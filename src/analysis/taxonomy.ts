/**
 * Canonical musical genre taxonomy, Discogs/Jamendo style mapping,
 * and affective mood lexicon.
 */

export interface GenreTaxonomyEntry {
  genre: string;
  grouping: string;
  subgenres: string[];
  /** Acoustic prototype vector used for deterministic scoring. */
  profile: {
    bpmCenter: number;
    bpmSpread: number;
    bassWeight: number;
    brightness: number; // 0..1 normalized centroid
    flux: number;       // 0..1 rhythmic transient activity
    contrast: number;   // 0..1 spectral contrast
    flatness: number;   // 0..1 noisiness
    vocalBias: number;  // 0..1 expected vocal prominence
    danceability: number;
    valence: number;
    arousal: number;
  };
}

export const GENRE_TAXONOMY: GenreTaxonomyEntry[] = [
  {
    genre: 'Hip-Hop',
    grouping: 'Rap',
    subgenres: ['Boom Bap', 'Conscious Rap', 'Trap', 'Horrorcore', 'Lo-Fi Hip-Hop', 'Cloud Rap', 'East Coast Hip-Hop', 'West Coast Hip-Hop', 'Drill', 'Abstract Hip-Hop'],
    profile: { bpmCenter: 90, bpmSpread: 22, bassWeight: 0.78, brightness: 0.42, flux: 0.62, contrast: 0.58, flatness: 0.34, vocalBias: 0.78, danceability: 0.74, valence: 0.42, arousal: 0.62 },
  },
  {
    genre: 'Electronic',
    grouping: 'Electronic',
    subgenres: ['House', 'Techno', 'Melodic Techno', 'Trance', 'Drum and Bass', 'Dubstep', 'Future Bass', 'Synthwave', 'Electro', 'IDM', 'UK Garage', 'Breakbeat'],
    profile: { bpmCenter: 128, bpmSpread: 28, bassWeight: 0.72, brightness: 0.62, flux: 0.74, contrast: 0.66, flatness: 0.42, vocalBias: 0.32, danceability: 0.86, valence: 0.58, arousal: 0.78 },
  },
  {
    genre: 'Ambient',
    grouping: 'Ambient & Experimental',
    subgenres: ['Dark Ambient', 'Drone', 'Space Ambient', 'Downtempo', 'Chillout', 'Psybient', 'Berlin School', 'Field Recording'],
    profile: { bpmCenter: 74, bpmSpread: 30, bassWeight: 0.38, brightness: 0.28, flux: 0.16, contrast: 0.32, flatness: 0.18, vocalBias: 0.12, danceability: 0.22, valence: 0.36, arousal: 0.20 },
  },
  {
    genre: 'Rock',
    grouping: 'Rock',
    subgenres: ['Alternative Rock', 'Indie Rock', 'Post-Rock', 'Classic Rock', 'Progressive Rock', 'Psychedelic Rock', 'Grunge', 'Shoegaze', 'Post-Punk'],
    profile: { bpmCenter: 118, bpmSpread: 26, bassWeight: 0.52, brightness: 0.58, flux: 0.58, contrast: 0.60, flatness: 0.46, vocalBias: 0.68, danceability: 0.54, valence: 0.52, arousal: 0.68 },
  },
  {
    genre: 'Metal',
    grouping: 'Metal',
    subgenres: ['Heavy Metal', 'Death Metal', 'Black Metal', 'Progressive Metal', 'Metalcore', 'Doom Metal', 'Thrash Metal', 'Djent', 'Industrial Metal'],
    profile: { bpmCenter: 142, bpmSpread: 34, bassWeight: 0.56, brightness: 0.72, flux: 0.82, contrast: 0.54, flatness: 0.62, vocalBias: 0.52, danceability: 0.44, valence: 0.24, arousal: 0.90 },
  },
  {
    genre: 'Pop',
    grouping: 'Pop',
    subgenres: ['Synth-Pop', 'Electropop', 'Indie Pop', 'Dance-Pop', 'Dream Pop', 'Art Pop', 'Bedroom Pop', 'Hyperpop'],
    profile: { bpmCenter: 114, bpmSpread: 20, bassWeight: 0.58, brightness: 0.60, flux: 0.54, contrast: 0.62, flatness: 0.32, vocalBias: 0.84, danceability: 0.78, valence: 0.68, arousal: 0.64 },
  },
  {
    genre: 'R&B',
    grouping: 'R&B & Soul',
    subgenres: ['Contemporary R&B', 'Neo-Soul', 'Alternative R&B', 'Quiet Storm', 'Funk', 'Motown Soul'],
    profile: { bpmCenter: 86, bpmSpread: 18, bassWeight: 0.66, brightness: 0.44, flux: 0.44, contrast: 0.56, flatness: 0.24, vocalBias: 0.82, danceability: 0.68, valence: 0.54, arousal: 0.46 },
  },
  {
    genre: 'Jazz',
    grouping: 'Jazz & Blues',
    subgenres: ['Bebop', 'Cool Jazz', 'Jazz Fusion', 'Modal Jazz', 'Nu-Jazz', 'Smooth Jazz', 'Swing', 'Blues'],
    profile: { bpmCenter: 108, bpmSpread: 32, bassWeight: 0.46, brightness: 0.48, flux: 0.48, contrast: 0.68, flatness: 0.22, vocalBias: 0.28, danceability: 0.48, valence: 0.58, arousal: 0.48 },
  },
  {
    genre: 'Classical',
    grouping: 'Classical & Score',
    subgenres: ['Orchestral', 'Chamber Music', 'Minimalism', 'Neoclassical', 'Film Score', 'Baroque', 'Romantic', 'Solo Piano'],
    profile: { bpmCenter: 84, bpmSpread: 36, bassWeight: 0.32, brightness: 0.38, flux: 0.24, contrast: 0.74, flatness: 0.14, vocalBias: 0.10, danceability: 0.18, valence: 0.48, arousal: 0.34 },
  },
  {
    genre: 'Folk',
    grouping: 'Folk & Acoustic',
    subgenres: ['Indie Folk', 'Acoustic', 'Singer-Songwriter', 'Americana', 'Chamber Folk', 'Country', 'Celtic'],
    profile: { bpmCenter: 98, bpmSpread: 24, bassWeight: 0.36, brightness: 0.46, flux: 0.36, contrast: 0.64, flatness: 0.20, vocalBias: 0.76, danceability: 0.44, valence: 0.56, arousal: 0.40 },
  },
  {
    genre: 'Reggae',
    grouping: 'Reggae & Dub',
    subgenres: ['Roots Reggae', 'Dub', 'Dancehall', 'Reggaeton', 'Ska'],
    profile: { bpmCenter: 84, bpmSpread: 18, bassWeight: 0.82, brightness: 0.40, flux: 0.52, contrast: 0.58, flatness: 0.28, vocalBias: 0.66, danceability: 0.80, valence: 0.66, arousal: 0.52 },
  },
  {
    genre: 'Phonk',
    grouping: 'Rap',
    subgenres: ['Drift Phonk', 'Memphis Phonk', 'Wave Phonk', 'Cowbell Phonk', 'Chill Phonk'],
    profile: { bpmCenter: 132, bpmSpread: 26, bassWeight: 0.88, brightness: 0.48, flux: 0.72, contrast: 0.52, flatness: 0.44, vocalBias: 0.52, danceability: 0.80, valence: 0.26, arousal: 0.84 },
  },
];

