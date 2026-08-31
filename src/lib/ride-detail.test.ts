import { describe, it, expect } from 'vitest';
import {
  detailSubline,
  headlineTiles,
  secondaryStats,
  fastestWindows,
  splitRows,
} from './ride-detail';
import type { RidePayload, Split, Bests } from './types';
import { SCHEMA_VERSION } from './types';

// The ride-detail view core (ticket 4a) is pure: a RidePayload in, formatted
// {label, value} rows out. de-DE numbers/dates, English labels, Berlin times.

const bests: Bests = {
  '5k': { time: 600, startDist: 0 }, // 5 km in 10:00 → 30,0 km/h
  '10k': { time: 1320, startDist: 2000 },
  '20k': null, // ride shorter than 20 km
};

const splits: Split[] = [
  { km: 1, len: 1000, time: 200, avgSpeed: 5, eleDelta: 12, avgGradient: 1.2 },
  { km: 2, len: 480, time: 96, avgSpeed: 5, eleDelta: -8, avgGradient: -1.6 },
];

const payload: RidePayload = {
  schemaVersion: SCHEMA_VERSION,
  id: '2026-07-05-airport-loop',
  name: 'Airport Loop',
  sport: 'e_bike',
  start: '2026-07-05T10:00:57Z', // 12:00 Berlin (summer)
  stats: {
    distance: 12480,
    duration: 4000,
    movingTime: 3600,
    avgMovingSpeed: 3.466,
    maxSpeed: 11.1,
    elevationGain: 97,
    elevationLoss: 84,
    maxGradient: 7.2,
    minGradient: -5.4,
  },
  splits,
  bests,
  track: { lat: [], lon: [], ele: [], t: [], dist: [], speed: [] },
};

describe('ride-detail — header subline', () => {
  it('is date · time · sport in Berlin, dropping an empty sport', () => {
    expect(detailSubline(payload)).toBe('05.07.2026 · 12:00 · E Bike');
    expect(detailSubline({ ...payload, sport: '' })).toBe('05.07.2026 · 12:00');
  });
});

describe('ride-detail — headline tiles', () => {
  it('renders the four headline stats in de-DE with English labels', () => {
    const tiles = headlineTiles(payload);
    expect(tiles.map((t) => t.label)).toEqual([
      'Distance',
      'Moving time',
      'Avg speed',
      'Elevation gain',
    ]);
    expect(tiles.map((t) => t.value)).toEqual(['12,5 km', '1:00:00', '12,5 km/h', '↑ 97 m']);
  });
});

describe('ride-detail — secondary stats', () => {
  it('covers elapsed time, elevation loss, top speed, and gradient extremes', () => {
    const stats = secondaryStats(payload);
    expect(stats).toEqual([
      { label: 'Elapsed time', value: '1:06:40' },
      { label: 'Idle time', value: '6:40' },
      { label: 'Elevation loss', value: '↓ 84 m' },
      { label: 'Top speed', value: '40,0 km/h' },
      { label: 'Max gradient', value: '7,2 %' },
      { label: 'Min gradient', value: '-5,4 %' },
    ]);
  });
});

describe('ride-detail — fastest windows', () => {
  it('shows time and avg speed, with — when the ride is too short', () => {
    const windows = fastestWindows(payload);
    expect(windows).toEqual([
      { label: 'Fastest 5 km', value: '10:00 · 30,0 km/h' },
      { label: 'Fastest 10 km', value: '22:00 · 27,3 km/h' },
      { label: 'Fastest 20 km', value: '—' },
    ]);
  });
});

describe('ride-detail — split rows', () => {
  it('formats each km with a real-length final partial and signed elevation', () => {
    const rows = splitRows(splits);
    expect(rows[0]).toEqual({
      km: '1',
      dist: '1,0 km',
      time: '3:20',
      speed: '18,0 km/h',
      ele: '+12 m',
      grad: '1,2 %',
    });
    // Final partial km keeps its true length and shows its own distance.
    expect(rows[1]).toEqual({
      km: '2',
      dist: '0,5 km',
      time: '1:36',
      speed: '18,0 km/h',
      ele: '-8 m',
      grad: '-1,6 %',
    });
  });
});
