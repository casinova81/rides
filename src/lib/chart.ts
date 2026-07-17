import type { Track } from './track';

// The synced elevation/speed charts (ticket 4d). Pure geometry so the same code
// renders the static SVG server-side and, on the client, hit-tests a hover x back
// to a distance and positions the cursor line. Charts are distance-keyed (not
// time), so a chart x maps straight to a track distance the map and playback share.
// A fixed viewBox stretched to full width (preserveAspectRatio="none", non-scaling
// strokes) keeps the client's clientX→viewBox map a single linear factor.

/** viewBox width; the SVG stretches to the container's real width via CSS. */
export const CHART_W = 1000;
/** viewBox height per chart. */
export const CHART_H = 150;
/** Inner margins (viewBox units) the plot is inset by. */
export const CHART_PAD = { top: 12, right: 10, bottom: 12, left: 10 };

/** Number of evenly-by-distance samples the path is resampled to (bounded size). */
const COLS = 500;

export type ChartKind = 'elevation' | 'speed';

interface ChartSpec {
  /** Pull the plotted value from a track sample. */
  value: (s: { ele: number; speed: number }) => number;
  /** ARIA / heading label. */
  label: string;
}

const SPECS: Record<ChartKind, ChartSpec> = {
  elevation: { value: (s) => s.ele, label: 'Elevation' },
  speed: { value: (s) => s.speed, label: 'Speed' },
};

