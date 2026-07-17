import { describe, it, expect } from 'vitest';
import type { IndexSummary, Records, RideStats } from './types';
import { encodePolyline } from './polyline';
import {
  allTimeTotals,
  availableYears,
  berlinYearMonth,
  libraryHTML,
  monthlyDistance,
  monthlyChartSVG,
  recordCards,
  recordHolderIds,
  ridesForYear,
  RECORD_LABELS,
} from './dashboard';

// The pure dashboard/library core (ticket 3b). Everything the landing page
// derives from the index lives here so it's unit-tested and shared verbatim
// between server-side render and the client-side year re-scope.

const line = encodePolyline([
  { lat: 52.5, lon: 13.4 },
  { lat: 52.51, lon: 13.41 },
]);

function stats(over: Partial<RideStats> = {}): RideStats {
  return {
    distance: 10000,
    duration: 3600,
    movingTime: 3000,
    avgMovingSpeed: 3.33,
    maxSpeed: 8,
    elevationGain: 100,
    elevationLoss: 100,
    maxGradient: 5,
    minGradient: -5,
    ...over,
  };
}

function ride(id: string, start: string, over: Partial<RideStats> = {}): IndexSummary {
  return { id, name: id, sport: 'cycling', start, stats: stats(over), polyline: line };
}

describe('berlinYearMonth', () => {
  it('reports the Berlin calendar year/month of a UTC instant', () => {
    expect(berlinYearMonth('2026-07-05T10:00:57Z')).toEqual({ year: 2026, month: 7 });
  });

  it('rolls a late-December UTC instant into the next Berlin year', () => {
    // 23:30Z on 31 Dec is 00:30 on 1 Jan in Berlin (UTC+1).
    expect(berlinYearMonth('2025-12-31T23:30:00Z')).toEqual({ year: 2026, month: 1 });
  });
});

describe('allTimeTotals', () => {
  it('sums distance, count, and moving time across every ride', () => {
    const rides = [
      ride('a', '2026-01-02T09:00:00Z', { distance: 20000, movingTime: 3600 }),
      ride('b', '2025-06-02T09:00:00Z', { distance: 5000, movingTime: 1200 }),
    ];
    expect(allTimeTotals(rides)).toEqual({ distance: 25000, count: 2, movingTime: 4800 });
  });

  it('is all zeros for an empty index', () => {
    expect(allTimeTotals([])).toEqual({ distance: 0, count: 0, movingTime: 0 });
  });
});

describe('availableYears', () => {
  it('returns unique Berlin years, newest first', () => {
    const rides = [
      ride('a', '2026-03-01T09:00:00Z'),
      ride('b', '2024-03-01T09:00:00Z'),
      ride('c', '2026-08-01T09:00:00Z'),
    ];
    expect(availableYears(rides)).toEqual([2026, 2024]);
  });
});

describe('ridesForYear', () => {
  const rides = [
    ride('new', '2026-05-01T09:00:00Z'),
    ride('old', '2025-05-01T09:00:00Z'),
  ];

  it('keeps only the selected Berlin year, order preserved', () => {
    expect(ridesForYear(rides, 2026).map((r) => r.id)).toEqual(['new']);
  });

  it('returns every ride for the "all" filter', () => {
    expect(ridesForYear(rides, 'all').map((r) => r.id)).toEqual(['new', 'old']);
  });
});

describe('monthlyDistance', () => {
  it('buckets a year into 12 months of metres by Berlin month', () => {
    const rides = [
      ride('jan', '2026-01-10T09:00:00Z', { distance: 3000 }),
      ride('jan2', '2026-01-20T09:00:00Z', { distance: 2000 }),
      ride('jul', '2026-07-10T09:00:00Z', { distance: 8000 }),
      ride('prev', '2025-07-10T09:00:00Z', { distance: 9999 }), // excluded — different year
    ];
    const m = monthlyDistance(rides, 2026);
    expect(m).toHaveLength(12);
    expect(m[0]).toBe(5000); // January
    expect(m[6]).toBe(8000); // July
    expect(m[3]).toBe(0); // April empty
  });

  it('aggregates across all years by calendar month for "all"', () => {
    const rides = [
      ride('a', '2026-07-10T09:00:00Z', { distance: 8000 }),
      ride('b', '2025-07-10T09:00:00Z', { distance: 2000 }),
    ];
    expect(monthlyDistance(rides, 'all')[6]).toBe(10000);
  });
});

