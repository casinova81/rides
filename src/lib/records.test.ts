import { describe, it, expect } from 'vitest';
import { recomputeRecords, type WindowTimes } from './records';
import type { IndexSummary, RideStats } from './types';

function summary(id: string, stats: Partial<RideStats>): IndexSummary {
  return {
    id,
    name: id,
    sport: 'e_bike',
    start: '2026-01-01T00:00:00Z',
    stats: {
      distance: 0,
      duration: 0,
      movingTime: 0,
      avgMovingSpeed: 0,
      maxSpeed: 0,
      elevationGain: 0,
      elevationLoss: 0,
      maxGradient: 0,
      minGradient: 0,
      ...stats,
    },
    polyline: '',
  };
}

describe('recomputeRecords — all 8 categories from index summaries', () => {
  it('picks the winner in every category and never maintains incrementally', () => {
    const summaries = [
      summary('long', { distance: 82000, elevationGain: 400, movingTime: 12000, maxSpeed: 12 }),
      summary('climby', { distance: 30000, elevationGain: 1500, movingTime: 9000, maxSpeed: 18 }),
      summary('fast', { distance: 25000, avgMovingSpeed: 8, movingTime: 3200, maxSpeed: 20 }),
    ];
    const windows = new Map<string, WindowTimes>([
      ['long', { '5k': 700, '10k': 1500, '20k': 3200 }],
      ['climby', { '5k': 600, '10k': 1400, '20k': null }],
      ['fast', { '5k': 500, '10k': 1100, '20k': 2400 }],
    ]);

    const r = recomputeRecords(summaries, windows);
    expect(r.longestDistance).toEqual({ rideId: 'long', value: 82000 });
    expect(r.mostElevationGain).toEqual({ rideId: 'climby', value: 1500 });
    expect(r.longestMovingTime).toEqual({ rideId: 'long', value: 12000 });
    expect(r.maxSpeed).toEqual({ rideId: 'fast', value: 20 });
    expect(r.fastest5k).toEqual({ rideId: 'fast', value: 500 });
    expect(r.fastest10k).toEqual({ rideId: 'fast', value: 1100 });
    expect(r.fastest20k).toEqual({ rideId: 'fast', value: 2400 });
  });

  it('limits the average-speed record to rides ≥ 20 km', () => {
    const summaries = [
      summary('shortburner', { distance: 8000, avgMovingSpeed: 12 }), // ineligible
      summary('longcruise', { distance: 40000, avgMovingSpeed: 7 }),
    ];
    const r = recomputeRecords(summaries, new Map());
    expect(r.fastestAvgSpeed).toEqual({ rideId: 'longcruise', value: 7 });
  });

  it('yields all-null records for an empty index (self-heals to nothing)', () => {
    const r = recomputeRecords([], new Map());
    expect(r.longestDistance).toBeNull();
    expect(r.fastest5k).toBeNull();
    expect(r.fastestAvgSpeed).toBeNull();
  });

  it('ignores rides with no qualifying window', () => {
    const summaries = [summary('a', { distance: 3000 })];
    const windows = new Map<string, WindowTimes>([['a', { '5k': null, '10k': null, '20k': null }]]);
    const r = recomputeRecords(summaries, windows);
    expect(r.fastest5k).toBeNull();
    expect(r.longestDistance).toEqual({ rideId: 'a', value: 3000 });
  });
});
