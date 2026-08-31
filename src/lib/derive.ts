import { parseGpx } from './gpx';
import { haversine } from './geo';
import { toIndexPolyline } from './polyline';
import type { RidePayload, RideStats, Split, Bests, Best, Track, IndexSummary } from './types';
import { SCHEMA_VERSION } from './types';

// The derivation pipeline (issue 03). Raw GPX text → the complete per-ride
// payload plus its index polyline. Runs client-side at upload time (issue 02);
// the Worker only validates and stores. All algorithms are locked:
//  - 5-point speed smoothing over point-to-point speeds
//  - moving = smoothed AND raw interval speed ≥ 2 km/h (the raw guard keeps the
//    smoother from bridging Komoot auto-pause gaps, where a break is one long
//    interval between two riding-speed points)
//  - elevation via 5-point smoothing + 2 m hysteresis
//  - gradients over a 100 m rolling window
//  - per-km splits with a real-length final partial
//  - fastest rolling 5/10/20 km windows, null when the ride is shorter
//  - max speed from the smoothed series
//  - point speeds derived from UNROUNDED timestamps

const MOVING_THRESHOLD = 2 / 3.6; // 2 km/h in m/s
const HYSTERESIS_M = 2;
const GRADIENT_HALF_WINDOW_M = 50; // ±50 m = 100 m window

export interface DerivedRide {
  payload: RidePayload;
  polyline: string; // DP-15 m encoded polyline (index only)
}

const round = (x: number, dp = 0): number => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

/** 5-point centred rolling average. */
function roll5(arr: number[]): number[] {
  const n = arr.length;
  return arr.map((_, i) => {
    const a = Math.max(0, i - 2);
    const b = Math.min(n - 1, i + 2);
    let s = 0;
    for (let j = a; j <= b; j++) s += arr[j];
    return s / (b - a + 1);
  });
}

