import { EARTH_RADIUS } from '../src/lib/geo';

// Builders for synthetic GPX strings that target one derivation rule at a time.
// Points are laid on the equator (lat 0) so cumulative distance is a clean
// function of longitude: at lat 0, haversine ≈ EARTH_RADIUS * Δlon(rad).

const M_PER_DEG_LON_AT_EQUATOR = (EARTH_RADIUS * Math.PI) / 180; // ≈ 111194.93

/** Longitude offset (deg) that sits `m` metres east of lon 0 at the equator. */
export function metersToLon(m: number): number {
  return m / M_PER_DEG_LON_AT_EQUATOR;
}

export interface FixturePoint {
  lat: number;
  lon: number;
  ele: number;
  /** seconds since the fixture's base instant; may be fractional (ms precision). */
  t: number;
}

const BASE = Date.parse('2026-01-01T12:00:00Z') / 1000;

export function makeGpx(
  points: FixturePoint[],
  opts: { name?: string; sport?: string } = {},
): string {
  const name = opts.name ?? 'Test Ride';
  const sport = opts.sport ?? 'e_bike';
  const trkpts = points
    .map((p) => {
      const iso = new Date((BASE + p.t) * 1000).toISOString();
      return `      <trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.ele}</ele><time>${iso}</time></trkpt>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="komoot">
  <metadata><link href="https://www.komoot.com"><text>komoot</text><type>text/html</type></link></metadata>
  <trk>
    <name>${name}</name>
    <type>${sport}</type>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

/** Build a straight eastward line from specs of {atMeters, atSeconds, ele}. */
export function lineGpx(
  specs: Array<{ m: number; s: number; ele?: number }>,
  opts?: { name?: string; sport?: string },
): string {
  return makeGpx(
    specs.map((sp) => ({ lat: 0, lon: metersToLon(sp.m), ele: sp.ele ?? 0, t: sp.s })),
    opts,
  );
}
