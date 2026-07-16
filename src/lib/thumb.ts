import { decodePolyline } from './polyline';

// A bare SVG route thumbnail drawn from a ride's stored DP-15 m polyline — no map
// tiles, no MapLibre (issue 04). Pure string output so the same drawing renders
// server-side on the dashboard/library and client-side on the upload results.

/**
 * Project an encoded polyline into a fitted SVG path inside a `w`×`h` box.
 * Uses a local equirectangular projection (longitude scaled by cos(lat)), fits
 * the track to the padded box preserving aspect, and flips y so north is up.
 * Returns a self-contained `<svg>` string; degenerate inputs yield an empty box.
 */
export function polylineThumb(encoded: string, w = 120, h = 80, pad = 6): string {
  const open = `<svg class="thumb" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`;
  const close = '</svg>';

  const pts = encoded ? decodePolyline(encoded) : [];
  if (pts.length < 2) return `${open}${close}`;

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
  if (!Number.isFinite(scale)) return `${open}${close}`;

  // Centre the scaled track within the box.
  const drawnW = spanX * scale;
  const drawnH = spanY * scale;
  const offX = pad + (boxW - drawnW) / 2;
  const offY = pad + (boxH - drawnH) / 2;

  const round = (n: number) => Math.round(n * 100) / 100;
  const d = xy
    .map((p, i) => {
      const x = round(offX + (p.x - minX) * scale);
      const y = round(offY + (maxY - p.y) * scale); // flip: higher lat → smaller y
      return `${i === 0 ? 'M' : 'L'}${x} ${y}`;
    })
    .join('');

  return `${open}<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>${close}`;
}
