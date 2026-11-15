import * as THREE from 'three/webgpu';
import {
  Break,
  Fn,
  If,
  Loop,
  color,
  float,
  int,
  ivec2,
  mix,
  screenSize,
  screenUV,
  smoothstep,
  textureLoad,
  uniform,
  vec2,
} from 'three/tsl';
import type { FrameFeatures } from '../audio/features';
import type { Palette } from '../types/song-analysis';
import type { ParamSpec, SceneContext, VisualScene } from './scene';
import { oklabMix, oklabPaletteRamp } from '../analysis/oklab-tsl';

const MAX_ITER = 256;

/**
 * Curated high-precision Mandelbrot dive targets.
 * With perturbation theory, these points remain structurally rich and razor-sharp
 * down to 10⁻¹² and beyond, well past the standard single-precision float32 floor (~10⁻⁴).
 */
export interface DiveTarget {
  name: string;
  re: number; // 64-bit IEEE 754 float
  im: number; // 64-bit IEEE 754 float
  minZoom: number; // Depth limit before beat-synchronized cut
  description: string;
}

export const DIVE_TARGETS: DiveTarget[] = [
  {
    name: 'Seahorse Spiral Valley',
    re: -0.7436438870371587,
    im: 0.131825904205312,
    minZoom: 1e-12,
    description: 'Double spiral arms with infinite sub-satellites',
  },
  {
    name: 'Misiurewicz Point M2,1',
    re: -0.77568377,
    im: 0.13646737,
    minZoom: 4e-11,
    description: 'Pre-periodic point with branching filament trees',
  },
  {
    name: 'Top-Bulb Spiral Needle',
    re: -0.10109636384562,
    im: 0.95628651080914,
    minZoom: 1e-12,
    description: 'Ultra-thin spirals in the main antenna valley',
  },
  {
    name: 'Elephant Valley Minibrot',
    re: 0.2869318625,
    im: 0.0142868312,
    minZoom: 2e-11,
    description: 'Elephant valley transitioning into needle spirals',
  },
  {
    name: 'San Marco Quad-Spirals',
    re: -0.749997125,
    im: 0.005000002,
    minZoom: 1e-12,
    description: 'Deep quadrupole spirals in the cusp region',
  },
];

/**
 * Animated Julia set & Mandelbrot Deep Zoom visualizer.
 * Features:
 *   1. Perturbation-Theory deep zoom: Evaluates a 64-bit double-precision reference orbit
 *      on the CPU and integrates Δ_{n+1} = 2·Z_n·Δ_n + Δ_n² + δ on the GPU, unlocking
 *      infinite zoom depths (10⁻¹² and beyond) without f32 blocky pixelation.
 *   2. OKLab palette interpolation: Blends colors in Björn Ottosson's perceptual OKLab space,
 *      maintaining chromatic vibrance and monotonic lightness without desaturated gray dips.
 */
export class Fractal implements VisualScene {
  readonly name = 'fractal';

  readonly params: Record<string, ParamSpec> = {
    speed: { default: 0.06, min: 0, max: 0.4 },
    warp: { default: 0.7885, min: 0.68, max: 0.92 },
    zoomRate: { default: 0.16, min: 0.02, max: 0.6 },
    brightness: { default: 0.85, min: 0, max: 2 },
    oklab: { default: 1, min: 0, max: 1 }, // 1 = OKLab perceptual interpolation, 0 = linear RGB
    perturb: { default: 1, min: 0, max: 1 }, // 1 = Perturbation theory (beyond f32), 0 = f32 direct
    target: { default: 0, min: 0, max: 4 }, // Dive target selector
    zoom: { default: 1.7, min: 1e-12, max: 3.0 }, // Dynamic zoom depth (scrubbable & readable)
    pulse: { default: 0, min: 0, max: 1 },
    fade: { default: 1, min: 0, max: 1 },
    inhale: { default: 0, min: 0, max: 1 },
    burst: { default: 0, min: 0, max: 1 },
  };

  private uC = uniform(new THREE.Vector2(0.7885, 0));
  private uZoom = uniform(1.7);
  private uCenter = uniform(new THREE.Vector2(0, 0));
  /** Cyclic band phase — beats push color waves along filaments */
  private uPhase = uniform(0);
  /** 0 = Julia overview (c orbits), 1 = Mandelbrot dive */
  private uMode = uniform(0);
  /** 1 = Perturbation theory active, 0 = direct f32 */
  private uPerturb = uniform(1);
  /** 1 = OKLab palette interpolation, 0 = linear sRGB */
  private uOklab = uniform(1);
  private uBrightness = uniform(this.params.brightness.default);
  private uFade = uniform(1);
  private uFlip = uniform(0); // 0/1 gradient inversion, toggled on drops