describe('recordHolderIds', () => {
  it('collects every ride id that holds at least one record', () => {
    const records: Records = {
      longestDistance: { rideId: 'a', value: 1 },
      mostElevationGain: { rideId: 'b', value: 1 },
      fastest5k: { rideId: 'a', value: 1 },
      fastest10k: null,
      fastest20k: null,
      fastestAvgSpeed: null,
      maxSpeed: { rideId: 'c', value: 1 },
      longestMovingTime: null,
    };
    expect(recordHolderIds(records)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('is empty when there are no records', () => {
    const empty = Object.fromEntries(
      Object.keys(RECORD_LABELS).map((k) => [k, null]),
    ) as unknown as Records;
    expect(recordHolderIds(empty).size).toBe(0);
  });
});

describe('recordCards', () => {
  const records: Records = {
    longestDistance: { rideId: 'r1', value: 57900 },
    mostElevationGain: { rideId: 'r2', value: 1241 },
    fastest5k: { rideId: 'r3', value: 900 },
    fastest10k: null,
    fastest20k: null,
    fastestAvgSpeed: { rideId: 'r4', value: 8.333 },
    maxSpeed: { rideId: 'r5', value: 12.5 },
    longestMovingTime: { rideId: 'r6', value: 12327 },
  };

  it('formats each category with its unit and links to the holder', () => {
    const cards = recordCards(records);
    const by = Object.fromEntries(cards.map((c) => [c.key, c]));
    expect(by.longestDistance.value).toBe('57,9 km');
    expect(by.longestDistance.rideId).toBe('r1');
    expect(by.mostElevationGain.value).toBe('↑ 1.241 m');
    expect(by.fastest5k.value).toBe('15:00');
    expect(by.fastestAvgSpeed.value).toBe('30,0 km/h');
    expect(by.maxSpeed.value).toBe('45,0 km/h');
    expect(by.longestMovingTime.value).toBe('3:25:27');
  });

  it('renders all 8 categories with a null value/holder when unset', () => {
    const cards = recordCards(records);
    expect(cards).toHaveLength(8);
    const f10 = cards.find((c) => c.key === 'fastest10k')!;
    expect(f10.value).toBeNull();
    expect(f10.rideId).toBeNull();
    expect(f10.label).toBe('Fastest 10 km');
  });
});

describe('libraryHTML', () => {
  const rides = [
    ride('new', '2026-05-01T09:00:00Z'),
    ride('old', '2025-05-01T09:00:00Z'),
  ];

  it('renders year-scoped cards with a trophy on record holders', () => {
    const html = libraryHTML(rides, 2026, new Set(['new']));
    expect((html.match(/ride-card/g) ?? []).length).toBe(1); // only the 2026 ride
    expect(html).toContain('href="/rides/new"');
    expect(html).toContain('trophy'); // 'new' holds a record
    expect(html).not.toContain('href="/rides/old"');
  });

  it('shows the empty note when the year has no rides', () => {
    expect(libraryHTML(rides, 2024, new Set())).toContain('empty-note');
    expect(libraryHTML(rides, 2024, new Set())).not.toContain('ride-card');
  });
});

describe('monthlyChartSVG', () => {
  it('draws 12 labelled bars with per-month tooltips', () => {
    const svg = monthlyChartSVG([1000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2000]);
    expect(svg.startsWith('<svg')).toBe(true);
    expect((svg.match(/<rect/g) ?? []).length).toBe(12);
    expect(svg).toContain('>Jan</text>');
    expect(svg).toContain('>Dec</text>');
    expect(svg).toContain('Dec: 2,0 km'); // tooltip carries the formatted value
  });

  it('draws flat bars without dividing by zero when every month is empty', () => {
    const svg = monthlyChartSVG(new Array(12).fill(0));
    expect(svg).toContain('height="0"');
    expect(svg).not.toContain('NaN');
  });
});
