import {
  DISCOGS_STYLE_DEFS,
  GENRE_TAXONOMY,
  JAMENDO_STYLE_DEFS,
  MOOD_LEXICON,
  normalizeGenreToTaxonomy,
} from './taxonomy';
import type { SongAnalysis } from '../types/song-analysis';
import type {
  EmotionClassifierOutput,
  LabelProbability,
  MoodScore,
  MusicBrainzEnrichment,
  PreservedFileTags,
  StatSummary,
  TempoCandidate,
  TrackMetadataReport,
  VltkAcousticMetrics,
  VltkClassificationDiagnostics,
  VltkEmotionDiagnostics,
  VltkTechInfo,
  VltkTempoDiagnostics,
} from '../types/track-metadata';

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function meanArr(arr: ArrayLike<number>): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

/** Formats Unicode key string (e.g. "B♭", "minor") into standard ASCII tag format ("Bbm"). */
export function formatMusicalKey(key: string, mode: 'major' | 'minor'): string {
  const ascii = key.replace(/♯/g, '#').replace(/♭/g, 'b').trim();
  if (!ascii || ascii === '—') return '';
  return mode === 'minor' ? `${ascii}m` : ascii;
}

/**
 * Evaluates tempo validity, rhythm stability, beat count, and half-time / double-time octave conflicts.
 * If convincing competing octave tempos exist (e.g., 70 vs 140 BPM), standard BPM tag must remain empty.
 */
export function evaluateTempoDiagnostics(analysis: SongAnalysis): VltkTempoDiagnostics {
  const measuredBpm = Math.round((analysis.tempo.bpm || 0) * 100) / 100;
  const confidence = clamp01(analysis.tempo.confidence ?? 0);
  const beats = analysis.beats ?? [];
  const downbeats = analysis.downbeats ?? [];
  const onsets = analysis.onsets ?? [];
  const durationSec = Math.max(1, analysis.durationSec || 1);

  // Beat interval stability (1 - coefficient of variation of IBIs)
  let stability = 0;
  let ibiHalfDoubleRatio = 0;
  if (beats.length >= 4) {
    const ibis: number[] = [];
    for (let i = 1; i < beats.length; i++) {
      const dt = beats[i] - beats[i - 1];
      if (dt > 0.15 && dt < 2.2) ibis.push(dt);
    }
    if (ibis.length >= 3) {
      const m = meanArr(ibis);
      let v = 0;
      for (const dt of ibis) v += (dt - m) * (dt - m);
      const sd = Math.sqrt(v / ibis.length);
      const cv = m > 0 ? sd / m : 1;
      stability = clamp01(1 - cv * 2.2);

      const halfCount = ibis.filter((dt) => Math.abs(dt / m - 0.5) < 0.12 || Math.abs(dt / m - 2.0) < 0.18).length;
      ibiHalfDoubleRatio = halfCount / ibis.length;
    }
  }

  // Gather candidate tempos from classical + neural sources
  const rawCandidates: TempoCandidate[] = [...(analysis.tempo.candidates ?? [])];
  if (measuredBpm > 0 && !rawCandidates.some((c) => Math.abs(c.bpm - measuredBpm) < 0.5)) {
    rawCandidates.unshift({
      bpm: measuredBpm,
      score: confidence,
      source: analysis.engine.includes('beat-this') ? 'beat_this_onnx' : 'autocorr_flux',
    });
  }

  // Deduplicate alternatives while preserving highest score per ~3% BPM bucket
  const alternatives: TempoCandidate[] = [];
  for (const c of rawCandidates.sort((a, b) => b.score - a.score)) {
    if (c.bpm <= 0) continue;
    const existing = alternatives.find((a) => Math.abs(a.bpm - c.bpm) / Math.max(a.bpm, 1) <= 0.035);
    if (!existing) {
      alternatives.push({
        bpm: Math.round(c.bpm * 100) / 100,
        score: Math.round(clamp01(c.score) * 1000) / 1000,
        source: c.source,
      });
    } else if (c.score > existing.score) {
      existing.score = Math.round(clamp01(c.score) * 1000) / 1000;
    }
  }

  const algorithms = Array.from(
    new Set([
      ...(analysis.engine.includes('beat-this') ? ['beat_this_onnx'] : []),
      'autocorr_flux',
      'onset_ioi',
      ...alternatives.map((a) => a.source),
    ]),
  );

  // Detect half-time / double-time conflict (e.g., 70 vs 140 BPM)
  let conflict = Boolean(analysis.tempo.conflict);
  let conflictReason = conflict ? 'half_double_autocorr_competition' : 'none';

  if (measuredBpm > 0) {
    for (const alt of alternatives) {
      if (Math.abs(alt.bpm - measuredBpm) < 1.5) continue;
      const ratio = alt.bpm > measuredBpm ? alt.bpm / measuredBpm : measuredBpm / alt.bpm;
      const isOctave = Math.abs(ratio - 2.0) <= 0.08;
      if (isOctave && alt.score >= Math.max(0.28, confidence * 0.68)) {
        conflict = true;
        const lo = Math.min(measuredBpm, alt.bpm).toFixed(2);
        const hi = Math.max(measuredBpm, alt.bpm).toFixed(2);
        conflictReason = `half_double_octave_competition (${lo} vs ${hi} BPM)`;
        break;
      }
    }
  }

  if (!conflict && ibiHalfDoubleRatio >= 0.22) {
    conflict = true;
    conflictReason = `bimodal_ibi_half_double_jitter (${Math.round(ibiHalfDoubleRatio * 100)}% octave intervals)`;
  }

  const validForStandardTag = !conflict && confidence >= 0.35 && measuredBpm >= 35 && measuredBpm <= 240;

  return {
    measuredBpm,
    confidence,
    validForStandardTag,
    algorithms,
    alternatives: alternatives.slice(0, 6),
    conflict,
    conflictReason,
    stability,
    beatCount: beats.length,
    downbeatCount: downbeats.length,
    onsetCount: onsets.length,
    onsetDensity: onsets.length / durationSec,
  };
}

