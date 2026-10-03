import type { Palette } from '../types/song-analysis';

/**
 * Generates an artistic circular vinyl / album cover art canvas as a data URL.
 * Combines track palette colors, title initials, radial geometric waves,
 * and high-contrast vinyl label typography.
 */
export function generateVinylCover(
  title: string,
  artist: string = 'Personance',
  palette?: Palette | null,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const cx = 128;
  const cy = 128;

  // Derive vibrant colors from palette or hash
  let c1 = palette?.primary ?? '#8a7cff';
  let c2 = palette?.accent ?? '#4ce0d2';
  let c3 = palette?.secondary ?? '#e85d9e';
  const bg = palette?.background ?? '#0a0a18';

  if (!palette) {
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
      hash = (hash << 5) - hash + title.charCodeAt(i);
      hash |= 0;
    }
    const h1 = Math.abs(hash) % 360;
    const h2 = (h1 + 65) % 360;
    const h3 = (h1 + 180) % 360;
    c1 = `hsl(${h1}, 80%, 60%)`;
    c2 = `hsl(${h2}, 85%, 65%)`;
    c3 = `hsl(${h3}, 75%, 55%)`;
  }

  // 1. Vinyl disc outer body (dark vinyl black)
  const discGrad = ctx.createRadialGradient(cx, cy, 20, cx, cy, 128);
  discGrad.addColorStop(0, '#121224');
  discGrad.addColorStop(0.5, '#0c0c16');
  discGrad.addColorStop(1, '#05050c');
  ctx.fillStyle = discGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, 128, 0, Math.PI * 2);
  ctx.fill();

  // 2. Vinyl grooves
  ctx.save();
  for (let r = 85; r < 125; r += 3) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // 3. Central album artwork circle
  const labelR = 76;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, labelR, 0, Math.PI * 2);
  ctx.clip();

  // Rich artistic gradient for label
  const labelGrad = ctx.createLinearGradient(cx - labelR, cy - labelR, cx + labelR, cy + labelR);
  labelGrad.addColorStop(0, c1);
  labelGrad.addColorStop(0.5, c3);
  labelGrad.addColorStop(1, c2);
  ctx.fillStyle = labelGrad;
  ctx.fillRect(cx - labelR, cy - labelR, labelR * 2, labelR * 2);

  // Geometric radial spokes / waveform mandala
  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  const spokes = 16;
  for (let i = 0; i < spokes; i++) {
    const angle = (i * Math.PI * 2) / spokes;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * labelR, cy + Math.sin(angle) * labelR);
    ctx.lineTo(cx + Math.cos(angle + 0.12) * labelR, cy + Math.sin(angle + 0.12) * labelR);
    ctx.closePath();
    ctx.fill();
  }

  // Darkened inner center ring
  const innerR = 46;
  const innerGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, innerR);
  innerGrad.addColorStop(0, 'rgba(8, 8, 20, 0.88)');
  innerGrad.addColorStop(1, 'rgba(12, 12, 28, 0.65)');
  ctx.fillStyle = innerGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Clean initials or title text
  const cleanTitle = title.replace(/\.[^.]+$/, '').trim();
  const initials = cleanTitle
    .split(/[\s—_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 6;
  ctx.fillText(initials || '♪', cx, cy - 8);

  ctx.font = '600 8px ui-monospace, SFMono-Regular, monospace';
  ctx.letterSpacing = '1px';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  const shortTitle = cleanTitle.length > 12 ? cleanTitle.slice(0, 11) + '…' : cleanTitle;
  ctx.fillText(shortTitle.toUpperCase(), cx, cy + 9);

  ctx.font = '500 7px ui-monospace, SFMono-Regular, monospace';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  const shortArtist = (artist || 'PERSONANCE').slice(0, 14).toUpperCase();
  ctx.fillText(shortArtist, cx, cy + 20);

  ctx.restore();

  // 4. Center spindle hole
  ctx.fillStyle = bg || '#050510';
  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  return canvas.toDataURL('image/png');
}
