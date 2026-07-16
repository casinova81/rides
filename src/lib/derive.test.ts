import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { deriveRide, slugify, rideId, resolveRideId, summaryOf } from './derive';
import { lineGpx, makeGpx, metersToLon } from '../../test/gpx-fixtures';

const airportGpx = readFileSync(
  fileURLToPath(new URL('../../airport.gpx', import.meta.url)),
  'utf8',
);

describe('deriveRide — airport.gpx contract numbers', () => {
  const { payload, polyline } = deriveRide(airportGpx);

  it('identifies the ride from Komoot metadata', () => {
    expect(payload.name).toBe('Berliner Mauerweg und Flughafen-Schleife');
    expect(payload.sport).toBe('mtb_easy');
    expect(payload.start).toBe('2026-07-05T10:00:57Z');
    expect(payload.id).toBe('2026-07-05-berliner-mauerweg-und-flughafen-schleife');
  });

  it('matches the prototype-validated stats', () => {
    expect((payload.stats.distance / 1000).toFixed(1)).toBe('57.9');
    expect(payload.stats.movingTime).toBe(12327); // 3:25:27
    expect(payload.stats.duration).toBe(12327);
    expect(payload.stats.elevationGain).toBe(97); // ↑97 m
  });

  it('produces per-km splits with a real-length final partial', () => {
    expect(payload.splits.length).toBe(58);
    const last = payload.splits[payload.splits.length - 1];
    expect(last.km).toBe(58);
    expect(last.len).toBeLessThan(1000); // partial km keeps its true length
    expect(last.len).toBeGreaterThan(0);
    // all full splits are ~1 km
    expect(payload.splits[0].len).toBeGreaterThan(900);
  });

  it('finds the fastest 5/10/20 km windows', () => {
    expect(payload.bests['5k']?.time).toBe(550);
    expect(payload.bests['10k']?.time).toBe(1247);
    expect(payload.bests['20k']?.time).toBe(3182);
  });

  it('stores a columnar track and a compact polyline', () => {
    const t = payload.track;
    expect(t.lat.length).toBe(4258);
    expect(t.lat.length).toBe(t.lon.length);
    expect(t.lat.length).toBe(t.speed.length);
    expect(t.t[0]).toBe(0);
    expect(polyline.length).toBeGreaterThan(0);
    expect(polyline.length).toBeLessThan(4000); // DP-15 m keeps the index tiny
  });

  it('projects to an index summary sharing the identical stats block', () => {
    const s = summaryOf(payload, polyline);
    expect(s.stats).toEqual(payload.stats);
    expect(s.polyline).toBe(polyline);
    expect(s.id).toBe(payload.id);
  });
});

