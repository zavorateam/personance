import { Fft } from './fft';
import type { StatSummary, VltkAcousticMetrics } from '../types/track-metadata';

/**
 * Computes full-bandwidth & stereo acoustic characteristics for VLTK_ tags:
 * - ITU-R BS.1770-4 K-weighted Integrated LUFS, Momentary Max, Short-Term Max, LRA
 * - RMS, Sample Peak, 4x Catmull-Rom True Peak Estimate, Crest Factor, Clipping Ratio, Silence Ratio
 * - Stereo Correlation & Mid/Side Stereo Width
 * - Frame-wise Spectral Centroid, Bandwidth, Rolloff (85%), Entropy, Flux, Contrast (6 octave bands), Flatness, ZCR
 * - 13 MFCCs with MEAN, MEDIAN, STD, MIN, MAX, P10, P90 statistics
 */

export function computeStatSummary(values: ArrayLike<number>): StatSummary {
  const n = values.length;
  if (n === 0) {
    return { mean: 0, median: 0, std: 0, min: 0, max: 0, p10: 0, p90: 0 };
  }
  const sorted = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = Number.isFinite(values[i]) ? values[i] : 0;
    sorted[i] = v;
    sum += v;
  }
  sorted.sort();
  const mean = sum / n;
  let sqSum = 0;
  for (let i = 0; i < n; i++) {
    const d = sorted[i] - mean;
    sqSum += d * d;
  }
  const std = Math.sqrt(sqSum / n);
  const quantile = (q: number): number => {
    const pos = q * (n - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(n - 1, lo + 1);
    const frac = pos - lo;
    return sorted[lo] * (1 - frac) + sorted[hi] * frac;
  };
  return {
    mean,
    median: quantile(0.5),
    std,
    min: sorted[0],
    max: sorted[n - 1],
    p10: quantile(0.1),
    p90: quantile(0.9),
  };
}

interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * Bilinear-transform biquad coefficients for ITU-R BS.1770-4 K-weighting
 * adapted to any arbitrary sampleRate (exact match at 48 kHz and generalized via pre-warped bilinear transform).
 */
