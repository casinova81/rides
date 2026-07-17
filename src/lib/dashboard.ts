import type { IndexSummary, Records, RecordKey } from './types';
import { RECORD_KEYS } from './types';
import { TIME_ZONE, fmtKm, fmtElevation, fmtSpeedKmh, fmtDuration } from './format';
import { rideCardHTML } from './ride-card';

// The pure dashboard/library core (ticket 3b). The landing page derives all-time
// totals, the monthly-km chart, the records grid, and the year-scoped library
// straight from the index — no stored aggregates. Everything here is a pure
// function so the same code renders server-side and re-scopes client-side when
// the year selector changes.

/** A calendar year, or "all" for the library's un-scoped view. */
export type YearFilter = number | 'all';

export interface AllTimeTotals {
  distance: number; // m
  count: number;
  movingTime: number; // s
}

/** Total distance, ride count, and moving time across every ride. */
export function allTimeTotals(rides: IndexSummary[]): AllTimeTotals {
  let distance = 0;
  let movingTime = 0;
  for (const r of rides) {
    distance += r.stats.distance;
    movingTime += r.stats.movingTime;
  }
  return { distance, count: rides.length, movingTime };
}

// GPX starts are UTC; the app groups and labels by the Berlin calendar, matching
// fmtDate. A numeric-parts formatter gives a locale-independent year/month.
const ymFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
});

/** The Berlin calendar year and 1-based month of a UTC ISO instant. */
export function berlinYearMonth(iso: string): { year: number; month: number } {
  const parts = ymFmt.formatToParts(new Date(iso));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get('year'), month: get('month') };
}

/** Distinct Berlin years that have rides, newest first. */
export function availableYears(rides: IndexSummary[]): number[] {
  const years = new Set<number>();
  for (const r of rides) years.add(berlinYearMonth(r.start).year);
  return [...years].sort((a, b) => b - a);
}

/** Rides in the selected Berlin year (or all of them), input order preserved. */
export function ridesForYear(rides: IndexSummary[], year: YearFilter): IndexSummary[] {
  if (year === 'all') return rides;
  return rides.filter((r) => berlinYearMonth(r.start).year === year);
}

/**
 * The year-scoped library as an HTML string — newest-first ride cards with a
 * trophy on record holders, or an empty note. Shared verbatim by the server
 * render and the client re-scope so the two never drift.
 */
export function libraryHTML(rides: IndexSummary[], year: YearFilter, holders: Set<string>): string {
  const scoped = ridesForYear(rides, year);
  if (scoped.length === 0) return '<p class="sub empty-note">No rides for this year.</p>';
  return scoped.map((s) => rideCardHTML(s, { holdsRecord: holders.has(s.id) })).join('');
}

/** Metres ridden per calendar month (length 12, Jan→Dec) within the year filter. */
export function monthlyDistance(rides: IndexSummary[], year: YearFilter): number[] {
  const months = new Array(12).fill(0);
  for (const r of rides) {
    const { year: y, month } = berlinYearMonth(r.start);
    if (year !== 'all' && y !== year) continue;
    months[month - 1] += r.stats.distance;
  }
  return months;
}

/** The set of ride ids that currently hold at least one of the 8 records. */
export function recordHolderIds(records: Records): Set<string> {
  const ids = new Set<string>();
  for (const key of RECORD_KEYS) {
    const entry = records[key];
    if (entry) ids.add(entry.rideId);
  }
  return ids;
}

/** English labels for the 8 record categories — the shared source of truth. */
export const RECORD_LABELS: Record<RecordKey, string> = {
  longestDistance: 'Longest distance',
  mostElevationGain: 'Most elevation gain',
  fastest5k: 'Fastest 5 km',
  fastest10k: 'Fastest 10 km',
  fastest20k: 'Fastest 20 km',
  fastestAvgSpeed: 'Fastest avg speed',
  maxSpeed: 'Top speed',
  longestMovingTime: 'Longest moving time',
};

// Each record's stored value is SI; render it in the category's own unit.
const RECORD_FMT: Record<RecordKey, (v: number) => string> = {
  longestDistance: fmtKm,
  mostElevationGain: (m) => `↑ ${fmtElevation(m)}`,
  fastest5k: fmtDuration,
  fastest10k: fmtDuration,
  fastest20k: fmtDuration,
  fastestAvgSpeed: fmtSpeedKmh,
  maxSpeed: fmtSpeedKmh,
  longestMovingTime: fmtDuration,
};

export interface RecordCard {
  key: RecordKey;
  label: string;
  value: string | null; // formatted; null when no ride qualifies yet
  rideId: string | null;
}

/** All 8 record cards in a fixed order, formatted and linked to their holder. */
export function recordCards(records: Records): RecordCard[] {
  return RECORD_KEYS.map((key) => {
    const entry = records[key];
    return {
      key,
      label: RECORD_LABELS[key],
      value: entry ? RECORD_FMT[key](entry.value) : null,
      rideId: entry ? entry.rideId : null,
    };
  });
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * A bare SVG bar chart of km per month — no chart library, matching the
 * thumbnail approach (issue 04). Twelve bars scaled to the busiest month, each
 * carrying a native `<title>` tooltip with its formatted distance. Scales to 0
 * cleanly when the year has no rides. Returns a self-contained `<svg>` string.
 */
export function monthlyChartSVG(monthly: number[]): string {
  const W = 640;
  const H = 180;
  const padX = 6;
  const padTop = 14;
  const padBottom = 24;
  const plotW = W - 2 * padX;
  const plotH = H - padTop - padBottom;
  const baseY = padTop + plotH;
  const slot = plotW / 12;
  const barW = slot * 0.6;
  const max = Math.max(0, ...monthly);

  let bars = '';
  for (let i = 0; i < 12; i++) {
    const v = monthly[i] ?? 0;
    const h = max > 0 ? (v / max) * plotH : 0;
    const x = padX + i * slot + (slot - barW) / 2;
    const y = baseY - h;
    const cx = padX + i * slot + slot / 2;
    bars +=
      `<rect class="bar" x="${round(x)}" y="${round(y)}" width="${round(barW)}" height="${round(h)}" rx="2">` +
      `<title>${MONTH_LABELS[i]}: ${fmtKm(v)}</title></rect>` +
      `<text class="bar-label" x="${round(cx)}" y="${H - 7}" text-anchor="middle">${MONTH_LABELS[i]}</text>`;
  }
  const baseline = `<line class="bar-base" x1="${padX}" y1="${round(baseY)}" x2="${W - padX}" y2="${round(baseY)}"/>`;
  return (
    `<svg class="month-chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" ` +
    `role="img" aria-label="Kilometres per month">${baseline}${bars}</svg>`
  );
}
