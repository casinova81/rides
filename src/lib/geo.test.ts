import { describe, it, expect } from 'vitest';
import { haversine, bearingBetween, offset, circularMean } from './geo';

describe('geodesy helpers', () => {
  it('measures a known short distance', () => {
    // ~111.19 m per 0.001° of longitude at the equator
    const d = haversine({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 });
    expect(d).toBeCloseTo(111.19, 1);
  });

  it('computes cardinal bearings', () => {
    expect(bearingBetween({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 3); // east
    expect(bearingBetween({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 3); // north
  });

  it('offset is the inverse of bearing+distance', () => {
    const from = { lat: 52.5, lon: 13.4 };
    const p = offset(from, 90, 100);
    expect(haversine(from, p)).toBeCloseTo(100, 1);
    expect(bearingBetween(from, p)).toBeCloseTo(90, 1);
  });

  it('circularMean handles the 360→0 wrap', () => {
    // mean of 350° and 10° is 0°, not 180°
    const m = circularMean([350, 10]);
    expect(Math.min(m, 360 - m)).toBeCloseTo(0, 3);
  });
});
