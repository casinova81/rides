import type { Track as TrackData } from './types';
import { bearingBetween } from './geo';
import type { LatLon } from './geo';

// Deep module over the columnar per-ride arrays (issue 09). Engine-agnostic and
// pure: playback, charts, and the MapLibre adapter all sample through it, so no
// consumer does interpolation math itself.

export interface Sample {
  lat: number;
  lon: number;
  ele: number;
  dist: number; // cumulative m
  speed: number; // m/s
  time: number; // s since start
}

/** Largest index i with arr[i] <= value (clamped to [0, n-1]); binary search on a sorted array. */
function lowerIndex(arr: number[], value: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  if (value <= arr[0]) return 0;
  if (value >= arr[hi]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid] <= value) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export class Track {
  readonly data: TrackData;
  readonly n: number;

  constructor(data: TrackData) {
    this.data = data;
    this.n = data.t.length;
  }

  get duration(): number {
    return this.data.t[this.n - 1];
  }

  get totalDistance(): number {
    return this.data.dist[this.n - 1];
  }

  /** [lng, lat] pairs for a GeoJSON LineString (MapLibre wants lon-first). */
  get coordinates(): [number, number][] {
    const { lat, lon } = this.data;
    const out: [number, number][] = new Array(this.n);
    for (let i = 0; i < this.n; i++) out[i] = [lon[i], lat[i]];
    return out;
  }

  private interpolateAt(idx: number, frac: number): Sample {
    const d = this.data;
    const j = Math.min(idx + 1, this.n - 1);
    const lerp = (a: number[], f = frac) => a[idx] + (a[j] - a[idx]) * f;
    return {
      lat: lerp(d.lat),
      lon: lerp(d.lon),
      ele: lerp(d.ele),
      dist: lerp(d.dist),
      speed: lerp(d.speed),
      time: lerp(d.t),
    };
  }

  /** Interpolated sample at time `t` seconds since start. */
  sampleByTime(t: number): Sample {
    const { t: ts } = this.data;
    const clamped = Math.max(ts[0], Math.min(ts[this.n - 1], t));
    const i = lowerIndex(ts, clamped);
    const span = ts[i + 1] - ts[i];
    const frac = i < this.n - 1 && span > 0 ? (clamped - ts[i]) / span : 0;
    return this.interpolateAt(i, frac);
  }

  /** Interpolated sample at cumulative distance `d` metres. */
  sampleByDist(d: number): Sample {
    const { dist } = this.data;
    const clamped = Math.max(dist[0], Math.min(dist[this.n - 1], d));
    const i = lowerIndex(dist, clamped);
    const span = dist[i + 1] - dist[i];
    const frac = i < this.n - 1 && span > 0 ? (clamped - dist[i]) / span : 0;
    return this.interpolateAt(i, frac);
  }

  /**
   * Max GPX elevation within ±halfWindow metres of distance `d`. The chase cam
   * clamps its altitude to this (+ margin) rather than querying terrain (issue 07).
   */
  maxElevationNear(d: number, halfWindow: number): number {
    const { dist, ele } = this.data;
    const lo = lowerIndex(dist, d - halfWindow);
    let max = -Infinity;
    for (let i = lo; i < this.n && dist[i] <= d + halfWindow; i++) {
      if (ele[i] > max) max = ele[i];
    }
    // Guarantee we consider at least the sample at `d` itself.
    if (max === -Infinity) max = this.sampleByDist(d).ele;
    return max;
  }

  /**
   * Nearest point on the track polyline to a geographic point, returned as its
   * interpolated cumulative distance (m), the base segment index, and the squared
   * planar distance `d2` to that point. Drives the map-hover → chart/playback sync
   * (ticket 4d): the pointer's lng/lat becomes the shared cursor distance. Uses a
   * local equirectangular projection (longitude scaled by cos(lat)); over a single
   * ride's extent that planar error is metres. `d2` lets a caller comparing the
   * same query point against several tracks pick the nearest (ticket 6 compare
   * overlay) — the projection scale is fixed by the query lat, so the values are
   * comparable across tracks queried at one point.
   */
  nearestByPoint(lon: number, lat: number): { dist: number; index: number; d2: number } {
    const d = this.data;
    const kx = Math.cos((lat * Math.PI) / 180);
    const qx = lon * kx;
    const qy = lat;

    let bestDistSq = Infinity;
    let bestIdx = 0;
    let bestT = 0;
    for (let i = 0; i < this.n - 1; i++) {
      const ax = d.lon[i] * kx;
      const ay = d.lat[i];
      const bx = d.lon[i + 1] * kx;
      const by = d.lat[i + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      const t = lenSq > 0 ? Math.max(0, Math.min(1, ((qx - ax) * dx + (qy - ay) * dy) / lenSq)) : 0;
      const px = ax + t * dx;
      const py = ay + t * dy;
      const distSq = (qx - px) ** 2 + (qy - py) ** 2;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestIdx = i;
        bestT = t;
      }
    }

    const dist = d.dist[bestIdx] + bestT * (d.dist[bestIdx + 1] - d.dist[bestIdx]);
    return { dist, index: bestIdx, d2: bestDistSq };
  }

  /** Smoothed heading at distance `d`, taken from a look-ahead point (issue 07). */
  bearingAt(d: number, lookahead = 25): number {
    const here = this.sampleByDist(d);
    const ahead = this.sampleByDist(Math.min(this.totalDistance, d + lookahead));
    const a: LatLon = { lat: here.lat, lon: here.lon };
    const b: LatLon = { lat: ahead.lat, lon: ahead.lon };
    return bearingBetween(a, b);
  }
}