/**
 * Multi-model Emotion & Mood diagnostics.
 */
export function evaluateEmotionDiagnostics(
  analysis: SongAnalysis,
  acoustics: VltkAcousticMetrics,
  tempoDiag: VltkTempoDiagnostics,
): VltkEmotionDiagnostics {
  const emo = analysis.emotion;
  const detectedKey = emo ? formatMusicalKey(emo.key, emo.mode) : '';
  const keyConfidence = clamp01(emo?.confidence ?? 0);
  const keyValidForStandardTag = detectedKey.length > 0 && keyConfidence >= 0.32;

  const isMinor = emo?.mode === 'minor';
  const centroidNorm = clamp01((Math.log2(Math.max(acoustics.spectralCentroid.mean, 120) / 120)) / 6.2);
  const contrastNorm = clamp01((acoustics.spectralContrast.mean - 10) / 22);
  const fluxNorm = clamp01(acoustics.spectralFlux.mean / 45);
  const crestNorm = clamp01((acoustics.crestFactorDb - 5) / 16);
  const bassMean = meanArr(analysis.curves.bass);
  const trebleMean = meanArr(analysis.curves.treble);
  const tempoNorm = clamp01((tempoDiag.measuredBpm - 60) / 120);
  const onsetNorm = clamp01((tempoDiag.onsetDensity - 0.5) / 3.5);

  // Classifier 1: Krumhansl-Schmuckler harmonic + tempo
  const m1Valence = clamp01(emo?.valence ?? (isMinor ? 0.32 : 0.68));
  const m1Arousal = clamp01(emo?.arousal ?? (tempoNorm * 0.55 + onsetNorm * 0.45));

  // Classifier 2: Spectral timbre (centroid brightness, contrast, flatness, treble/bass balance)
  const m2Valence = clamp01(
    0.25 + centroidNorm * 0.42 + (trebleMean - bassMean * 0.4) * 0.25 - (isMinor ? 0.12 : -0.08),
  );
  const m2Arousal = clamp01(fluxNorm * 0.45 + contrastNorm * 0.2 + centroidNorm * 0.2 + (1 - acoustics.silenceRatio) * 0.15);

  // Classifier 3: Rhythmic dynamics (groove, onset density, crest, RMS loudness)
  const loudnessNorm = clamp01((acoustics.lufsIntegrated + 28) / 22);
  const m3Valence = clamp01(0.35 + tempoDiag.stability * 0.25 + crestNorm * 0.2 - (isMinor ? 0.15 : -0.12));
  const m3Arousal = clamp01(loudnessNorm * 0.45 + onsetNorm * 0.3 + tempoNorm * 0.25);

  const classifiers: EmotionClassifierOutput[] = [
    { name: 'krumhansl_harmonic', valence: m1Valence, arousal: m1Arousal },
    { name: 'spectral_timbre', valence: m2Valence, arousal: m2Arousal },
    { name: 'rhythmic_dynamics', valence: m3Valence, arousal: m3Arousal },
  ];

  const valence = clamp01((m1Valence * 0.42 + m2Valence * 0.33 + m3Valence * 0.25));
  const arousal = clamp01((m1Arousal * 0.35 + m2Arousal * 0.35 + m3Arousal * 0.30));

  const valMean = (m1Valence + m2Valence + m3Valence) / 3;
  const aroMean = (m1Arousal + m2Arousal + m3Arousal) / 3;
  const valStd = Math.sqrt(
    ((m1Valence - valMean) ** 2 + (m2Valence - valMean) ** 2 + (m3Valence - valMean) ** 2) / 3,
  );
  const aroStd = Math.sqrt(
    ((m1Arousal - aroMean) ** 2 + (m2Arousal - aroMean) ** 2 + (m3Arousal - aroMean) ** 2) / 3,
  );
  const modelDivergence = Math.round(((valStd + aroStd) * 0.5) * 10000) / 10000;

  // Score mood lexicon
  const moodScores: MoodScore[] = MOOD_LEXICON.map((proto) => {
    const dist = Math.hypot(valence - proto.valence, arousal - proto.arousal);
    let score = Math.exp(-dist * 2.8);
    if (proto.minorRequired && isMinor) score *= 1.15;
    if (proto.darkBias && valence < 0.42) score *= 1 + proto.darkBias * (0.45 - valence);
    if (proto.bassBias && bassMean > 0.45) score *= 1 + proto.bassBias * (bassMean - 0.3);
    return { mood: proto.mood, score: clamp01(score) };
  })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  // Normalize top moods slightly so leading scores read naturally
  const maxMood = moodScores[0]?.score || 1;
  for (const ms of moodScores) {
    ms.score = Math.round((ms.score / Math.max(maxMood, 0.01)) * 0.96 * 1000) / 1000;
  }

  return {
    valence,
    arousal,
    detectedKey,
    keyConfidence,
    keyValidForStandardTag,
    modelDivergence,
    classifiers,
    moodScores,
  };
}

