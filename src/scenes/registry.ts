import type { ParamSpec, VisualScene } from './scene';

export interface SceneDescriptor {
  readonly name: string;
  readonly label: string;
  readonly params: Record<string, ParamSpec>;
  load(): Promise<VisualScene>;
}

export const SCENE_REGISTRY: SceneDescriptor[] = [
  {
    name: 'ferrofluid',
    label: 'Ferrofluid',
    params: {
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
    },
    async load() {
      const { FerrofluidBlob } = await import('./ferrofluid');
      return new FerrofluidBlob();
    },
  },
  {
    name: 'lavalamp',
    label: 'Lava Lamp',
    params: {
      convection: { default: 1.2, min: 0.2, max: 3.0 },
      viscosity: { default: 1.1, min: 0.3, max: 2.5 },
      glow: { default: 1.2, min: 0.2, max: 3.0 },
      fluidTurbulence: { default: 0.8, min: 0.0, max: 2.0 },
      fade: { default: 1, min: 0, max: 1 },
      inhale: { default: 0, min: 0, max: 1 },
      burst: { default: 0, min: 0, max: 1 },
    },
    async load() {
      const { LavaLamp } = await import('./lavalamp');
      return new LavaLamp();
    },
  },
  {
    name: 'particles',
    label: 'Particles',
    params: {
      turbulence: { default: 0.8, min: 0, max: 5 },
      breathe: { default: 0, min: 0, max: 1 },
      brightness: { default: 0.5, min: 0, max: 2.5 },
      pulse: { default: 0, min: 0, max: 1 },
      drift: { default: 0.5, min: 0, max: 2 },
      fade: { default: 1, min: 0, max: 1 },
      inhale: { default: 0, min: 0, max: 1 },
      burst: { default: 0, min: 0, max: 1 },
    },
    async load() {
      const { ParticleField } = await import('./particles');
      return new ParticleField();
    },
  },
  {
    name: 'terrain',
    label: 'Terrain',
    params: {
      amplitude: { default: 2.2, min: 0.2, max: 6 },
      detail: { default: 0.3, min: 0, max: 1 },
      scrollSpeed: { default: 2.5, min: 0, max: 12 },
      glow: { default: 0.7, min: 0, max: 2.5 },
      fade: { default: 1, min: 0, max: 1 },
      inhale: { default: 0, min: 0, max: 1 },
      burst: { default: 0, min: 0, max: 1 },
    },
    async load() {
      const { Terrain } = await import('./terrain');
      return new Terrain();
    },
  },
  {
    name: 'fractal',
    label: 'Fractal',
    params: {
      speed: { default: 0.06, min: 0, max: 0.4 },
      warp: { default: 0.7885, min: 0.68, max: 0.92 },
      zoomRate: { default: 0.16, min: 0.02, max: 0.6 },
      brightness: { default: 0.85, min: 0, max: 2 },
      oklab: { default: 1, min: 0, max: 1 },
      perturb: { default: 1, min: 0, max: 1 },
      target: { default: 0, min: 0, max: 4 },
      zoom: { default: 1.7, min: 1e-12, max: 3.0 },
      pulse: { default: 0, min: 0, max: 1 },
      fade: { default: 1, min: 0, max: 1 },
      inhale: { default: 0, min: 0, max: 1 },
      burst: { default: 0, min: 0, max: 1 },
    },
    async load() {
      const { Fractal } = await import('./fractal');
      return new Fractal();
    },
  },
  {
    name: 'physarum',
    label: 'Physarum',
    params: {
      sensorAngle: { default: 0.5, min: 0.15, max: 1.2 },
      turnSpeed: { default: 0.45, min: 0.1, max: 2 },
      moveSpeed: { default: 0.006, min: 0.002, max: 0.02 },
      decay: { default: 0.968, min: 0.86, max: 0.995 },
      brightness: { default: 0.9, min: 0, max: 2.5 },
      fade: { default: 1, min: 0, max: 1 },
      inhale: { default: 0, min: 0, max: 1 },
      burst: { default: 0, min: 0, max: 1 },
    },
    async load() {
      const { Physarum } = await import('./physarum');
      return new Physarum();
    },
  },
  {
    name: 'attractor',
    label: 'Attractor',
    params: {
      speed: { default: 1, min: 0.1, max: 3 },
      brightness: { default: 0.7, min: 0, max: 2.5 },
      pulse: { default: 0, min: 0, max: 1 },
      fade: { default: 1, min: 0, max: 1 },
      inhale: { default: 0, min: 0, max: 1 },
      burst: { default: 0, min: 0, max: 1 },
    },
    async load() {
      const { Attractor } = await import('./attractor');
      return new Attractor();
    },
  },
  {
    name: 'kifs',
    label: 'KIFS',
    params: {
      foldDrift: { default: 0.02, min: 0, max: 0.2 },
      scale: { default: 2.0, min: 1.9, max: 2.45 },
      twist: { default: 0, min: 0, max: 1 },
      brightness: { default: 0.9, min: 0, max: 2.5 },
      fade: { default: 1, min: 0, max: 1 },
      inhale: { default: 0, min: 0, max: 1 },
      burst: { default: 0, min: 0, max: 1 },
    },
    async load() {
      const { Kifs } = await import('./kifs');
      return new Kifs();
    },
  },
  {
    name: 'blackhole',
    label: 'Black Hole',
    params: {
      gravity: { default: 1.35, min: 0.8, max: 2.4 },
      diskBrightness: { default: 1.0, min: 0, max: 2.5 },
      turbulence: { default: 0.5, min: 0, max: 1 },
      spin: { default: 1.0, min: 0.2, max: 2.5 },
      flare: { default: 0, min: 0, max: 1 },
      fade: { default: 1, min: 0, max: 1 },
      inhale: { default: 0, min: 0, max: 1 },
      burst: { default: 0, min: 0, max: 1 },
    },
    async load() {
      const { BlackHole } = await import('./blackhole');
      return new BlackHole();
    },
  },
  {
    name: 'boids',
    label: 'Boids',
    params: {
      cohesion: { default: 0.8, min: 0, max: 2 },
      separation: { default: 0.9, min: 0, max: 2.5 },
      alignment: { default: 1.0, min: 0, max: 2 },
      speed: { default: 1.0, min: 0.2, max: 2.5 },
      scatter: { default: 0, min: 0, max: 1 },
      brightness: { default: 0.8, min: 0, max: 2.5 },
      oklab: { default: 1, min: 0, max: 1 },
      fade: { default: 1, min: 0, max: 1 },
      inhale: { default: 0, min: 0, max: 1 },
      burst: { default: 0, min: 0, max: 1 },
    },
    async load() {
      const { Boids } = await import('./boids');
      return new Boids();
    },
  },
];
