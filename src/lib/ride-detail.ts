import type { RidePayload, Split, Best } from './types';
import {
  fmtKm,
  fmtElevation,
  fmtSpeedKmh,
  fmtDuration,
  fmtDate,
  fmtTime,
  fmtGradient,
  fmtEleDelta,
  fmtSport,
} from './format';

// The ride-detail view core (ticket 4a). Pure: a RidePayload in, formatted
// {label, value} rows out — de-DE numbers/dates, English labels, Berlin times.
// The Astro page renders these lists; keeping them here makes the formatting
// unit-testable and keeps the page markup declarative.

export interface StatItem {
  label: string;
  value: string;
}

/** Header subline: `date · time · sport` (Berlin), dropping an empty sport. */
export function detailSubline(payload: RidePayload): string {
  const parts = [fmtDate(payload.start), fmtTime(payload.start)];
  const sport = fmtSport(payload.sport);
  if (sport) parts.push(sport);
  return parts.join(' · ');
}

/** The four headline tiles: distance, moving time, avg speed, elevation gain. */
export function headlineTiles(payload: RidePayload): StatItem[] {
  const s = payload.stats;
  return [
    { label: 'Distance', value: fmtKm(s.distance) },
    { label: 'Moving time', value: fmtDuration(s.movingTime) },
    { label: 'Avg speed', value: fmtSpeedKmh(s.avgMovingSpeed) },
    { label: 'Elevation gain', value: `↑ ${fmtElevation(s.elevationGain)}` },
  ];
}

/** Secondary stats shown inside the disclosure. */
export function secondaryStats(payload: RidePayload): StatItem[] {
  const s = payload.stats;
  return [
    { label: 'Elapsed time', value: fmtDuration(s.duration) },
    { label: 'Elevation loss', value: `↓ ${fmtElevation(s.elevationLoss)}` },
    { label: 'Top speed', value: fmtSpeedKmh(s.maxSpeed) },
    { label: 'Max gradient', value: fmtGradient(s.maxGradient) },
    { label: 'Min gradient', value: fmtGradient(s.minGradient) },
  ];
}

const WINDOWS: { key: keyof RidePayload['bests']; label: string; meters: number }[] = [
  { key: '5k', label: 'Fastest 5 km', meters: 5000 },
  { key: '10k', label: 'Fastest 10 km', meters: 10000 },
  { key: '20k', label: 'Fastest 20 km', meters: 20000 },
];

/** Fastest 5/10/20 km windows as time · avg speed, or `—` when the ride is too short. */
export function fastestWindows(payload: RidePayload): StatItem[] {
  return WINDOWS.map(({ key, label, meters }) => {
    const best: Best | null = payload.bests[key];
    if (!best) return { label, value: '—' };
    const speed = best.time > 0 ? meters / best.time : 0;
    return { label, value: `${fmtDuration(best.time)} · ${fmtSpeedKmh(speed)}` };
  });
}

export interface SplitRow {
  km: string;
  dist: string;
  time: string;
  speed: string;
  ele: string;
  grad: string;
}

/** Per-km splits as formatted table rows; the final partial km keeps its real length. */
export function splitRows(splits: Split[]): SplitRow[] {
  return splits.map((s) => ({
    km: String(s.km),
    dist: fmtKm(s.len),
    time: fmtDuration(s.time),
    speed: fmtSpeedKmh(s.avgSpeed),
    ele: fmtEleDelta(s.eleDelta),
    grad: fmtGradient(s.avgGradient),
  }));
}
