import { Vibrant } from 'node-vibrant/browser';
import type { Emotion, Palette } from '../types/song-analysis';
import { extractCoverArt } from './cover-extractor';

/**
 * Synthetic palette for tracks without cover art. Emotions are complex —
 * one hue is a caricature. The base hue comes from valence, but the
 * SCHEME comes from character: high arousal earns triadic contrast,
 * bright songs spread analogous, moody ones get a complementary accent.
 * A key-derived rotation keeps two songs with the same mood apart.
 */
export function emotionPalette(e: Emotion): Palette {
  // Base hue: valence path (indigo → magenta → amber), rotated by key
  // (12 keys spread over ±55°) so same-mood songs still differ.
  const keyIndex = 'C C♯ D E♭ E F F♯ G A♭ A B♭ B'.split(' ').indexOf(e.key);
  const keyShift = (Math.max(0, keyIndex) / 11 - 0.5) * 110;
  const hue = (250 + e.valence * 145 + keyShift + 360) % 360;
  const sat = 0.5 + e.arousal * 0.4;

  // Scheme by character.
  let h2: number;
  let h3: number;
  if (e.arousal > 0.65) {
    // Triadic: three genuinely different color families.
    h2 = (hue + 120) % 360;
    h3 = (hue + 240) % 360;
  } else if (e.valence > 0.55) {
    // Wide analogous: a warm flowing gradient.
    h2 = (hue + 55) % 360;
    h3 = (hue + 310) % 360;
  } else {
    // Complementary accent against a moody base.
    h2 = (hue + 160) % 360;
    h3 = (hue + 30) % 360;
  }

  const primary = hslHex(hue, sat, 0.6);
  const accent = hslHex(h2, Math.min(1, sat + 0.12), 0.72);
  const secondary = hslHex(h3, sat * 0.85, 0.55);
  const background = hslHex((hue + 15) % 360, sat * 0.5, 0.07);
  return {
    background,
    primary,
    secondary,
    accent,
    swatches: [primary, accent, secondary],
    coverArtUrl: null,
  };
}

function hslHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  const to255 = (x: number): number => Math.round(x * 255);
  return `#${((to255(f(0)) << 16) | (to255(f(8)) << 8) | to255(f(4))).toString(16).padStart(6, '0')}`;
}

/**
 * Dynamically updates UI styling and CSS variables according to the track's cover palette.
 * Intelligently adapts player dock, buttons, timeline, glowing shadows, and drawer to cover gradients.
 */
export function applyInterfacePalette(palette: Palette): void {
  const root = document.documentElement;
  const p = palette.primary || '#8a7cff';
  const a = palette.accent || lighten(p, 0.2);
  const s = palette.secondary || palette.accent || '#4ce0d2';

  root.style.setProperty('--accent', p);
  root.style.setProperty('--accent-bright', a);
  root.style.setProperty('--cyan', s);

  const hexToRgb = (hex: string) => {
    const clean = hex.replace('#', '');
    const n = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16);
    if (Number.isNaN(n)) return { r: 138, g: 124, b: 255 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };

  const pRgb = hexToRgb(p);
  const aRgb = hexToRgb(a);
  const sRgb = hexToRgb(s);

  const pGlow = `rgba(${pRgb.r}, ${pRgb.g}, ${pRgb.b}, 0.5)`;
  const aGlow = `rgba(${aRgb.r}, ${aRgb.g}, ${aRgb.b}, 0.4)`;
  const sGlow = `rgba(${sRgb.r}, ${sRgb.g}, ${sRgb.b}, 0.3)`;

  root.style.setProperty('--accent-glow', pGlow);
  root.style.setProperty('--border-glass-bright', aGlow);
  root.style.setProperty('--accent-glow-secondary', sGlow);
  root.style.setProperty('--cover-gradient', `linear-gradient(135deg, ${p} 0%, ${a} 50%, ${s} 100%)`);

  // Intelligently adapt player dock styling with ambient cover gradient
  const playerDock = document.getElementById('player-dock');
  if (playerDock) {
    playerDock.style.background = `linear-gradient(135deg, rgba(${pRgb.r}, ${pRgb.g}, ${pRgb.b}, 0.16) 0%, rgba(${sRgb.r}, ${sRgb.g}, ${sRgb.b}, 0.08) 50%, rgba(8, 8, 20, 0.86) 100%)`;
    playerDock.style.borderColor = `rgba(${aRgb.r}, ${aRgb.g}, ${aRgb.b}, 0.38)`;
    playerDock.style.boxShadow = `0 16px 42px rgba(0, 0, 0, 0.72), 0 0 35px rgba(${pRgb.r}, ${pRgb.g}, ${pRgb.b}, 0.32), 0 0 15px rgba(${aRgb.r}, ${aRgb.g}, ${aRgb.b}, 0.2)`;
  }

  // Intelligently adapt timeline scrubber gradient
  const timelineFill = document.getElementById('timeline-fill');
  if (timelineFill) {
    timelineFill.style.background = `linear-gradient(90deg, ${p} 0%, ${a} 60%, ${s} 100%)`;
    timelineFill.style.boxShadow = `0 0 12px ${pGlow}`;
  }

  const timelineThumb = document.getElementById('timeline-thumb');
  if (timelineThumb) {
    timelineThumb.style.background = '#ffffff';
    timelineThumb.style.boxShadow = `0 0 10px ${a}, 0 0 4px #ffffff`;
  }

  // Intelligently adapt vinyl disc play button glow and border
  const playBtn = document.getElementById('dock-play-btn');
  if (playBtn) {
    playBtn.style.borderColor = `rgba(${aRgb.r}, ${aRgb.g}, ${aRgb.b}, 0.55)`;
    playBtn.style.boxShadow = `0 4px 18px rgba(0, 0, 0, 0.65), 0 0 22px rgba(${pRgb.r}, ${pRgb.g}, ${pRgb.b}, 0.45)`;
  }

  // Adapt playlist drawer card if present
  const playlistCard = document.querySelector<HTMLElement>('.playlist-card');
  if (playlistCard) {
    playlistCard.style.borderColor = `rgba(${aRgb.r}, ${aRgb.g}, ${aRgb.b}, 0.28)`;
    playlistCard.style.boxShadow = `0 24px 60px rgba(0, 0, 0, 0.8), 0 0 40px rgba(${pRgb.r}, ${pRgb.g}, ${pRgb.b}, 0.18)`;
  }
}

