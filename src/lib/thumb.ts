import { decodePolyline } from './polyline';

// Bare SVG route drawings from a ride's geometry — no map tiles, no MapLibre
// (issue 04). The small card thumbnail draws the stored DP-15 m polyline; the
// detail-page hero placeholder (ticket 4a) draws the full-resolution track until
// ticket 4b makes the map live. Both share one projection so they never drift,
// and both are pure strings that render server- and client-side identically.

interface Pt {
  lat: number;
  lon: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Project geographic points into a fitted SVG path `d` inside a `w`×`h` box.
 * Local equirectangular projection (longitude scaled by cos(lat)), aspect
 * preserved, y flipped so north is up. Returns null for degenerate inputs
 * (fewer than 2 points, or a zero-area span) so callers emit an empty box.
 */
function fitPath(pts: Pt[], w: number, h: number, pad: number): string | null {
  if (pts.length < 2) return null;

  const latMid = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const kx = Math.cos((latMid * Math.PI) / 180);
  const xy = pts.map((p) => ({ x: p.lon * kx, y: p.lat }));

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of xy) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const boxW = w - 2 * pad;
  const boxH = h - 2 * pad;
  // Uniform scale that fits both axes; guard the fully-degenerate (single-point) span.
  const scale = Math.min(spanX > 0 ? boxW / spanX : Infinity, spanY > 0 ? boxH / spanY : Infinity);
  if (!Number.isFinite(scale)) return null;

  // Centre the scaled track within the box.
  const drawnW = spanX * scale;
  const drawnH = spanY * scale;
  const offX = pad + (boxW - drawnW) / 2;
  const offY = pad + (boxH - drawnH) / 2;

  return xy
    .map((p, i) => {
      const x = round(offX + (p.x - minX) * scale);
      const y = round(offY + (maxY - p.y) * scale); // flip: higher lat → smaller y
      return `${i === 0 ? 'M' : 'L'}${x} ${y}`;
    })
    .join('');
}

/**
 * A card route thumbnail from the stored DP-15 m polyline. Returns a
 * self-contained `<svg>` string; degenerate inputs yield an empty box.
 */
export function polylineThumb(encoded: string, w = 120, h = 80, pad = 6): string {
  const open = `<svg class="thumb" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`;
  const close = '</svg>';

  const d = fitPath(encoded ? decodePolyline(encoded) : [], w, h, pad);
  if (!d) return `${open}${close}`;
  return `${open}<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>${close}`;
}

/**
 * The detail-page map-hero placeholder (ticket 4a): the full-resolution track
 * drawn from its columnar lat/lon arrays, until ticket 4b makes the map live.
 * Wide box scaled by CSS; degenerate tracks yield an empty box.
 */
export function trackHeroSVG(lat: number[], lon: number[], w = 960, h = 360, pad = 20): string {
  const open = `<svg class="hero-line" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Route overview">`;
  const close = '</svg>';

  const n = Math.min(lat.length, lon.length);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) pts.push({ lat: lat[i], lon: lon[i] });

  const d = fitPath(pts, w, h, pad);
  if (!d) return `${open}${close}`;
  return `${open}<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${close}`;
}
