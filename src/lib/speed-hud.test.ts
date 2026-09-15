import { describe, it, expect } from 'vitest';
import { hudScale, hudFrame, HUD_W, HUD_H, HUD_HALF_WINDOW } from './speed-hud';
import { Track } from './track';
import type { Track as TrackData } from './types';

// The live speed HUD geometry: a time-keyed ±30 s sparkline on a per-ride fixed
// y scale. These pin the centre-at-now mapping, the fixed scale, and the clipping
// of the window to the ride's own time span.

// A 200 s ride, one point every 20 s, speed ramping 2 → 12 m/s.
const data: TrackData = {
  lat: new Array(11).fill(0),
  lon: Array.from({ length: 11 }, (_, i) => i * 0.001),
  ele: new Array(11).fill(0),
  t: Array.from({ length: 11 }, (_, i) => i * 20),
  dist: Array.from({ length: 11 }, (_, i) => i * 100),
  speed: Array.from({ length: 11 }, (_, i) => 2 + i),
};
const track = new Track(data);
const scale = hudScale(track);

describe('hudScale', () => {
  it('puts "now" at the horizontal centre and ±30 s at the edges', () => {
    expect(scale.xForTime(100, 100)).toBeCloseTo(HUD_W / 2, 5);
    expect(scale.xForTime(100 - HUD_HALF_WINDOW, 100)).toBeCloseTo(0, 5);
    expect(scale.xForTime(100 + HUD_HALF_WINDOW, 100)).toBeCloseTo(HUD_W, 5);
  });

  it('pins the y axis to the ride max speed: 0 at the bottom, max at the top', () => {
    expect(scale.maxSpeed).toBe(12);
    expect(scale.yForSpeed(0)).toBeCloseTo(HUD_H, 5);
    expect(scale.yForSpeed(12)).toBeCloseTo(0, 5);
    expect(scale.yForSpeed(6)).toBeCloseTo(HUD_H / 2, 5);
  });

  it('never divides by zero on a stationary ride', () => {
    const still = new Track({ ...data, speed: new Array(11).fill(0) });
    const s = hudScale(still);
    expect(s.maxSpeed).toBe(1);
    expect(Number.isFinite(s.yForSpeed(0))).toBe(true);
  });
});

describe('hudFrame', () => {
  it('reads the current speed from the track at "now"', () => {
    expect(hudFrame(track, scale, 100).speed).toBeCloseTo(7, 5);
    expect(hudFrame(track, scale, 110).speed).toBeCloseTo(7.5, 5);
  });

  it('spans the full window mid-ride, from x=0 to x=HUD_W', () => {
    const f = hudFrame(track, scale, 100);
    expect(f.path.startsWith('M0 ')).toBe(true);
    const yEnd = Math.round(scale.yForSpeed(track.sampleByTime(130).speed) * 100) / 100;
    expect(f.path.endsWith(`L${HUD_W} ${yEnd}`)).toBe(true);
    expect(f.area.endsWith(`L${HUD_W} ${HUD_H}L0 ${HUD_H}Z`)).toBe(true);
  });

  it('clips the past at the ride start: the path begins at the centre when now = 0', () => {
    const f = hudFrame(track, scale, 0);
    expect(f.path.startsWith(`M${HUD_W / 2} `)).toBe(true);
    // 31 samples (0..30 s) → one M plus 30 L's.
    expect(f.path.match(/L/g)?.length).toBe(30);
  });

  it('clips the future at the ride end: the path stops at the centre when now = duration', () => {
    const f = hudFrame(track, scale, track.duration);
    expect(f.path.startsWith('M0 ')).toBe(true);
    expect(f.path.endsWith(`L${HUD_W / 2} 0`)).toBe(true);
  });

  it('is monotonic in time: earlier seconds sit further left', () => {
    const f = hudFrame(track, scale, 100);
    const xs = [...f.path.matchAll(/[ML]([\d.]+) /g)].map((m) => Number(m[1]));
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  });
});
