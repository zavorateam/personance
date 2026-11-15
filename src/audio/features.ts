import type { Palette, Section } from '../types/song-analysis';

/**
 * The per-frame feature bus every scene and the conductor consume.
 * Scenes never know whether audio came from a pre-analyzed file or a
 * live capture — LiveProvider simply leaves the lookahead fields null.
 */
/**
 * Extended multi-band sound apertures + normalized VLTK_* tag profile (0..1)
 * used by physics scenes (e.g. ferrofluid) to disperse along X/Y/Z axes
 * with cross-tag coefficients.
 */
export interface VltkApertures {
  /** Instantaneous frequency-band apertures (0..1). */
  subBass: number;   // 20–80 Hz
  bass: number;      // 20–250 Hz
  lowMid: number;    // 250–800 Hz
  mid: number;       // 250–2000 Hz
  highMid: number;   // 2000–4500 Hz
  treble: number;    // 2000–8000 Hz
  air: number;       // 6000–16000 Hz
  flux: number;      // positive spectral flux transient 0..1

  /** Normalized VLTK_* track metadata tags (0..1). */
  tags: {
    VLTK_STEREO_WIDTH: number;
    VLTK_STEREO_CORRELATION: number;
    VLTK_CREST_FACTOR_DB: number;
    VLTK_DYNAMIC_RANGE_DB: number;
    VLTK_LRA: number;
    VLTK_LUFS_INTEGRATED: number;
    VLTK_SPECTRAL_BANDWIDTH_MEAN: number;
    VLTK_SPECTRAL_CONTRAST_MEAN: number;
    VLTK_SPECTRAL_ENTROPY_MEAN: number;
    VLTK_SPECTRAL_FLATNESS_MEAN: number;
    VLTK_SPECTRAL_FLUX_MEAN: number;
    VLTK_SPECTRAL_ROLLOFF_MEAN: number;
    VLTK_MFCC_STD: number;
    VLTK_DANCEABILITY: number;
    VLTK_AROUSAL: number;
    VLTK_VALENCE: number;
    VLTK_ONSET_DENSITY: number;
    VLTK_BPM_STABILITY: number;
    VLTK_VOCAL_PROBABILITY: number;
  };
  /** 'metadata' when backed by TrackMetadataReport flatTags, 'live-proxy' otherwise. */
  source: 'metadata' | 'live-proxy';
}

export interface FrameFeatures {
  /** Playback / capture clock in seconds. */
  time: number;
  /** Overall loudness 0..1 (adaptively normalized). */
  level: number;
  bass: number;
  mid: number;
  treble: number;
  /** Spectral centroid 0..1 (brightness). */
  centroid: number;
  /** True on the frame an onset/beat fires. */
  onset: boolean;
  /** True on the frame a downbeat (the "1") fires. */
  downbeat: boolean;
  /** Continuous 0..1 phase between beats; null when no beat grid. */
  beatPhase: number | null;
  /** Seconds until the next beat; null when unknown (live mode). */
  nextBeatIn: number | null;
  /** Energy percentile of this moment relative to the whole song; null live. */
  energyPercentile: number | null;
  /** Current section; null when unknown. */
  section: Section | null;
  /** Seconds until the next section boundary; null when unknown. */
  nextSectionIn: number | null;
  /** Energy of the UPCOMING section — the drop-anticipation signal. */
  nextSectionEnergy: number | null;
  /** Raw magnitude spectrum 0..1 for per-bin effects. */
  spectrum: Float32Array;
  /** Multi-band apertures and normalized VLTK_* metadata tags. */
  apertures?: VltkApertures;
}

export interface AudioFeatureProvider {
  /** Pull the latest frame. Called once per render frame. */
  frame(): FrameFeatures;
  readonly palette: Palette | null;
  readonly isPlaying: boolean;
}