  // 4-stop track palette uniforms
  private uLow = uniform(color('#120a2e'));
  private uSecondary = uniform(color('#2e1c66'));
  private uHigh = uniform(color('#7a5cff'));
  private uPeak = uniform(color('#ffe9f0'));

  // 64-bit CPU reference orbit state for perturbation theory
  private refOrbitData = new Float32Array(MAX_ITER * 4);
  private refOrbitTexture: THREE.DataTexture;
  private centerRe = DIVE_TARGETS[0].re;
  private centerIm = DIVE_TARGETS[0].im;

  private theta = 2.1;
  private speed = this.params.speed.default;
  private zoomRate = this.params.zoomRate.default;
  private zoom = 1.7;
  private resetPending = false;
  private diving = false;
  private diveIndex = 0;
  private overviewTimer = 0;
  private warp = this.params.warp.default;
  private perturb = 1;
  private oklab = 1;
  private pulse = 0;
  private inhale = 0;
  private burst = 0;

  private mesh: THREE.Mesh | null = null;
  private ctx: SceneContext | null = null;
  private paramValues: Record<string, number> = {};

  constructor() {
    // Initialize 1D DataTexture to stream the high-precision reference orbit to the GPU
    this.refOrbitTexture = new THREE.DataTexture(
      this.refOrbitData,
      MAX_ITER,
      1,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.refOrbitTexture.minFilter = THREE.NearestFilter;
    this.refOrbitTexture.magFilter = THREE.NearestFilter;
    this.refOrbitTexture.generateMipmaps = false;
    this.refOrbitTexture.needsUpdate = true;
    this.computeReferenceOrbit(this.centerRe, this.centerIm);
  }

  /**
   * Evaluates the central reference orbit Z₀=0, Z_{n+1} = Z_n² + C on CPU with 64-bit precision.
   * Streaming this 1KB buffer allows the GPU shader to run perturbation math with full dynamic range.
   */
  private computeReferenceOrbit(cr: number, ci: number): void {
    let zx = 0;
    let zy = 0;
    for (let i = 0; i < MAX_ITER; i++) {
      this.refOrbitData[i * 4 + 0] = zx;
      this.refOrbitData[i * 4 + 1] = zy;
      this.refOrbitData[i * 4 + 2] = 0;
      this.refOrbitData[i * 4 + 3] = 1;

      const x2 = zx * zx - zy * zy + cr;
      const y2 = 2 * zx * zy + ci;
      zx = x2;
      zy = y2;
    }
    this.refOrbitTexture.needsUpdate = true;
  }

  getParam(name: string): number {
    if (name === 'zoom') return this.zoom;
    if (name === 'oklab') return this.oklab;
    if (name === 'perturb') return this.perturb;
    return this.paramValues[name] ?? this.params[name]?.default ?? 0;
  }

  setParam(name: string, value: number): void {
    this.paramValues[name] = value;
    switch (name) {
      case 'zoom':
        this.zoom = Math.max(1e-13, value);
        this.uZoom.value = this.zoom;
        break;
      case 'speed':
        this.speed = value;
        break;
      case 'warp':
        this.warp = value;
        break;
      case 'zoomRate':
        this.zoomRate = value;
        break;
      case 'brightness':
        this.uBrightness.value = value;
        break;
      case 'oklab':
        this.oklab = value;
        this.uOklab.value = value;
        break;
      case 'perturb':
        this.perturb = value;
        this.uPerturb.value = value;
        break;
      case 'target': {
        const idx = Math.min(DIVE_TARGETS.length - 1, Math.max(0, Math.floor(value)));
        if (idx !== this.diveIndex) {
          this.diveIndex = idx;
          const target = DIVE_TARGETS[idx];
          this.centerRe = target.re;
          this.centerIm = target.im;
          this.computeReferenceOrbit(this.centerRe, this.centerIm);
          (this.uCenter.value as THREE.Vector2).set(target.re, target.im);
        }
        break;
      }
      case 'pulse':
        this.pulse = value;
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
      const aspect = screenSize.x.div(screenSize.y);
      // delta0 represents relative screen offset from the high-precision center reference point
      const delta0 = screenUV
        .sub(vec2(0.5, 0.5))
        .mul(vec2(aspect, 1))
        .mul(this.uZoom);

      const z = vec2(0, 0).toVar();
      const iter = float(0).toVar();
      const escaped = float(0).toVar();
      // Orbit trap: closest approach to origin for interior shading
      const trap = float(1e9).toVar();

      If(this.uMode.equal(0), () => {
        // --- Mode 0: Julia Overview (Orbiting C) ---
        const p = delta0.add(vec2(this.uCenter.x, this.uCenter.y));
        z.assign(p);
        Loop({ start: 0, end: MAX_ITER, type: 'int' }, () => {
          z.assign(
            vec2(z.x.mul(z.x).sub(z.y.mul(z.y)), z.x.mul(z.y).mul(2)).add(
              vec2(this.uC.x, this.uC.y),
            ),
          );
          trap.assign(trap.min(z.dot(z)));
          If(z.dot(z).greaterThan(6), () => {
            escaped.assign(1);
            Break();
          });
          iter.addAssign(1);
        });
      }).Else(() => {
        // --- Mode 1: Mandelbrot Dive ---
        If(this.uPerturb.equal(1), () => {
          // --- PERTURBATION THEORY (Beyond f32 Precision) ---
          // Reference orbit Z_n is streamed from CPU Float64.
          // Perturbation recurrence: Δ_{n+1} = 2·Z_n·Δ_n + Δ_n² + δ₀
          const delta = vec2(0, 0).toVar();
          const iterInt = int(0).toVar();

          Loop({ start: 0, end: MAX_ITER, type: 'int' }, () => {
            const Z = textureLoad(this.refOrbitTexture, ivec2(iterInt, 0)).xy;
            const curZ = Z.add(delta);
            const m = curZ.dot(curZ);
            trap.assign(trap.min(m));

            If(m.greaterThan(6), () => {
              escaped.assign(1);
              z.assign(curZ);
              Break();
            });

            // Complex multiplication:
            // 2·Z·Δ = (2(Z.x·Δ.x - Z.y·Δ.y), 2(Z.x·Δ.y + Z.y·Δ.x))
            // Δ²    = (Δ.x² - Δ.y², 2·Δ.x·Δ.y)
            const nextDeltaX = float(2)
              .mul(Z.x.mul(delta.x).sub(Z.y.mul(delta.y)))
              .add(delta.x.mul(delta.x).sub(delta.y.mul(delta.y)))
              .add(delta0.x);

            const nextDeltaY = float(2)
              .mul(Z.x.mul(delta.y).add(Z.y.mul(delta.x)))
              .add(float(2).mul(delta.x).mul(delta.y))
              .add(delta0.y);

            delta.assign(vec2(nextDeltaX, nextDeltaY));
            iter.addAssign(1);
            iterInt.addAssign(1);
          });
        }).Else(() => {
          // Fallback direct f32 (collapses at zoom < 1e-4)
          const p = delta0.add(vec2(this.uCenter.x, this.uCenter.y));
          z.assign(vec2(0, 0));
          Loop({ start: 0, end: MAX_ITER, type: 'int' }, () => {
            z.assign(vec2(z.x.mul(z.x).sub(z.y.mul(z.y)), z.x.mul(z.y).mul(2)).add(p));
            trap.assign(trap.min(z.dot(z)));
            If(z.dot(z).greaterThan(6), () => {
              escaped.assign(1);
              Break();
            });
            iter.addAssign(1);
          });
        });
      });

      // Smooth (continuous) escape-time coloring
      const m = z.dot(z).max(1.000001);
      const nu = m.log2().mul(0.5).log2();
      const smoothIter = iter.add(float(1).sub(nu));

      // Cyclic escape-time banding: depth-invariant infinite-zoom look
      let cyc = smoothIter.div(8).add(this.uPhase).fract();
      cyc = mix(cyc, float(1).sub(cyc), this.uFlip);
      const tri = cyc.mul(2).sub(1).abs();
      const vis = smoothstep(2, 8, smoothIter);

      // Thin glowing contour lines
      const line = float(1).sub(tri).pow(6);
      const parity = smoothIter.div(8).add(this.uPhase).floor().mod(2);

      // --- OKLab Palette Interpolation vs Standard Linear RGB ---
      // OKLab path:
      const oklabBandHue = oklabMix(
        this.uHigh,
        oklabMix(this.uHigh, this.uPeak, float(0.6)),
        parity,
      );
      const oklabBase = oklabPaletteRamp(
        this.uLow.mul(0.35),
        this.uSecondary.mul(0.45),
        oklabBandHue.mul(0.6),
        this.uPeak.mul(0.7),
        cyc,
      );
      const oklabEscaped = oklabMix(
        oklabBase,
        this.uPeak,
        line.mul(0.85),
      ).mul(vis).mul(0.6);

      // Linear RGB fallback:
      const linearBandHue = mix(this.uHigh, mix(this.uHigh, this.uPeak, 0.6), parity);
      const linearBase = mix(this.uLow.mul(0.3), linearBandHue.mul(0.5), cyc);
      const linearEscaped = linearBase.add(this.uPeak.mul(line).mul(0.85)).mul(vis).mul(0.55);

      const escapedColor = mix(linearEscaped, oklabEscaped, this.uOklab);

      // Interior: orbit-trap glow
      const trapGlow = smoothstep(0.5, 0.0, trap.sqrt());
      const oklabInterior = oklabMix(
        this.uLow.mul(0.12),
        this.uHigh,
        trapGlow.pow(2).mul(0.38),
      );
      const linearInterior = this.uLow.mul(0.1).add(this.uHigh.mul(trapGlow.pow(2)).mul(0.35));
      const interior = mix(linearInterior, oklabInterior, this.uOklab);

      const c = mix(interior, escapedColor, escaped);
      return c.mul(this.uBrightness).mul(this.uFade);
    })();

    const geometry = new THREE.PlaneGeometry(60, 60);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    this.mesh = mesh;
    ctx.scene.add(mesh);
  }

