import { describe, it, expect } from 'vitest';
import { PlaybackCore, SPEED_STEPS } from './playback';
import { Track } from './track';
import { offset, haversine } from './geo';
import type { LatLon } from './geo';
import type { Track as TrackData } from './types';

// The engine-agnostic playback core (issue 09 / ticket 4b): owns the clock and
// pose smoothing, emitting one absolute RidePose per frame. No map here — the
// core is verified purely, the way the MapView adapter can't be.

/** Build a Track by walking `legs` (bearing°, length m) from a start, at constant speed. */
function buildTrack(
  legs: { bearing: number; length: number }[],
  opts: { start?: LatLon; step?: number; speed?: number } = {},
): Track {
  const step = opts.step ?? 10;
  const speed = opts.speed ?? 5; // m/s
  let cur: LatLon = opts.start ?? { lat: 52.5, lon: 13.4 };
  const lat = [cur.lat];
  const lon = [cur.lon];
  for (const leg of legs) {
    const n = Math.max(1, Math.round(leg.length / step));
    for (let i = 0; i < n; i++) {
      cur = offset(cur, leg.bearing, step);
      lat.push(cur.lat);
      lon.push(cur.lon);
    }
  }
  const dist = [0];
  for (let i = 1; i < lat.length; i++) {
    dist.push(dist[i - 1] + haversine({ lat: lat[i - 1], lon: lon[i - 1] }, { lat: lat[i], lon: lon[i] }));
  }
  const data: TrackData = {
    lat,
    lon,
    ele: lat.map(() => 100),
    t: dist.map((d) => d / speed),
    dist,
    speed: lat.map(() => speed),
  };
  return new Track(data);
}

// A straight ~1 km eastbound track at 5 m/s → ~200 s long.
const straight = () => buildTrack([{ bearing: 90, length: 1000 }]);

describe('PlaybackCore — clock', () => {
  it('starts paused at t=0 with a default speed step', () => {
    const pb = new PlaybackCore(straight());
    expect(pb.playing).toBe(false);
    expect(pb.time).toBe(0);
    expect(SPEED_STEPS).toContain(pb.speed);
  });

  it('advances virtual time by dt·speed only while playing', () => {
    const pb = new PlaybackCore(straight());
    pb.setSpeed(10);

    pb.frame(1.0); // paused → no advance
    expect(pb.time).toBe(0);

    pb.play();
    pb.frame(1.0); // 1 s · 10× = 10 s
    expect(pb.time).toBeCloseTo(10, 6);
    pb.frame(0.5); // + 0.5 s · 10× = 5 s
    expect(pb.time).toBeCloseTo(15, 6);
  });

  it('honours the speed steps', () => {
    const pb = new PlaybackCore(straight());
    pb.play();
    pb.setSpeed(200);
    pb.frame(0.1); // 0.1 · 200 = 20 s
    expect(pb.time).toBeCloseTo(20, 6);
  });

  it('clamps at the end and auto-pauses', () => {
    const pb = new PlaybackCore(straight());
    const dur = pb.duration;
    pb.setSpeed(500);
    pb.play();
    pb.frame(dur); // massively overshoots
    expect(pb.time).toBe(dur);
    expect(pb.playing).toBe(false);
    expect(pb.progress).toBeCloseTo(1, 6);
  });

  it('seek clamps to [0, duration] and reports progress', () => {
    const pb = new PlaybackCore(straight());
    pb.seek(-50);
    expect(pb.time).toBe(0);
    pb.seek(pb.duration + 999);
    expect(pb.time).toBe(pb.duration);
    pb.seek(pb.duration / 2);
    expect(pb.progress).toBeCloseTo(0.5, 6);
  });

  it('toggle flips play/pause', () => {
    const pb = new PlaybackCore(straight());
    pb.toggle();
    expect(pb.playing).toBe(true);
    pb.toggle();
    expect(pb.playing).toBe(false);
  });
});