export const DISCOGS_STYLE_DEFS: { label: string; genre: string; subgenre: string }[] = [
  { label: 'Hip Hop---Boom Bap', genre: 'Hip-Hop', subgenre: 'Boom Bap' },
  { label: 'Hip Hop---Conscious', genre: 'Hip-Hop', subgenre: 'Conscious Rap' },
  { label: 'Hip Hop---Trap', genre: 'Hip-Hop', subgenre: 'Trap' },
  { label: 'Hip Hop---Horrorcore', genre: 'Hip-Hop', subgenre: 'Horrorcore' },
  { label: 'Hip Hop---Instrumental', genre: 'Hip-Hop', subgenre: 'Lo-Fi Hip-Hop' },
  { label: 'Hip Hop---Cloud Rap', genre: 'Hip-Hop', subgenre: 'Cloud Rap' },
  { label: 'Hip Hop---Phonk', genre: 'Phonk', subgenre: 'Drift Phonk' },
  { label: 'Electronic---House', genre: 'Electronic', subgenre: 'House' },
  { label: 'Electronic---Techno', genre: 'Electronic', subgenre: 'Techno' },
  { label: 'Electronic---Melodic Techno', genre: 'Electronic', subgenre: 'Melodic Techno' },
  { label: 'Electronic---Drum n Bass', genre: 'Electronic', subgenre: 'Drum and Bass' },
  { label: 'Electronic---Dubstep', genre: 'Electronic', subgenre: 'Dubstep' },
  { label: 'Electronic---Future Bass', genre: 'Electronic', subgenre: 'Future Bass' },
  { label: 'Electronic---Synthwave', genre: 'Electronic', subgenre: 'Synthwave' },
  { label: 'Electronic---Trance', genre: 'Electronic', subgenre: 'Trance' },
  { label: 'Electronic---IDM', genre: 'Electronic', subgenre: 'IDM' },
  { label: 'Electronic---Ambient', genre: 'Ambient', subgenre: 'Space Ambient' },
  { label: 'Electronic---Dark Ambient', genre: 'Ambient', subgenre: 'Dark Ambient' },
  { label: 'Electronic---Downtempo', genre: 'Ambient', subgenre: 'Downtempo' },
  { label: 'Rock---Alternative Rock', genre: 'Rock', subgenre: 'Alternative Rock' },
  { label: 'Rock---Indie Rock', genre: 'Rock', subgenre: 'Indie Rock' },
  { label: 'Rock---Post-Rock', genre: 'Rock', subgenre: 'Post-Rock' },
  { label: 'Rock---Shoegaze', genre: 'Rock', subgenre: 'Shoegaze' },
  { label: 'Rock---Heavy Metal', genre: 'Metal', subgenre: 'Heavy Metal' },
  { label: 'Rock---Metalcore', genre: 'Metal', subgenre: 'Metalcore' },
  { label: 'Pop---Synth-pop', genre: 'Pop', subgenre: 'Synth-Pop' },
  { label: 'Pop---Electropop', genre: 'Pop', subgenre: 'Electropop' },
  { label: 'Pop---Dream Pop', genre: 'Pop', subgenre: 'Dream Pop' },
  { label: 'Funk / Soul---Neo Soul', genre: 'R&B', subgenre: 'Neo-Soul' },
  { label: 'Funk / Soul---Contemporary R&B', genre: 'R&B', subgenre: 'Contemporary R&B' },
  { label: 'Jazz---Fusion', genre: 'Jazz', subgenre: 'Jazz Fusion' },
  { label: 'Jazz---Modal', genre: 'Jazz', subgenre: 'Modal Jazz' },
  { label: 'Classical---Neoclassical', genre: 'Classical', subgenre: 'Neoclassical' },
  { label: 'Stage & Screen---Score', genre: 'Classical', subgenre: 'Film Score' },
  { label: 'Folk, World, & Country---Indie Folk', genre: 'Folk', subgenre: 'Indie Folk' },
  { label: 'Reggae---Dub', genre: 'Reggae', subgenre: 'Dub' },
];