function designKWeightingBiquads(sampleRate: number): [BiquadCoeffs, BiquadCoeffs] {
  // Stage 1: High shelf (+3.999843853973347 dB @ ~1681.97 Hz, Q = 0.7071752369554196)
  const f0Shelf = 1681.974450955533;
  const G = 3.999843853973347;
  const Qs = 0.7071752369554196;
  const K1 = Math.tan((Math.PI * f0Shelf) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0_1 = 1 + K1 / Qs + K1 * K1;
  const stage1: BiquadCoeffs = {
    b0: (Vh + (Vb * K1) / Qs + K1 * K1) / a0_1,
    b1: (2 * (K1 * K1 - Vh)) / a0_1,
    b2: (Vh - (Vb * K1) / Qs + K1 * K1) / a0_1,
    a1: (2 * (K1 * K1 - 1)) / a0_1,
    a2: (1 - K1 / Qs + K1 * K1) / a0_1,
  };

  // Stage 2: RLB High-pass (f0 = 38.13547087602444 Hz, Q = 0.5003270373238773)
  const f0Hp = 38.13547087602444;
  const Qh = 0.5003270373238773;
  const K2 = Math.tan((Math.PI * f0Hp) / sampleRate);
  const a0_2 = 1 + K2 / Qh + K2 * K2;
  const stage2: BiquadCoeffs = {
    b0: 1 / a0_2,
    b1: -2 / a0_2,
    b2: 1 / a0_2,
    a1: (2 * (K2 * K2 - 1)) / a0_2,
    a2: (1 - K2 / Qh + K2 * K2) / a0_2,
  };

  return [stage1, stage2];
}

function applyBiquadInPlace(buf: Float32Array, c: BiquadCoeffs): void {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x0 = buf[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    buf[i] = y0;
  }
}

function linearToDb(v: number, floorDb = -120): number {
  if (v <= 1e-12) return floorDb;
  return Math.max(floorDb, 20 * Math.log10(v));
}

function powerToLufs(meanSquare: number): number {
  if (meanSquare <= 1e-12) return -120;
  return Math.max(-120, -0.691 + 10 * Math.log10(meanSquare));
}

/**
 * Computes acoustic features directly from the full-sample-rate AudioBuffer (mono or stereo).
 */
export function extractAcousticMetrics(buffer: AudioBuffer): VltkAcousticMetrics {
  const sr = buffer.sampleRate;
  const nCh = buffer.numberOfChannels;
  const len = buffer.length;
  const ch0 = buffer.getChannelData(0);
  const ch1 = nCh > 1 ? buffer.getChannelData(1) : ch0;

  // 1. Time-domain sample-accurate metrics (RMS, Sample Peak, 4x Catmull-Rom True Peak, Clipping, Stereo)
  let sumSqTotal = 0;
  let samplePeak = 0;
  let truePeak = 0;
  let clippedSamples = 0;

  let corrNum = 0;
  let corrDenL = 0;
  let corrDenR = 0;
  let midEnergy = 0;
  let sideEnergy = 0;

  const mono = new Float32Array(len);

  for (let c = 0; c < nCh; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const s = ch[i];
      const abs = Math.abs(s);
      sumSqTotal += s * s;
      if (abs > samplePeak) samplePeak = abs;
      if (abs >= 0.9999) clippedSamples++;

      // 4x Catmull-Rom cubic interpolation for inter-sample true peak estimate
      if (i >= 1 && i + 2 < len) {
        const p0 = ch[i - 1];
        const p1 = s;
        const p2 = ch[i + 1];
        const p3 = ch[i + 2];
        const a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
        const b = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
        const cc = -0.5 * p0 + 0.5 * p2;
        const d = p1;
        for (const t of [0.25, 0.5, 0.75]) {
          const interp = Math.abs(((a * t + b) * t + cc) * t + d);
          if (interp > truePeak) truePeak = interp;
        }
      }
      if (abs > truePeak) truePeak = abs;
    }
  }

  for (let i = 0; i < len; i++) {
    const l = ch0[i];
    const r = ch1[i];
    const m = 0.5 * (l + r);
    const s = 0.5 * (l - r);
    mono[i] = m;
    corrNum += l * r;
    corrDenL += l * l;
    corrDenR += r * r;
    midEnergy += m * m;
    sideEnergy += s * s;
  }

  const totalSamples = Math.max(1, len * nCh);
  const rmsLinear = Math.sqrt(sumSqTotal / totalSamples);
  const rmsDb = linearToDb(rmsLinear, -96);
  const samplePeakDbfs = linearToDb(samplePeak, -96);
  const truePeakDbtp = linearToDb(truePeak, -96);
  const crestFactorDb = Math.max(0, truePeakDbtp - rmsDb);
  const clippingRatio = clippedSamples / totalSamples;

  const stereoCorrelation =
    nCh < 2
      ? 1
      : corrDenL > 1e-12 && corrDenR > 1e-12
        ? Math.max(-1, Math.min(1, corrNum / Math.sqrt(corrDenL * corrDenR)))
        : 1;
  const stereoWidth =
    nCh < 2 || midEnergy + sideEnergy <= 1e-12 ? 0 : Math.min(1, (2 * sideEnergy) / (midEnergy + sideEnergy));

  // 2. ITU-R BS.1770-4 K-weighted Loudness (400ms hop 100ms momentary, 3s short-term, LRA)
  const [kw1, kw2] = designKWeightingBiquads(sr);
  const kwSumSq = new Float64Array(len);
  const chLimit = Math.min(nCh, 2);
  for (let c = 0; c < chLimit; c++) {
    const filtered = new Float32Array(buffer.getChannelData(c));
    applyBiquadInPlace(filtered, kw1);
    applyBiquadInPlace(filtered, kw2);
    for (let i = 0; i < len; i++) {
      kwSumSq[i] += filtered[i] * filtered[i];
    }
  }

  const hop100 = Math.max(1, Math.round(sr * 0.1));
  const win400 = Math.max(1, Math.round(sr * 0.4));
  const win3s = Math.max(1, Math.round(sr * 3.0));

  // Prefix sum for O(N) block loudness
  const prefix = new Float64Array(len + 1);
  for (let i = 0; i < len; i++) prefix[i + 1] = prefix[i] + kwSumSq[i];

  const momMeans: number[] = [];
  let lufsMomentaryMax = -120;
  for (let start = 0; start + win400 <= len; start += hop100) {
    const ms = (prefix[start + win400] - prefix[start]) / win400;
    momMeans.push(ms);
    const l = powerToLufs(ms);
    if (l > lufsMomentaryMax) lufsMomentaryMax = l;
  }
  if (momMeans.length === 0 && len > 0) {
    const ms = prefix[len] / len;
    momMeans.push(ms);
    lufsMomentaryMax = powerToLufs(ms);
  }

  // Absolute gate (-70 LUFS) then relative gate (-10 LU)
  const absThresholdMs = Math.pow(10, (-70 + 0.691) / 10);
  const aboveAbs = momMeans.filter((ms) => ms > absThresholdMs);
  let lufsIntegrated = -70;
  if (aboveAbs.length > 0) {
    const meanAbs = aboveAbs.reduce((a, b) => a + b, 0) / aboveAbs.length;
    const relThresholdLufs = powerToLufs(meanAbs) - 10;
    const relThresholdMs = Math.pow(10, (relThresholdLufs + 0.691) / 10);
    const aboveRel = aboveAbs.filter((ms) => ms > relThresholdMs);
    const finalMs = aboveRel.length > 0 ? aboveRel.reduce((a, b) => a + b, 0) / aboveRel.length : meanAbs;
    lufsIntegrated = powerToLufs(finalMs);
  }

  const shortTermLufs: number[] = [];
  let lufsShortTermMax = -120;
  for (let start = 0; start + win3s <= len; start += hop100) {
    const ms = (prefix[start + win3s] - prefix[start]) / win3s;
    const l = powerToLufs(ms);
    if (l > lufsShortTermMax) lufsShortTermMax = l;
    if (l > -70) shortTermLufs.push(l);
  }
  if (shortTermLufs.length === 0) {
    lufsShortTermMax = lufsMomentaryMax;
  }
  let lra = 0;
  if (shortTermLufs.length >= 2) {
    const gatedShort = shortTermLufs.filter((l) => l >= lufsIntegrated - 20).sort((a, b) => a - b);
    if (gatedShort.length >= 2) {
      const p10 = gatedShort[Math.floor(0.1 * (gatedShort.length - 1))];
      const p95 = gatedShort[Math.floor(0.95 * (gatedShort.length - 1))];
      lra = Math.max(0, p95 - p10);
    }
  }

  // 3. Frame-wise Spectral, Temporal, Contrast, and MFCC Analysis (full sampleRate)
  const FRAME = 2048;
  const HOP = 512;
  const nFrames = Math.max(1, Math.floor((len - FRAME) / HOP) + 1);
  // Downsample frame step only if track is extraordinarily long (>18 min) to keep UI responsive
  const frameStride = nFrames > 90000 ? 2 : 1;
  const sampledFrames = Math.max(1, Math.ceil(nFrames / frameStride));

  const fft = new Fft(FRAME);
  const halfBins = FRAME / 2;
  const binHz = sr / FRAME;
  const win = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FRAME - 1)));

  const frameBuf = new Float32Array(FRAME);
  const mags = new Float32Array(halfBins);
  const prevMags = new Float32Array(halfBins);

  // Precompute Mel filterbank (26 filters from 20 Hz to nyquist, 13 MFCCs)
  const NUM_MEL = 26;
  const NUM_MFCC = 13;
  const nyquist = sr * 0.5;
  const melBanks = buildMelFilterbank(NUM_MEL, FRAME, sr, 20, Math.min(16000, nyquist));
  const dctMatrix = buildDctMatrix(NUM_MFCC, NUM_MEL);

  // Octave sub-band boundaries for Spectral Contrast (6 bands: 40-160, 160-320, 320-640, 640-1280, 1280-2560, 2560-nyq)
  const contrastBands: [number, number][] = [];
  let fLow = 40;
  for (let b = 0; b < 6; b++) {
    const fHigh = b === 5 ? Math.min(nyquist, 16000) : fLow * 2;
    const b0 = Math.max(1, Math.floor(fLow / binHz));
    const b1 = Math.min(halfBins - 1, Math.max(b0 + 2, Math.floor(fHigh / binHz)));
    contrastBands.push([b0, b1]);
    fLow = fHigh;
  }

  const arrRmsDb = new Float32Array(sampledFrames);
  const arrCentroid = new Float32Array(sampledFrames);
  const arrBandwidth = new Float32Array(sampledFrames);
  const arrRolloff = new Float32Array(sampledFrames);
  const arrEntropy = new Float32Array(sampledFrames);
  const arrFlux = new Float32Array(sampledFrames);
  const arrContrast = new Float32Array(sampledFrames);
  const arrFlatness = new Float32Array(sampledFrames);
  const arrZcr = new Float32Array(sampledFrames);
  const mfccSeries: Float32Array[] = Array.from({ length: NUM_MFCC }, () => new Float32Array(sampledFrames));

  let silentFrames = 0;
  const logHalfBins = Math.log2(halfBins - 1);
  const bandSliceScratch = new Float64Array(halfBins);
  const melEnergies = new Float64Array(NUM_MEL);

  let outIdx = 0;
  for (let f = 0; f < nFrames && outIdx < sampledFrames; f += frameStride) {
    const off = f * HOP;
    let rmsSum = 0;
    let zcrCount = 0;
    let prevSign = 0;

    for (let i = 0; i < FRAME; i++) {
      const raw = off + i < len ? mono[off + i] : 0;
      rmsSum += raw * raw;
      const sign = raw >= 0 ? 1 : -1;
      if (i > 0 && sign !== prevSign) zcrCount++;
      prevSign = sign;
      frameBuf[i] = raw * win[i];
    }

    const frameRms = Math.sqrt(rmsSum / FRAME);
    const frameRmsDb = linearToDb(frameRms, -96);
    if (frameRmsDb < -60) silentFrames++;
    arrRmsDb[outIdx] = frameRmsDb;
    arrZcr[outIdx] = zcrCount / (FRAME - 1);

    fft.magnitudes(frameBuf, mags);

    let magSum = 0;
    let powerSum = 0;
    let weightedHz = 0;
    let fluxSum = 0;
    let logMagSum = 0;

    for (let k = 1; k < halfBins; k++) {
      const m = mags[k];
      const p = m * m;
      magSum += m;
      powerSum += p;
      weightedHz += m * (k * binHz);
      const diff = m - prevMags[k];
      if (diff > 0) fluxSum += diff;
      prevMags[k] = m;
      logMagSum += Math.log(Math.max(m, 1e-10));
    }

    const centHz = magSum > 1e-12 ? weightedHz / magSum : 0;
    arrCentroid[outIdx] = centHz;
    arrFlux[outIdx] = fluxSum;

    // Spectral Bandwidth & Rolloff (85%) & Entropy
    let bwAccum = 0;
    let cumPower = 0;
    const rolloffTarget = powerSum * 0.85;
    let rolloffHz = 0;
    let entropySum = 0;

    if (powerSum > 1e-18) {
      for (let k = 1; k < halfBins; k++) {
        const freq = k * binHz;
        const m = mags[k];
        const p = m * m;
        const df = freq - centHz;
        bwAccum += m * df * df;

        cumPower += p;
        if (rolloffHz === 0 && cumPower >= rolloffTarget) {
          rolloffHz = freq;
        }

        const prob = p / powerSum;
        if (prob > 1e-12) entropySum -= prob * Math.log2(prob);
      }
    }
    arrBandwidth[outIdx] = magSum > 1e-12 ? Math.sqrt(bwAccum / magSum) : 0;
    arrRolloff[outIdx] = rolloffHz;
    arrEntropy[outIdx] = Math.min(1, Math.max(0, entropySum / logHalfBins));

    // Spectral Flatness (geometric mean / arithmetic mean of magnitudes)
    const arithMean = magSum / (halfBins - 1);
    const geomMean = Math.exp(logMagSum / (halfBins - 1));
    arrFlatness[outIdx] = arithMean > 1e-12 ? Math.min(1, geomMean / arithMean) : 0;

    // Spectral Contrast (mean dB peak-to-valley across 6 octave bands, alpha = 0.2)
    let contrastAccum = 0;
    for (let b = 0; b < contrastBands.length; b++) {
      const [b0, b1] = contrastBands[b];
      const count = b1 - b0 + 1;
      for (let k = 0; k < count; k++) bandSliceScratch[k] = mags[b0 + k];
      bandSliceScratch.subarray(0, count).sort();
      const qCount = Math.max(1, Math.floor(count * 0.2));
      let valley = 0;
      let peak = 0;
      for (let q = 0; q < qCount; q++) {
        valley += bandSliceScratch[q];
        peak += bandSliceScratch[count - 1 - q];
      }
      valley /= qCount;
      peak /= qCount;
      contrastAccum += 20 * Math.log10((peak + 1e-7) / (valley + 1e-7));
    }
    arrContrast[outIdx] = contrastAccum / contrastBands.length;

    // Mel filterbank + DCT -> 13 MFCCs
    for (let m = 0; m < NUM_MEL; m++) {
      const weights = melBanks[m];
      let e = 0;
      for (let k = weights.start; k < weights.end; k++) {
        const mag = mags[k];
        e += mag * mag * weights.w[k - weights.start];
      }
      melEnergies[m] = Math.log(Math.max(e, 1e-12));
    }
    for (let c = 0; c < NUM_MFCC; c++) {
      let coeff = 0;
      const dctRow = dctMatrix[c];
      for (let m = 0; m < NUM_MEL; m++) {
        coeff += dctRow[m] * melEnergies[m];
      }
      mfccSeries[c][outIdx] = coeff;
    }

    outIdx++;
  }

  const frameRmsDb = computeStatSummary(arrRmsDb);
  const silenceRatio = silentFrames / Math.max(1, sampledFrames);
  const dynamicRangeDb = Math.max(0, frameRmsDb.p90 - frameRmsDb.p10);

  const mfccCoefficients = mfccSeries.map((series) => computeStatSummary(series));
  // Overall MFCC summary across coefficients 1..12 (excluding c0 energy offset) for concise track-level vector stats
  const mfccOverall: StatSummary = {
    mean: meanOf(mfccCoefficients.slice(1).map((s) => s.mean)),
    median: meanOf(mfccCoefficients.slice(1).map((s) => s.median)),
    std: meanOf(mfccCoefficients.slice(1).map((s) => s.std)),
    min: Math.min(...mfccCoefficients.slice(1).map((s) => s.min)),
    max: Math.max(...mfccCoefficients.slice(1).map((s) => s.max)),
    p10: meanOf(mfccCoefficients.slice(1).map((s) => s.p10)),
    p90: meanOf(mfccCoefficients.slice(1).map((s) => s.p90)),
  };

  return {
    lufsIntegrated,
    lufsMomentaryMax,
    lufsShortTermMax,
    lra,
    rmsDb,
    rmsLinear,
    samplePeak,
    samplePeakDbfs,
    truePeakEstimate: truePeak,
    truePeakDbtp,
    crestFactorDb,
    clippingRatio,
    silenceRatio,
    stereoCorrelation,
    stereoWidth,
    dynamicRangeDb,

    frameRmsDb,
    spectralCentroid: computeStatSummary(arrCentroid),
    spectralBandwidth: computeStatSummary(arrBandwidth),
    spectralRolloff: computeStatSummary(arrRolloff),
    spectralEntropy: computeStatSummary(arrEntropy),
    spectralFlux: computeStatSummary(arrFlux),
    spectralContrast: computeStatSummary(arrContrast),
    spectralFlatness: computeStatSummary(arrFlatness),
    zeroCrossingRate: computeStatSummary(arrZcr),
    mfccCoefficients,
    mfccOverall,
  };
}

function meanOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

function buildMelFilterbank(
  numMel: number,
  fftSize: number,
  sampleRate: number,
  fMin: number,
  fMax: number,
): { start: number; end: number; w: Float32Array }[] {
  const melMin = hzToMel(fMin);
  const melMax = hzToMel(fMax);
  const bins = new Int32Array(numMel + 2);
  const half = fftSize / 2;
  for (let i = 0; i < numMel + 2; i++) {
    const hz = melToHz(melMin + ((melMax - melMin) * i) / (numMel + 1));
    bins[i] = Math.min(half - 1, Math.max(1, Math.floor(((fftSize + 1) * hz) / sampleRate)));
  }

  const bank: { start: number; end: number; w: Float32Array }[] = [];
  for (let m = 1; m <= numMel; m++) {
    const left = bins[m - 1];
    const center = Math.max(left + 1, bins[m]);
    const right = Math.max(center + 1, bins[m + 1]);
    const w = new Float32Array(right - left + 1);
    for (let k = left; k <= center; k++) {
      w[k - left] = (k - left) / Math.max(1, center - left);
    }
    for (let k = center; k <= right; k++) {
      w[k - left] = (right - k) / Math.max(1, right - center);
    }
    bank.push({ start: left, end: right + 1, w });
  }
  return bank;
}

function buildDctMatrix(numCepstra: number, numMel: number): Float64Array[] {
  const mat: Float64Array[] = [];
  const norm = Math.sqrt(2 / numMel);
  for (let c = 0; c < numCepstra; c++) {
    const row = new Float64Array(numMel);
    for (let m = 0; m < numMel; m++) {
      row[m] = norm * Math.cos((Math.PI * c * (m + 0.5)) / numMel);
    }
    mat.push(row);
  }
  return mat;
}
