import { describe, it, expect } from 'vitest';
import type { LatLon } from './geo';
import { encodePolyline } from './polyline';
import {
  binHeatmap,
  heatmapFeatureCollection,
  HEAT_CELL_M,
} from './heatmap';

// The heatmap binning seam (ticket 5 / issue 12, variant C). Cells are anchored to the
// first ride's first point, so fixtures build lines relative to a known origin.
const O = { lat: 50, lon: 8 };
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LON = 111320 * Math.cos((O.lat * Math.PI) / 180);

/** A straight eastward line `meters` long, one point every `stepM` metres. */
function eastLine(meters: number, stepM = 10, from: LatLon = O): LatLon[] {
  const pts: LatLon[] = [];
  for (let d = 0; d <= meters; d += stepM) {
    pts.push({ lat: from.lat, lon: from.lon + d / M_PER_DEG_LON });
  }
  return pts;
}

/** A straight northward line of `meters`, starting at `from`. */
function northLine(meters: number, stepM = 10, from: LatLon = O): LatLon[] {
  const pts: LatLon[] = [];
  for (let d = 0; d <= meters; d += stepM) {
    pts.push({ lat: from.lat + d / M_PER_DEG_LAT, lon: from.lon });
  }
  return pts;
}

describe('binHeatmap', () => {
  it('produces undirected edges along a single line, all at max intensity', () => {
    const { edges, maxCount } = binHeatmap([eastLine(200)]);
    expect(maxCount).toBe(1);
    expect(edges.length).toBeGreaterThan(0);
    // One ride → every reachable cell has count 1, so every edge is normalised to 1.
    for (const e of edges) {
      expect(e.count).toBe(1);
      expect(e.v).toBeCloseTo(1, 5);
    }
  });

  it('counts a cell once per ride even when the ride revisits it (out-and-back)', () => {
    const there = eastLine(200);
    const back = [...there].reverse();
    const outAndBack = [...there, ...back];
    const oneWay = binHeatmap([there]);
    const round = binHeatmap([outAndBack]);
    // Revisiting the same cells must not inflate counts: max stays 1.
    expect(round.maxCount).toBe(1);
    expect(oneWay.maxCount).toBe(1);
  });

  it('stacks two identical rides to count 2 across every shared cell', () => {
    const line = eastLine(200);
    const { edges, maxCount } = binHeatmap([line, line]);
    expect(maxCount).toBe(2);
    for (const e of edges) {
      expect(e.count).toBe(2);
      expect(e.v).toBeCloseTo(1, 5); // min endpoint count == max → normalised 1
    }
  });

  it('treats a ride and its reverse as the same undirected edge set', () => {
    const line = eastLine(200);
    const forward = binHeatmap([line, line]);
    const mixed = binHeatmap([line, [...line].reverse()]);
    expect(mixed.edges.length).toBe(forward.edges.length);
    expect(mixed.maxCount).toBe(2);
  });

  it('colours a shared corridor hotter than a diverging spur (min-endpoint, log scale)', () => {
    // Two rides share the first 200 m east, then one continues east, the other turns north.
    const shared = eastLine(200);
    const eastTail = eastLine(400); // ride A: straight on
    const junction = { lat: O.lat, lon: O.lon + 200 / M_PER_DEG_LON };
    const northTail = [...shared, ...northLine(200, 10, junction)]; // ride B: turns off
    const { edges, maxCount } = binHeatmap([eastTail, northTail]);
    expect(maxCount).toBe(2);
    const hot = edges.filter((e) => e.count === 2);
    const cool = edges.filter((e) => e.count === 1);
    expect(hot.length).toBeGreaterThan(0);
    expect(cool.length).toBeGreaterThan(0);
    // Log-normalised: shared cells reach 1, single-pass cells sit below it.
    for (const e of hot) expect(e.v).toBeCloseTo(1, 5);
    for (const e of cool) expect(e.v).toBeLessThan(1);
    expect(Math.max(...cool.map((e) => e.v))).toBeLessThan(Math.min(...hot.map((e) => e.v)));
  });

  it('honours a custom cell size', () => {
    const line = eastLine(200);
    const fine = binHeatmap([line], 10);
    const coarse = binHeatmap([line], 50);
    // Smaller cells → more, shorter edges over the same line.
    expect(fine.edges.length).toBeGreaterThan(coarse.edges.length);
  });

  it('returns empty output for no rides', () => {
    const { edges, maxCount } = binHeatmap([]);
    expect(edges).toEqual([]);
    expect(maxCount).toBe(0);
  });

  it('skips empty polylines without throwing', () => {
    const { edges } = binHeatmap([[], eastLine(100), []]);
    expect(edges.length).toBeGreaterThan(0);
  });

  it('uses a 25 m grid by default', () => {
    expect(HEAT_CELL_M).toBe(25);
    // A 100 m line on a 25 m grid spans ~4 cells → ~4 edges.
    const { edges } = binHeatmap([eastLine(100)]);
    expect(edges.length).toBeGreaterThanOrEqual(3);
    expect(edges.length).toBeLessThanOrEqual(5);
  });
});

describe('heatmapFeatureCollection', () => {
  it('decodes encoded polylines and emits LineString edges with n and v props', () => {
    const encoded = encodePolyline(eastLine(200));
    const fc = heatmapFeatureCollection([encoded, encoded]);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features.length).toBeGreaterThan(0);
    for (const f of fc.features) {
      expect(f.geometry.type).toBe('LineString');
      expect(f.geometry.coordinates).toHaveLength(2); // one cell-to-cell segment
      const [lon, lat] = f.geometry.coordinates[0];
      expect(lon).toBeCloseTo(O.lon, 2);
      expect(lat).toBeCloseTo(O.lat, 2);
      expect(f.properties.n).toBe(2);
      expect(f.properties.v).toBeGreaterThan(0);
      expect(f.properties.v).toBeLessThanOrEqual(1);
    }
  });

  it('is empty for an empty index', () => {
    const fc = heatmapFeatureCollection([]);
    expect(fc.features).toEqual([]);
  });
});
