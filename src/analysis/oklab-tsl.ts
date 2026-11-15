import { float, mix, vec3 } from 'three/tsl';

/**
 * Converts linear RGB node to OKLab (L, a, b) node in TSL.
 * Reference: Björn Ottosson (2020)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rgbToOklab(rgb: any): any {
  const rx = float(rgb.x);
  const ry = float(rgb.y);
  const rz = float(rgb.z);

  const l_ = float(0.4122214708)
    .mul(rx)
    .add(float(0.5363325363).mul(ry))
    .add(float(0.0514459929).mul(rz))
    .max(float(0))
    .pow(float(1.0 / 3.0));
  const m_ = float(0.2119034982)
    .mul(rx)
    .add(float(0.6806995451).mul(ry))
    .add(float(0.1073969566).mul(rz))
    .max(float(0))
    .pow(float(1.0 / 3.0));
  const s_ = float(0.0883024619)
    .mul(rx)
    .add(float(0.2817188376).mul(ry))
    .add(float(0.6299787005).mul(rz))
    .max(float(0))
    .pow(float(1.0 / 3.0));

  const L = float(0.2104542553)
    .mul(l_)
    .add(float(0.793617785).mul(m_))
    .sub(float(0.0040720468).mul(s_));
  const a = float(1.9779984951)
    .mul(l_)
    .sub(float(2.428592205).mul(m_))
    .add(float(0.4505937099).mul(s_));
  const b = float(0.0259040371)
    .mul(l_)
    .add(float(0.7827717662).mul(m_))
    .sub(float(0.808675766).mul(s_));
  return vec3(L, a, b);
}

/**
 * Converts OKLab (L, a, b) node back to linear RGB node in TSL.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function oklabToRgb(lab: any): any {
  const L = float(lab.x);
  const a = float(lab.y);
  const b = float(lab.z);

  const l_ = L.add(float(0.3963377774).mul(a)).add(float(0.2158037573).mul(b));
  const m_ = L.sub(float(0.1055613458).mul(a)).sub(float(0.0638541728).mul(b));
  const s_ = L.sub(float(0.0894841775).mul(a)).sub(float(1.291485548).mul(b));

  const l = l_.mul(l_).mul(l_);
  const m = m_.mul(m_).mul(m_);
  const s = s_.mul(s_).mul(s_);

  const r = float(4.0767416621)
    .mul(l)
    .sub(float(3.3077115913).mul(m))
    .add(float(0.2309699292).mul(s))
    .clamp(float(0), float(1));
  const g = float(-1.2684380046)
    .mul(l)
    .add(float(2.6097574011).mul(m))
    .sub(float(0.3413193965).mul(s))
    .clamp(float(0), float(1));
  const bOut = float(-0.0041960863)
    .mul(l)
    .sub(float(0.7034186147).mul(m))
    .add(float(1.707614701).mul(s))
    .clamp(float(0), float(1));
  return vec3(r, g, bOut);
}

/**
 * Perceptual mix between two RGB color nodes via OKLab.
 * Prevents muddy gray midpoints and unnatural luminance dips.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function oklabMix(c1: any, c2: any, t: any): any {
  const lab1 = rgbToOklab(c1);
  const lab2 = rgbToOklab(c2);
  return oklabToRgb(mix(lab1, lab2, t));
}

/**
 * Continuous 4-stop perceptual palette ramp in OKLab.
 * Smoothly interpolates across 4 track colors without desaturation.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function oklabPaletteRamp(c0: any, c1: any, c2: any, c3: any, t: any): any {
  const lab0 = rgbToOklab(c0);
  const lab1 = rgbToOklab(c1);
  const lab2 = rgbToOklab(c2);
  const lab3 = rgbToOklab(c3);

  const t1 = t.mul(3.0).clamp(float(0), float(1));
  const t2 = t.mul(3.0).sub(1.0).clamp(float(0), float(1));
  const t3 = t.mul(3.0).sub(2.0).clamp(float(0), float(1));

  const m01 = mix(lab0, lab1, t1);
  const m12 = mix(m01, lab2, t2);
  const m23 = mix(m12, lab3, t3);
  return oklabToRgb(m23);
}

/**
 * Continuous 3-stop perceptual palette ramp in OKLab.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function oklabPaletteRamp3(c0: any, c1: any, c2: any, t: any): any {
  const lab0 = rgbToOklab(c0);
  const lab1 = rgbToOklab(c1);
  const lab2 = rgbToOklab(c2);

  const t1 = t.mul(2.0).clamp(float(0), float(1));
  const t2 = t.mul(2.0).sub(1.0).clamp(float(0), float(1));

  const m01 = mix(lab0, lab1, t1);
  const m12 = mix(m01, lab2, t2);
  return oklabToRgb(m12);
}
