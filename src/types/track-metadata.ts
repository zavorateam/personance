export interface StatSummary {
  mean: number;
  median: number;
  std: number;
  min: number;
  max: number;
  p10: number;
  p90: number;
}

export interface MusicalMetadata {
  /** Primary genre normalized to our taxonomy (e.g. "Hip-Hop"). */
  genre: string;
  /** Broad stylistic grouping (e.g. "Rap", "Electronic", "Rock"). */
  grouping: string;
  /** Subgenres strictly belonging to the chosen primary genre. */
  subgenres: string[];
  /** Semicolon-joined SUBGENRE string. */
  subgenreTag: string;
  /** Formatted BPM (e.g. "89.10") ONLY if valid & unconflicted; empty string otherwise. */
  bpm: string;
  /** Formatted Key (e.g. "Bbm") ONLY if confidence is sufficient; empty string otherwise. */
  key: string;
  /** Emotional mood descriptors. */
  moods: string[];
  /** Semicolon-joined MOOD string. */
  moodTag: string;
}

export interface TempoCandidate {
  bpm: number;
  score: number;
  source: string;
}

export interface VltkTempoDiagnostics {
  measuredBpm: number;
  confidence: number;
  validForStandardTag: boolean;
  algorithms: string[];
  alternatives: TempoCandidate[];
  conflict: boolean;
  conflictReason: string;
  stability: number;
  beatCount: number;
  downbeatCount: number;
  onsetCount: number;
  onsetDensity: number;
}

export interface EmotionClassifierOutput {
  name: string;
  valence: number;
  arousal: number;
}

export interface MoodScore {
  mood: string;
  score: number;
}

export interface VltkEmotionDiagnostics {
  valence: number;
  arousal: number;
  detectedKey: string;
  keyConfidence: number;
  keyValidForStandardTag: boolean;
  modelDivergence: number;
  classifiers: EmotionClassifierOutput[];
  moodScores: MoodScore[];
}

export interface LabelProbability {
  label: string;
  probability: number;
}

export interface VltkClassificationDiagnostics {
  discogsGenres: LabelProbability[];
  jamendoGenres: LabelProbability[];
  instruments: LabelProbability[];
  danceability: number;
  vocalContent: 'vocal' | 'instrumental' | 'mixed';
  vocalProbability: number;
}

export interface VltkAcousticMetrics {
  lufsIntegrated: number;
  lufsMomentaryMax: number;
  lufsShortTermMax: number;
  lra: number;
  rmsDb: number;
  rmsLinear: number;
  samplePeak: number;
  samplePeakDbfs: number;
  truePeakEstimate: number;
  truePeakDbtp: number;
  crestFactorDb: number;
  clippingRatio: number;
  silenceRatio: number;
  stereoCorrelation: number;
  stereoWidth: number;
  dynamicRangeDb: number;

  frameRmsDb: StatSummary;
  spectralCentroid: StatSummary;
  spectralBandwidth: StatSummary;
  spectralRolloff: StatSummary;
  spectralEntropy: StatSummary;
  spectralFlux: StatSummary;
  spectralContrast: StatSummary;
  spectralFlatness: StatSummary;
  zeroCrossingRate: StatSummary;
  /** Summary statistics across the 13 MFCC coefficients (each StatSummary per coefficient 1..13). */
  mfccCoefficients: StatSummary[];
  /** Aggregated MFCC summary stats across coefficients. */
  mfccOverall: StatSummary;
}

export interface VltkTechInfo {
  container: string;
  codec: string;
  codecProfile: string;
  sampleRate: number;
  channels: number;
  bitrate: number;
  bitDepth: number | null;
  durationSec: number;
  fileSize: number;
}

export interface PreservedFileTags {
  container: 'mp3' | 'flac' | 'wav' | 'ogg' | 'mp4' | 'unknown';
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  date?: string;
  releaseDate?: string;
  isrc?: string;
  lyrics?: string;
  trackNumber?: string;
  discNumber?: string;
  comment?: string;
  hasEmbeddedCover: boolean;
  existingGenre?: string;
  existingGrouping?: string;
  existingBpm?: string;
  existingKey?: string;
  musicbrainz: {
    trackId?: string;
    albumId?: string;
    artistId?: string;
    albumArtistId?: string;
    releaseGroupId?: string;
    releaseTrackId?: string;
    workId?: string;
  };
  acoustid: {
    id?: string;
    fingerprint?: string;
  };
  /** Custom or unknown text tags preserved verbatim. */
  customTags: Record<string, string>;
}

export interface MusicBrainzEnrichment {
  source: 'musicbrainz' | 'acoustid';
  fetchedAt: number;
  recordingId?: string;
  title?: string;
  artist?: string;
  album?: string;
  releaseDate?: string;
  isrc?: string;
  tags?: string[];
}

export interface TrackMetadataReport {
  musical: MusicalMetadata;
  tempo: VltkTempoDiagnostics;
  emotion: VltkEmotionDiagnostics;
  classification: VltkClassificationDiagnostics;
  acoustics: VltkAcousticMetrics;
  tech: VltkTechInfo;
  preserved: PreservedFileTags;
  enrichment?: MusicBrainzEnrichment | null;
  /** Flat key-value representation of all tags to be written to the audio file. */
  flatTags: Record<string, string>;
}
