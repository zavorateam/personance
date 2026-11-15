import type { SongAnalysis } from '../types/song-analysis';
import type { VltkApertures } from './features';

export type NormalizedVltkTags = VltkApertures['tags'];

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function normRange(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return clamp01((v - lo) / Math.max(1e-6, hi - lo));
}

function parseTagFloat(flatTags: Record<string, string> | undefined, key: string): number | null {
  if (!flatTags || !(key in flatTags)) return null;
  const parsed = parseFloat(flatTags[key]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function defaultVltkTags(): NormalizedVltkTags {
  return {
    VLTK_STEREO_WIDTH: 0.45,
    VLTK_STEREO_CORRELATION: 0.65,
    VLTK_CREST_FACTOR_DB: 0.5,
    VLTK_DYNAMIC_RANGE_DB: 0.45,
    VLTK_LRA: 0.4,
    VLTK_LUFS_INTEGRATED: 0.55,
    VLTK_SPECTRAL_BANDWIDTH_MEAN: 0.48,
    VLTK_SPECTRAL_CONTRAST_MEAN: 0.5,
    VLTK_SPECTRAL_ENTROPY_MEAN: 0.55,
    VLTK_SPECTRAL_FLATNESS_MEAN: 0.3,
    VLTK_SPECTRAL_FLUX_MEAN: 0.45,
    VLTK_SPECTRAL_ROLLOFF_MEAN: 0.48,
    VLTK_MFCC_STD: 0.45,
    VLTK_DANCEABILITY: 0.55,
    VLTK_AROUSAL: 0.5,
    VLTK_VALENCE: 0.5,
    VLTK_ONSET_DENSITY: 0.45,
    VLTK_BPM_STABILITY: 0.7,
    VLTK_VOCAL_PROBABILITY: 0.4,
  };
}

/**
 * Extracts normalized (0..1) VLTK_* tag values from SongAnalysis.metadata
 * (reading flatTags['VLTK_*'] with structured fallbacks).
 */
export function extractNormalizedVltkTags(analysis: SongAnalysis | null): {
  tags: NormalizedVltkTags;
  source: 'metadata' | 'live-proxy';
} {
  const tags = defaultVltkTags();
  if (!analysis) return { tags, source: 'live-proxy' };

  // Emotion & onset density approximations before full TrackMetadataReport lands
  if (analysis.emotion) {
    tags.VLTK_VALENCE = clamp01(analysis.emotion.valence);
    tags.VLTK_AROUSAL = clamp01(analysis.emotion.arousal);
  }
  if (analysis.durationSec > 0 && analysis.onsets.length > 0) {
    tags.VLTK_ONSET_DENSITY = normRange(analysis.onsets.length / analysis.durationSec, 0.4, 5.5);
  }

  const meta = analysis.metadata;
  if (!meta) return { tags, source: 'live-proxy' };

  const flat = meta.flatTags;
  const ac = meta.acoustics;

  const stereoWidth = parseTagFloat(flat, 'VLTK_STEREO_WIDTH') ?? ac.stereoWidth;
  const stereoCorr = parseTagFloat(flat, 'VLTK_STEREO_CORRELATION') ?? ac.stereoCorrelation;
  const crestDb = parseTagFloat(flat, 'VLTK_CREST_FACTOR_DB') ?? ac.crestFactorDb;
  const dynRange = parseTagFloat(flat, 'VLTK_DYNAMIC_RANGE_DB') ?? ac.dynamicRangeDb;
  const lra = parseTagFloat(flat, 'VLTK_LRA') ?? ac.lra;
  const lufs = parseTagFloat(flat, 'VLTK_LUFS_INTEGRATED') ?? ac.lufsIntegrated;

  const bw = parseTagFloat(flat, 'VLTK_SPECTRAL_BANDWIDTH_MEAN') ?? ac.spectralBandwidth.mean;
  const contrast = parseTagFloat(flat, 'VLTK_SPECTRAL_CONTRAST_MEAN') ?? ac.spectralContrast.mean;
  const entropy = parseTagFloat(flat, 'VLTK_SPECTRAL_ENTROPY_MEAN') ?? ac.spectralEntropy.mean;
  const flatness = parseTagFloat(flat, 'VLTK_SPECTRAL_FLATNESS_MEAN') ?? ac.spectralFlatness.mean;
  const flux = parseTagFloat(flat, 'VLTK_SPECTRAL_FLUX_MEAN') ?? ac.spectralFlux.mean;
  const rolloff = parseTagFloat(flat, 'VLTK_SPECTRAL_ROLLOFF_MEAN') ?? ac.spectralRolloff.mean;
  const mfccStd = parseTagFloat(flat, 'VLTK_MFCC_STD') ?? ac.mfccOverall.std;

  const danceability = parseTagFloat(flat, 'VLTK_DANCEABILITY') ?? meta.classification.danceability;
  const arousal = parseTagFloat(flat, 'VLTK_AROUSAL') ?? meta.emotion.arousal;
  const valence = parseTagFloat(flat, 'VLTK_VALENCE') ?? meta.emotion.valence;
  const onsetDensity = parseTagFloat(flat, 'VLTK_ONSET_DENSITY') ?? meta.tempo.onsetDensity;
  const bpmStability = parseTagFloat(flat, 'VLTK_BPM_STABILITY') ?? meta.tempo.stability;
  const vocalProb = parseTagFloat(flat, 'VLTK_VOCAL_PROBABILITY') ?? meta.classification.vocalProbability;

  tags.VLTK_STEREO_WIDTH = clamp01(stereoWidth);
  // Correlation is [-1, 1]; map to [0, 1] where 1 = tightly correlated mono center
  tags.VLTK_STEREO_CORRELATION = normRange(stereoCorr, -0.5, 1.0);
  tags.VLTK_CREST_FACTOR_DB = normRange(crestDb, 4.0, 20.0);
  tags.VLTK_DYNAMIC_RANGE_DB = normRange(dynRange, 2.0, 18.0);
  tags.VLTK_LRA = normRange(lra, 1.0, 16.0);
  tags.VLTK_LUFS_INTEGRATED = normRange(lufs, -28.0, -5.0);

  tags.VLTK_SPECTRAL_BANDWIDTH_MEAN = normRange(bw, 600, 4800);
  tags.VLTK_SPECTRAL_CONTRAST_MEAN = normRange(contrast, 8, 28);
  tags.VLTK_SPECTRAL_ENTROPY_MEAN = clamp01(entropy);
  tags.VLTK_SPECTRAL_FLATNESS_MEAN = normRange(flatness, 0.01, 0.35);
  tags.VLTK_SPECTRAL_FLUX_MEAN = normRange(flux, 2.0, 48.0);
  tags.VLTK_SPECTRAL_ROLLOFF_MEAN = normRange(rolloff, 1200, 12000);
  tags.VLTK_MFCC_STD = normRange(mfccStd, 2.0, 22.0);

  tags.VLTK_DANCEABILITY = clamp01(danceability);
  tags.VLTK_AROUSAL = clamp01(arousal);
  tags.VLTK_VALENCE = clamp01(valence);
  tags.VLTK_ONSET_DENSITY = normRange(onsetDensity, 0.4, 5.5);
  tags.VLTK_BPM_STABILITY = clamp01(bpmStability);
  tags.VLTK_VOCAL_PROBABILITY = clamp01(vocalProb);

  return { tags, source: 'metadata' };
}