function softmaxTop<T extends { label: string }>(
  items: { item: T; logit: number }[],
  limit: number,
  temperature = 1.0,
): LabelProbability[] {
  const maxL = Math.max(...items.map((x) => x.logit));
  const exps = items.map((x) => Math.exp((x.logit - maxL) / temperature));
  const sum = exps.reduce((a, b) => a + b, 1e-9);
  return items
    .map((x, i) => ({
      label: x.item.label,
      probability: Math.round((exps[i] / sum) * 10000) / 10000,
    }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, limit);
}

/**
 * Deterministic genre, Discogs/Jamendo, instrument, danceability, and vocal classifier.
 */
export function evaluateClassificationDiagnostics(
  analysis: SongAnalysis,
  acoustics: VltkAcousticMetrics,
  tempoDiag: VltkTempoDiagnostics,
  emotionDiag: VltkEmotionDiagnostics,
  preserved: PreservedFileTags,
  enrichment?: MusicBrainzEnrichment | null,
): {
  classification: VltkClassificationDiagnostics;
  genre: string;
  grouping: string;
  subgenres: string[];
} {
  const bassMean = meanArr(analysis.curves.bass);
  const midMean = meanArr(analysis.curves.mid);
  const trebleMean = meanArr(analysis.curves.treble);
  const bandSum = Math.max(0.01, bassMean + midMean + trebleMean);
  const bassWeight = clamp01(bassMean / bandSum * 1.45);
  const midWeight = clamp01(midMean / bandSum * 1.45);
  const trebWeight = clamp01(trebleMean / bandSum * 1.45);

  const brightness = clamp01((Math.log2(Math.max(acoustics.spectralCentroid.mean, 120) / 120)) / 6.2);
  const flux = clamp01(meanArr(analysis.curves.flux));
  const contrast = clamp01((acoustics.spectralContrast.mean - 8) / 22);
  const flatness = clamp01(acoustics.spectralFlatness.mean * 3.5);
  const mfccVar = clamp01(acoustics.mfccOverall.std / 18);
  const bpm = tempoDiag.measuredBpm || 110;

  // Danceability: beat stability + rhythmic flux + bass presence + optimal tempo proximity (85-135 BPM)
  const tempoDanceFactor = Math.exp(-Math.pow((bpm - 114) / 36, 2));
  const danceability = clamp01(
    tempoDiag.stability * 0.36 +
      flux * 0.24 +
      bassWeight * 0.22 +
      tempoDanceFactor * 0.18,
  );

  // Vocal content estimation: mid-band concentration (300-3400Hz proxy), spectral contrast & MFCC dynamics, ZCR
  const vocalHarmonic = clamp01(midWeight * 0.44 + mfccVar * 0.28 + contrast * 0.16 + (1 - flatness) * 0.12);
  const vocalProbability = Math.round(vocalHarmonic * 1000) / 1000;
  const vocalContent: 'vocal' | 'instrumental' | 'mixed' =
    vocalProbability >= 0.58 ? 'vocal' : vocalProbability <= 0.36 ? 'instrumental' : 'mixed';

  // Instrument probability estimates (heuristic acoustic descriptors)
  const instRaw: { label: string; score: number }[] = [
    { label: 'drums', score: clamp01(flux * 0.5 + bassWeight * 0.3 + (1 - acoustics.silenceRatio) * 0.2) },
    { label: 'bass', score: clamp01(bassWeight * 0.72 + (1 - brightness) * 0.28) },
    { label: 'synth', score: clamp01(brightness * 0.4 + flatness * 0.25 + contrast * 0.2 + tempoDiag.stability * 0.15) },
    { label: 'vocals', score: vocalProbability },
    { label: 'guitar', score: clamp01(midWeight * 0.45 + trebWeight * 0.25 + acoustics.zeroCrossingRate.mean * 3.0) },
    { label: 'piano_keys', score: clamp01(contrast * 0.45 + (1 - flatness) * 0.35 + midWeight * 0.2) },
    { label: 'strings_pad', score: clamp01((1 - flux) * 0.45 + (1 - flatness) * 0.35 + midWeight * 0.2) },
    { label: 'brass_winds', score: clamp01(contrast * 0.4 + midWeight * 0.35 + brightness * 0.25) },
  ];
  const instruments: LabelProbability[] = instRaw
    .sort((a, b) => b.score - a.score)
    .map((x) => ({ label: x.label, probability: Math.round(x.score * 1000) / 1000 }));

  // Check if external hint from existing tags or MusicBrainz tags maps cleanly into taxonomy
  const tagHints = [
    preserved.existingGenre,
    preserved.existingGrouping,
    ...(enrichment?.tags ?? []),
  ].filter(Boolean) as string[];
  const hintMatches = tagHints.map((h) => normalizeGenreToTaxonomy(h)).filter(Boolean);

  // Score canonical genres
  const genreScores = GENRE_TAXONOMY.map((entry) => {
    const p = entry.profile;
    // Allow octave-equivalent BPM distance so half/double time tracks still match cleanly
    const dBpmDirect = Math.abs(bpm - p.bpmCenter) / p.bpmSpread;
    const dBpmHalf = Math.abs(bpm * 0.5 - p.bpmCenter) / p.bpmSpread;
    const dBpmDouble = Math.abs(bpm * 2 - p.bpmCenter) / p.bpmSpread;
    const dBpm = Math.min(dBpmDirect, dBpmHalf * 1.15, dBpmDouble * 1.15);

    const dist =
      dBpm * 0.9 +
      Math.abs(bassWeight - p.bassWeight) * 1.3 +
      Math.abs(brightness - p.brightness) * 1.1 +
      Math.abs(flux - p.flux) * 1.0 +
      Math.abs(contrast - p.contrast) * 0.8 +
      Math.abs(flatness - p.flatness) * 0.8 +
      Math.abs(danceability - p.danceability) * 0.9 +
      Math.abs(emotionDiag.valence - p.valence) * 0.7 +
      Math.abs(emotionDiag.arousal - p.arousal) * 0.7;

    let score = -dist;
    if (hintMatches.some((hm) => hm?.genre === entry.genre)) {
      score += 0.65;
    }
    return { entry, score };
  }).sort((a, b) => b.score - a.score);

  const chosen = genreScores[0]?.entry ?? GENRE_TAXONOMY[0];

  // Score Discogs styles
  const discogsScored = DISCOGS_STYLE_DEFS.map((d) => {
    const baseGenreScore = genreScores.find((g) => g.entry.genre === d.genre)?.score ?? -2;
    let bonus = 0;
    if (d.genre === chosen.genre) bonus += 0.4;
    if (d.subgenre.toLowerCase().includes('dark') && emotionDiag.valence < 0.35) bonus += 0.35;
    if (d.subgenre.toLowerCase().includes('boom bap') && bpm >= 80 && bpm <= 102) bonus += 0.3;
    if (d.subgenre.toLowerCase().includes('trap') && bassWeight > 0.68 && (bpm >= 125 || bpm <= 76)) bonus += 0.3;
    if (d.subgenre.toLowerCase().includes('drum') && bpm >= 160) bonus += 0.5;
    if (d.subgenre.toLowerCase().includes('house') && bpm >= 118 && bpm <= 132 && danceability > 0.65) bonus += 0.35;
    if (d.subgenre.toLowerCase().includes('techno') && bpm >= 124 && bpm <= 145 && emotionDiag.valence < 0.5) bonus += 0.3;
    return { item: d, logit: (baseGenreScore + bonus) * 2.2 };
  });
  const discogsGenres = softmaxTop(discogsScored, 8, 0.85);

  // Score Jamendo genres
  const jamendoScored = JAMENDO_STYLE_DEFS.map((j) => {
    const baseGenreScore = genreScores.find((g) => g.entry.genre === j.genre)?.score ?? -2;
    let bonus = j.genre === chosen.genre ? 0.35 : 0;
    if (j.label === 'soundtrack' && acoustics.dynamicRangeDb > 12) bonus += 0.35;
    if (j.label === 'chillout' && emotionDiag.arousal < 0.42) bonus += 0.3;
    if (j.label === 'dance' && danceability > 0.72) bonus += 0.35;
    return { item: j, logit: (baseGenreScore + bonus) * 2.0 };
  });
  const jamendoGenres = softmaxTop(jamendoScored, 8, 0.9);

  // Select top 3 subgenres STRICTLY belonging to the chosen primary genre
  const subScores = chosen.subgenres.map((sub, idx) => {
    let s = 1.0 - idx * 0.04;
    const low = sub.toLowerCase();
    // Deterministic acoustic affinity within the primary genre's subgenres
    if (low.includes('boom bap') && bpm >= 80 && bpm <= 104) s += 0.45;
    if (low.includes('conscious') && vocalProbability > 0.5 && acoustics.spectralContrast.mean > 15) s += 0.42;
    if (low.includes('horrorcore') && emotionDiag.valence < 0.38) s += 0.4;
    if (low.includes('trap') && (bpm >= 125 || bpm <= 76) && bassWeight > 0.65) s += 0.45;
    if (low.includes('lo-fi') && brightness < 0.42 && emotionDiag.arousal < 0.5) s += 0.45;
    if (low.includes('house') && bpm >= 116 && bpm <= 132) s += 0.45;
    if (low.includes('melodic') && emotionDiag.keyConfidence > 0.35) s += 0.38;
    if (low.includes('drum and bass') && bpm >= 158) s += 0.55;
    if (low.includes('synthwave') && bpm >= 92 && bpm <= 122) s += 0.42;
    if (low.includes('future bass') && bassWeight > 0.6 && emotionDiag.arousal > 0.55) s += 0.42;
    if (low.includes('dark') && emotionDiag.valence < 0.38) s += 0.45;
    if (low.includes('downtempo') && bpm < 105) s += 0.42;
    if (low.includes('post-rock') && acoustics.dynamicRangeDb > 10) s += 0.42;
    if (low.includes('shoegaze') && flatness > 0.35 && emotionDiag.valence < 0.55) s += 0.38;
    // Check Discogs probability boost if subgenre matches a Discogs style
    const dMatch = discogsGenres.find((d) => d.label.toLowerCase().includes(low));
    if (dMatch) s += dMatch.probability * 1.2;
    return { sub, s };
  });
  const subgenres = subScores
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.sub);

  return {
    classification: {
      discogsGenres,
      jamendoGenres,
      instruments,
      danceability: Math.round(danceability * 1000) / 1000,
      vocalContent,
      vocalProbability,
    },
    genre: chosen.genre,
    grouping: chosen.grouping,
    subgenres,
  };
}

