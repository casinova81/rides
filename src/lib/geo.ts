// Pure geodesy helpers (issue 09). Used on both sides of the MapView seam:
// derivation (distance/gradient) and the MapLibre chase-cam geometry.

export const EARTH_RADIUS = 6371000; // m
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Great-circle distance in metres between two lat/lon points. */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * D2R;
  const dLon = (b.lon - a.lon) * D2R;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(s));
}

/** Initial bearing a→b in degrees, normalised to [0, 360). */
export function bearingBetween(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * D2R;
  const φ2 = b.lat * D2R;
  const Δλ = (b.lon - a.lon) * D2R;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** Point reached from `from` after travelling `distance` m along `bearing` degrees. */
export function offset(from: LatLon, bearing: number, distance: number): LatLon {
  const δ = distance / EARTH_RADIUS;
  const θ = bearing * D2R;
  const φ1 = from.lat * D2R;
  const λ1 = from.lon * D2R;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return { lat: φ2 * R2D, lon: λ2 * R2D };
}

/** Circular mean of bearings (degrees) — averages direction vectors, not scalars. */
export function circularMean(bearings: number[]): number {
  let x = 0;
  let y = 0;
  for (const b of bearings) {
    x += Math.cos(b * D2R);
    y += Math.sin(b * D2R);
  }
  return (Math.atan2(y, x) * R2D + 360) % 360;
}