export interface ChartGeometry {
  kind: ChartKind;
  width: number;
  height: number;
  minDist: number;
  maxDist: number;
  minValue: number;
  maxValue: number;
  /** Distance (m) → x in viewBox units. */
  xForDist(d: number): number;
  /** x in viewBox units → distance (m), clamped to the distance domain. */
  distForX(x: number): number;
  /** Plotted value → y in viewBox units (north-up: max at the top). */
  yForValue(v: number): number;
  /** The series line path (`M…L…`). */
  path: string;
  /** The same line closed down to the baseline for a fill (`…Z`). */
  area: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

interface SampledSeries {
  dists: number[];
  values: number[];
  min: number;
  max: number;
}

/** Resample `track`'s value at `cols` points evenly across [0, upto] metres. */
function sampleSeries(track: Track, spec: ChartSpec, upto: number, cols: number): SampledSeries {
  const span = upto || 1;
  const dists: number[] = new Array(cols);
  const values: number[] = new Array(cols);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < cols; i++) {
    const d = (span * i) / (cols - 1);
    const v = spec.value(track.sampleByDist(d));
    dists[i] = d;
    values[i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { dists, values, min, max };
}

interface Mappers {
  left: number;
  right: number;
  top: number;
  bottom: number;
  xForDist(d: number): number;
  distForX(x: number): number;
  yForValue(v: number): number;
}

/**
 * The linear x (distance) and y (value) mappers over an explicit domain, shared by
 * the single-track and compare charts. `xForDist`/`distForX` are exact inverses —
 * the invariant chart↔map↔playback sync relies on; a flat value span collapses to
 * the box's vertical centre rather than dividing by zero.
 */
function mappers(minDist: number, maxDist: number, minValue: number, maxValue: number): Mappers {
  const left = CHART_PAD.left;
  const right = CHART_W - CHART_PAD.right;
  const top = CHART_PAD.top;
  const bottom = CHART_H - CHART_PAD.bottom;
  const distSpan = maxDist - minDist || 1;
  const valueSpan = maxValue - minValue;
  return {
    left,
    right,
    top,
    bottom,
    xForDist: (d) => left + ((d - minDist) / distSpan) * (right - left),
    distForX: (x) =>
      Math.max(minDist, Math.min(maxDist, minDist + ((x - left) / (right - left)) * distSpan)),
    yForValue: (v) =>
      valueSpan > 0 ? bottom - ((v - minValue) / valueSpan) * (bottom - top) : (top + bottom) / 2,
  };
}

/** An `M…L…` polyline through the sampled points, mapped to viewBox coordinates. */
function buildPath(s: SampledSeries, m: Mappers): string {
  let path = '';
  for (let i = 0; i < s.dists.length; i++) {
    path += `${i === 0 ? 'M' : 'L'}${round(m.xForDist(s.dists[i]))} ${round(m.yForValue(s.values[i]))}`;
  }
  return path;
}

/** Points to resample a track to: bounded by COLS, never fewer than its own points. */
const colsFor = (track: Track) => Math.max(2, Math.min(COLS, track.n));

/**
 * Pure geometry for one distance-keyed chart over `track`. The x axis is
 * cumulative distance [0, totalDistance]; the y axis is the value's own min/max.
 * Dimensions are the fixed viewBox constants: the SVG stretches to its container
 * via CSS, so they never vary per call.
 */
export function chartGeometry(track: Track, kind: ChartKind): ChartGeometry {
  const spec = SPECS[kind];
  const maxDist = track.totalDistance;
  const s = sampleSeries(track, spec, maxDist, colsFor(track));
  const m = mappers(0, maxDist, s.min, s.max);

  const path = buildPath(s, m);
  const area = `${path}L${round(m.right)} ${round(m.bottom)}L${round(m.left)} ${round(m.bottom)}Z`;

  return {
    kind,
    width: CHART_W,
    height: CHART_H,
    minDist: 0,
    maxDist,
    minValue: s.min,
    maxValue: s.max,
    xForDist: m.xForDist,
    distForX: m.distForX,
    yForValue: m.yForValue,
    path,
    area,
  };
}

/**
 * A self-contained, full-width SVG for one chart: a filled area under the series
 * line and a hidden cursor line the client reveals and moves. `preserveAspectRatio
 * ="none"` stretches the fixed viewBox to the container width; strokes use
 * `vector-effect="non-scaling-stroke"` so that stretch never thickens them.
 */
export function chartSVG(track: Track, kind: ChartKind): string {
  const g = chartGeometry(track, kind);
  const spec = SPECS[kind];
  const width = g.width;
  const height = g.height;
  return (
    `<svg class="chart__svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"` +
    ` data-chart="${kind}" xmlns="http://www.w3.org/2000/svg" role="img"` +
    ` aria-label="${spec.label} over distance">` +
    `<path class="chart__area" d="${g.area}" />` +
    `<path class="chart__line" d="${g.path}" fill="none" vector-effect="non-scaling-stroke" />` +
    `<line class="chart__cursor" x1="0" y1="0" x2="0" y2="${height}"` +
    ` vector-effect="non-scaling-stroke" style="display:none" />` +
    `</svg>`
  );
}

/** One ride's line within a compare chart, ending at its own distance. */
export interface CompareSeries {
  /** The ride's total distance (m) — where its line stops (≤ the shared maxDist). */
  maxDist: number;
  path: string;
}

export interface CompareChartGeometry {
  kind: ChartKind;
  width: number;
  height: number;
  minDist: number;
  /** Shared x extent: the longer of the two rides. */
  maxDist: number;
  /** Shared y extent: min/max across both series. */
  minValue: number;
  maxValue: number;
  xForDist(d: number): number;
  distForX(x: number): number;
  yForValue(v: number): number;
  series: CompareSeries[];
}

/**
 * Pure geometry for a compare chart (ticket 6): both rides on one shared distance
 * axis (0 → the longer ride) and one shared value axis (min/max across both). Each
 * series is resampled over *its own* extent, so a shorter ride's line stops mid-axis
 * rather than being stretched — the visual cue that the rides differ in length. The
 * mappers are shared, so the client hit-tests hover x → distance once for both.
 */
export function compareChartGeometry(tracks: Track[], kind: ChartKind): CompareChartGeometry {
  const spec = SPECS[kind];
  const maxDist = Math.max(...tracks.map((t) => t.totalDistance));

  let minValue = Infinity;
  let maxValue = -Infinity;
  const sampled = tracks.map((t) => {
    const s = sampleSeries(t, spec, t.totalDistance, colsFor(t));
    if (s.min < minValue) minValue = s.min;
    if (s.max > maxValue) maxValue = s.max;
    return s;
  });

  const m = mappers(0, maxDist, minValue, maxValue);
  const series: CompareSeries[] = sampled.map((s, i) => ({
    maxDist: tracks[i].totalDistance,
    path: buildPath(s, m),
  }));

  return {
    kind,
    width: CHART_W,
    height: CHART_H,
    minDist: 0,
    maxDist,
    minValue,
    maxValue,
    xForDist: m.xForDist,
    distForX: m.distForX,
    yForValue: m.yForValue,
    series,
  };
}

/**
 * A full-width compare-chart SVG: one line per ride in its identity colour and one
 * hidden cursor line per ride (they diverge during the ghost race, coincide on
 * hover). No area fills — two translucent fills over one axis just muddy each other.
 */
export function compareChartSVG(tracks: Track[], kind: ChartKind, colors: string[]): string {
  const g = compareChartGeometry(tracks, kind);
  const spec = SPECS[kind];
  // The identity stroke is set inline (not as a `stroke` attribute) so it outranks
  // `.chart__line { stroke: var(--series) }` from global.css — a presentation
  // attribute would lose to that class rule and both lines would render one colour.
  const lines = g.series
    .map(
      (s, i) =>
        `<path class="chart__line" d="${s.path}" fill="none" vector-effect="non-scaling-stroke"` +
        ` style="stroke:${colors[i]}" />`,
    )
    .join('');
  const cursors = g.series
    .map(
      (_, i) =>
        `<line class="chart__cursor" data-series="${i}" x1="0" y1="0" x2="0" y2="${g.height}"` +
        ` vector-effect="non-scaling-stroke" style="stroke:${colors[i]};display:none" />`,
    )
    .join('');
  return (
    `<svg class="chart__svg" viewBox="0 0 ${g.width} ${g.height}" preserveAspectRatio="none"` +
    ` data-chart="${kind}" xmlns="http://www.w3.org/2000/svg" role="img"` +
    ` aria-label="${spec.label} over distance, both rides">${lines}${cursors}</svg>`
  );
}