export const JAMENDO_STYLE_DEFS: { label: string; genre: string; moodHint?: string }[] = [
  { label: 'hiphop', genre: 'Hip-Hop' },
  { label: 'rap', genre: 'Hip-Hop' },
  { label: 'electronic', genre: 'Electronic' },
  { label: 'dance', genre: 'Electronic', moodHint: 'Energetic' },
  { label: 'house', genre: 'Electronic' },
  { label: 'techno', genre: 'Electronic', moodHint: 'Hypnotic' },
  { label: 'ambient', genre: 'Ambient', moodHint: 'Atmospheric' },
  { label: 'chillout', genre: 'Ambient', moodHint: 'Relaxed' },
  { label: 'rock', genre: 'Rock' },
  { label: 'indie', genre: 'Rock' },
  { label: 'metal', genre: 'Metal', moodHint: 'Aggressive' },
  { label: 'pop', genre: 'Pop', moodHint: 'Uplifting' },
  { label: 'rnb', genre: 'R&B', moodHint: 'Sensual' },
  { label: 'soul', genre: 'R&B' },
  { label: 'jazz', genre: 'Jazz' },
  { label: 'classical', genre: 'Classical' },
  { label: 'soundtrack', genre: 'Classical', moodHint: 'Cinematic' },
  { label: 'folk', genre: 'Folk', moodHint: 'Warm' },
  { label: 'acoustic', genre: 'Folk' },
  { label: 'reggae', genre: 'Reggae' },
  { label: 'dub', genre: 'Reggae' },
];

export interface MoodPrototype {
  mood: string;
  valence: number;
  arousal: number;
  darkBias?: number;
  bassBias?: number;
  minorRequired?: boolean;
}

