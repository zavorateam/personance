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
  sqrt,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { FrameFeatures } from '../audio/features';
import { defaultVltkTags } from '../audio/vltk-tags';
import type { Palette } from '../types/song-analysis';
import type { ParamSpec, SceneContext, VisualScene } from './scene';
import { oklabMix, oklabPaletteRamp3 } from '../analysis/oklab-tsl';

const RT_W = 1280;
const RT_H = 720;
const MARCH_STEPS = 72;

// Virtual invisible containment volume dimensions
const JAR_R = 1.92;
const JAR_BOTTOM = -1.32;
const JAR_TOP = 1.52;
const DROPLET_COUNT = 10;

/**
 * 2nd-order damped harmonic spring oscillator:
 * Simulates fluid surface tension, bounce elasticity, and magnetic field recoil.
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

interface DropletState {
  // World position & velocity inside the jar
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  // Base radius & animated radius
  baseR: number;
  r: number;
  // 3D anchor direction around the core (Fibonacci sphere shell)
  ax: number;
  ay: number;
  az: number;
  restDist: number;
  orbitPhase: number;
  orbitSpeed: number;
  susceptibility: number; // How strongly the external magnet pulls this droplet
  fission: number; // Temporary beat-ejection boost
}

/**
 * FerrofluidBlob:
 * A 3D spherical magnetic droplet-cluster suspended inside a glass jar,
 * pulled and torn along X/Y/Z axes by sound apertures and cross-coupled VLTK_* tags,
 * with a virtual magnet behind the jar wall and multi-mode beat bounce physics.
 */
export class FerrofluidBlob implements VisualScene {
  readonly name = 'ferrofluid';

  readonly params: Record<string, ParamSpec> = {
    magnetForce: { default: 1.4, min: 0.3, max: 3.0 },
    fluidity: { default: 1.0, min: 0.2, max: 2.5 },
    viscosity: { default: 0.7, min: 0.1, max: 2.0 },
    dropletSpread: { default: 1.0, min: 0.2, max: 2.5 },
    iridescence: { default: 1.0, min: 0.0, max: 2.5 },
    coreGlow: { default: 0.8, min: 0.0, max: 2.5 },
    oklab: { default: 1, min: 0, max: 1 },
    fade: { default: 1, min: 0, max: 1 },
    inhale: { default: 0, min: 0, max: 1 },
    burst: { default: 0, min: 0, max: 1 },
  };

  // Camera uniforms
  private uCamPos = uniform(new THREE.Vector3(0, -0.35, 4.7));
  private uLookTarget = uniform(new THREE.Vector3(0, -0.1, 0));

  // Core blob & external magnet uniforms
  private uCorePos = uniform(new THREE.Vector3(0, -0.22, 0));
  private uCoreScale = uniform(new THREE.Vector3(1, 1, 1));
  private uCoreRadius = uniform(0.68);
  private uMagnetPos = uniform(new THREE.Vector3(2.45, 0.15, 0.3));
  private uMagnetPull = uniform(0.35);

  // Surface spikes, viscosity & iridescence uniforms
  private uSpikeHeight = uniform(0.14);
  private uSpikeFreq = uniform(7.2);
  private uViscosity = uniform(0.7);
  private uIridescence = uniform(1.0);
  private uCoreGlow = uniform(0.8);
  private uPulse = uniform(0.1);
  private uWobblePhase = uniform(new THREE.Vector4(0, 0, 0, 0));
  private uTime = uniform(0);
  private uOklab = uniform(1);
  private uFade = uniform(1);

  // 10 satellite droplets: (x, y, z, radius)
  private uDrop0 = uniform(new THREE.Vector4(0.5, 0.1, 0.2, 0.34));
  private uDrop1 = uniform(new THREE.Vector4(-0.45, 0.25, 0.3, 0.31));
  private uDrop2 = uniform(new THREE.Vector4(0.1, -0.45, 0.45, 0.36));
  private uDrop3 = uniform(new THREE.Vector4(-0.2, 0.5, -0.35, 0.29));
  private uDrop4 = uniform(new THREE.Vector4(0.45, -0.2, -0.4, 0.32));
  private uDrop5 = uniform(new THREE.Vector4(-0.5, -0.3, -0.15, 0.33));
  private uDrop6 = uniform(new THREE.Vector4(0.2, 0.52, 0.2, 0.27));
  private uDrop7 = uniform(new THREE.Vector4(-0.15, -0.52, -0.25, 0.30));
  private uDrop8 = uniform(new THREE.Vector4(0.35, 0.35, -0.35, 0.26));
  private uDrop9 = uniform(new THREE.Vector4(-0.35, -0.1, 0.45, 0.28));

  // Palette colors
  private uLow = uniform(color('#030308'));
  private uHigh = uniform(color('#4ce0d2'));
  private uPeak = uniform(color('#ffffff'));
  private uAccent = uniform(color('#8a7cff'));

  // Physical core body state inside the jar
  private corePos = new THREE.Vector3(0, -0.22, 0);
  private coreVel = new THREE.Vector3(0, 0, 0);
  private squashSpring = new Spring1D(1.0, 175, 11);
  private spikeSpring = new Spring1D(0.11, 140, 10);
  private pulseSpring = new Spring1D(0.1, 95, 8);
  private magnetPullSpring = new Spring1D(0.28, 85, 8);

  // Per-axis VLTK-coupled dispersion springs (X, Y, Z)
  private dispSpringX = new Spring1D(0, 90, 9);
  private dispSpringY = new Spring1D(0, 95, 9);
  private dispSpringZ = new Spring1D(0, 90, 9);

  // External magnet orbiting behind the jar wall
  private magnetAngle = 0.45;
  private magnetAngVel = 0.25;
  private magnetY = 0.05;
  private magnetDist = JAR_R + 0.62;
  private beatSideToggle = 1;

