import type { RidePayload, RideStats, Bests } from './types';
import {
  fmtKm,
  fmtElevation,
  fmtSpeedKmh,
  fmtDuration,
  fmtEleDelta,
  fmtDeltaKm,
  fmtDeltaDuration,
  fmtDeltaSpeedKmh,
} from './format';

// The compare view core (ticket 6 / issue 13). Pure: two RidePayloads in,
// formatted rows out — the same {label, value} discipline as ride-detail.ts, so
// the Astro page stays declarative and the comparison logic is unit-testable.
// Δ is always ride 2 − ride 1; the identity colours (ride 1 blue, ride 2 orange)
// carry through every surface (map tracks, chart series, table headers, markers).

/** Ride-identity colours — the single source the map, charts, and tables share. */
export const COMPARE_COLORS = { a: '#2a78d6', b: '#e8802a' } as const;

/** The identity colours in ride order — `[ride 1, ride 2]`, for index-keyed callers. */
export const COMPARE_COLOR_LIST = [COMPARE_COLORS.a, COMPARE_COLORS.b];

/** Ghost-race speed multipliers, in toggle order (issue 13: 50/200/500×). */
export const GHOST_SPEEDS = [50, 200, 500] as const;

/** The default ghost-race speed (issue 13 prototype). */
export const GHOST_DEFAULT_SPEED = 200;

const EM_DASH = '—';

/** One Δ-table row: the metric label, both efforts, and their signed difference. */
export interface DeltaRow {
  label: string;
  a: string;
  b: string;
  delta: string;
}

// [label, value, formatter, delta-formatter]. Δ = ride 2 − ride 1, so a positive
// delta means ride 2 is the larger — direction only, not "better" (a larger time
// is worse, a larger speed better); the page never colours these, it just shows Δ.
const METRICS: {
  label: string;
  get: (s: RideStats) => number;
  fmt: (v: number) => string;
  dfmt: (v: number) => string;
}[] = [
  { label: 'Distance', get: (s) => s.distance, fmt: fmtKm, dfmt: fmtDeltaKm },
  { label: 'Moving time', get: (s) => s.movingTime, fmt: fmtDuration, dfmt: fmtDeltaDuration },
  { label: 'Elapsed time', get: (s) => s.duration, fmt: fmtDuration, dfmt: fmtDeltaDuration },
  { label: 'Avg speed', get: (s) => s.avgMovingSpeed, fmt: fmtSpeedKmh, dfmt: fmtDeltaSpeedKmh },
  { label: 'Max speed', get: (s) => s.maxSpeed, fmt: fmtSpeedKmh, dfmt: fmtDeltaSpeedKmh },
  { label: 'Elevation gain', get: (s) => s.elevationGain, fmt: (v) => `↑ ${fmtElevation(v)}`, dfmt: fmtEleDelta },
  { label: 'Elevation loss', get: (s) => s.elevationLoss, fmt: (v) => `↓ ${fmtElevation(v)}`, dfmt: fmtEleDelta },
];

const WINDOWS: { label: string; key: keyof Bests }[] = [
  { label: 'Fastest 5 km', key: '5k' },
  { label: 'Fastest 10 km', key: '10k' },
  { label: 'Fastest 20 km', key: '20k' },
];

/**
 * The Δ table: seven headline stats then the three fastest-window times. Δ = ride
 * 2 − ride 1. A window either ride is too short for shows "—" in that ride's column
 * and in Δ (a difference needs both sides).
 */
export function deltaTable(r1: RidePayload, r2: RidePayload): DeltaRow[] {
  const statRows: DeltaRow[] = METRICS.map(({ label, get, fmt, dfmt }) => ({
    label,
    a: fmt(get(r1.stats)),
    b: fmt(get(r2.stats)),
    delta: dfmt(get(r2.stats) - get(r1.stats)),
  }));

  const windowRows: DeltaRow[] = WINDOWS.map(({ label, key }) => {
    const a = r1.bests[key];
    const b = r2.bests[key];
    return {
      label,
      a: a ? fmtDuration(a.time) : EM_DASH,
      b: b ? fmtDuration(b.time) : EM_DASH,
      delta: a && b ? fmtDeltaDuration(b.time - a.time) : EM_DASH,
    };
  });

  return [...statRows, ...windowRows];
}

/** One per-km splits-diff row, coloured by whoever rode that km faster. */
export interface SplitDiffRow {
  km: number;
  a: string;
  b: string;
  delta: string;
  /** The quicker ride that km, or null when one is missing or the times tie. */
  faster: 'a' | 'b' | null;
}

/**
 * Per-km splits diff up to the longer ride's length. Δ = ride 2 − ride 1 time, so
 * a negative Δ means ride 2 was quicker → `faster: 'b'`. A km only one ride reached
 * has no comparison ("—", faster null).
 */
export function splitsDiff(r1: RidePayload, r2: RidePayload): SplitDiffRow[] {
  const n = Math.max(r1.splits.length, r2.splits.length);
  const rows: SplitDiffRow[] = [];
  for (let i = 0; i < n; i++) {
    const a = r1.splits[i];
    const b = r2.splits[i];
    if (a && b) {
      const d = b.time - a.time;
      rows.push({
        km: i + 1,
        a: fmtDuration(a.time),
        b: fmtDuration(b.time),
        delta: fmtDeltaDuration(d),
        faster: d < 0 ? 'b' : d > 0 ? 'a' : null,
      });
    } else {
      rows.push({
        km: i + 1,
        a: a ? fmtDuration(a.time) : EM_DASH,
        b: b ? fmtDuration(b.time) : EM_DASH,
        delta: EM_DASH,
        faster: null,
      });
    }
  }
  return rows;
}

/** Which ride is further along the shared ghost-race clock, and by how many metres. */
export interface Leader {
  leader: 'a' | 'b' | null;
  gap: number; // metres
}

/** The ghost-race readout: the ride ahead by distance and the gap (0 → tie). */
export function leaderReadout(distA: number, distB: number): Leader {
  return {
    leader: distA > distB ? 'a' : distB > distA ? 'b' : null,
    gap: Math.abs(distA - distB),
  };
}
