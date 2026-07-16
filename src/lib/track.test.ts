import { describe, it, expect } from 'vitest';
import { Track } from './track';
import type { Track as TrackData } from './types';

// A simple 3-point track: 0→100→200 m east along the equator, 0→10→20 s,
// elevation 10→30→10, speed 10→10→10.
const data: TrackData = {
  lat: [0, 0, 0],
  lon: [0, 0.000899, 0.001798],
  ele: [10, 30, 10],
  t: [0, 10, 20],
  dist: [0, 100, 200],
  speed: [10, 10, 10],
};

describe('Track sampling', () => {
  const track = new Track(data);

  it('reports duration and total distance', () => {
    expect(track.duration).toBe(20);
    expect(track.totalDistance).toBe(200);
  });

  it('interpolates by time', () => {
    const s = track.sampleByTime(5);
    expect(s.dist).toBeCloseTo(50, 5);
    expect(s.ele).toBeCloseTo(20, 5);
  });

  it('interpolates by distance', () => {
    const s = track.sampleByDist(150);
    expect(s.time).toBeCloseTo(15, 5);
    expect(s.ele).toBeCloseTo(20, 5); // halfway from 30 back down to 10
  });

  it('clamps out-of-range queries to the endpoints', () => {
    expect(track.sampleByTime(-5).dist).toBe(0);
    expect(track.sampleByTime(999).dist).toBe(200);
    expect(track.sampleByDist(-1).time).toBe(0);
    expect(track.sampleByDist(9999).time).toBe(20);
  });

  it('finds the max elevation within a window', () => {
    expect(track.maxElevationNear(100, 60)).toBe(30); // includes the 30 m peak
    expect(track.maxElevationNear(0, 10)).toBe(10); // only the start
  });

  it('emits lon-first coordinates for GeoJSON', () => {
    expect(track.coordinates[1]).toEqual([0.000899, 0]);
  });

  it('takes bearing from a look-ahead point', () => {
    // heading due east → 90°
    expect(track.bearingAt(0, 25)).toBeCloseTo(90, 0);
  });
});
