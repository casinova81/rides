import { describe, it, expect } from 'vitest';
import {
  chartGeometry,
  chartSVG,
  compareChartGeometry,
  compareChartSVG,
  CHART_W,
  CHART_PAD,
} from './chart';
import { Track } from './track';
import type { Track as TrackData } from './types';

// The synced elevation/speed charts (ticket 4d). The geometry is pure and shared
// by the server (renders the static SVG) and the client (positions the cursor and
// hit-tests a hover x back to a distance). These tests pin the two mappings that
// keep chart↔map↔playback consistent: dist→x (and its inverse distForX) and value→y.

// A 5-point eastbound track: 0..400 m, elevation a 10→50→10 tent, speed 5→10→5.
const data: TrackData = {
  lat: [0, 0, 0, 0, 0],
  lon: [0, 0.001, 0.002, 0.003, 0.004],
  ele: [10, 30, 50, 30, 10],
  t: [0, 40, 80, 120, 160],
  dist: [0, 100, 200, 300, 400],
  speed: [5, 7.5, 10, 7.5, 5],
};
const track = new Track(data);

describe('chartGeometry — distance ↔ x mapping', () => {
  const g = chartGeometry(track, 'elevation');

  it('spans the drawable box: minDist → left edge, maxDist → right edge', () => {
    expect(g.minDist).toBe(0);
    expect(g.maxDist).toBe(400);
    expect(g.xForDist(0)).toBeCloseTo(CHART_PAD.left, 5);
    expect(g.xForDist(400)).toBeCloseTo(CHART_W - CHART_PAD.right, 5);
  });

  it('is monotonic and linear in distance', () => {
    expect(g.xForDist(200)).toBeCloseTo((g.xForDist(0) + g.xForDist(400)) / 2, 5);
  });

  it('distForX inverts xForDist', () => {
    for (const d of [0, 100, 250, 400]) {
      expect(g.distForX(g.xForDist(d))).toBeCloseTo(d, 3);
    }
  });

  it('clamps distForX to the distance domain outside the box', () => {
    expect(g.distForX(-9999)).toBe(0);
    expect(g.distForX(9999)).toBe(400);
  });
});

describe('chartGeometry — value → y mapping (north-up)', () => {
  it('maps the elevation domain, min at the bottom and max at the top', () => {
    const g = chartGeometry(track, 'elevation');
    expect(g.minValue).toBe(10);
    expect(g.maxValue).toBe(50);
    expect(g.yForValue(50)).toBeCloseTo(CHART_PAD.top, 5); // peak → top
    expect(g.yForValue(10)).toBeCloseTo(g.height - CHART_PAD.bottom, 5); // floor → bottom
  });

  it('reads the speed series independently of elevation', () => {
    const g = chartGeometry(track, 'speed');
    expect(g.minValue).toBe(5);
    expect(g.maxValue).toBe(10);
  });

  it('centres a flat series instead of dividing by zero', () => {
    const flat = new Track({ ...data, ele: [20, 20, 20, 20, 20] });
    const g = chartGeometry(flat, 'elevation');
    const mid = (CHART_PAD.top + (g.height - CHART_PAD.bottom)) / 2;
    expect(g.yForValue(20)).toBeCloseTo(mid, 5);
    expect(Number.isFinite(g.yForValue(20))).toBe(true);
  });
});

describe('chartGeometry — path', () => {
  const g = chartGeometry(track, 'elevation');

  it('starts with a moveto and stays within the box', () => {
    expect(g.path.startsWith('M')).toBe(true);
    const nums = g.path.match(/-?\d+(\.\d+)?/g)!.map(Number);
    for (let i = 0; i < nums.length; i += 2) {
      expect(nums[i]).toBeGreaterThanOrEqual(CHART_PAD.left - 1e-6);
      expect(nums[i]).toBeLessThanOrEqual(CHART_W - CHART_PAD.right + 1e-6);
    }
  });

  it('closes the area path back down to the baseline', () => {
    expect(g.area.startsWith('M')).toBe(true);
    expect(g.area.trimEnd().endsWith('Z')).toBe(true);
  });
});

describe('chartSVG', () => {
  it('emits a self-contained full-width svg carrying the series path and a cursor line', () => {
    const svg = chartSVG(track, 'speed');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${CHART_W}`);
    expect(svg).toContain('preserveAspectRatio="none"');
    expect(svg).toContain('data-chart="speed"');
    expect(svg).toContain('class="chart__cursor"');
    expect(svg.endsWith('</svg>')).toBe(true);
  });
});

// The compare charts (ticket 6): both rides on one shared axis. The x domain is
// 0→max of the two distances; the y domain spans both series; each series' line
// stops at its own distance so a shorter ride ends before the right edge.
const short = track; // 0..400 m, elevation 10→50→10
const long = new Track({
  lat: [0, 0, 0, 0, 0],
  lon: [0, 0.002, 0.004, 0.006, 0.008],
  ele: [20, 30, 40, 50, 60],
  t: [0, 80, 160, 240, 320],
  dist: [0, 200, 400, 600, 800],
  speed: [4, 5, 6, 7, 8],
});

describe('compareChartGeometry — shared axes', () => {
  const g = compareChartGeometry([short, long], 'elevation');

  it('spans the longer ride on x and both rides on y', () => {
    expect(g.minDist).toBe(0);
    expect(g.maxDist).toBe(800); // max of 400 and 800
    expect(g.minValue).toBe(10); // min across both series
    expect(g.maxValue).toBe(60); // max across both series
    expect(g.xForDist(0)).toBeCloseTo(CHART_PAD.left, 5);
    expect(g.xForDist(800)).toBeCloseTo(CHART_W - CHART_PAD.right, 5);
  });

  it('distForX inverts xForDist over the shared domain', () => {
    for (const d of [0, 200, 400, 800]) {
      expect(g.distForX(g.xForDist(d))).toBeCloseTo(d, 3);
    }
  });

  it('gives one path per ride, each ending at its own distance', () => {
    expect(g.series).toHaveLength(2);
    expect(g.series[0].maxDist).toBe(400);
    expect(g.series[1].maxDist).toBe(800);
    // The short ride's line ends mid-axis (at x for 400), not at the right edge.
    const lastX = (path: string) => {
      const nums = path.match(/-?\d+(\.\d+)?/g)!.map(Number);
      return nums[nums.length - 2];
    };
    expect(lastX(g.series[0].path)).toBeCloseTo(g.xForDist(400), 3);
    expect(lastX(g.series[1].path)).toBeCloseTo(g.xForDist(800), 3);
  });
});

describe('compareChartSVG', () => {
  it('carries both series in their identity colours plus a cursor line each', () => {
    const svg = compareChartSVG([short, long], 'speed', ['#2a78d6', '#e8802a']);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('data-chart="speed"');
    // Identity colours set inline so they beat the .chart__line class rule.
    expect(svg).toContain('stroke:#2a78d6');
    expect(svg).toContain('stroke:#e8802a');
    expect(svg).toContain('data-series="0"');
    expect(svg).toContain('data-series="1"');
    expect(svg.endsWith('</svg>')).toBe(true);
  });
});
