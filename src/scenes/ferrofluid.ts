import * as THREE from 'three/webgpu';
import {
  Break,
  Fn,
  If,
  Loop,
  atan,
  color,
  float,
  mix,
  normalize,
  screenUV,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { FrameFeatures } from '../audio/features';
import type { Palette } from '../types/song-analysis';
import type { ParamSpec, SceneContext, VisualScene } from './scene';

const RT_W = 1280;
const RT_H = 720;
const MARCH_STEPS = 75;

/**
 * 2nd-order damped harmonic spring oscillator:
 * Simulates fluid surface tension and magnetic field elasticity.
 */
class Spring1D {
  val: number;
  vel = 0;
  target: number;
  k: number;
  damp: number;

  constructor(initial = 0, k = 140, damp = 11) {
    this.val = initial;
    this.target = initial;
    this.k = k;
    this.damp = damp;
  }

  update(dt: number): number {
    const force = (this.target - this.val) * this.k;
    const damping = this.vel * this.damp;
    const accel = force - damping;
    this.vel += accel * dt;
    this.val += this.vel * dt;
    return this.val;
  }

  impulse(force: number): void {
    this.vel += force;
  }
}

/**
 * FerrofluidBlob:
 * A suspended 3D magnetic liquid blob with genuine Rosensweig instability spikes.
 * Viewed from below looking upwards for a towering, dramatic perspective.
 * Pure deep-space void background with no gray substrate or ground plane.
 * Smooth, serene, stabilized camera motion without erratic hopping.
 */
export class FerrofluidBlob implements VisualScene {
  readonly name = 'ferrofluid';

  readonly params: Record<string, ParamSpec> = {
    magnetForce: { default: 1.4, min: 0.3, max: 3.0 },
    fluidity: { default: 1.0, min: 0.2, max: 2.5 },
    viscosity: { default: 0.7, min: 0.1, max: 2.0 },
    iridescence: { default: 1.0, min: 0.0, max: 2.5 },
    coreGlow: { default: 0.8, min: 0.0, max: 2.5 },
    fade: { default: 1, min: 0, max: 1 },
    inhale: { default: 0, min: 0, max: 1 },
    burst: { default: 0, min: 0, max: 1 },
  };

  // Camera looking from below upwards at the ferrofluid
  private uCamPos = uniform(new THREE.Vector3(0, -1.9, 3.8));
  private uLookTarget = uniform(new THREE.Vector3(0, 0.35, 0));
  private uSpikeHeight = uniform(0.18); // Height of Rosensweig spikes
  private uBlobRadius = uniform(1.55); // Overall puddle radius
  private uBlobWobble = uniform(new THREE.Vector4(0, 0, 0, 0)); // Harmonic shape deformation
  private uPulse = uniform(0.1);
  private uTime = uniform(0);
  private uFade = uniform(1);
  private uLow = uniform(color('#030308'));
  private uHigh = uniform(color('#4ce0d2'));
  private uPeak = uniform(color('#ffffff'));
  private uAccent = uniform(color('#8a7cff'));

  // Physical spring oscillators
  private spikeSpring = new Spring1D(0.12, 130, 10);
  private radiusSpring = new Spring1D(1.5, 100, 8);
  private pulseSpring = new Spring1D(0.1, 90, 8);

  // Beat-synced camera orbit & centroid-driven height
  private orbitAngle = 0;
  private prevBeatPhase = 0;
  private camY = -1.9;
  private lookTargetY = 0.35;
  private camDist = 3.85;

  private prevSpectrum = new Float32Array(512);
  private time = 0;
  private inhale = 0;
  private burst = 0;

  // Render pipeline
  private rt: THREE.RenderTarget;
  private fboScene = new THREE.Scene();
  private fboCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private marchQuad: THREE.Mesh | null = null;
  private displayMesh: THREE.Mesh | null = null;
  private displayRead = texture(new THREE.Texture());
  private ctx: SceneContext | null = null;

  private paramValues: Record<string, number> = {};

  constructor() {
    this.rt = new THREE.RenderTarget(RT_W, RT_H, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
  }

  getParam(name: string): number {
    return this.paramValues[name] ?? this.params[name]?.default ?? 0;
  }

  setParam(name: string, value: number): void {
    this.paramValues[name] = value;
    switch (name) {
      case 'fade':
        this.uFade.value = value;
        break;
      case 'inhale':
        this.inhale = value;
        break;
      case 'burst':
        this.burst = value;
        break;
    }
  }

  init(ctx: SceneContext): void {
    this.ctx = ctx;

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = Fn(() => {
      // Perspective camera ray looking from below upwards at the ferrofluid
      const ndc = uv().mul(2).sub(vec2(1, 1)).mul(vec2(RT_W / RT_H, 1));
      const ro = vec3(this.uCamPos.x, this.uCamPos.y, this.uCamPos.z);
      const fwd = normalize(this.uLookTarget.sub(ro));
      const right = normalize(vec3(fwd.z, 0, fwd.x.negate()));
      const up = right.cross(fwd);
      const rd = normalize(fwd.add(right.mul(ndc.x.mul(0.68))).add(up.mul(ndc.y.mul(0.68))));

      // Organic Random Blob Puddle Radius calculation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getBlobRadius = (ang: any) => {
        const w = this.uBlobWobble;
        const pert = float(1.0)
          .add(ang.mul(2.0).add(w.x).cos().mul(0.18))
          .add(ang.mul(3.0).add(w.y).sin().mul(0.14))
          .add(ang.mul(5.0).add(w.z).cos().mul(0.09))
          .add(ang.mul(7.0).add(w.w).sin().mul(0.06));
        return this.uBlobRadius.mul(pert);
      };

      // Full 3D Volumetric Ferrofluid SDF (No ground plane, no gray substrate)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sdFerrofluid = (posIn: any) => {
        const p = posIn;
        const x = p.x;
        const z = p.z;
        const y = p.y;
        const r = p.xz.length();
        const ang = atan(z, x);
        const rMax = getBlobRadius(ang);

        // Normalized radial distance [0 = center, 1 = boundary]
        const uNorm = r.div(rMax);

        // Meniscus height profile (contact angle at boundary)
        const baseDome = float(1.0).sub(uNorm.mul(uNorm)).max(0.0).sqrt().mul(0.32);

        // Rosensweig Instability Hexagonal Grid of Cones
        const kSpike = float(6.8);
        const s1 = x.mul(kSpike).cos();
        const s2 = x.mul(0.5).add(z.mul(0.866025)).mul(kSpike).cos();
        const s3 = x.mul(0.5).sub(z.mul(0.866025)).mul(kSpike).cos();
        const hexSum = s1.add(s2).add(s3).div(3.0);
        const hexNorm = hexSum.add(1.0).mul(0.5);

        // Sharp conical peaks (Rosensweig spikes)
        const cones = hexNorm.pow(4.0);

        // Secondary higher-frequency needle harmonics
        const micro = x.mul(14.0).cos().mul(z.mul(14.0).cos()).add(1.0).mul(0.5).pow(3.0).mul(0.22);

        // Mask spikes smoothly near the rim so spikes erupt organically from the fluid body
        const spikeMask = smoothstep(float(0.96), float(0.15), uNorm);
        const spikes = cones.add(micro).mul(this.uSpikeHeight).mul(spikeMask);

        // Double-sided 3D fluid volume:
        // Top surface crowns upward, bottom surface spikes downwards toward camera
        const yTop = baseDome.add(spikes.mul(0.65));
        const yBottom = baseDome.mul(0.6).add(spikes.mul(1.35)).negate();

        // Signed distance to vertical bounds
        const dY = y.sub(yTop).max(yBottom.sub(y));
        const dXZ = r.sub(rMax);

        // Solid 3D fluid mass
        return mix(dY.max(dXZ), dXZ.max(y.abs()), uNorm.greaterThan(1.0));
      };

      // Raymarching execution
      const t = float(0.1).toVar();
      const hit = float(0).toVar();
      const pos = vec3(0, 0, 0).toVar();
      const minApproach = float(10.0).toVar();

      Loop({ start: 0, end: MARCH_STEPS, type: 'int' }, () => {
        pos.assign(ro.add(rd.mul(t)));

        const d = sdFerrofluid(pos);
        minApproach.assign(minApproach.min(d));

        If(d.lessThan(0.0025), () => {
          hit.assign(1);
          Break();
        });

        If(t.greaterThan(10.0), () => {
          Break();
        });

        const step = d.mul(0.68).max(0.0035);
        t.addAssign(step);
      });

      // Surface Normal via finite differences on sdFerrofluid
      const eps = float(0.004);
      const nx = sdFerrofluid(pos.add(vec3(eps, 0, 0))).sub(sdFerrofluid(pos.sub(vec3(eps, 0, 0))));
      const ny = sdFerrofluid(pos.add(vec3(0, eps, 0))).sub(sdFerrofluid(pos.sub(vec3(0, eps, 0))));
      const nz = sdFerrofluid(pos.add(vec3(0, 0, eps))).sub(sdFerrofluid(pos.sub(vec3(0, 0, eps))));
      const norm = normalize(vec3(nx, ny, nz));

      // View & Lighting vectors
      const v = rd.negate();
      const lKey = normalize(vec3(1.8, 3.5, 2.0)); // Overhead key light
      const lFill = normalize(vec3(-2.2, -2.4, 2.2)); // Lower fill light illuminating spikes from below
      const lRim = normalize(vec3(0.0, 3.2, -3.0)); // Top-back rim light

      // Specular Blinn-Phong highlights on the fluid spikes
      const hKey = normalize(lKey.add(v));
      const hFill = normalize(lFill.add(v));
      const hRim = normalize(lRim.add(v));

      const specKeySharp = norm.dot(hKey).max(0.0).pow(128.0);
      const specKeyBroad = norm.dot(hKey).max(0.0).pow(22.0);
      const specFill = norm.dot(hFill).max(0.0).pow(32.0);
      const specRim = norm.dot(hRim).max(0.0).pow(64.0);

      // Deep jet-black mirror obsidian chrome liquid
      const jetBlack = vec3(0.009, 0.010, 0.014);

      // Thin-film oil sheen along glancing angles (Fresnel iridescence)
      const nDotV = norm.dot(v).max(0.0);
      const fresnel = float(1.0).sub(nDotV).pow(3.5);
      const oilSheen = mix(this.uHigh, this.uAccent, fresnel.mul(1.3).min(1.0));

      // Crisp mirror-chrome specular highlights on spike facets
      const chrome = this.uPeak.mul(
        specKeySharp.mul(2.6).add(specKeyBroad.mul(0.35)).add(specFill.mul(0.7)).add(specRim.mul(1.0)),
      );

      // Internal magnetic pulse through the fluid
      const pulseLight = this.uHigh.mul(this.uPulse.mul(0.45));

      const fluidColor = jetBlack
        .add(oilSheen.mul(fresnel.mul(0.8)))
        .add(chrome)
        .add(pulseLight);

      // Clean cosmic background: deep space void with subtle track palette aura
      const halo = smoothstep(float(2.4), float(0.0), minApproach);
      const spaceAura = mix(this.uLow.mul(0.02), this.uAccent.mul(0.12), halo);

      const finalColor = mix(spaceAura, fluidColor, hit);

      return vec4(finalColor.mul(this.uFade), 1);
    })();

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.position.z = -1;
    this.marchQuad = quad;
    this.fboScene.add(quad);

    const displayMat = new THREE.MeshBasicNodeMaterial();
    this.displayRead.value = this.rt.texture;
    displayMat.colorNode = Fn(() => {
      return this.displayRead.sample(screenUV).rgb.mul(this.uFade);
    })();
    const displayMesh = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), displayMat);
    displayMesh.frustumCulled = false;
    this.displayMesh = displayMesh;
    ctx.scene.add(displayMesh);
  }

  setVisible(v: boolean): void {
    if (this.displayMesh) this.displayMesh.visible = v;
  }

  update(features: FrameFeatures, dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.displayMesh?.visible || !this.marchQuad) return;

    const subDt = Math.min(dt, 0.04);
    this.time += dt;
    this.uTime.value = this.time;

    // Instantaneous positive spectral flux (audio transient & onset magnitude)
    let flux = 0;
    const spec = features.spectrum;
    const len = Math.min(spec.length, this.prevSpectrum.length);
    for (let i = 0; i < len; i++) {
      const diff = spec[i] - this.prevSpectrum[i];
      if (diff > 0) flux += diff;
      this.prevSpectrum[i] = spec[i];
    }
    const fluxNorm = Math.min(1, flux * 0.16);

    const force = this.getParam('magnetForce');
    const fluidity = this.getParam('fluidity');
    const viscosity = this.getParam('viscosity');

    // Dynamic spring properties
    this.spikeSpring.k = 135 * fluidity;
    this.spikeSpring.damp = 11 * viscosity;
    this.radiusSpring.k = 100 * fluidity;
    this.radiusSpring.damp = 9 * viscosity;

    // 1. Audio metrics (RMS Level, Bass & Spectral Flux) drive spike eruption:
    const inhaleFactor = 1 - this.inhale * 0.65;

    // Rosensweig spike height target
    const spikeTarget =
      (0.1 + (features.level * 0.95 + features.bass * 0.85 + fluxNorm * 0.6) * force + this.burst * 1.3) *
      inhaleFactor;
    this.spikeSpring.target = Math.max(0.06, spikeTarget);

    // Puddle spreading target
    const radiusTarget = 1.5 + (features.bass * 0.35 + features.level * 0.25) * force;
    this.radiusSpring.target = radiusTarget;

    // 2. Transients deliver explosive kinetic shockwaves to spike tips
    if (fluxNorm > 0.12) {
      this.spikeSpring.impulse(fluxNorm * 3.4 * fluidity);
    }

    if (features.downbeat) {
      this.spikeSpring.impulse(1.8 * fluidity);
      this.radiusSpring.impulse(0.35 * fluidity);
      this.pulseSpring.impulse(2.0);
    } else if (features.onset) {
      this.spikeSpring.impulse(0.8 * fluidity);
      this.pulseSpring.impulse(0.9);
    }

    // Update physical harmonic oscillators
    const currentSpikes = Math.max(0.05, this.spikeSpring.update(subDt));
    const currentRadius = Math.max(1.1, this.radiusSpring.update(subDt));
    const currentPulse = Math.max(0.05, this.pulseSpring.update(subDt));

    // Push physical values to raymarching uniforms
    this.uSpikeHeight.value = currentSpikes;
    this.uBlobRadius.value = currentRadius;
    this.uPulse.value = currentPulse;

    // Smooth, slow organic blob contour breathing (no rapid jitter)
    const t = this.time * 0.15;
    (this.uBlobWobble.value as THREE.Vector4).set(
      t * 0.7,
      t * 1.1 + 1.2,
      t * 0.5 + 2.4,
      t * 0.9 + 3.1,
    );

    // 1. Camera circular orbit IN RHYTHM TO THE BEAT (Slow, cinematic & hypnotic):
    if (features.beatPhase !== null) {
      let phaseDelta = features.beatPhase - this.prevBeatPhase;
      if (phaseDelta < -0.5) phaseDelta += 1.0; // wrapped to new beat
      if (phaseDelta > 0 && phaseDelta < 0.5) {
        // Slow, majestic rotation: 1 full 360° circle every 64 beats (~16 musical bars in 4/4)
        // Gentle groove modulation: soft rhythmic pulse on the beat stroke
        const groove = 1.0 + Math.sin(features.beatPhase * Math.PI) * 0.3;
        this.orbitAngle += phaseDelta * (Math.PI / 32) * groove;
      }
      this.prevBeatPhase = features.beatPhase;
    } else {
      // Continuous slow groove fallback when beatPhase is null (live audio / idle)
      const tempoSpeed = 0.08 + features.level * 0.07;
      this.orbitAngle += subDt * tempoSpeed;
    }

    if (features.downbeat) {
      // Subtle rhythmic accent on the downbeat ("1" of the bar)
      this.orbitAngle += 0.008;
    }

    // 2. Camera moving UP / DOWN driven by spectral centroid & treble:
    // Spectral centroid (frequency brightness) + treble smoothly lifts camera up,
    // while sub-bass / dark moments drop the camera deep underneath the liquid mass!
    const brightFactor = Math.min(1, features.centroid * 1.35 + features.treble * 0.65);
    // Y range: -2.35 (steep low-angle looking up) to -0.65 (elevated side-view)
    const targetY = -2.35 + brightFactor * 1.7;
    this.camY += (targetY - this.camY) * Math.min(1, subDt * 3.0);

    // Target slightly tilts up when bass hits
    const targetLookY = 0.25 + features.bass * 0.25;
    this.lookTargetY += (targetLookY - this.lookTargetY) * Math.min(1, subDt * 3.5);

    // 3. Automatic dynamic zoom in / zoom out (отдаление/приближение кадра):
    // - Continuous slow cinematic breathing cycle between intimate close-up and epic wide shot
    const breathingCycle = Math.sin(this.time * 0.065) * 0.55;
    // - Audio energy reactivity: quiet moments pull in close (~3.0), loud drops/bass push out (~4.8)
    const energyZoom = (features.level * 0.85 + features.bass * 0.65 + this.burst * 1.1) - 0.4;
    // - Track section progression if available
    const sectionFactor = ((features.energyPercentile ?? 0.5) - 0.5) * 0.4;

    const desiredDist = Math.max(2.85, Math.min(5.1, 3.8 + breathingCycle + energyZoom + sectionFactor));
    this.camDist += (desiredDist - this.camDist) * Math.min(1, subDt * 2.2);

    // Position camera with dynamic zoom & angle
    (this.uCamPos.value as THREE.Vector3).set(
      Math.sin(this.orbitAngle) * this.camDist,
      this.camY,
      Math.cos(this.orbitAngle) * this.camDist,
    );
    (this.uLookTarget.value as THREE.Vector3).set(0, this.lookTargetY, 0);

    // Render raymarched FBO
    const prev = ctx.renderer.getRenderTarget();
    ctx.renderer.setRenderTarget(this.rt);
    ctx.renderer.render(this.fboScene, this.fboCamera);
    ctx.renderer.setRenderTarget(prev);
  }

  updateCamera(camera: THREE.PerspectiveCamera): void {
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
  }

  applyPalette(p: Palette): void {
    (this.uLow.value as THREE.Color).set(p.background);
    (this.uHigh.value as THREE.Color).set(p.primary);
    (this.uPeak.value as THREE.Color).set(p.accent);
    (this.uAccent.value as THREE.Color).set(p.secondary || '#8a7cff');
  }

  dispose(): void {
    if (this.displayMesh && this.ctx) {
      this.ctx.scene.remove(this.displayMesh);
      this.displayMesh.geometry.dispose();
      (this.displayMesh.material as THREE.Material).dispose();
    }
    this.rt.dispose();
  }
}