describe('deriveRide — locked rules on synthetic fixtures', () => {
  it('excludes stopped time (smoothed speed < 2 km/h)', () => {
    // fast → long stationary block (the 5-pt smoother must not bridge it) → fast
    const fast = Array.from({ length: 5 }, (_, i) => ({ m: i * 100, s: i * 10 }));
    const stopped = Array.from({ length: 12 }, (_, i) => ({ m: 400, s: 70 + i * 30 }));
    const resume = Array.from({ length: 5 }, (_, i) => ({ m: 500 + i * 100, s: 440 + i * 10 }));
    const withStop = deriveRide(lineGpx([...fast, ...stopped, ...resume]));
    // a real multi-minute stop is excluded from moving time
    expect(withStop.payload.stats.duration - withStop.payload.stats.movingTime).toBeGreaterThan(
      150,
    );

    // a ride with no stops: moving time equals elapsed time
    const noStop = deriveRide(
      lineGpx(Array.from({ length: 20 }, (_, i) => ({ m: i * 100, s: i * 10 }))),
    );
    expect(noStop.payload.stats.movingTime).toBe(noStop.payload.stats.duration);
  });

  it('banks elevation only past the 2 m hysteresis threshold', () => {
    // sub-2 m oscillation → no gain
    const flat = deriveRide(
      lineGpx(
        Array.from({ length: 20 }, (_, i) => ({ m: i * 100, s: i * 10, ele: i % 2 ? 101 : 100 })),
      ),
    );
    expect(flat.payload.stats.elevationGain).toBe(0);
    expect(flat.payload.stats.elevationLoss).toBe(0);

    // a clean 20 m climb → most of it banked (last <2 m residual may drop)
    const climb = deriveRide(
      lineGpx(Array.from({ length: 21 }, (_, i) => ({ m: i * 100, s: i * 10, ele: 100 + i }))),
    );
    expect(climb.payload.stats.elevationGain).toBeGreaterThanOrEqual(14);
    expect(climb.payload.stats.elevationGain).toBeLessThanOrEqual(20);
    expect(climb.payload.stats.elevationLoss).toBe(0);
  });

  it('keeps the final partial km at its real length', () => {
    const ride = deriveRide(
      lineGpx(Array.from({ length: 26 }, (_, i) => ({ m: i * 100, s: i * 20 }))), // 2500 m
    );
    expect(ride.payload.splits.length).toBe(3);
    expect(ride.payload.splits[2].len).toBeGreaterThan(400);
    expect(ride.payload.splits[2].len).toBeLessThan(600);
  });

  it('returns null best windows when the ride is shorter than the window', () => {
    // 7 km ride → 5k set, 10k and 20k null
    const ride = deriveRide(
      lineGpx(Array.from({ length: 71 }, (_, i) => ({ m: i * 100, s: i * 10 }))),
    );
    expect(ride.payload.bests['5k']).not.toBeNull();
    expect(ride.payload.bests['10k']).toBeNull();
    expect(ride.payload.bests['20k']).toBeNull();
  });

  it('derives max speed from unrounded timestamps (rounding would explode it)', () => {
    // 5 m every 0.4 s = 12.5 m/s. Rounded to whole seconds, many dt collapse to 0.
    const ride = deriveRide(
      lineGpx(Array.from({ length: 20 }, (_, i) => ({ m: i * 5, s: i * 0.4 }))),
    );
    expect(Number.isFinite(ride.payload.stats.maxSpeed)).toBe(true);
    expect(ride.payload.stats.maxSpeed).toBeGreaterThan(10);
    expect(ride.payload.stats.maxSpeed).toBeLessThan(15); // ~12.5, not astronomical
  });
});

describe('ride ID + slug collision handling', () => {
  it('slugifies German ride names', () => {
    expect(slugify('Berliner Mauerweg und Flughafen-Schleife')).toBe(
      'berliner-mauerweg-und-flughafen-schleife',
    );
    expect(slugify('Tour über die Höhen')).toBe('tour-uber-die-hohen');
    expect(slugify('Straße 17!')).toBe('strasse-17');
  });

  it('builds the ID from the Berlin date and the slug', () => {
    const start = new Date('2026-07-05T10:00:57Z');
    expect(rideId('Berliner Mauerweg und Flughafen-Schleife', start)).toBe(
      '2026-07-05-berliner-mauerweg-und-flughafen-schleife',
    );
  });

  it('appends -2 (then -3) on ID collision', () => {
    const base = '2026-07-05-airport';
    expect(resolveRideId(base, [])).toBe(base);
    expect(resolveRideId(base, [base])).toBe(`${base}-2`);
    expect(resolveRideId(base, [base, `${base}-2`])).toBe(`${base}-3`);
  });

  it('two same-date same-name rides collide on the base ID', () => {
    const a = deriveRide(lineGpx([{ m: 0, s: 0 }, { m: 100, s: 10 }], { name: 'Feierabendrunde' }));
    const b = deriveRide(
      makeGpx(
        [
          { lat: 0, lon: metersToLon(0), ele: 0, t: 5000 },
          { lat: 0, lon: metersToLon(100), ele: 0, t: 5010 },
        ],
        { name: 'Feierabendrunde' },
      ),
    );
    expect(a.payload.id).toBe(b.payload.id); // same base
    expect(resolveRideId(b.payload.id, [a.payload.id])).toBe(`${a.payload.id}-2`);
  });
});
