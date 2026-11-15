/**
 * OKLab and Oklch color space conversion and perceptual interpolation.
 * References:
 *   - Björn Ottosson: "A perceptual color space for image processing" (2020)
 *   - CSS Color Module Level 4 (OKLab / Oklch specification)
 */

export interface OklabColor {
  L: number; // Perceptual lightness [0, 1]
  a: number; // Green (-) to Red (+) [-0.4, 0.4]
  b: number; // Blue (-) to Yellow (+) [-0.4, 0.4]
}

export interface OklchColor {
  L: number; // Perceptual lightness [0, 1]
  C: number; // Chroma [0, ~0.4]
  h: number; // Hue in degrees [0, 360)
}

export interface RgbColor {
  r: number; // [0, 1]
  g: number; // [0, 1]
  b: number; // [0, 1]
}

/** Converts sRGB [0..1] to linear sRGB [0..1] */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Converts linear sRGB [0..1] to sRGB [0..1] */
export function linearToSrgb(c: number): number {
  const clamped = Math.max(0, Math.min(1, c));
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

/** Parses hex string (#rgb, #rrggbb, #rrggbbaa) to linear sRGB [0..1] */
export function hexToLinearRgb(hex: string): RgbColor {
  const clean = hex.replace('#', '').trim();
  let r = 0;
  let g = 0;
  let b = 0;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16) / 255;
    g = parseInt(clean[1] + clean[1], 16) / 255;
    b = parseInt(clean[2] + clean[2], 16) / 255;
  } else {
    r = parseInt(clean.substring(0, 2), 16) / 255;
    g = parseInt(clean.substring(2, 4), 16) / 255;
    b = parseInt(clean.substring(4, 6), 16) / 255;
  }
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return { r: 0.5, g: 0.5, b: 0.5 };
  }
  return {
    r: srgbToLinear(r),
    g: srgbToLinear(g),
    b: srgbToLinear(b),
  };
}

/** Converts linear sRGB [0..1] to hex string (#rrggbb) */
export function linearRgbToHex(rgb: RgbColor): string {
  const r = Math.round(Math.min(255, Math.max(0, linearToSrgb(rgb.r) * 255)));
  const g = Math.round(Math.min(255, Math.max(0, linearToSrgb(rgb.g) * 255)));
  const b = Math.round(Math.min(255, Math.max(0, linearToSrgb(rgb.b) * 255)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Converts linear sRGB to OKLab */
export function linearRgbToOklab(rgb: RgbColor): OklabColor {
  const l = Math.cbrt(0.4122214708 * rgb.r + 0.5363325363 * rgb.g + 0.0514459929 * rgb.b);
  const m = Math.cbrt(0.2119034982 * rgb.r + 0.6806995451 * rgb.g + 0.1073969566 * rgb.b);
  const s = Math.cbrt(0.0883024619 * rgb.r + 0.2817188376 * rgb.g + 0.6299787005 * rgb.b);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Converts OKLab to linear sRGB */
export function oklabToLinearRgb(lab: OklabColor): RgbColor {
  const l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
  const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
  const s_ = lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: Math.max(0, Math.min(1, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    g: Math.max(0, Math.min(1, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    b: Math.max(0, Math.min(1, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  };
}

/** Converts hex directly to OKLab */
export function hexToOklab(hex: string): OklabColor {
  return linearRgbToOklab(hexToLinearRgb(hex));
}

/** Converts OKLab directly to hex */
export function oklabToHex(lab: OklabColor): string {
  return linearRgbToHex(oklabToLinearRgb(lab));
}

/** Converts OKLab to Oklch (Lightness, Chroma, Hue in degrees [0, 360)) */
export function oklabToOklch(lab: OklabColor): OklchColor {
  const C = Math.hypot(lab.a, lab.b);
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L: lab.L, C, h };
}

/** Converts Oklch to OKLab */
export function oklchToOklab(lch: OklchColor): OklabColor {
  const rad = (lch.h * Math.PI) / 180;
  return {
    L: lch.L,
    a: lch.C * Math.cos(rad),
    b: lch.C * Math.sin(rad),
  };
}

/** Converts Oklch directly to hex */
export function oklchToHex(lch: OklchColor): string {
  return oklabToHex(oklchToOklab(lch));
}

/**
 * Linearly interpolates two colors in perceptual OKLab space.
 * Eliminates gray midpoints and brightness dips common in naive RGB mix.
 */
export function oklabLerp(hexA: string, hexB: string, t: number): string {
  const clampedT = Math.max(0, Math.min(1, t));
  const labA = hexToOklab(hexA);
  const labB = hexToOklab(hexB);
  return oklabToHex({
    L: labA.L + (labB.L - labA.L) * clampedT,
    a: labA.a + (labB.a - labA.a) * clampedT,
    b: labA.b + (labB.b - labA.b) * clampedT,
  });
}

/**
 * Perceptually lightens a color by raising its OKLab Lightness (L)
 * while preserving hue and chromatic saturation.
 */
export function oklabLighten(hex: string, amount: number): string {
  const lab = hexToOklab(hex);
  const targetL = Math.min(1.0, lab.L + (1.0 - lab.L) * Math.max(0, Math.min(1, amount)));
  return oklabToHex({ ...lab, L: targetL });
}

/**
 * Perceptually darkens a color by reducing its OKLab Lightness (L)
 * while preserving hue.
 */
export function oklabDarken(hex: string, amount: number): string {
  const lab = hexToOklab(hex);
  const factor = 1.0 - Math.max(0, Math.min(1, amount));
  return oklabToHex({ ...lab, L: Math.max(0, lab.L * factor) });
}

/**
 * Generates an array of perceptually uniform colors sampled along
 * an OKLab spline or multi-point gradient.
 */
export function sampleOklabGradient(colors: string[], steps: number): string[] {
  if (steps <= 1 || colors.length === 1) return [colors[0] ?? '#8a7cff'];
  const labs = colors.map(hexToOklab);
  const result: string[] = [];
  const segments = labs.length - 1;

  for (let i = 0; i < steps; i++) {
    const globalT = i / (steps - 1);
    const segIdx = Math.min(segments - 1, Math.floor(globalT * segments));
    const localT = (globalT * segments) - segIdx;
    const a = labs[segIdx];
    const b = labs[segIdx + 1];
    result.push(oklabToHex({
      L: a.L + (b.L - a.L) * localT,
      a: a.a + (b.a - a.a) * localT,
      b: a.b + (b.b - a.b) * localT,
    }));
  }
  return result;
}

/**
 * Generates a CSS linear-gradient string with intermediate OKLab stops.
 */
export function oklabGradientCss(direction: string, colors: string[], samples = 6): string {
  const stops = sampleOklabGradient(colors, samples);
  const stopStrs = stops.map((c, i) => `${c} ${(i / (stops.length - 1) * 100).toFixed(1)}%`);
  return `linear-gradient(${direction}, ${stopStrs.join(', ')})`;
}