  // Droplet cluster state
  private droplets: DropletState[] = [];

  // Camera orbit & framing
  private orbitAngle = 0.2;
  private prevBeatPhase = 0;
  private camY = -0.25;
  private lookTargetY = -0.12;
  private camDist = 4.75;

  private prevSpectrum = new Float32Array(512);
  private fallbackTags = defaultVltkTags();
  private time = 0;
  private inhale = 0;
  private burst = 0;

  // Render pipeline
  private rt: THREE.RenderTarget | null = null;
  private fboScene = new THREE.Scene();
  private fboCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private marchQuad: THREE.Mesh | null = null;
  private displayMesh: THREE.Mesh | null = null;
  private displayRead = texture(new THREE.Texture());
  private ctx: SceneContext | null = null;

  private paramValues: Record<string, number> = {};

  constructor() {
    this.initDroplets();
  }

  private initDroplets(): void {
    // Golden-angle Fibonacci sphere distribution so idle state is an organic spherical droplet-blob
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const radii = [0.35, 0.31, 0.37, 0.28, 0.33, 0.32, 0.27, 0.30, 0.25, 0.29];
    this.droplets = [];
    for (let i = 0; i < DROPLET_COUNT; i++) {
      const y = 1 - (i / (DROPLET_COUNT - 1)) * 2;
      const radAtY = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = goldenAngle * i;
      const ax = Math.cos(theta) * radAtY;
      const az = Math.sin(theta) * radAtY;
      const restDist = 0.48 + (i % 3) * 0.11;
      const baseR = radii[i];
      this.droplets.push({
        x: this.corePos.x + ax * restDist,
        y: this.corePos.y + y * restDist,
        z: this.corePos.z + az * restDist,
        vx: 0,
        vy: 0,
        vz: 0,
        baseR,
        r: baseR,
        ax,
        ay: y,
        az,
        restDist,
        orbitPhase: i * 0.77,
        orbitSpeed: 0.35 + (i % 4) * 0.12,
        susceptibility: 0.65 + (i % 5) * 0.16,
        fission: 0,
      });
    }
  }

  getParam(name: string): number {
    if (name === 'oklab') return this.uOklab.value as number;
    return this.paramValues[name] ?? this.params[name]?.default ?? 0;
  }

