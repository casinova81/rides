import { haversine } from './geo';
import type { LatLon } from './geo';

// Simplified route geometry for the index (issue 03): Douglas-Peucker at a 15 m
// tolerance, then Google encoded-polyline at precision 5. ~1–2 KB per ride, so
// the index stays one small fetch for years of riding.

const DP_TOLERANCE_M = 15;

/** Perpendicular distance (m) from point p to the segment a→b, in local metric space. */
function perpDistance(p: LatLon, a: LatLon, b: LatLon): number {
  // Project to a local equirectangular plane (metres) around `a` — fine at 15 m scale.
  const latRef = (a.lat * Math.PI) / 180;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(latRef);
  const ax = 0;
  const ay = 0;
  const bx = (b.lon - a.lon) * mPerDegLon;
  const by = (b.lat - a.lat) * mPerDegLat;
  const px = (p.lon - a.lon) * mPerDegLon;
  const py = (p.lat - a.lat) * mPerDegLat;
  const dx = bx - ax;
  const dy = by - ay;
  const segLen2 = dx * dx + dy * dy;
  if (segLen2 === 0) return Math.hypot(px, py);
  let tt = (px * dx + py * dy) / segLen2;
  tt = Math.max(0, Math.min(1, tt));
  const cx = tt * dx;
  const cy = tt * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Douglas-Peucker simplification of a lat/lon path to the given tolerance (m). */
export function simplify(points: LatLon[], tolerance = DP_TOLERANCE_M): LatLon[] {
  if (points.length <= 2) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpDistance(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance && index !== -1) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }

  const out: LatLon[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/** Encode one signed value into the Google polyline chunk format. */
function encodeValue(value: number, out: string[]): void {
  let v = value < 0 ? ~(value << 1) : value << 1;
  while (v >= 0x20) {
    out.push(String.fromCharCode((0x20 | (v & 0x1f)) + 63));
    v >>>= 5;
  }
  out.push(String.fromCharCode(v + 63));
}

/** Google encoded polyline, precision 5. */
export function encodePolyline(points: LatLon[]): string {
  const out: string[] = [];
  let prevLat = 0;
  let prevLon = 0;
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lon = Math.round(p.lon * 1e5);
    encodeValue(lat - prevLat, out);
    encodeValue(lon - prevLon, out);
    prevLat = lat;
    prevLon = lon;
  }
  return out.join('');
}

/** Decode a precision-5 encoded polyline back to lat/lon points. */
export function decodePolyline(encoded: string): LatLon[] {
  const points: LatLon[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lon: lon / 1e5 });
  }
  return points;
}

/** Convenience: simplify a path at 15 m and return its encoded polyline. */
export function toIndexPolyline(points: LatLon[]): string {
  return encodePolyline(simplify(points, DP_TOLERANCE_M));
}

/** Distance (m) covered by a lat/lon polyline via segment sum — used by the heatmap. */
export function polylineLength(points: LatLon[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversine(points[i - 1], points[i]);
  return d;
}
