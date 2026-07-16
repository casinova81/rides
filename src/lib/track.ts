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

  /** Smoothed heading at distance `d`, taken from a look-ahead point (issue 07). */
  bearingAt(d: number, lookahead = 25): number {
    const here = this.sampleByDist(d);
    const ahead = this.sampleByDist(Math.min(this.totalDistance, d + lookahead));
    const a: LatLon = { lat: here.lat, lon: here.lon };
    const b: LatLon = { lat: ahead.lat, lon: ahead.lon };
    return bearingBetween(a, b);
  }
}