describe('PlaybackCore — pose smoothing', () => {
  it('snaps to the raw sample on the frame after a seek (no easing across the jump)', () => {
    const track = straight();
    const pb = new PlaybackCore(track);
    pb.seek(100); // half-way in time
    const pose = pb.frame(0.016);
    const raw = track.sampleByTime(pb.time);
    expect(pose.lngLat[0]).toBeCloseTo(raw.lon, 9);
    expect(pose.lngLat[1]).toBeCloseTo(raw.lat, 9);
    expect(pose.elevation).toBeCloseTo(raw.ele, 6);
  });

  it('lags behind the raw position when the clock jumps ahead', () => {
    const track = straight();
    const start = { lat: track.data.lat[0], lon: track.data.lon[0] };
    const pb = new PlaybackCore(track);
    pb.seek(0);
    pb.frame(0.016); // establish smoothed state at the start
    pb.setSpeed(10);
    pb.play();
    const pose = pb.frame(1.0); // clock jumps to 10 s → raw ~50 m in
    const rawDist = track.sampleByTime(pb.time).dist;
    const smoothedFromStart = haversine(start, { lat: pose.lngLat[1], lon: pose.lngLat[0] });
    expect(smoothedFromStart).toBeGreaterThan(0); // it moved
    expect(pose.distance).toBeLessThan(rawDist); // …but lags the clock's raw distance
    expect(smoothedFromStart).toBeCloseTo(pose.distance, 3); // and sits at its own distance
  });

  it('keeps the pose exactly on the track polyline while smoothing (never cuts corners)', () => {
    // A hard 90° corner: lon/lat smoothing would pull the pose inside the bend;
    // arc-length smoothing must keep every frame's position on the line itself.
    const track = buildTrack([
      { bearing: 90, length: 400 },
      { bearing: 0, length: 400 },
    ]);
    const pb = new PlaybackCore(track);
    pb.setSpeed(50);
    pb.play();
    for (let i = 0; i < 120 && pb.playing; i++) {
      const pose = pb.frame(0.05);
      const onLine = track.sampleByDist(pose.distance);
      expect(pose.lngLat[0]).toBeCloseTo(onLine.lon, 12);
      expect(pose.lngLat[1]).toBeCloseTo(onLine.lat, 12);
      // …and that distance really is a point of the polyline, metres from the
      // straight-line chord a corner-cutting smoother would take.
      const nearest = track.nearestByPoint(pose.lngLat[0], pose.lngLat[1]);
      expect(Math.sqrt(nearest.d2)).toBeLessThan(1e-9); // planar degrees² → ~0
    }
  });

  it('converges to the raw position when the clock is held still', () => {
    const track = straight();
    const pb = new PlaybackCore(track);
    pb.seek(0);
    pb.frame(0.016);
    pb.seek(120); // reset again, then hold the clock (paused) and let it settle
    for (let i = 0; i < 80; i++) pb.frame(0.1);
    const pose = pb.frame(0.1);
    const raw = track.sampleByTime(120);
    expect(pose.lngLat[0]).toBeCloseTo(raw.lon, 7);
    expect(pose.lngLat[1]).toBeCloseTo(raw.lat, 7);
  });
});

describe('PlaybackCore — bearing turns in step with the track', () => {
  it('aligns with the new heading shortly after a 90° corner, at any speed step', () => {
    // Bearing relaxes per metre travelled, so promptness must not depend on the
    // playback multiplier: shortly past the corner (look-ahead 25 m + a few
    // 12 m length constants) the arrow points down the new leg.
    for (const speed of SPEED_STEPS) {
      const track = buildTrack([
        { bearing: 90, length: 400 },
        { bearing: 0, length: 400 },
      ]);
      const pb = new PlaybackCore(track);
      pb.setSpeed(speed);
      pb.play();
      let bearing = NaN;
      // Realistic ~60 fps frames; keep framing after the clock ends (the pose
      // trails the clock at high multipliers and settles while paused) until the
      // pose itself is 80 m past the corner.
      for (let i = 0; i < 5000; i++) {
        const pose = pb.frame(0.016);
        bearing = pose.bearing;
        if (pose.distance >= 480) break;
      }
      const off = Math.min(bearing, 360 - bearing); // angular distance from north
      expect(off).toBeLessThan(10);
    }
  });
});

describe('PlaybackCore — bearing smoothing across the 360°→0° wrap', () => {
  it('smooths through north, never swinging toward the south', () => {
    // Heads 350° (just west of north), then turns to 10° (just east of north).
    // A naive scalar smoother would interpolate 350→10 the long way, dipping
    // through 180°; circular (vector) smoothing must stay near north.
    const track = buildTrack([
      { bearing: 350, length: 400 },
      { bearing: 10, length: 400 },
    ]);
    const pb = new PlaybackCore(track);
    pb.seek(0);
    pb.setSpeed(10);
    pb.play();

    const bearings: number[] = [];
    for (let i = 0; i < 200 && pb.playing; i++) {
      bearings.push(pb.frame(0.1).bearing);
    }

    expect(bearings.length).toBeGreaterThan(10);
    for (const b of bearings) {
      // Never points south-ish: stays out of the (90°, 270°) half.
      expect(b > 90 && b < 270).toBe(false);
    }
    // And it actually crossed from the west side to the east side of north.
    expect(bearings.some((b) => b > 270 && b < 360)).toBe(true);
    expect(bearings.some((b) => b > 0 && b < 90)).toBe(true);
  });
});