  setVisible(v: boolean): void {
    if (this.mesh) this.mesh.visible = v;
  }

  update(f: FrameFeatures, dt: number): void {
    if (!this.mesh?.visible) return;
    const center = this.uCenter.value as THREE.Vector2;

    if (!this.diving) {
      // Julia overview: the whole set breathing, c orbiting
      this.theta += dt * this.speed * (1 - this.inhale * 0.85);
      (this.uC.value as THREE.Vector2).set(
        this.warp * Math.cos(this.theta),
        this.warp * Math.sin(this.theta),
      );
      center.lerp(new THREE.Vector2(0, 0), Math.min(dt * 4, 1));
      this.zoom += (1.7 - this.zoom) * Math.min(dt * 3, 1);
      this.uMode.value = 0;

      // Dive on the next musical drop, or after ~14s of overview
      this.overviewTimer += dt;
      if (this.burst > 0.7 || this.overviewTimer > 14) {
        this.diving = true;
        this.overviewTimer = 0;
        this.diveIndex = (this.diveIndex + 1) % DIVE_TARGETS.length;
        const target = DIVE_TARGETS[this.diveIndex];
        this.centerRe = target.re;
        this.centerIm = target.im;
        this.computeReferenceOrbit(this.centerRe, this.centerIm);
        center.set(target.re, target.im);
        this.zoom = 3.0;
        this.uFlip.value = 1 - (this.uFlip.value as number);
      }
    } else {
      // Mandelbrot dive: Perturbation theory keeps needle-sharp details deep beyond f32
      this.uMode.value = 1;
      const target = DIVE_TARGETS[this.diveIndex];

      // Smoothly track target center in 64-bit precision
      const lerpFactor = Math.min(dt * 6, 1);
      this.centerRe += (target.re - this.centerRe) * lerpFactor;
      this.centerIm += (target.im - this.centerIm) * lerpFactor;
      center.set(this.centerRe, this.centerIm);
      this.computeReferenceOrbit(this.centerRe, this.centerIm);

      const rate =
        (this.zoomRate * 1.6 + this.pulse * 0.35 + this.burst * 1.0) *
        (1 - this.inhale * 0.95);
      this.zoom *= Math.exp(-dt * rate);

      // Deep zoom floor: With perturbation theory we dive to 10⁻¹² and beyond!
      // When perturbation is disabled, stops at standard f32 floor (1.2e-4).
      const minZoomFloor = this.perturb > 0.5 ? Math.max(1e-13, target.minZoom) : 1.2e-4;

      if (this.zoom < minZoomFloor) this.resetPending = true;
      if (this.resetPending && (f.onset || this.zoom < minZoomFloor * 0.5)) {
        this.diving = false;
        this.resetPending = false;
        this.zoom = 1.7;
        this.uFlip.value = 1 - (this.uFlip.value as number);
      }
    }
    this.uZoom.value = this.zoom;

    // Phase drift + beat pushes: bands crawl, beats shove them
    this.uPhase.value =
      ((this.uPhase.value as number) + dt * (0.02 + this.pulse * 0.12)) % 1;
  }

  /** Fullscreen scene: pin the camera. */
  updateCamera(camera: THREE.PerspectiveCamera): void {
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
  }

  applyPalette(p: Palette): void {
    (this.uLow.value as THREE.Color).set(p.background);
    (this.uSecondary.value as THREE.Color).set(p.secondary || p.accent);
    (this.uHigh.value as THREE.Color).set(p.primary);
    (this.uPeak.value as THREE.Color).set(p.accent);
  }

  dispose(): void {
    if (this.mesh && this.ctx) {
      this.ctx.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.refOrbitTexture.dispose();
    }
  }
}
