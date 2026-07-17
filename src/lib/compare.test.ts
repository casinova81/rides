import { describe, it, expect } from 'vitest';
import { COMPARE_COLORS, deltaTable, splitsDiff, leaderReadout } from './compare';
import type { RidePayload, RideStats, Split, Bests } from './types';
import { SCHEMA_VERSION } from './types';

// The compare view core (ticket 6 / issue 13) is pure: two RidePayloads in,
// formatted rows out. Δ = ride 2 − ride 1; identity colours (ride 1 blue, ride 2
// orange) carry through the page. Windows a ride is too short for render "—", and
// so does their Δ. The splits diff colours each km by whoever was faster.

const stats = (over: Partial<RideStats>): RideStats => ({
  distance: 0,
  duration: 0,
  movingTime: 0,
  avgMovingSpeed: 0,
  maxSpeed: 0,
  elevationGain: 0,
  elevationLoss: 0,
  maxGradient: 0,
  minGradient: 0,
  ...over,
});

const ride = (over: {
  id?: string;
  name?: string;
  stats: RideStats;
  splits?: Split[];
  bests?: Bests;
}): RidePayload => ({
  schemaVersion: SCHEMA_VERSION,
  id: over.id ?? 'r',
  name: over.name ?? 'Ride',
  sport: 'e_bike',
  start: '2026-07-05T10:00:00Z',
  stats: over.stats,
  splits: over.splits ?? [],
  bests: over.bests ?? { '5k': null, '10k': null, '20k': null },
  track: { lat: [], lon: [], ele: [], t: [], dist: [], speed: [] },
});

const split = (km: number, time: number): Split => ({
  km,
  len: 1000,
  time,
  avgSpeed: 1000 / time,
  eleDelta: 0,
  avgGradient: 0,
});

const r1 = ride({
  id: 'a-ride',
  name: 'Morning Loop',
  stats: stats({
    distance: 12000,
    duration: 4000,
    movingTime: 3600,
    avgMovingSpeed: 3,
    maxSpeed: 10,
    elevationGain: 100,
    elevationLoss: 80,
  }),
  splits: [split(1, 200), split(2, 220), split(3, 210)],
  bests: { '5k': { time: 600, startDist: 0 }, '10k': null, '20k': null },
});

const r2 = ride({
  id: 'b-ride',
  name: 'Evening Sprint',
  stats: stats({
    distance: 15000,
    duration: 3500,
    movingTime: 3000,
    avgMovingSpeed: 5,
    maxSpeed: 12.5,
    elevationGain: 150,
    elevationLoss: 60,
  }),
  splits: [split(1, 190), split(2, 240)],
  bests: { '5k': { time: 540, startDist: 0 }, '10k': { time: 1200, startDist: 0 }, '20k': null },
});

describe('compare — identity colours', () => {
  it('locks ride 1 blue and ride 2 orange', () => {
    expect(COMPARE_COLORS.a).toBe('#2a78d6');
    expect(COMPARE_COLORS.b).toBe('#e8802a');
  });
});

describe('compare — Δ table (ride 2 − ride 1)', () => {
  const rows = deltaTable(r1, r2);
  const by = (label: string) => rows.find((r) => r.label === label)!;

  it('lists the seven stats then the three fastest windows, in order', () => {
    expect(rows.map((r) => r.label)).toEqual([
      'Distance',
      'Moving time',
      'Elapsed time',
      'Avg speed',
      'Max speed',
      'Elevation gain',
      'Elevation loss',
      'Fastest 5 km',
      'Fastest 10 km',
      'Fastest 20 km',
    ]);
  });

  it('formats both efforts and a signed Δ for each stat', () => {
    expect(by('Distance')).toEqual({ label: 'Distance', a: '12,0 km', b: '15,0 km', delta: '+3,0 km' });
    expect(by('Moving time')).toEqual({ label: 'Moving time', a: '1:00:00', b: '50:00', delta: '-10:00' });
    expect(by('Elapsed time')).toEqual({ label: 'Elapsed time', a: '1:06:40', b: '58:20', delta: '-8:20' });
    expect(by('Avg speed')).toEqual({ label: 'Avg speed', a: '10,8 km/h', b: '18,0 km/h', delta: '+7,2 km/h' });
    expect(by('Max speed')).toEqual({ label: 'Max speed', a: '36,0 km/h', b: '45,0 km/h', delta: '+9,0 km/h' });
    expect(by('Elevation gain')).toEqual({ label: 'Elevation gain', a: '↑ 100 m', b: '↑ 150 m', delta: '+50 m' });
    expect(by('Elevation loss')).toEqual({ label: 'Elevation loss', a: '↓ 80 m', b: '↓ 60 m', delta: '-20 m' });
  });

  it('shows a window and its Δ, with "—" where either ride is too short', () => {
    expect(by('Fastest 5 km')).toEqual({ label: 'Fastest 5 km', a: '10:00', b: '9:00', delta: '-1:00' });
    // ride 1 has no 10 km window → value and Δ both "—"
    expect(by('Fastest 10 km')).toEqual({ label: 'Fastest 10 km', a: '—', b: '20:00', delta: '—' });
    expect(by('Fastest 20 km')).toEqual({ label: 'Fastest 20 km', a: '—', b: '—', delta: '—' });
  });
});

describe('compare — per-km splits diff', () => {
  const rows = splitsDiff(r1, r2);

  it('runs to the longer ride, colouring each km by whoever was faster', () => {
    expect(rows).toHaveLength(3);
    // km 1: ride 2 quicker (190 < 200) → faster 'b', Δ negative
    expect(rows[0]).toEqual({ km: 1, a: '3:20', b: '3:10', delta: '-0:10', faster: 'b' });
    // km 2: ride 1 quicker (220 < 240) → faster 'a', Δ positive
    expect(rows[1]).toEqual({ km: 2, a: '3:40', b: '4:00', delta: '+0:20', faster: 'a' });
    // km 3: only ride 1 has it → no comparison
    expect(rows[2]).toEqual({ km: 3, a: '3:30', b: '—', delta: '—', faster: null });
  });

  it('marks an equal km as a tie (no colour)', () => {
    const tie = splitsDiff(
      ride({ stats: stats({}), splits: [split(1, 200)] }),
      ride({ stats: stats({}), splits: [split(1, 200)] }),
    );
    expect(tie[0]).toEqual({ km: 1, a: '3:20', b: '3:20', delta: '0:00', faster: null });
  });
});

describe('compare — ghost-race leader', () => {
  it('names the ride that is further along and the gap between them', () => {
    expect(leaderReadout(1000, 800)).toEqual({ leader: 'a', gap: 200 });
    expect(leaderReadout(500, 900)).toEqual({ leader: 'b', gap: 400 });
    expect(leaderReadout(300, 300)).toEqual({ leader: null, gap: 0 });
  });
});
