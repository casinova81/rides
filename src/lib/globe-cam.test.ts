import { describe, it, expect } from 'vitest';
import {
  orbitShot,
  orbitRange,
  trackCenter,
  ORBIT_PITCH,
  ORBIT_TURNS,
  ORBIT_MIN_RANGE,
  ORBIT_RANGE_FACTOR,
} from './globe-cam';
import { Track } from './track';
import { offset, haversine } from './geo';
import type { LatLon } from './geo';
import type { Track as TrackData } from './types';

// The ambient-globe camera math (Cesium engine). Pure and engine-agnostic like
// chase-cam: given how far through the ride we are and how big the ride is, it
// yields a heading/pitch/range the Cesium adapter feeds to camera.lookAt. It is a
// pure function of ride *progress* (pose.time / duration), never wall-clock, so the
// orbit does a fixed slow number of turns across the whole ride at any playback
// speed and stays absolute — the seam's updateFrame invariant (issue 09). The
// browser-side Cesium calls stay in the adapter; here we verify the numbers.

/** An eastbound track, `n` points at 10 m spacing, all at elevation `ele`. */
function buildTrack(n: number, ele = 100, start: LatLon = { lat: 52.5, lon: 13.4 }): Track {
  const lat = [start.lat];
  const lon = [start.lon];
  let cur = start;
  for (let i = 1; i < n; i++) {
    cur = offset(cur, 90, 10);
    lat.push(cur.lat);
    lon.push(cur.lon);
  }
  const dist = [0];
  for (let i = 1; i < n; i++) {
    dist.push(dist[i - 1] + haversine({ lat: lat[i - 1], lon: lon[i - 1] }, { lat: lat[i], lon: lon[i] }));
  }
  const data: TrackData = {
    lat,
    lon,
    ele: new Array(n).fill(ele),
    t: dist.map((d) => d / 5),
    dist,
    speed: new Array(n).fill(5),
  };
  return new Track(data);
}

describe('orbitShot — heading advances with ride progress, absolute', () => {
  const RANGE = 5000;

  it('starts at heading 0 at the ride start', () => {
    expect(orbitShot(0, RANGE).heading).toBeCloseTo(0, 6);
  });

  it('completes ORBIT_TURNS revolutions across the whole ride (wrapped to 0..360)', () => {
    // progress 1 → 360*ORBIT_TURNS degrees, taken mod 360.
    const expected = ((360 * ORBIT_TURNS) % 360 + 360) % 360;
    expect(orbitShot(1, RANGE).heading).toBeCloseTo(expected, 6);
  });

  it('is monotonic within a single revolution and wraps past 360', () => {
    const quarterTurnProgress = 0.25 / ORBIT_TURNS; // progress for a 90° sweep
    expect(orbitShot(quarterTurnProgress, RANGE).heading).toBeCloseTo(90, 4);
    const fullPlusBit = 1.5 / ORBIT_TURNS; // 1.5 turns → 540° → 180°
    expect(orbitShot(fullPlusBit, RANGE).heading).toBeCloseTo(180, 4);
  });

  it('is deterministic — same progress gives the same shot (no stored state)', () => {
    expect(orbitShot(0.42, RANGE)).toEqual(orbitShot(0.42, RANGE));
  });

  it('keeps pitch fixed and passes the range through untouched', () => {
    const shot = orbitShot(0.3, 8123);
    expect(shot.pitch).toBe(ORBIT_PITCH);
    expect(shot.range).toBe(8123);
    expect(shot.heading).toBeGreaterThanOrEqual(0);
    expect(shot.heading).toBeLessThan(360);
  });
});

describe('orbitRange — frames the whole ride with globe curvature', () => {
  it('floors at ORBIT_MIN_RANGE for a tiny ride', () => {
    const tiny = buildTrack(3); // ~20 m across
    expect(orbitRange(tiny)).toBe(ORBIT_MIN_RANGE);
  });

  it('scales with the ride span for a large ride', () => {
    const big = buildTrack(2001); // ~20 km across
    const span = haversine(
      { lat: big.data.lat[0], lon: big.data.lon[0] },
      { lat: big.data.lat[big.n - 1], lon: big.data.lon[big.n - 1] },
    );
    expect(orbitRange(big)).toBeGreaterThan(ORBIT_MIN_RANGE);
    expect(orbitRange(big)).toBeCloseTo(span * ORBIT_RANGE_FACTOR, -2);
  });
});

describe('trackCenter — bounding-box midpoint of the ride', () => {
  it('returns a point inside the track lat/lon extent', () => {
    const track = buildTrack(101);
    const c = trackCenter(track);
    const lats = track.data.lat;
    const lons = track.data.lon;
    expect(c.lat).toBeGreaterThanOrEqual(Math.min(...lats));
    expect(c.lat).toBeLessThanOrEqual(Math.max(...lats));
    expect(c.lon).toBeGreaterThanOrEqual(Math.min(...lons));
    expect(c.lon).toBeLessThanOrEqual(Math.max(...lons));
    // Eastbound flat track → center longitude is the midpoint of the ends.
    expect(c.lon).toBeCloseTo((lons[0] + lons[track.n - 1]) / 2, 6);
  });
});
