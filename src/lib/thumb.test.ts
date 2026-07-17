import { describe, it, expect } from 'vitest';
import { polylineThumb, trackHeroSVG } from './thumb';
import { encodePolyline } from './polyline';

// The card route thumbnail (issue 04): a bare SVG path drawn from the stored
// DP-15 m polyline — no map tiles. Pure geometry, so it renders identically
// server-side (dashboard) and client-side (upload results).

describe('polylineThumb', () => {
  it('projects a polyline into a fitted, y-flipped SVG path', () => {
    // A short north-east diagonal near Berlin.
    const encoded = encodePolyline([
      { lat: 52.5, lon: 13.4 },
      { lat: 52.51, lon: 13.41 },
      { lat: 52.52, lon: 13.42 },
    ]);
    const svg = polylineThumb(encoded, 120, 80);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 120 80"');
    const path = /<path d="([^"]+)"/.exec(svg)?.[1];
    expect(path).toBeTruthy();
    expect(path!.startsWith('M')).toBe(true);
    expect(path).toContain('L');
    // Every coordinate is finite and inside the padded box.
    const coords = path!.match(/-?\d+(\.\d+)?/g)!.map(Number);
    for (const c of coords) {
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(120);
    }
    // Higher latitude must map to a smaller y (north is up).
    const ys = coords.filter((_, i) => i % 2 === 1);
    expect(ys[0]).toBeGreaterThan(ys[ys.length - 1]);
  });

  it('degrades gracefully on a degenerate (too-short) polyline', () => {
    const svg = polylineThumb(encodePolyline([{ lat: 52.5, lon: 13.4 }]), 120, 80);
    expect(svg).toContain('<svg');
    // No NaN leaks into the output.
    expect(svg).not.toContain('NaN');
  });

  it('handles an empty polyline without throwing', () => {
    const svg = polylineThumb('', 120, 80);
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('NaN');
  });
});

describe('trackHeroSVG', () => {
  it('draws the full-resolution track line into a fitted, y-flipped hero box', () => {
    const lat = [52.5, 52.51, 52.52];
    const lon = [13.4, 13.41, 13.42];
    const svg = trackHeroSVG(lat, lon, 960, 360);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 960 360"');
    const path = /<path d="([^"]+)"/.exec(svg)?.[1];
    expect(path).toBeTruthy();
    expect(path!.startsWith('M')).toBe(true);
    const coords = path!.match(/-?\d+(\.\d+)?/g)!.map(Number);
    for (const c of coords) expect(Number.isFinite(c)).toBe(true);
    // North is up: first (southernmost) point sits below the last.
    const ys = coords.filter((_, i) => i % 2 === 1);
    expect(ys[0]).toBeGreaterThan(ys[ys.length - 1]);
  });

  it('degrades gracefully on a too-short track', () => {
    const svg = trackHeroSVG([52.5], [13.4], 960, 360);
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('NaN');
    expect(svg).not.toContain('<path');
  });
});
