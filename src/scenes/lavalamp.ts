import * as THREE from 'three/webgpu';
import {
  Break,
  Fn,
  If,
  Loop,
  color,
  cos,
  float,
  mix,
  normalize,
  screenUV,
  sin,
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
const MARCH_STEPS = 64;

interface BlobState {
  x: number;
  y: number;
  z: number;
  r: number;
  baseR: number;
  vy: number;
  vx: number;
  vz: number;
  phase: number;
  freq: number;
  buoyancy: number;
}

/**
 * LavaLamp (Immersive Interior):
 * We are INSIDE the glowing fluid core of the lava lamp!
 * Giant, glowing, translucent wax metaballs float, stretch, merge, and drift
 * around our field of view in a warm, illuminated, viscous medium.
 * Driven by audio transients and bass: thermal convection currents push giant
 * glowing wax globules upward, where they slowly cool, fuse, and cascade back down.
 */
export class LavaLamp implements VisualScene {
  readonly name = 'lavalamp';

  readonly params: Record<string, ParamSpec> = {
    convection: { default: 1.2, min: 0.2, max: 3.0 },
    viscosity: { default: 1.1, min: 0.3, max: 2.5 },
    glow: { default: 1.2, min: 0.2, max: 3.0 },
    fluidTurbulence: { default: 0.8, min: 0.0, max: 2.0 },
    fade: { default: 1, min: 0, max: 1 },
    inhale: { default: 0, min: 0, max: 1 },
    burst: { default: 0, min: 0, max: 1 },
  };

  // 8 Giant floating wax metaballs in 3D surrounding camera: (x, y, z, radius)
  private uBlob0 = uniform(new THREE.Vector4(0.2, -0.6, 0.4, 1.1));
  private uBlob1 = uniform(new THREE.Vector4(-1.4, 0.8, -0.5, 0.95));
  private uBlob2 = uniform(new THREE.Vector4(1.5, 1.2, -0.8, 1.05));
  private uBlob3 = uniform(new THREE.Vector4(-0.6, -1.5, 0.9, 1.15));
  private uBlob4 = uniform(new THREE.Vector4(0.8, 2.1, 0.5, 0.9));
  private uBlob5 = uniform(new THREE.Vector4(-1.2, -0.4, 1.6, 0.85));
  private uBlob6 = uniform(new THREE.Vector4(1.1, -1.2, -1.4, 1.0));
  private uBlob7 = uniform(new THREE.Vector4(-0.3, 0.6, -1.8, 0.9));

  // Dynamic audio & camera uniforms
  private uCamPos = uniform(new THREE.Vector3(0, 0, 0));
  private uLookTarget = uniform(new THREE.Vector3(0, 0.2, -3.0));
  private uViscosity = uniform(1.1);
  private uGlow = uniform(1.2);
  private uThermalPulse = uniform(0.1);
  private uTime = uniform(0);
  private uFade = uniform(1);

  // Palette colors
  private uLow = uniform(color('#15031b')); // Deep warm fluid medium
  private uHigh = uniform(color('#ff3d1f')); // Luminous hot lava wax
  private uPeak = uniform(color('#ffaa22')); // Incandescent thermal glow
  private uAccent = uniform(color('#ff0077')); // Iridescent fluid edge sheen

  // CPU 3D Blob Physics
  private blobs: BlobState[] = [
    { x: 0.15, y: -0.6, z: 0.3, r: 1.15, baseR: 1.15, vy: 0.22, vx: 0.05, vz: -0.04, phase: 0.0, freq: 0.5, buoyancy: 1.2 },
    { x: -1.35, y: 0.75, z: -0.45, r: 0.95, baseR: 0.95, vy: 0.18, vx: -0.06, vz: 0.05, phase: 1.3, freq: 0.6, buoyancy: 1.0 },
    { x: 1.45, y: 1.15, z: -0.75, r: 1.05, baseR: 1.05, vy: -0.20, vx: 0.04, vz: -0.07, phase: 2.7, freq: 0.45, buoyancy: 0.9 },
    { x: -0.55, y: -1.45, z: 0.85, r: 1.2, baseR: 1.2, vy: 0.26, vx: 0.07, vz: 0.03, phase: 3.9, freq: 0.55, buoyancy: 1.3 },
    { x: 0.75, y: 2.05, z: 0.45, r: 0.9, baseR: 0.9, vy: -0.24, vx: -0.05, vz: 0.06, phase: 4.8, freq: 0.4, buoyancy: 0.8 },
    { x: -1.15, y: -0.35, z: 1.55, r: 0.85, baseR: 0.85, vy: 0.21, vx: -0.04, vz: -0.05, phase: 5.4, freq: 0.65, buoyancy: 1.1 },
    { x: 1.05, y: -1.15, z: -1.35, r: 1.0, baseR: 1.0, vy: 0.19, vx: 0.05, vz: 0.08, phase: 0.8, freq: 0.5, buoyancy: 1.05 },
    { x: -0.25, y: 0.55, z: -1.75, r: 0.9, baseR: 0.9, vy: -0.17, vx: -0.07, vz: -0.03, phase: 2.1, freq: 0.48, buoyancy: 0.95 },
  ];

  private time = 0;
  private camAngle = 0;
  private camPitch = 0;
  private camDist = 2.4;
  private bulbPulse = 0;
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
      case 'viscosity':
        this.uViscosity.value = value;
        break;
      case 'glow':
        this.uGlow.value = value;
        break;
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
      // Perspective camera inside the fluid looking through the wax globules
      const ndc = uv().mul(2).sub(vec2(1, 1)).mul(vec2(RT_W / RT_H, 1));
      const ro = vec3(this.uCamPos.x, this.uCamPos.y, this.uCamPos.z);
      const fwd = normalize(this.uLookTarget.sub(ro));
      const right = normalize(vec3(fwd.z, 0, fwd.x.negate()));
      const up = right.cross(fwd);
      const rd = normalize(fwd.add(right.mul(ndc.x.mul(0.72))).add(up.mul(ndc.y.mul(0.72))));

      // Polynomial smooth minimum for viscous, stretching wax necks
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const smin = (a: any, b: any, k: any) => {
        const h = float(1.0).sub(a.sub(b).abs().div(k)).max(0.0);
        return a.min(b).sub(h.mul(h).mul(h).mul(k).mul(1.0 / 6.0));
      };

      // Interior Wax Metaball Field SDF
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sdWaxField = (pIn: any) => {
        const p = pIn;
        const kBlend = float(0.75).mul(this.uViscosity);

        const d0 = p.sub(this.uBlob0.xyz).length().sub(this.uBlob0.w);
        const d1 = p.sub(this.uBlob1.xyz).length().sub(this.uBlob1.w);
        const d2 = p.sub(this.uBlob2.xyz).length().sub(this.uBlob2.w);
        const d3 = p.sub(this.uBlob3.xyz).length().sub(this.uBlob3.w);
        const d4 = p.sub(this.uBlob4.xyz).length().sub(this.uBlob4.w);
        const d5 = p.sub(this.uBlob5.xyz).length().sub(this.uBlob5.w);
        const d6 = p.sub(this.uBlob6.xyz).length().sub(this.uBlob6.w);
        const d7 = p.sub(this.uBlob7.xyz).length().sub(this.uBlob7.w);

        let d = smin(d0, d1, kBlend);
        d = smin(d, d2, kBlend);
        d = smin(d, d3, kBlend);
        d = smin(d, d4, kBlend);
        d = smin(d, d5, kBlend);
        d = smin(d, d6, kBlend);
        d = smin(d, d7, kBlend);

        // Acoustic fluid wobble & ripples on bass kicks (turns stiff balls into quivering molten wax)
        const wobble = sin(p.x.mul(3.2).add(this.uTime.mul(2.2)))
          .mul(cos(p.y.mul(3.0).sub(this.uTime.mul(1.8))))
          .mul(this.uThermalPulse)
          .mul(0.045);

        return d.add(wobble);
      };

      // Raymarching inside the fluid
      const t = float(0.15).toVar();
      const hit = float(0).toVar();
      const pos = vec3(0, 0, 0).toVar();
      const volGlow = float(0.0).toVar();

      Loop({ start: 0, end: MARCH_STEPS, type: 'int' }, () => {
        pos.assign(ro.add(rd.mul(t)));

        const d = sdWaxField(pos);

        // Accumulate warm internal volumetric fluid glow
        const proximity = smoothstep(float(1.2), float(0.0), d);
        volGlow.addAssign(proximity.mul(0.038));

        // Suspended golden micro-bubbles & flecks caught in the convection currents
        const sparkPos = pos.mul(2.2).add(vec3(0, this.uTime.mul(0.4), 0));
        const sparkGrid = sparkPos.fract().sub(0.5);
        const sparkDist = sparkGrid.length();
        const spark = smoothstep(float(0.13), float(0.02), sparkDist).mul(smoothstep(float(2.0), float(0.2), d));
        volGlow.addAssign(spark.mul(0.08).mul(this.uGlow));

        If(d.lessThan(0.0035), () => {
          hit.assign(1);
          Break();
        });

        If(t.greaterThan(12.0), () => {
          Break();
        });

        const step = d.mul(0.68).max(0.004);
        t.addAssign(step);
      });

      // Surface Normal calculation
      const eps = float(0.005);
      const nx = sdWaxField(pos.add(vec3(eps, 0, 0))).sub(sdWaxField(pos.sub(vec3(eps, 0, 0))));
      const ny = sdWaxField(pos.add(vec3(0, eps, 0))).sub(sdWaxField(pos.sub(vec3(0, eps, 0))));
      const nz = sdWaxField(pos.add(vec3(0, 0, eps))).sub(sdWaxField(pos.sub(vec3(0, 0, eps))));
      const norm = normalize(vec3(nx, ny, nz));

      // View & Light directions
      const v = rd.negate();
      const lThermal = normalize(vec3(0.1, 1.0, 0.2)); // Upward thermal light from glowing bottom
      const lKey = normalize(vec3(1.2, 1.8, 1.5)); // Soft overhead ambient fill

      const hKey = normalize(lKey.add(v));
      const hThermal = normalize(lThermal.add(v));

      const specKey = norm.dot(hKey).max(0.0).pow(36.0);
      const specThermal = norm.dot(hThermal).max(0.0).pow(24.0);

      // Shimmering 3D fluid caustics across the surfaces
      const cCoord = pos.mul(1.6).add(vec3(0, this.uTime.mul(0.35), 0));
      const cWave1 = sin(cCoord.x.mul(2.2).add(cCoord.y.mul(1.6))).mul(cos(cCoord.z.mul(2.0).sub(cCoord.y.mul(1.3))));
      const cWave2 = cos(cCoord.x.mul(1.8).sub(cCoord.z.mul(2.3))).mul(sin(cCoord.y.mul(2.6).add(cCoord.x.mul(1.1))));
      const caustics = cWave1.add(cWave2).mul(0.5).max(0.0).pow(2.5).mul(0.8);

      // Fresnel rim iridescence along wax curves
      const nDotV = norm.dot(v).max(0.0);
      const fresnel = float(1.0).sub(nDotV).pow(2.8);

      // Subsurface transmission: light glowing through translucent wax body
      const transLight = norm.dot(lThermal.negate()).max(0.0).pow(1.8).mul(1.4);

      // Thermal gradient & internal molten magma marbling striations
      const marble = sin(pos.y.mul(3.6).add(sin(pos.x.mul(2.6).add(pos.z.mul(2.0))).mul(2.2))).mul(0.5).add(0.5);
      const thermalY = smoothstep(float(3.2), float(-3.0), pos.y);
      const waxCoreColor = mix(this.uHigh, this.uPeak, thermalY.add(marble.mul(0.35)).add(this.uThermalPulse).min(1.0));

      // Spectral thin-film iridescent oil sheen on wax skin
      const iridPhase = fresnel.mul(5.5).add(pos.y.mul(0.35)).add(this.uTime.mul(0.3));
      const iridR = sin(iridPhase).mul(0.5).add(0.5);
      const iridG = sin(iridPhase.add(2.09)).mul(0.5).add(0.5);
      const iridB = sin(iridPhase.add(4.18)).mul(0.5).add(0.5);
      const iridescence = vec3(iridR, iridG, iridB);

      // Wax surface illumination
      const waxSubsurface = this.uPeak.mul(transLight.add(this.uThermalPulse.mul(0.8))).mul(this.uGlow);
      const waxFresnel = mix(this.uHigh, mix(this.uAccent, iridescence, 0.7), fresnel);
      const waxSpecular = this.uPeak.mul(specThermal.mul(1.6).add(specKey.mul(1.2)).add(caustics.mul(0.7)));

      const surfaceColor = waxCoreColor
        .add(waxSubsurface)
        .add(waxFresnel.mul(fresnel.mul(0.85)))
        .add(waxSpecular);

      // Surrounding illuminated fluid medium with rising heat shafts
      const shaftCoord = pos.xz.mul(1.1).add(vec2(this.uTime.mul(0.1), this.uTime.mul(0.08)));
      const shaft = sin(shaftCoord.x.mul(2.8)).mul(cos(shaftCoord.y.mul(2.8))).mul(0.5).add(0.5).mul(thermalY);
      const fluidFogColor = mix(this.uLow.mul(0.08), this.uAccent.mul(0.24), volGlow.mul(this.uGlow).min(1.0));
      const finalFluidColor = fluidFogColor.add(this.uPeak.mul(volGlow.mul(0.18).add(shaft.mul(0.15))));

      // Depth fog blend
      const depthFog = smoothstep(float(11.0), float(2.0), t);
      const compColor = mix(finalFluidColor, surfaceColor, hit.mul(depthFog));

      return vec4(compColor.mul(this.uFade), 1);
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

    const convection = this.getParam('convection');
    const glow = this.getParam('glow');

    // 1. Audio Thermal Pulse (Bass / Kick drives thermal convection and heat flares)
    const inhaleFactor = 1 - this.inhale * 0.5;
    const bassHeat = (features.bass * 1.5 + features.level * 1.0 + this.burst * 1.6) * convection * inhaleFactor;

    if (features.downbeat) {
      this.bulbPulse = 1.9;
    } else if (features.onset) {
      this.bulbPulse = Math.max(this.bulbPulse, 1.1);
    }
    this.bulbPulse *= Math.pow(0.86, subDt * 60);

    // Push thermal pulse to shader
    this.uThermalPulse.value = (features.bass * 0.4 + this.bulbPulse * 0.5) * inhaleFactor;
    this.uGlow.value = glow * (1.0 + this.bulbPulse * 0.35 + features.level * 0.3);

    // 2. 3D Wax Metaball Convection Physics
    const speed = (0.55 + bassHeat * 0.45) * subDt;

    for (let i = 0; i < this.blobs.length; i++) {
      const b = this.blobs[i];
      b.phase += subDt * b.freq;

      // Vertical convective motion
      b.y += b.vy * speed * b.buoyancy;

      // 3D fluid currents: gentle swirling inside the medium
      b.x += b.vx * speed + Math.sin(b.phase + i) * 0.008;
      b.z += b.vz * speed + Math.cos(b.phase * 0.9 + i * 1.3) * 0.008;

      // Vertical loop boundaries with smooth velocity reversals:
      // When reaching top, wax cools down and starts descending
      if (b.y > 2.8 && b.vy > 0) {
        b.vy = -Math.abs(b.vy) * (0.85 + Math.random() * 0.2);
        b.vx = (Math.random() - 0.5) * 0.15;
        b.vz = (Math.random() - 0.5) * 0.15;
      }
      // When reaching bottom, hot thermal reservoir expands wax and pushes it upward
      else if (b.y < -2.8 && b.vy < 0) {
        b.vy = (0.22 + Math.random() * 0.18 + bassHeat * 0.25) * (0.8 + convection * 0.3);
        b.vx = (Math.random() - 0.5) * 0.15;
        b.vz = (Math.random() - 0.5) * 0.15;
      }

      // Horizontal boundary bouncing
      if (Math.abs(b.x) > 2.6) b.vx = -b.vx * 0.8;
      if (Math.abs(b.z) > 2.6) b.vz = -b.vz * 0.8;

      // Organic shape swelling with audio transients
      const audioExpansion = b.y < 0 ? bassHeat * 0.12 : 0;
      b.r = b.baseR * (1.0 + Math.sin(b.phase * 2.0) * 0.06 + audioExpansion);
    }

    // Push blob positions to uniforms
    (this.uBlob0.value as THREE.Vector4).set(this.blobs[0].x, this.blobs[0].y, this.blobs[0].z, this.blobs[0].r);
    (this.uBlob1.value as THREE.Vector4).set(this.blobs[1].x, this.blobs[1].y, this.blobs[1].z, this.blobs[1].r);
    (this.uBlob2.value as THREE.Vector4).set(this.blobs[2].x, this.blobs[2].y, this.blobs[2].z, this.blobs[2].r);
    (this.uBlob3.value as THREE.Vector4).set(this.blobs[3].x, this.blobs[3].y, this.blobs[3].z, this.blobs[3].r);
    (this.uBlob4.value as THREE.Vector4).set(this.blobs[4].x, this.blobs[4].y, this.blobs[4].z, this.blobs[4].r);
    (this.uBlob5.value as THREE.Vector4).set(this.blobs[5].x, this.blobs[5].y, this.blobs[5].z, this.blobs[5].r);
    (this.uBlob6.value as THREE.Vector4).set(this.blobs[6].x, this.blobs[6].y, this.blobs[6].z, this.blobs[6].r);
    (this.uBlob7.value as THREE.Vector4).set(this.blobs[7].x, this.blobs[7].y, this.blobs[7].z, this.blobs[7].r);

    // 3. First-Person Camera Fluid Navigation:
    // Gliding smoothly inside the liquid medium in rhythm with the beat
    if (features.beatPhase !== null) {
      this.camAngle += subDt * 0.14;
    } else {
      this.camAngle += subDt * 0.11;
    }

    // Dynamic zoom / proximity breathing inside the fluid
    const slowBreathe = Math.sin(this.time * 0.065) * 0.45;
    const energyZoom = (features.level * 0.6 + features.bass * 0.4) - 0.25;
    const desiredDist = Math.max(1.8, Math.min(3.8, 2.6 + slowBreathe + energyZoom));
    this.camDist += (desiredDist - this.camDist) * Math.min(1, subDt * 2.2);

    this.camPitch = Math.sin(this.time * 0.08) * 0.35 + (features.centroid - 0.5) * 0.5;

    // Camera floats inside the fluid space
    const camX = Math.sin(this.camAngle) * this.camDist;
    const camZ = Math.cos(this.camAngle) * this.camDist;
    const camY = this.camPitch;

    (this.uCamPos.value as THREE.Vector3).set(camX, camY, camZ);
    // Camera gazes across the floating globules
    (this.uLookTarget.value as THREE.Vector3).set(
      Math.sin(this.camAngle + Math.PI * 0.4) * 0.8,
      camY * 0.4,
      Math.cos(this.camAngle + Math.PI * 0.4) * 0.8,
    );

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
    (this.uLow.value as THREE.Color).set(p.background || '#15031b');
    (this.uHigh.value as THREE.Color).set(p.primary || '#ff3d1f');
    (this.uPeak.value as THREE.Color).set(p.accent || '#ffaa22');
    (this.uAccent.value as THREE.Color).set(p.secondary || '#ff0077');
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