/** URL-safe slug of a Komoot ride name (diacritics folded, non-alphanumerics → "-"). */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining marks
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/** Calendar date (Europe/Berlin) of an instant, as YYYY-MM-DD — the ride-ID prefix. */
export function berlinDate(instant: Date): string {
  // en-CA yields ISO-ordered Y-M-D parts.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Base ride ID = Berlin date + slugified name (issue 03). Collisions resolved elsewhere. */
export function rideId(name: string, start: Date): string {
  return `${berlinDate(start)}-${slugify(name)}`;
}

/** Resolve a base ID against already-used IDs, appending "-2" (then -3…) on collision. */
export function resolveRideId(baseId: string, existing: Set<string> | string[]): string {
  const taken = existing instanceof Set ? existing : new Set(existing);
  if (!taken.has(baseId)) return baseId;
  let n = 2;
  while (taken.has(`${baseId}-${n}`)) n++;
  return `${baseId}-${n}`;
}

function computeStats(
  dist: number[],
  tF: number[],
  speed: number[],
  vRaw: number[],
  ele: number[],
  grad: number[],
): RideStats {
  const n = dist.length;
  const distance = dist[n - 1];
  const duration = tF[n - 1];

  let movingTime = 0;
  for (let i = 1; i < n; i++) {
    if (speed[i] >= MOVING_THRESHOLD && vRaw[i] >= MOVING_THRESHOLD) {
      movingTime += tF[i] - tF[i - 1];
    }
  }

  let gain = 0;
  let loss = 0;
  let anchor = ele[0];
  for (const e of ele) {
    const d = e - anchor;
    if (d >= HYSTERESIS_M) {
      gain += d;
      anchor = e;
    } else if (d <= -HYSTERESIS_M) {
      loss += -d;
      anchor = e;
    }
  }

  const avgMovingSpeed = movingTime > 0 ? distance / movingTime : 0;
  return {
    distance: round(distance),
    duration: round(duration),
    movingTime: round(movingTime),
    avgMovingSpeed: round(avgMovingSpeed, 2),
    maxSpeed: round(Math.max(...speed), 2),
    elevationGain: round(gain),
    elevationLoss: round(loss),
    maxGradient: round(Math.max(...grad), 1),
    minGradient: round(Math.min(...grad), 1),
  };
}

/** Gradient (%) over a 100 m window centred on each point, on smoothed elevation. */
function computeGradients(dist: number[], ele: number[]): number[] {
  const n = dist.length;
  const grad = new Array<number>(n).fill(0);
  let j = 0;
  let k = 0;
  for (let i = 0; i < n; i++) {
    while (dist[j] < dist[i] - GRADIENT_HALF_WINDOW_M) j++;
    while (k < n - 1 && dist[k + 1] <= dist[i] + GRADIENT_HALF_WINDOW_M) k++;
    const dd = dist[k] - dist[j];
    grad[i] = dd > 20 ? ((ele[k] - ele[j]) / dd) * 100 : 0;
  }
  return grad;
}

function computeSplits(dist: number[], tF: number[], ele: number[]): Split[] {
  const n = dist.length;
  const splits: Split[] = [];
  let s0 = 0;
  for (let i = 1; i < n; i++) {
    const kmDone = Math.floor(dist[i] / 1000);
    const kmPrev = Math.floor(dist[s0] / 1000);
    if (kmDone > kmPrev || i === n - 1) {
      const len = dist[i] - dist[s0];
      const time = tF[i] - tF[s0];
      if (len > 50) {
        splits.push({
          km: splits.length + 1,
          len: round(len),
          time: round(time),
          avgSpeed: round(time > 0 ? len / time : 0, 2),
          eleDelta: round(ele[i] - ele[s0]),
          avgGradient: round(len > 0 ? ((ele[i] - ele[s0]) / len) * 100 : 0, 1),
        });
      }
      s0 = i;
    }
  }
  return splits;
}

/** Fastest contiguous window of `windowM` metres, or null if the ride is shorter. */
function fastestWindow(dist: number[], tF: number[], windowM: number): Best | null {
  const n = dist.length;
  if (dist[n - 1] < windowM) return null;
  let bestT = Infinity;
  let bestStart = 0;
  let k = 0;
  for (let j = 0; j < n; j++) {
    while (k < n - 1 && dist[k] < dist[j] + windowM) k++;
    if (dist[k] < dist[j] + windowM) break;
    const dt = tF[k] - tF[j];
    if (dt < bestT) {
      bestT = dt;
      bestStart = dist[j];
    }
  }
  if (!Number.isFinite(bestT)) return null;
  return { time: round(bestT), startDist: round(bestStart) };
}

export function deriveRide(gpxText: string): DerivedRide {
  const { name, sport, points } = parseGpx(gpxText);
  const n = points.length;
  const t0 = points[0].time;

  const tF = points.map((p) => p.time - t0); // unrounded seconds
  const dist: number[] = [0];
  for (let i = 1; i < n; i++) dist.push(dist[i - 1] + haversine(points[i - 1], points[i]));

  // point-to-point speed from UNROUNDED timestamps, then 5-point smoothed
  const vRaw = points.map((_, i) =>
    i === 0 ? 0 : (dist[i] - dist[i - 1]) / Math.max(1e-9, tF[i] - tF[i - 1]),
  );
  vRaw[0] = vRaw[1] ?? 0;
  const speed = roll5(vRaw);
  const ele = roll5(points.map((p) => p.ele));
  const grad = computeGradients(dist, ele);

  const stats = computeStats(dist, tF, speed, vRaw, ele, grad);
  const splits = computeSplits(dist, tF, ele);
  const bests: Bests = {
    '5k': fastestWindow(dist, tF, 5000),
    '10k': fastestWindow(dist, tF, 10000),
    '20k': fastestWindow(dist, tF, 20000),
  };

  const track: Track = {
    lat: points.map((p) => round(p.lat, 6)),
    lon: points.map((p) => round(p.lon, 6)),
    ele: ele.map((e) => round(e, 1)),
    t: tF.map((x) => round(x)),
    dist: dist.map((d) => round(d)),
    speed: speed.map((s) => round(s, 2)),
  };

  const start = new Date(t0 * 1000);
  const startISO = start.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const payload: RidePayload = {
    schemaVersion: SCHEMA_VERSION,
    id: rideId(name, start),
    name,
    sport,
    start: startISO,
    stats,
    splits,
    bests,
    track,
  };

  const polyline = toIndexPolyline(points.map((p) => ({ lat: p.lat, lon: p.lon })));
  return { payload, polyline };
}

/** Project a per-ride payload + polyline down to its index summary. */
export function summaryOf(payload: RidePayload, polyline: string): IndexSummary {
  return {
    id: payload.id,
    name: payload.name,
    sport: payload.sport,
    start: payload.start,
    stats: payload.stats,
    polyline,
  };
}
