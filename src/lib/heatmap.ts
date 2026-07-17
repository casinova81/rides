import type { LatLon } from './geo';
import { decodePolyline } from './polyline';

// The everywhere-I've-ridden heatmap (ticket 5 / issue 12, variant C — binned
// segments). Pure, node-safe geometry so it is unit-tested and could move
// server-side later; the client script only feeds it decoded polylines and hands
// the result to MapLibre. Technique (locked in issue 12): resample each ride's
// polyline at the grid spacing, snap to a square grid, count *rides per cell*
// (deduped per ride — cell counting is stable under GPS jitter where edge
// counting fragments), then draw each unique cell-to-cell edge coloured by
// min(count at each endpoint) on a log scale. Additive line stacking saturates as
// the archive grows and a density heatmap washes out rare roads; this stays crisp.

/** Grid cell size (m). */
export const HEAT_CELL_M = 25;
/** Rendered edge width (px). */
export const HEAT_LINE_WIDTH = 2.5;
/** OpenFreeMap dark basemap — the heatmap's only style. */
export const HEAT_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

const M_PER_DEG_LAT = 111320;

/** Strava ramp: interpolated over normalised intensity `v` ∈ [0,1]. */
const HEAT_RAMP: { line0: string; stops: [number, string][] } = {
  line0: 'rgba(139,0,0,0.55)',
  stops: [
    [0.25, '#8b0000'],
    [0.5, '#ff3b00'],
    [0.75, '#ff9d00'],
    [1, '#ffffff'],
  ],
};

/**
 * The MapLibre `line-color` interpolate expression for the strava ramp, driven by
 * each edge's `v` property. Returned as a plain array (no MapLibre import), so the
 * ramp lives in one node-safe place.
 */
export function heatColorExpression(): unknown[] {
  const expr: unknown[] = ['interpolate', ['linear'], ['get', 'v'], 0, HEAT_RAMP.line0];
  for (const [t, c] of HEAT_RAMP.stops) expr.push(t, c);
  return expr;
}

/** One binned edge between two adjacent grid-cell centres. */
export interface HeatEdge {
  a: [number, number]; // [lon, lat] of the first cell centre
  b: [number, number]; // [lon, lat] of the second cell centre
  count: number; // min ride-count of the two endpoint cells
  v: number; // normalised intensity [0,1], log scale
}

type XY = [number, number];

/** Resample a metric-space path so points sit ~`step` m apart (endpoints kept). */
function resample(pts: XY[], step: number): XY[] {
  const out: XY[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const seg = Math.hypot(bx - ax, by - ay);
    let d = step - carry;
    while (d < seg) {
      const t = d / seg;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      d += step;
    }
    carry = (carry + seg) % step;
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Bin an archive of decoded ride polylines onto a `cell`-metre grid. Rides are
 * projected to a local equirectangular plane anchored at the first ride's first
 * point (planar error is metres over one city's extent). Cell coordinates are
 * integer grid indices, so identical roads across rides snap together regardless
 * of GPS jitter.
 */
export function binHeatmap(polylines: LatLon[][], cell = HEAT_CELL_M): {
  edges: HeatEdge[];
  maxCount: number;
} {
  const origin = polylines.find((p) => p.length > 0)?.[0];
  if (!origin) return { edges: [], maxCount: 0 };

  const mPerDegLon = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);
  const project = (p: LatLon): XY => [
    (p.lon - origin.lon) * mPerDegLon,
    (p.lat - origin.lat) * M_PER_DEG_LAT,
  ];
  const cellCentreLngLat = (cx: number, cy: number): [number, number] => [
    origin.lon + (cx * cell) / mPerDegLon,
    origin.lat + (cy * cell) / M_PER_DEG_LAT,
  ];

  const cellCounts = new Map<string, number>(); // "cx,cy" → rides through this cell
  const edges = new Map<string, [string, string]>(); // "a|b" (sorted) → cell keys

  for (const line of polylines) {
    if (line.length === 0) continue;
    const xy = line.map(project);
    const seen = new Set<string>(); // cells this ride has already counted
    let prev: string | null = null;
    for (const [x, y] of resample(xy, cell)) {
      const key = `${Math.round(x / cell)},${Math.round(y / cell)}`;
      if (!seen.has(key)) {
        seen.add(key);
        cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
      }
      if (prev !== null && key !== prev) {
        const edgeKey = prev < key ? `${prev}|${key}` : `${key}|${prev}`;
        if (!edges.has(edgeKey)) edges.set(edgeKey, prev < key ? [prev, key] : [key, prev]);
      }
      prev = key;
    }
  }

  let maxCount = 0;
  for (const n of cellCounts.values()) if (n > maxCount) maxCount = n;
  const denom = Math.log1p(maxCount) || 1;
  const norm = (n: number) => Math.log1p(n) / denom;

  const out: HeatEdge[] = [];
  for (const [a, b] of edges.values()) {
    const count = Math.min(cellCounts.get(a)!, cellCounts.get(b)!);
    const [ax, ay] = a.split(',').map(Number);
    const [bx, by] = b.split(',').map(Number);
    out.push({
      a: cellCentreLngLat(ax, ay),
      b: cellCentreLngLat(bx, by),
      count,
      v: Math.round(norm(count) * 1000) / 1000,
    });
  }
  return { edges: out, maxCount };
}

/** A GeoJSON LineString feature carrying one binned edge's count and intensity. */
export interface HeatFeature {
  type: 'Feature';
  properties: { n: number; v: number };
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}

export interface HeatFeatureCollection {
  type: 'FeatureCollection';
  features: HeatFeature[];
}

/**
 * Decode an index's encoded polylines and bin them into a GeoJSON collection the
 * MapLibre line layer renders directly. This is the client's single entry point.
 */
export function heatmapFeatureCollection(
  encodedPolylines: string[],
  cell = HEAT_CELL_M,
): HeatFeatureCollection {
  const { edges } = binHeatmap(encodedPolylines.map(decodePolyline), cell);
  return {
    type: 'FeatureCollection',
    features: edges.map((e) => ({
      type: 'Feature',
      properties: { n: e.count, v: e.v },
      geometry: { type: 'LineString', coordinates: [e.a, e.b] },
    })),
  };
}
