import { describe, it, expect } from 'vitest';
import { simplify, encodePolyline, decodePolyline, toIndexPolyline } from './polyline';

describe('polyline simplify + encode', () => {
  it('drops near-collinear points beyond the tolerance', () => {
    const line = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.001 }, // ~111 m along a straight east line — redundant
      { lat: 0, lon: 0.002 },
    ];
    expect(simplify(line, 15)).toHaveLength(2); // endpoints only
  });

  it('keeps a point that deviates more than the tolerance', () => {
    const line = [
      { lat: 0, lon: 0 },
      { lat: 0.001, lon: 0.001 }, // ~111 m off the straight chord
      { lat: 0, lon: 0.002 },
    ];
    expect(simplify(line, 15)).toHaveLength(3);
  });

  it('round-trips through the encoder at precision 5', () => {
    const pts = [
      { lat: 52.50271, lon: 13.47563 },
      { lat: 52.502608, lon: 13.475681 },
    ];
    const decoded = decodePolyline(encodePolyline(pts));
    expect(decoded[0].lat).toBeCloseTo(52.50271, 5);
    expect(decoded[1].lon).toBeCloseTo(13.475681, 5);
  });

  it('matches the reference Google encoding', () => {
    // Classic example from Google's polyline algorithm docs.
    expect(
      encodePolyline([
        { lat: 38.5, lon: -120.2 },
        { lat: 40.7, lon: -120.95 },
        { lat: 43.252, lon: -126.453 },
      ]),
    ).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });

  it('toIndexPolyline simplifies then encodes', () => {
    const straight = Array.from({ length: 50 }, (_, i) => ({ lat: 0, lon: i * 0.0001 }));
    const encoded = toIndexPolyline(straight);
    expect(decodePolyline(encoded).length).toBeLessThan(straight.length);
  });
});