/**
 * Extract a palette and album art from embedded track cover art.
 * Returns null when the file has no usable art — scenes keep defaults.
 */
export async function extractPalette(bytes: ArrayBuffer): Promise<Palette | null> {
  const cover = extractCoverArt(bytes);
  if (!cover) return null;

  const colors = await extractColorsFromImage(cover.url);
  return {
    ...colors,
    coverArtUrl: cover.url,
  };
}

async function extractColorsFromImage(url: string): Promise<{
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  swatches: string[];
}> {
  // First try node-vibrant for rich perceptual swatches
  try {
    const v = await Vibrant.from(url).getPalette();
    const hex = (s: { hex: string } | null | undefined): string | null => s?.hex ?? null;
    const primary = hex(v.Vibrant) ?? hex(v.LightVibrant) ?? hex(v.Muted);
    if (primary) {
      const background = darken(hex(v.DarkMuted) ?? hex(v.DarkVibrant) ?? '#0a0a18', 0.65);
      const secondary = hex(v.Muted) ?? hex(v.DarkVibrant) ?? primary;
      const accent = hex(v.LightVibrant) ?? hex(v.LightMuted) ?? primary;
      const swatches = [
        hex(v.Vibrant),
        hex(v.LightVibrant),
        hex(v.Muted),
        hex(v.LightMuted),
        hex(v.DarkVibrant),
        hex(v.DarkMuted),
      ].filter((h): h is string => h !== null);

      return { background, primary, secondary, accent, swatches };
    }
  } catch {
    // Vibrant failed, fallback to canvas pixel sampling
  }

  // Canvas pixel sampling fallback
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({
          primary: '#8a7cff',
          secondary: '#4ce0d2',
          accent: '#b8adff',
          background: '#0a0a18',
          swatches: ['#8a7cff', '#4ce0d2'],
        });
        return;
      }
      ctx.drawImage(img, 0, 0, 16, 16);
      const data = ctx.getImageData(0, 0, 16, 16).data;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let count = 0;
      let maxSat = 0;
      let satColor = '#8a7cff';

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a < 128) continue;
        rSum += r;
        gSum += g;
        bSum += b;
        count++;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const sat = max > 0 ? (max - min) / max : 0;
        if (sat > maxSat && max > 60 && min < 220) {
          maxSat = sat;
          satColor = `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
        }
      }

      const avgR = count ? Math.round(rSum / count) : 138;
      const avgG = count ? Math.round(gSum / count) : 124;
      const avgB = count ? Math.round(bSum / count) : 255;
      const avgColor = `#${((avgR << 16) | (avgG << 8) | avgB).toString(16).padStart(6, '0')}`;
      const primary = maxSat > 0.15 ? satColor : avgColor;
      const accent = lighten(primary, 0.25);
      const secondary = maxSat > 0.15 ? avgColor : '#4ce0d2';
      const background = darken(primary, 0.82);

      resolve({
        background,
        primary,
        secondary,
        accent,
        swatches: [primary, accent, secondary],
      });
    };
    img.onerror = () => {
      resolve({
        primary: '#8a7cff',
        secondary: '#4ce0d2',
        accent: '#b8adff',
        background: '#0a0a18',
        swatches: ['#8a7cff', '#4ce0d2'],
      });
    };
    img.src = url;
  });
}

function lighten(hexColor: string, amount: number): string {
  const n = parseInt(hexColor.replace('#', ''), 16);
  if (Number.isNaN(n)) return '#b8adff';
  const r = Math.min(255, Math.round(((n >> 16) & 0xff) + (255 - ((n >> 16) & 0xff)) * amount));
  const g = Math.min(255, Math.round(((n >> 8) & 0xff) + (255 - ((n >> 8) & 0xff)) * amount));
  const b = Math.min(255, Math.round((n & 0xff) + (255 - (n & 0xff)) * amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function darken(hexColor: string, amount: number): string {
  const n = parseInt(hexColor.replace('#', ''), 16);
  if (Number.isNaN(n)) return '#0a0a18';
  const f = 1 - amount;
  const r = Math.round(((n >> 16) & 0xff) * f);
  const g = Math.round(((n >> 8) & 0xff) * f);
  const b = Math.round((n & 0xff) * f);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