  setParam(name: string, value: number): void {
    this.paramValues[name] = value;
    switch (name) {
      case 'oklab':
        this.uOklab.value = value;
        break;
      case 'viscosity':
        this.uViscosity.value = value;
        break;
      case 'iridescence':
        this.uIridescence.value = value;
        break;
      case 'coreGlow':
        this.uCoreGlow.value = value;
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
    const rtW = Math.round(RT_W * ctx.qualityScale);
    const rtH = Math.round(RT_H * ctx.qualityScale);
    const marchSteps = ctx.isMobile ? 46 : MARCH_STEPS;
    this.rt = new THREE.RenderTarget(rtW, rtH, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = Fn(() => {
      const ndc = uv().mul(2).sub(vec2(1, 1)).mul(vec2(rtW / rtH, 1));
      const ro = vec3(this.uCamPos.x, this.uCamPos.y, this.uCamPos.z);
      const fwd = normalize(this.uLookTarget.sub(ro));
      const right = normalize(vec3(fwd.z, 0, fwd.x.negate()));
      const up = right.cross(fwd);
      const rd = normalize(fwd.add(right.mul(ndc.x.mul(0.64))).add(up.mul(ndc.y.mul(0.64))));

      // Polynomial smooth minimum for coalescing ferrofluid droplets
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const smin = (a: any, b: any, k: any) => {
        const h = float(1.0).sub(a.sub(b).abs().div(k)).max(0.0);
        return a.min(b).sub(h.mul(h).mul(h).mul(k).mul(1.0 / 6.0));
      };

      // Polynomial smooth maximum for glass jar wall/floor containment & flattening
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const smax = (a: any, b: any, k: any) => {
        return smin(a.negate(), b.negate(), k).negate();
      };

      // 6 normalized icosahedral axes for seamless 3D spherical Rosensweig spikes
      const ico0 = normalize(vec3(0.0, 1.0, 1.618034));
      const ico1 = normalize(vec3(0.0, -1.0, 1.618034));
      const ico2 = normalize(vec3(1.0, 1.618034, 0.0));
      const ico3 = normalize(vec3(-1.0, 1.618034, 0.0));
      const ico4 = normalize(vec3(1.618034, 0.0, 1.0));
      const ico5 = normalize(vec3(1.618034, 0.0, -1.0));

      const toMagGlobal = normalize(this.uMagnetPos.sub(this.uCorePos).add(vec3(0.0001, 0.0001, 0.0001)));
      const minCoreScale = this.uCoreScale.x.min(this.uCoreScale.y).min(this.uCoreScale.z);

      // 3D Spherical Droplet-Cluster Ferrofluid SDF inside cylindrical jar
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sdFerrofluid = (pIn: any) => {
        const p = vec3(pIn);

        // 1. Anisotropic core ellipsoid (stretched by X/Y/Z aperture dispersion & beat squash)
        const relCore = p.sub(this.uCorePos);
        const q = relCore.div(this.uCoreScale);
        const dCoreBase = q.length().sub(this.uCoreRadius).mul(minCoreScale);

        // Magnetic dipole attraction bulge pointing toward external magnet behind jar wall
        const coreDir = normalize(vec3(relCore.add(vec3(0.0001, 0.0002, 0.0001))));
        const magDot = coreDir.dot(toMagGlobal);
        const magAlign = magDot.max(0.0);
        const dipoleBulge = magAlign.pow(2.2).mul(this.uMagnetPull).mul(0.32);
        const dCore = dCoreBase.sub(dipoleBulge);

        // 2. Smoothly coalesce 10 satellite droplets into the core blob
        const kBlend = float(0.22).add(this.uViscosity.mul(0.28));
        const d0 = p.sub(this.uDrop0.xyz).length().sub(this.uDrop0.w);
        const d1 = p.sub(this.uDrop1.xyz).length().sub(this.uDrop1.w);
        const d2 = p.sub(this.uDrop2.xyz).length().sub(this.uDrop2.w);
        const d3 = p.sub(this.uDrop3.xyz).length().sub(this.uDrop3.w);
        const d4 = p.sub(this.uDrop4.xyz).length().sub(this.uDrop4.w);
        const d5 = p.sub(this.uDrop5.xyz).length().sub(this.uDrop5.w);
        const d6 = p.sub(this.uDrop6.xyz).length().sub(this.uDrop6.w);
        const d7 = p.sub(this.uDrop7.xyz).length().sub(this.uDrop7.w);
        const d8 = p.sub(this.uDrop8.xyz).length().sub(this.uDrop8.w);
        const d9 = p.sub(this.uDrop9.xyz).length().sub(this.uDrop9.w);

        let dFluid = smin(dCore, d0, kBlend);
        dFluid = smin(dFluid, d1, kBlend);
        dFluid = smin(dFluid, d2, kBlend);
        dFluid = smin(dFluid, d3, kBlend);
        dFluid = smin(dFluid, d4, kBlend);
        dFluid = smin(dFluid, d5, kBlend);
        dFluid = smin(dFluid, d6, kBlend);
        dFluid = smin(dFluid, d7, kBlend);
        dFluid = smin(dFluid, d8, kBlend);
        dFluid = smin(dFluid, d9, kBlend);

        // 3. Jar inner-wall & floor liquid flattening (meniscus contact when droplets press the glass)
        const dJarWall = p.xz.length().sub(float(JAR_R));
        const dJarFloor = float(JAR_BOTTOM).sub(p.y);
        const dJarCeil = p.y.sub(float(JAR_TOP));
        dFluid = smax(dFluid, dJarWall, float(0.08));
        dFluid = smax(dFluid, dJarFloor, float(0.08));
        dFluid = smax(dFluid, dJarCeil, float(0.08));

        // 4. 3D Geodesic Rosensweig spikes oriented along field lines toward the external magnet
        const wp = this.uWobblePhase;
        const rotAngle = wp.x.mul(0.25);
        const cs = cos(rotAngle);
        const sn = sin(rotAngle);
        const rotDir = vec3(
          coreDir.x.mul(cs).sub(coreDir.z.mul(sn)),
          coreDir.y,
          coreDir.x.mul(sn).add(coreDir.z.mul(cs)),
        );

        const kS = this.uSpikeFreq;
        const w0 = cos(rotDir.dot(ico0).mul(kS).add(wp.y));
        const w1 = cos(rotDir.dot(ico1).mul(kS).sub(wp.z));
        const w2 = cos(rotDir.dot(ico2).mul(kS).add(wp.w));
        const w3 = cos(rotDir.dot(ico3).mul(kS).sub(wp.x));
        const w4 = cos(rotDir.dot(ico4).mul(kS).add(wp.z));
        const w5 = cos(rotDir.dot(ico5).mul(kS).sub(wp.y));

        const hexLattice = w0.add(w1).add(w2).add(w3).add(w4).add(w5).div(6.0).add(1.0).mul(0.5);
        const cones = hexLattice.pow(4.0);

        // Secondary high-frequency magnetic needle ridges
        const micro = cos(rotDir.dot(toMagGlobal).mul(kS.mul(2.1)).sub(wp.w.mul(1.5)))
          .mul(cos(rotDir.y.mul(kS.mul(1.8)).add(wp.y)))
          .add(1.0)
          .mul(0.5)
          .pow(3.0)
          .mul(0.24);

        // Spikes erupt strongest facing the external magnet (plus subtle opposite pole tuft)
        const magFocus = float(0.32)
          .add(magAlign.pow(1.4).mul(1.15))
          .add(magDot.negate().max(0.0).pow(2.4).mul(0.45));

        // Subtle capillary liquid slosh wave
        const slosh = sin(p.x.mul(4.5).add(wp.y))
          .mul(cos(p.y.mul(4.2).sub(wp.z)))
          .mul(sin(p.z.mul(4.5).add(wp.w)))
          .mul(0.022);

        // Keep spikes confined near the fluid boundary so raymarching steps cleanly
        const nearMask = float(1.0).sub(smoothstep(float(-0.04), float(0.6), dFluid));
        // Dampen spikes slightly where pressed flat against glass wall/floor
        const glassClearance = float(1.0).sub(smoothstep(float(-0.22), float(-0.02), dJarWall.max(dJarFloor)));
        const spikeDisp = cones.add(micro).mul(this.uSpikeHeight).mul(magFocus).mul(nearMask).mul(glassClearance);

        return dFluid.sub(spikeDisp).add(slosh);
      };

      // Bounding sphere fast-skip around the fluid volume (radius 3.25 centered at (0, 0.08, 0))
      const boundCenter = vec3(0, 0.08, 0);
      const oc = ro.sub(boundCenter);
      const bDot = oc.dot(rd);
      const cSphere = oc.dot(oc).sub(float(3.25 * 3.25));
      const disc = bDot.mul(bDot).sub(cSphere);

      const t = float(0.1).toVar();
      const tEnd = float(10.5).toVar();
      const hit = float(0).toVar();
      const pos = vec3(0, 0, 0).toVar();
      const minApproach = float(10.0).toVar();

      If(disc.greaterThan(0.0), () => {
        const sq = sqrt(disc);
        t.assign(bDot.negate().sub(sq).max(0.1));
        tEnd.assign(bDot.negate().add(sq).min(10.5));

        Loop({ start: 0, end: marchSteps, type: 'int' }, () => {
          If(t.greaterThan(tEnd), () => {
            Break();
          });

          pos.assign(ro.add(rd.mul(t)));
          const d = sdFerrofluid(pos);
          minApproach.assign(minApproach.min(d));

          If(d.lessThan(0.0022), () => {
            hit.assign(1);
            Break();
          });

          const step = d.mul(0.45).max(0.003);
          t.addAssign(step);
        });
      });

      // Surface Normal via finite differences
      const eps = float(0.0038);
      const nx = sdFerrofluid(pos.add(vec3(eps, 0, 0))).sub(sdFerrofluid(pos.sub(vec3(eps, 0, 0))));
      const ny = sdFerrofluid(pos.add(vec3(0, eps, 0))).sub(sdFerrofluid(pos.sub(vec3(0, eps, 0))));
      const nz = sdFerrofluid(pos.add(vec3(0, 0, eps))).sub(sdFerrofluid(pos.sub(vec3(0, 0, eps))));
      const norm = normalize(vec3(nx, ny, nz).add(vec3(0.0001, 0.0002, 0.0001)));

      // View & Lighting vectors (including dynamic light at external magnet position!)
      const v = rd.negate();
      const lKey = normalize(vec3(1.8, 3.6, 2.2));
      const lFill = normalize(vec3(-2.4, -2.2, 1.9));
      const lMag = normalize(this.uMagnetPos.sub(pos).add(vec3(0.0001, 0.0001, 0.0001)));

      const hKey = normalize(lKey.add(v));
      const hFill = normalize(lFill.add(v));
      const hMag = normalize(lMag.add(v));

      const specKeySharp = norm.dot(hKey).max(0.0).pow(135.0);
      const specKeyBroad = norm.dot(hKey).max(0.0).pow(20.0);
      const specFill = norm.dot(hFill).max(0.0).pow(30.0);
      const specMag = norm.dot(hMag).max(0.0).pow(48.0);

      // Deep mirror-obsidian ferrofluid base
      const jetBlack = vec3(0.007, 0.009, 0.013);

      // Thin-film oil iridescence along grazing Fresnel angles
      const nDotV = norm.dot(v).max(0.0);
      const fresnel = float(1.0).sub(nDotV).pow(3.2);
      const oklabOilSheen = oklabPaletteRamp3(
        this.uHigh,
        this.uAccent,
        this.uPeak,
        fresnel.mul(1.2).clamp(float(0), float(1)),
      );
      const linearOilSheen = mix(this.uHigh, this.uAccent, fresnel.mul(1.3).min(1.0));
      const oilSheen = mix(linearOilSheen, oklabOilSheen, this.uOklab);

      // Specular chrome & magnetic rim sheen
      const chrome = this.uPeak.mul(
        specKeySharp.mul(2.5).add(specKeyBroad.mul(0.32)).add(specFill.mul(0.6)),
      );
      const magnetRimLight = this.uAccent.mul(specMag.mul(0.95).mul(float(0.5).add(this.uMagnetPull)));

      // Internal pulse glow in valleys & stretched droplet necks
      const valleyFactor = float(1.0).sub(nDotV).mul(0.5).add(0.5);
      const pulseLight = this.uHigh.mul(this.uPulse.mul(0.32).mul(this.uCoreGlow).mul(valleyFactor));

      const fluidColor = jetBlack
        .add(oilSheen.mul(fresnel.mul(0.72).mul(this.uIridescence)))
        .add(chrome)
        .add(magnetRimLight)
        .add(pulseLight);

      // Seamless background gradient & magnetic aura (zero bounding-sphere cutoff!)
      // Tight near-surface halo strictly inside the bounding sphere (d < 0.35 -> fades to 0 well before R=3.25)
      const nearHalo = float(1.0).sub(smoothstep(float(0.0), float(0.35), minApproach));

      // Continuous ray closest-approach to the ferrofluid core & external magnet across the full screen
      const coreToRo = this.uCorePos.sub(ro);
      const tCoreClosest = coreToRo.dot(rd).max(0.0);
      const coreRayDist = ro.add(rd.mul(tCoreClosest)).sub(this.uCorePos).length();
      const wideAura = float(1.0).sub(smoothstep(float(0.4), float(4.2), coreRayDist));

      const magToRo = this.uMagnetPos.sub(ro);
      const tMagClosest = magToRo.dot(rd).max(0.0);
      const magRayDist = ro.add(rd.mul(tMagClosest)).sub(this.uMagnetPos).length();
      const magBgGlow = float(1.0).sub(smoothstep(float(0.4), float(3.8), magRayDist)).mul(this.uMagnetPull);

      const bgVert = uv().y.clamp(float(0), float(1));
      const bgRadial = float(1.0).sub(smoothstep(float(0.1), float(1.5), ndc.length()));

      const oklabBgBase = oklabMix(
        this.uLow.mul(0.36),
        this.uHigh.mul(0.16),
        bgVert.mul(0.45).add(bgRadial.mul(0.35)).add(wideAura.mul(0.2)).min(1.0),
      );
      const linearBgBase = mix(
        this.uLow.mul(0.32),
        this.uHigh.mul(0.14),
        bgVert.mul(0.45).add(bgRadial.mul(0.35)).add(wideAura.mul(0.2)).min(1.0),
      );
      const bgBase = mix(linearBgBase, oklabBgBase, this.uOklab);

      const auraMix = nearHalo.mul(0.42).add(wideAura.mul(0.32)).add(magBgGlow.mul(0.48)).min(1.0);
      const oklabSpaceAura = oklabMix(bgBase, this.uAccent.mul(0.26), auraMix);
      const linearSpaceAura = mix(bgBase, this.uAccent.mul(0.2), auraMix);
      const spaceAura = mix(linearSpaceAura, oklabSpaceAura, this.uOklab).add(
        this.uHigh.mul(magBgGlow.mul(0.1).mul(this.uCoreGlow)),
      );

      const oklabBase = oklabMix(spaceAura, fluidColor, hit);
      const linearBase = mix(spaceAura, fluidColor, hit);
      const finalColor = mix(linearBase, oklabBase, this.uOklab);

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
    if (!ctx || !this.displayMesh?.visible || !this.marchQuad || !this.rt) return;

    const subDt = Math.min(dt, 0.035);
    this.time += dt;
    this.uTime.value = this.time;

    // Positive spectral flux (fallback when FrameFeatures.apertures isn't provided)
    let rawFlux = 0;
    const spec = features.spectrum;
    const len = Math.min(spec.length, this.prevSpectrum.length);
    for (let i = 0; i < len; i++) {
      const diff = spec[i] - this.prevSpectrum[i];
      if (diff > 0) rawFlux += diff;
      this.prevSpectrum[i] = spec[i];
    }
    const fluxNorm = features.apertures ? features.apertures.flux : Math.min(1, rawFlux * 0.16);

    // Multi-band apertures + VLTK_* metadata tags
    const ap = features.apertures;
    const tags = ap?.tags ?? this.fallbackTags;
    const subBass = ap?.subBass ?? features.bass;
    const bass = ap?.bass ?? features.bass;
    const lowMid = ap?.lowMid ?? (features.bass * 0.4 + features.mid * 0.6);
    const mid = ap?.mid ?? features.mid;
    const highMid = ap?.highMid ?? (features.mid * 0.5 + features.treble * 0.5);
    const treble = ap?.treble ?? features.treble;
    const air = ap?.air ?? features.treble;

    const force = this.getParam('magnetForce');
    const fluidity = this.getParam('fluidity');
    const viscosity = this.getParam('viscosity');
    const spreadParam = this.getParam('dropletSpread');
    const inhaleFactor = 1 - this.inhale * 0.55;

    // -----------------------------------------------------------------------
    // 1. VLTK_* Cross-Coupled 3-Axis Dispersion Coefficients:
    //    Each sound aperture disperses along X, Y, Z with its own coefficient
    //    determined by OTHER VLTK_* tags!
    // -----------------------------------------------------------------------
    // X-Axis: Mid + HighMid + Bandwidth apertures, coefficient from VLTK_STEREO_WIDTH & VLTK_STEREO_CORRELATION & VLTK_MFCC_STD
    const coefX =
      (0.55 + 1.35 * tags.VLTK_STEREO_WIDTH) *
      (1.22 - 0.42 * tags.VLTK_STEREO_CORRELATION) *
      (0.82 + 0.38 * tags.VLTK_MFCC_STD);
    const apertureX = mid * 0.52 + highMid * 0.32 + fluxNorm * 0.28 + tags.VLTK_SPECTRAL_BANDWIDTH_MEAN * 0.16;

    // Y-Axis: SubBass + Bass + Level apertures, coefficient from VLTK_CREST_FACTOR_DB & VLTK_DYNAMIC_RANGE_DB & VLTK_DANCEABILITY
    const coefY =
      (0.55 + 1.15 * tags.VLTK_CREST_FACTOR_DB + 0.5 * tags.VLTK_DYNAMIC_RANGE_DB) *
      (0.75 + 0.5 * tags.VLTK_DANCEABILITY);
    const apertureY = subBass * 0.58 + bass * 0.45 + features.level * 0.22 + tags.VLTK_LUFS_INTEGRATED * 0.12;

    // Z-Axis: Treble + Air + Centroid apertures, coefficient from VLTK_SPECTRAL_CONTRAST_MEAN & VLTK_AROUSAL & VLTK_ONSET_DENSITY
    const coefZ =
      (0.55 + 1.1 * tags.VLTK_SPECTRAL_CONTRAST_MEAN + 0.45 * tags.VLTK_ONSET_DENSITY) *
      (0.75 + 0.55 * tags.VLTK_AROUSAL);
    const apertureZ = treble * 0.48 + air * 0.36 + features.centroid * 0.26 + tags.VLTK_SPECTRAL_ROLLOFF_MEAN * 0.14;

    this.dispSpringX.k = 95 * fluidity;
    this.dispSpringX.damp = 9.5 * viscosity;
    this.dispSpringY.k = 105 * fluidity;
    this.dispSpringY.damp = 9.0 * viscosity;
    this.dispSpringZ.k = 95 * fluidity;
    this.dispSpringZ.damp = 9.5 * viscosity;

    this.dispSpringX.target = Math.min(1.6, apertureX * coefX * spreadParam * inhaleFactor);
    this.dispSpringY.target = Math.min(1.75, apertureY * coefY * spreadParam * inhaleFactor);
    this.dispSpringZ.target = Math.min(1.6, apertureZ * coefZ * spreadParam * inhaleFactor);

    const dispX = Math.max(0, this.dispSpringX.update(subDt));
    const dispY = Math.max(0, this.dispSpringY.update(subDt));
    const dispZ = Math.max(0, this.dispSpringZ.update(subDt));

    // Additional VLTK_* physical couplings:
    // - VLTK_BPM_STABILITY + VLTK_SPECTRAL_ENTROPY_MEAN -> spike frequency & lattice order
    this.uSpikeFreq.value = 6.2 + tags.VLTK_SPECTRAL_ENTROPY_MEAN * 3.8 + (1 - tags.VLTK_BPM_STABILITY) * 1.8;
    // - VLTK_LRA -> jar bounce restitution
    const restitution = 0.38 + tags.VLTK_LRA * 0.42;
    // - VLTK_VALENCE + VLTK_VOCAL_PROBABILITY -> external magnet sweep agility
    const magnetSweepGain = 0.35 + tags.VLTK_VALENCE * 0.85 + tags.VLTK_VOCAL_PROBABILITY * 0.4;
    // - VLTK_SPECTRAL_FLATNESS_MEAN -> droplet separation/fission readiness
    const fissionGain = (0.75 + tags.VLTK_SPECTRAL_FLATNESS_MEAN * 0.85 + this.burst * 0.9) * fluidity;

    // -----------------------------------------------------------------------
    // 2. External Magnet Behind the Jar Wall
    // -----------------------------------------------------------------------
    this.magnetAngVel += (0.28 * magnetSweepGain - this.magnetAngVel) * Math.min(1, subDt * 2.5);
    this.magnetAngle += this.magnetAngVel * subDt;

    const targetMagY = -0.55 + (features.centroid * 0.7 + treble * 0.5) * 1.45;
    this.magnetY += (targetMagY - this.magnetY) * Math.min(1, subDt * 3.2);

    const targetMagDist = JAR_R + 0.72 - Math.min(0.45, (bass * 0.32 + force * 0.12 + this.burst * 0.25));
    this.magnetDist += (targetMagDist - this.magnetDist) * Math.min(1, subDt * 5.0);

    const magX = Math.sin(this.magnetAngle) * this.magnetDist;
    const magZ = Math.cos(this.magnetAngle) * this.magnetDist;
    (this.uMagnetPos.value as THREE.Vector3).set(magX, this.magnetY, magZ);

    this.magnetPullSpring.k = 90 * fluidity;
    this.magnetPullSpring.damp = 8 * viscosity;
    this.magnetPullSpring.target = (0.18 + (bass * 0.45 + lowMid * 0.2 + this.burst * 0.65) * force * 0.45) * inhaleFactor;

    // -----------------------------------------------------------------------
    // 3. Jar Bounce, Squash-and-Stretch & Beat Fission Impulses
    // -----------------------------------------------------------------------
    this.spikeSpring.k = 140 * fluidity;
    this.spikeSpring.damp = 10.5 * viscosity;
    this.spikeSpring.target = Math.max(
      0.04,
      (0.06 + (features.level * 0.38 + bass * 0.42 + fluxNorm * 0.35) * force * 0.45 + this.burst * 0.48) * inhaleFactor,
    );

    if (fluxNorm > 0.14) {
      this.spikeSpring.impulse(fluxNorm * 2.2 * fluidity);
    }

    if (features.downbeat) {
      this.beatSideToggle *= -1;
      // Big jar jump + lateral slosh + magnet snap + droplet fission
      const jumpImp = (2.2 + subBass * 1.8) * (0.6 + coefY * 0.45);
      this.coreVel.y += jumpImp;
      this.coreVel.x += this.beatSideToggle * (0.45 + dispX * 0.4);
      this.coreVel.z += Math.cos(this.magnetAngle) * (0.35 + dispZ * 0.35);

      this.squashSpring.impulse(-3.2);
      this.spikeSpring.impulse(1.5 * fluidity);
      this.magnetPullSpring.impulse(1.6);
      this.pulseSpring.impulse(1.8);
      this.magnetAngVel += this.beatSideToggle * (1.2 + tags.VLTK_AROUSAL * 1.4);

      // Eject satellite droplets into fission arcs inside the jar
      for (let i = 0; i < this.droplets.length; i++) {
        const d = this.droplets[i];
        d.fission = Math.min(1.8, d.fission + (0.65 + (i % 3) * 0.22) * fissionGain);
        d.vy += jumpImp * (0.7 + (i % 4) * 0.18);
        d.vx += d.ax * dispX * 1.8;
        d.vz += d.az * dispZ * 1.8;
      }
    } else if (features.onset) {
      this.beatSideToggle *= -1;
      const hopImp = (1.15 + bass * 1.1) * (0.55 + coefY * 0.4);
      this.coreVel.y += hopImp;
      this.coreVel.x += Math.sin(this.magnetAngle + 1.57) * this.beatSideToggle * 0.32;

      this.squashSpring.impulse(-1.7);
      this.spikeSpring.impulse(0.8 * fluidity);
      this.magnetPullSpring.impulse(0.75);
      this.pulseSpring.impulse(0.9);

      for (let i = 0; i < this.droplets.length; i++) {
        const d = this.droplets[i];
        d.fission = Math.min(1.4, d.fission + 0.35 * fissionGain);
        d.vy += hopImp * (0.55 + (i % 2) * 0.25);
      }
    }

    // Core vertical gravity + carrier buoyancy + magnetic wall pull
    const coreR = (0.68 - this.inhale * 0.14) * (1 + features.level * 0.08);
    this.uCoreRadius.value = coreR;

    const restY = -0.25 + (this.inhale * 0.22) + (tags.VLTK_VALENCE - 0.5) * 0.2;
    const gravity = -5.6;
    const buoyancy = (restY - this.corePos.y) * (5.2 + viscosity * 2.0);
    this.coreVel.y += (gravity * 0.32 + buoyancy) * subDt;

    // External magnet pulls core toward the wall
    const dxMag = magX - this.corePos.x;
    const dzMag = magZ - this.corePos.z;
    const distMagXZ = Math.hypot(dxMag, dzMag) || 1;
    const magPullForce = (0.55 + bass * 1.3 + this.burst * 1.5) * force * 0.65 * inhaleFactor;
    this.coreVel.x += (dxMag / distMagXZ) * magPullForce * subDt - this.corePos.x * 2.2 * subDt;
    this.coreVel.z += (dzMag / distMagXZ) * magPullForce * subDt - this.corePos.z * 2.2 * subDt;

    // Carrier-fluid viscous drag
    const coreDrag = Math.exp(-(2.1 + viscosity * 1.6) * subDt);
    this.coreVel.multiplyScalar(coreDrag);
    this.corePos.addScaledVector(this.coreVel, subDt);

    // Core jar boundary containment & floor bounce
    const coreFloor = JAR_BOTTOM + coreR * 0.85;
    if (this.corePos.y < coreFloor) {
      this.corePos.y = coreFloor;
      if (this.coreVel.y < -0.25) {
        const impact = Math.min(1.5, Math.abs(this.coreVel.y) * 0.45);
        this.squashSpring.impulse(-impact * 4.2);
        this.spikeSpring.impulse(impact * 0.9);
        // Radial bottom splash to droplets
        for (const d of this.droplets) {
          d.vx += d.ax * impact * 0.85;
          d.vz += d.az * impact * 0.85;
          d.vy += impact * 0.45;
        }
      }
      this.coreVel.y = Math.abs(this.coreVel.y) * restitution;
    }
    const coreCeil = JAR_TOP - coreR * 0.85;
    if (this.corePos.y > coreCeil) {
      this.corePos.y = coreCeil;
      this.coreVel.y = -Math.abs(this.coreVel.y) * restitution;
    }
    const coreRadXZ = Math.hypot(this.corePos.x, this.corePos.z);
    const maxCoreXZ = JAR_R - coreR * 0.78;
    if (coreRadXZ > maxCoreXZ && coreRadXZ > 1e-4) {
      const nx = this.corePos.x / coreRadXZ;
      const nz = this.corePos.z / coreRadXZ;
      this.corePos.x = nx * maxCoreXZ;
      this.corePos.z = nz * maxCoreXZ;
      const vn = this.coreVel.x * nx + this.coreVel.z * nz;
      if (vn > 0) {
        this.coreVel.x -= (1 + restitution * 0.6) * vn * nx;
        this.coreVel.z -= (1 + restitution * 0.6) * vn * nz;
      }
    }

    (this.uCorePos.value as THREE.Vector3).copy(this.corePos);

    // Squash-and-stretch + 3-axis anisotropic dispersion of the core spheroid
    const squashY = Math.max(0.62, Math.min(1.48, this.squashSpring.update(subDt)));
    const velStretchY = Math.max(-0.18, Math.min(0.28, this.coreVel.y * 0.08));
    const stretchY = squashY + velStretchY;
    const conserveXZ = 1 / Math.sqrt(Math.max(0.55, stretchY));

    const sx = conserveXZ * (1.0 + dispX * 0.38 - dispY * 0.12 - dispZ * 0.1);
    const sy = stretchY * (1.0 + dispY * 0.42 - dispX * 0.1 - dispZ * 0.1);
    const sz = conserveXZ * (1.0 + dispZ * 0.38 - dispX * 0.1 - dispY * 0.12);
    (this.uCoreScale.value as THREE.Vector3).set(
      Math.max(0.55, Math.min(1.9, sx)),
      Math.max(0.55, Math.min(1.9, sy)),
      Math.max(0.55, Math.min(1.9, sz)),
    );

    // -----------------------------------------------------------------------
    // 4. Satellite Droplet Cluster Physics (3D Spherical Shell + Fission + Jar Walls)
    // -----------------------------------------------------------------------
    const surfaceTensionK = (14.5 + viscosity * 9.0) * (1 + this.inhale * 0.8);
    const dropletDrag = Math.exp(-(2.6 + viscosity * 2.1) * subDt);
    const maxFissionDecay = Math.exp(-3.2 * subDt);

    for (let i = 0; i < this.droplets.length; i++) {
      const d = this.droplets[i];
      d.orbitPhase += d.orbitSpeed * (0.6 + features.level * 1.4) * subDt;
      d.fission *= maxFissionDecay;

      // Gently rotating 3D spherical anchor around the core blob
      const cOrb = Math.cos(d.orbitPhase * 0.45);
      const sOrb = Math.sin(d.orbitPhase * 0.45);
      const rx = d.ax * cOrb - d.az * sOrb;
      const rz = d.ax * sOrb + d.az * cOrb;
      const ry = d.ay * Math.cos(d.orbitPhase * 0.25) + Math.sin(d.orbitPhase * 0.7) * 0.14;

      // Axis-specific dispersion: each sound aperture + VLTK_* tag pulls droplets along X, Y, Z!
      const spreadScale = d.restDist * (1.0 + d.fission * 0.85) * (0.85 + spreadParam * 0.25) * inhaleFactor;
      const tx = this.corePos.x + rx * spreadScale * (1.0 + dispX * 1.45);
      const ty = this.corePos.y + ry * spreadScale * (1.0 + dispY * 1.5);
      const tz = this.corePos.z + rz * spreadScale * (1.0 + dispZ * 1.45);

      // Surface tension spring pulling back to spherical blob cluster
      d.vx += (tx - d.x) * surfaceTensionK * subDt;
      d.vy += (ty - d.y) * surfaceTensionK * subDt;
      d.vz += (tz - d.z) * surfaceTensionK * subDt;

      // External magnet dipole attraction on susceptible droplets
      const mdx = magX - d.x;
      const mdy = this.magnetY - d.y;
      const mdz = magZ - d.z;
      const mDistSq = mdx * mdx + mdy * mdy + mdz * mdz + 0.6;
      const mPull = (magPullForce * 2.2 * d.susceptibility) / mDistSq;
      d.vx += mdx * mPull * subDt;
      d.vy += mdy * mPull * 0.55 * subDt;
      d.vz += mdz * mPull * subDt;

      // Damping & integration
      d.vx *= dropletDrag;
      d.vy *= dropletDrag;
      d.vz *= dropletDrag;
      d.x += d.vx * subDt;
      d.y += d.vy * subDt;
      d.z += d.vz * subDt;

      // Dynamic droplet radius pulsing slightly with sound apertures
      d.r = d.baseR * (1.0 + Math.sin(d.orbitPhase * 2.1) * 0.06 + bass * 0.12 + d.fission * 0.08);

      // Glass jar containment & bounce for every droplet
      const floorY = JAR_BOTTOM + d.r * 0.72;
      if (d.y < floorY) {
        d.y = floorY;
        d.vy = Math.abs(d.vy) * restitution;
      }
      const ceilY = JAR_TOP - d.r * 0.72;
      if (d.y > ceilY) {
        d.y = ceilY;
        d.vy = -Math.abs(d.vy) * restitution;
      }
      const rXZ = Math.hypot(d.x, d.z);
      const maxR = JAR_R - d.r * 0.65;
      if (rXZ > maxR && rXZ > 1e-4) {
        const nx = d.x / rXZ;
        const nz = d.z / rXZ;
        d.x = nx * maxR;
        d.z = nz * maxR;
        const vn = d.vx * nx + d.vz * nz;
        if (vn > 0) {
          d.vx -= (1 + restitution * 0.7) * vn * nx;
          d.vz -= (1 + restitution * 0.7) * vn * nz;
        }
      }
    }

    // Push droplet uniforms
    (this.uDrop0.value as THREE.Vector4).set(this.droplets[0].x, this.droplets[0].y, this.droplets[0].z, this.droplets[0].r);
    (this.uDrop1.value as THREE.Vector4).set(this.droplets[1].x, this.droplets[1].y, this.droplets[1].z, this.droplets[1].r);
    (this.uDrop2.value as THREE.Vector4).set(this.droplets[2].x, this.droplets[2].y, this.droplets[2].z, this.droplets[2].r);
    (this.uDrop3.value as THREE.Vector4).set(this.droplets[3].x, this.droplets[3].y, this.droplets[3].z, this.droplets[3].r);
    (this.uDrop4.value as THREE.Vector4).set(this.droplets[4].x, this.droplets[4].y, this.droplets[4].z, this.droplets[4].r);
    (this.uDrop5.value as THREE.Vector4).set(this.droplets[5].x, this.droplets[5].y, this.droplets[5].z, this.droplets[5].r);
    (this.uDrop6.value as THREE.Vector4).set(this.droplets[6].x, this.droplets[6].y, this.droplets[6].z, this.droplets[6].r);
    (this.uDrop7.value as THREE.Vector4).set(this.droplets[7].x, this.droplets[7].y, this.droplets[7].z, this.droplets[7].r);
    (this.uDrop8.value as THREE.Vector4).set(this.droplets[8].x, this.droplets[8].y, this.droplets[8].z, this.droplets[8].r);
    (this.uDrop9.value as THREE.Vector4).set(this.droplets[9].x, this.droplets[9].y, this.droplets[9].z, this.droplets[9].r);

    // Update scalar shader uniforms
    this.uSpikeHeight.value = Math.max(0.03, this.spikeSpring.update(subDt));
    this.uPulse.value = Math.max(0.05, this.pulseSpring.update(subDt));
    this.uMagnetPull.value = Math.max(0.12, this.magnetPullSpring.update(subDt));

    const wT = this.time * (0.45 + features.level * 0.65);
    (this.uWobblePhase.value as THREE.Vector4).set(
      wT * 0.7,
      wT * 1.15 + 1.1,
      wT * 0.85 + 2.3,
      wT * 1.3 + 3.4,
    );

    // -----------------------------------------------------------------------
    // 5. Cinematic Jar Framing & Beat-Synced Camera Orbit
    // -----------------------------------------------------------------------
    if (features.beatPhase !== null) {
      let phaseDelta = features.beatPhase - this.prevBeatPhase;
      if (phaseDelta < -0.5) phaseDelta += 1.0;
      if (phaseDelta > 0 && phaseDelta < 0.5) {
        const groove = 1.0 + Math.sin(features.beatPhase * Math.PI) * 0.3;
        this.orbitAngle += phaseDelta * (Math.PI / 28) * groove;
      }
      this.prevBeatPhase = features.beatPhase;
    } else {
      const tempoSpeed = 0.075 + features.level * 0.08;
      this.orbitAngle += subDt * tempoSpeed;
    }

    const brightFactor = Math.min(1, features.centroid * 1.2 + treble * 0.55);
    const targetY = -0.75 + brightFactor * 1.55;
    this.camY += (targetY - this.camY) * Math.min(1, subDt * 2.8);

    const targetLookY = this.corePos.y * 0.45;
    this.lookTargetY += (targetLookY - this.lookTargetY) * Math.min(1, subDt * 3.5);

    const breathingCycle = Math.sin(this.time * 0.07) * 0.42;
    const energyZoom = (features.level * 0.7 + bass * 0.5 + this.burst * 0.85) - 0.3;
    const sectionFactor = ((features.energyPercentile ?? 0.5) - 0.5) * 0.35;
    const desiredDist = Math.max(3.9, Math.min(5.9, 4.75 + breathingCycle + energyZoom + sectionFactor));
    this.camDist += (desiredDist - this.camDist) * Math.min(1, subDt * 2.2);

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
    if (this.marchQuad) {
      this.fboScene.remove(this.marchQuad);
      this.marchQuad.geometry.dispose();
      (this.marchQuad.material as THREE.Material).dispose();
      this.marchQuad = null;
    }
    if (this.displayMesh && this.ctx) {
      this.ctx.scene.remove(this.displayMesh);
      this.displayMesh.geometry.dispose();
      (this.displayMesh.material as THREE.Material).dispose();
      this.displayMesh = null;
    }
    this.rt?.dispose();
    this.rt = null;
  }
}
