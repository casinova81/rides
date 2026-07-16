import { describe, it, expect } from 'vitest';
import { rideCardHTML } from './ride-card';
import type { IndexSummary } from './types';
import { encodePolyline } from './polyline';

// The shared ride card (issue 04), extracted in ticket 3a and reused by the
// upload results screen and the dashboard/library. Pure HTML string so it works
// from an Astro page and from client-side JS alike.

const summary: IndexSummary = {
  id: '2026-07-05-berliner-mauerweg-und-flughafen-schleife',
  name: 'Berliner Mauerweg & Flughafen-Schleife',
  sport: 'mtb_easy',
  start: '2026-07-05T10:00:57Z',
  stats: {
    distance: 57900,
    duration: 12327,
    movingTime: 12327,
    avgMovingSpeed: 4.7,
    maxSpeed: 11.4,
    elevationGain: 97,
    elevationLoss: 118,
    maxGradient: 6.4,
    minGradient: -7.1,
  },
  polyline: encodePolyline([
    { lat: 52.5, lon: 13.4 },
    { lat: 52.51, lon: 13.41 },
  ]),
};

describe('rideCardHTML', () => {
  it('links to the ride detail page and shows name, date, and key stats', () => {
    const html = rideCardHTML(summary);
    expect(html).toContain('href="/rides/2026-07-05-berliner-mauerweg-und-flughafen-schleife"');
    expect(html).toContain('05.07.2026');
    expect(html).toContain('57,9 km'); // distance
    expect(html).toContain('97 m'); // elevation gain
    expect(html).toContain('<svg'); // route thumbnail
  });

  it('escapes the ride name (raw Komoot text, never trusted as HTML)', () => {
    const html = rideCardHTML(summary);
    expect(html).toContain('Berliner Mauerweg &amp; Flughafen-Schleife');
    expect(html).not.toContain('Mauerweg & Flughafen');
  });

  it('adds a trophy badge only when the ride holds a record', () => {
    expect(rideCardHTML(summary, { holdsRecord: true })).toContain('trophy');
    expect(rideCardHTML(summary, { holdsRecord: false })).not.toContain('trophy');
  });
});