function appendStatTags(out: Record<string, string>, prefix: string, stat: StatSummary, decimals = 4): void {
  out[`${prefix}_MEAN`] = stat.mean.toFixed(decimals);
  out[`${prefix}_MEDIAN`] = stat.median.toFixed(decimals);
  out[`${prefix}_STD`] = stat.std.toFixed(decimals);
  out[`${prefix}_MIN`] = stat.min.toFixed(decimals);
  out[`${prefix}_MAX`] = stat.max.toFixed(decimals);
  out[`${prefix}_P10`] = stat.p10.toFixed(decimals);
  out[`${prefix}_P90`] = stat.p90.toFixed(decimals);
}

/**
 * Builds the complete TrackMetadataReport and flat tag dictionary (GENRE, GROUPING, SUBGENRE, BPM, KEY, MOOD, VLTK_*, VLTK_TECH_*).
 */
export function buildTrackMetadataReport(params: {
  analysis: SongAnalysis;
  acoustics: VltkAcousticMetrics;
  tech: VltkTechInfo;
  preserved: PreservedFileTags;
  enrichment?: MusicBrainzEnrichment | null;
}): TrackMetadataReport {
  const { analysis, acoustics, tech, preserved, enrichment } = params;

  const tempo = evaluateTempoDiagnostics(analysis);
  const emotion = evaluateEmotionDiagnostics(analysis, acoustics, tempo);
  const { classification, genre, grouping, subgenres } = evaluateClassificationDiagnostics(
    analysis,
    acoustics,
    tempo,
    emotion,
    preserved,
    enrichment,
  );

  const moods = emotion.moodScores.slice(0, 3).map((m) => m.mood);
  const subgenreTag = subgenres.join('; ');
  const moodTag = moods.join('; ');

  const musical = {
    genre,
    grouping,
    subgenres,
    subgenreTag,
    bpm: tempo.validForStandardTag ? tempo.measuredBpm.toFixed(2) : '',
    key: emotion.keyValidForStandardTag ? emotion.detectedKey : '',
    moods,
    moodTag,
  };

  const flatTags: Record<string, string> = {};

  // Standard musical tags (BPM and KEY left empty string when unverified / conflicted)
  flatTags['GENRE'] = musical.genre;
  flatTags['GROUPING'] = musical.grouping;
  flatTags['SUBGENRE'] = musical.subgenreTag;
  flatTags['BPM'] = musical.bpm;
  flatTags['KEY'] = musical.key;
  flatTags['MOOD'] = musical.moodTag;

  // VLTK_ Tempo / Rhythm Diagnostics
  flatTags['VLTK_BPM_MEASURED'] = tempo.measuredBpm.toFixed(2);
  flatTags['VLTK_BPM_CONFIDENCE'] = tempo.confidence.toFixed(4);
  flatTags['VLTK_BPM_VALID'] = String(tempo.validForStandardTag);
  flatTags['VLTK_BPM_ALGORITHMS'] = tempo.algorithms.join('; ');
  flatTags['VLTK_BPM_ALTERNATIVES'] = tempo.alternatives
    .map((a) => `${a.bpm.toFixed(2)} (${a.score.toFixed(2)}, ${a.source})`)
    .join('; ');
  flatTags['VLTK_BPM_CONFLICT'] = String(tempo.conflict);
  flatTags['VLTK_BPM_CONFLICT_REASON'] = tempo.conflictReason;
  flatTags['VLTK_BPM_STABILITY'] = tempo.stability.toFixed(4);
  flatTags['VLTK_BEAT_COUNT'] = String(tempo.beatCount);
  flatTags['VLTK_DOWNBEAT_COUNT'] = String(tempo.downbeatCount);
  flatTags['VLTK_ONSET_COUNT'] = String(tempo.onsetCount);
  flatTags['VLTK_ONSET_DENSITY'] = tempo.onsetDensity.toFixed(4);

  // VLTK_ Emotion Diagnostics
  flatTags['VLTK_VALENCE'] = emotion.valence.toFixed(4);
  flatTags['VLTK_AROUSAL'] = emotion.arousal.toFixed(4);
  flatTags['VLTK_KEY_DETECTED'] = emotion.detectedKey || 'unknown';
  flatTags['VLTK_KEY_CONFIDENCE'] = emotion.keyConfidence.toFixed(4);
  flatTags['VLTK_EMOTION_DIVERGENCE'] = emotion.modelDivergence.toFixed(4);
  for (const clf of emotion.classifiers) {
    const keyName = clf.name.toUpperCase();
    flatTags[`VLTK_EMOTION_${keyName}`] = `valence=${clf.valence.toFixed(4)}; arousal=${clf.arousal.toFixed(4)}`;
  }
  flatTags['VLTK_MOOD_SCORES'] = emotion.moodScores
    .map((m) => `${m.mood}: ${m.score.toFixed(3)}`)
    .join('; ');

  // VLTK_ Genre, Instrument, Danceability & Vocal Content Diagnostics
  flatTags['VLTK_DISCOGS_GENRES'] = classification.discogsGenres
    .map((g) => `${g.label}: ${g.probability.toFixed(4)}`)
    .join('; ');
  flatTags['VLTK_JAMENDO_GENRES'] = classification.jamendoGenres
    .map((g) => `${g.label}: ${g.probability.toFixed(4)}`)
    .join('; ');
  flatTags['VLTK_INSTRUMENTS'] = classification.instruments
    .map((i) => `${i.label}: ${i.probability.toFixed(3)}`)
    .join('; ');
  flatTags['VLTK_DANCEABILITY'] = classification.danceability.toFixed(4);
  flatTags['VLTK_VOCAL_CONTENT'] = classification.vocalContent;
  flatTags['VLTK_VOCAL_PROBABILITY'] = classification.vocalProbability.toFixed(4);

  // VLTK_ Acoustic Features
  flatTags['VLTK_LUFS_INTEGRATED'] = acoustics.lufsIntegrated.toFixed(2);
  flatTags['VLTK_LUFS_MOMENTARY_MAX'] = acoustics.lufsMomentaryMax.toFixed(2);
  flatTags['VLTK_LUFS_SHORT_TERM_MAX'] = acoustics.lufsShortTermMax.toFixed(2);
  flatTags['VLTK_LRA'] = acoustics.lra.toFixed(2);
  flatTags['VLTK_RMS_DB'] = acoustics.rmsDb.toFixed(2);
  flatTags['VLTK_RMS_LINEAR'] = acoustics.rmsLinear.toFixed(6);
  flatTags['VLTK_SAMPLE_PEAK'] = acoustics.samplePeak.toFixed(6);
  flatTags['VLTK_SAMPLE_PEAK_DBFS'] = acoustics.samplePeakDbfs.toFixed(2);
  flatTags['VLTK_TRUE_PEAK_ESTIMATE'] = acoustics.truePeakEstimate.toFixed(6);
  flatTags['VLTK_TRUE_PEAK_DBTP'] = acoustics.truePeakDbtp.toFixed(2);
  flatTags['VLTK_CREST_FACTOR_DB'] = acoustics.crestFactorDb.toFixed(2);
  flatTags['VLTK_CLIPPING_RATIO'] = acoustics.clippingRatio.toFixed(6);
  flatTags['VLTK_SILENCE_RATIO'] = acoustics.silenceRatio.toFixed(4);
  flatTags['VLTK_STEREO_CORRELATION'] = acoustics.stereoCorrelation.toFixed(4);
  flatTags['VLTK_STEREO_WIDTH'] = acoustics.stereoWidth.toFixed(4);
  flatTags['VLTK_DYNAMIC_RANGE_DB'] = acoustics.dynamicRangeDb.toFixed(2);

  appendStatTags(flatTags, 'VLTK_FRAME_RMS_DB', acoustics.frameRmsDb, 2);
  appendStatTags(flatTags, 'VLTK_SPECTRAL_CENTROID', acoustics.spectralCentroid, 2);
  appendStatTags(flatTags, 'VLTK_SPECTRAL_BANDWIDTH', acoustics.spectralBandwidth, 2);
  appendStatTags(flatTags, 'VLTK_SPECTRAL_ROLLOFF', acoustics.spectralRolloff, 2);
  appendStatTags(flatTags, 'VLTK_SPECTRAL_ENTROPY', acoustics.spectralEntropy, 4);
  appendStatTags(flatTags, 'VLTK_SPECTRAL_FLUX', acoustics.spectralFlux, 4);
  appendStatTags(flatTags, 'VLTK_SPECTRAL_CONTRAST', acoustics.spectralContrast, 3);
  appendStatTags(flatTags, 'VLTK_SPECTRAL_FLATNESS', acoustics.spectralFlatness, 4);
  appendStatTags(flatTags, 'VLTK_ZERO_CROSSING_RATE', acoustics.zeroCrossingRate, 5);
  appendStatTags(flatTags, 'VLTK_MFCC', acoustics.mfccOverall, 3);

  // Per-coefficient MFCC vectors (MEAN/MEDIAN/STD/MIN/MAX/P10/P90 across 1..13)
  flatTags['VLTK_MFCC_VEC_MEAN'] = acoustics.mfccCoefficients.map((c) => c.mean.toFixed(2)).join(', ');
  flatTags['VLTK_MFCC_VEC_MEDIAN'] = acoustics.mfccCoefficients.map((c) => c.median.toFixed(2)).join(', ');
  flatTags['VLTK_MFCC_VEC_STD'] = acoustics.mfccCoefficients.map((c) => c.std.toFixed(2)).join(', ');
  flatTags['VLTK_MFCC_VEC_MIN'] = acoustics.mfccCoefficients.map((c) => c.min.toFixed(2)).join(', ');
  flatTags['VLTK_MFCC_VEC_MAX'] = acoustics.mfccCoefficients.map((c) => c.max.toFixed(2)).join(', ');
  flatTags['VLTK_MFCC_VEC_P10'] = acoustics.mfccCoefficients.map((c) => c.p10.toFixed(2)).join(', ');
  flatTags['VLTK_MFCC_VEC_P90'] = acoustics.mfccCoefficients.map((c) => c.p90.toFixed(2)).join(', ');

  // VLTK_TECH_ Technical FFprobe-equivalent fields
  flatTags['VLTK_TECH_CONTAINER'] = tech.container;
  flatTags['VLTK_TECH_CODEC'] = tech.codec;
  flatTags['VLTK_TECH_CODEC_PROFILE'] = tech.codecProfile;
  flatTags['VLTK_TECH_SAMPLE_RATE'] = String(tech.sampleRate);
  flatTags['VLTK_TECH_CHANNELS'] = String(tech.channels);
  flatTags['VLTK_TECH_BITRATE'] = String(Math.round(tech.bitrate));
  flatTags['VLTK_TECH_BIT_DEPTH'] = tech.bitDepth !== null ? String(tech.bitDepth) : 'N/A (lossy)';
  flatTags['VLTK_TECH_DURATION'] = tech.durationSec.toFixed(3);
  flatTags['VLTK_TECH_FILE_SIZE'] = String(tech.fileSize);

  return {
    musical,
    tempo,
    emotion,
    classification,
    acoustics,
    tech,
    preserved,
    enrichment: enrichment ?? null,
    flatTags,
  };
}