export const MOOD_LEXICON: MoodPrototype[] = [
  { mood: 'Aggressive', valence: 0.18, arousal: 0.88, darkBias: 0.35 },
  { mood: 'Tense', valence: 0.25, arousal: 0.74, darkBias: 0.30 },
  { mood: 'Brooding', valence: 0.22, arousal: 0.48, darkBias: 0.40 },
  { mood: 'Dark', valence: 0.14, arousal: 0.56, darkBias: 0.50 },
  { mood: 'Melancholic', valence: 0.24, arousal: 0.32, minorRequired: true },
  { mood: 'Atmospheric', valence: 0.44, arousal: 0.28 },
  { mood: 'Dreamy', valence: 0.56, arousal: 0.26 },
  { mood: 'Chill', valence: 0.62, arousal: 0.24 },
  { mood: 'Warm', valence: 0.68, arousal: 0.42 },
  { mood: 'Hypnotic', valence: 0.46, arousal: 0.62, bassBias: 0.25 },
  { mood: 'Groovy', valence: 0.66, arousal: 0.64, bassBias: 0.30 },
  { mood: 'Energetic', valence: 0.64, arousal: 0.84 },
  { mood: 'Euphoric', valence: 0.88, arousal: 0.86 },
  { mood: 'Uplifting', valence: 0.82, arousal: 0.72 },
  { mood: 'Bright', valence: 0.78, arousal: 0.56 },
  { mood: 'Epic', valence: 0.50, arousal: 0.78 },
  { mood: 'Intimate', valence: 0.48, arousal: 0.20 },
  { mood: 'Reflective', valence: 0.38, arousal: 0.30 },
];

/**
 * Normalizes an arbitrary genre hint string into our canonical taxonomy entry if possible.
 */
export function normalizeGenreToTaxonomy(rawGenre?: string): GenreTaxonomyEntry | null {
  if (!rawGenre) return null;
  const g = rawGenre.trim().toLowerCase();
  if (!g) return null;
  for (const entry of GENRE_TAXONOMY) {
    if (entry.genre.toLowerCase() === g || entry.grouping.toLowerCase() === g) {
      return entry;
    }
    if (entry.subgenres.some((s) => s.toLowerCase() === g)) {
      return entry;
    }
  }
  if (g.includes('hip') || g.includes('rap') || g.includes('trap') || g.includes('boom bap')) {
    return GENRE_TAXONOMY.find((e) => e.genre === 'Hip-Hop') ?? null;
  }
  if (g.includes('phonk')) return GENRE_TAXONOMY.find((e) => e.genre === 'Phonk') ?? null;
  if (g.includes('house') || g.includes('techno') || g.includes('edm') || g.includes('electro') || g.includes('trance') || g.includes('dnb') || g.includes('dubstep') || g.includes('synthwave')) {
    return GENRE_TAXONOMY.find((e) => e.genre === 'Electronic') ?? null;
  }
  if (g.includes('ambient') || g.includes('drone') || g.includes('chill')) {
    return GENRE_TAXONOMY.find((e) => e.genre === 'Ambient') ?? null;
  }
  if (g.includes('metal') || g.includes('djent') || g.includes('deathcore')) {
    return GENRE_TAXONOMY.find((e) => e.genre === 'Metal') ?? null;
  }
  if (g.includes('rock') || g.includes('indie') || g.includes('punk') || g.includes('grunge')) {
    return GENRE_TAXONOMY.find((e) => e.genre === 'Rock') ?? null;
  }
  if (g.includes('pop')) return GENRE_TAXONOMY.find((e) => e.genre === 'Pop') ?? null;
  if (g.includes('r&b') || g.includes('rnb') || g.includes('soul') || g.includes('funk')) {
    return GENRE_TAXONOMY.find((e) => e.genre === 'R&B') ?? null;
  }
  if (g.includes('jazz') || g.includes('blues')) return GENRE_TAXONOMY.find((e) => e.genre === 'Jazz') ?? null;
  if (g.includes('classic') || g.includes('orchestr') || g.includes('soundtrack') || g.includes('score') || g.includes('piano')) {
    return GENRE_TAXONOMY.find((e) => e.genre === 'Classical') ?? null;
  }
  if (g.includes('folk') || g.includes('acoustic') || g.includes('country')) {
    return GENRE_TAXONOMY.find((e) => e.genre === 'Folk') ?? null;
  }
  if (g.includes('reggae') || g.includes('dub') || g.includes('ska')) {
    return GENRE_TAXONOMY.find((e) => e.genre === 'Reggae') ?? null;
  }
  return null;
}
