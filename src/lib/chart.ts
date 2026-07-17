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

/**
 * Pure geometry for one distance-keyed chart over `track`. The x axis is
 * cumulative distance [0, totalDistance]; the y axis is the value's own min/max
 * (a flat series collapses to the box's vertical centre rather than dividing by
 * zero). `xForDist`/`distForX` are exact linear inverses — the invariant the
 * chart↔map↔playback sync relies on. Dimensions are the fixed viewBox constants:
 * the SVG stretches to its container via CSS, so they never vary per call.
 */
export function chartGeometry(track: Track, kind: ChartKind): ChartGeometry {
  const width = CHART_W;
  const height = CHART_H;
  const spec = SPECS[kind];
  const minDist = 0;
  const maxDist = track.totalDistance;
  const distSpan = maxDist - minDist || 1;

  const left = CHART_PAD.left;
  const right = width - CHART_PAD.right;
  const top = CHART_PAD.top;
  const bottom = height - CHART_PAD.bottom;

  // Resample evenly by distance so the path size is bounded regardless of point count.
  const cols = Math.max(2, Math.min(COLS, track.n));
  const dists: number[] = new Array(cols);
  const values: number[] = new Array(cols);
  let minValue = Infinity;
  let maxValue = -Infinity;
  for (let i = 0; i < cols; i++) {
    const d = minDist + (distSpan * i) / (cols - 1);
    const v = spec.value(track.sampleByDist(d));
    dists[i] = d;
    values[i] = v;
    if (v < minValue) minValue = v;
    if (v > maxValue) maxValue = v;
  }
  const valueSpan = maxValue - minValue;

  const xForDist = (d: number) => left + ((d - minDist) / distSpan) * (right - left);
  const distForX = (x: number) => {
    const d = minDist + ((x - left) / (right - left)) * distSpan;
    return Math.max(minDist, Math.min(maxDist, d));
  };
  const yForValue = (v: number) =>
    valueSpan > 0 ? bottom - ((v - minValue) / valueSpan) * (bottom - top) : (top + bottom) / 2;

  let path = '';
  for (let i = 0; i < cols; i++) {
    path += `${i === 0 ? 'M' : 'L'}${round(xForDist(dists[i]))} ${round(yForValue(values[i]))}`;
  }
  const area = `${path}L${round(right)} ${round(bottom)}L${round(left)} ${round(bottom)}Z`;

  return {
    kind,
    width,
    height,
    minDist,
    maxDist,
    minValue,
    maxValue,
    xForDist,
    distForX,
    yForValue,
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
