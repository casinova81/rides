import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { storeRide, validateUploadBody, UploadValidationError } from '../../src/lib/upload-store';
import { deriveRide } from '../../src/lib/derive';
import { loadIndex, loadRide } from '../../src/lib/db';
import { lineGpx } from '../gpx-fixtures';
import type { UploadBody } from '../../src/lib/upload-store';

// Worker-side upload storage (issue 06). Runs against simulated Miniflare D1/R2.
// The single-ride Worker contract: validate → R2 (raw GPX) + D1 (rows) → dedup by
// first-trackpoint start → records self-heal from summaries at read time.

/** A ~25 km constant-speed ride; `startS` offsets the first-trackpoint time. */
function bigRide(name: string, opts: { startS?: number; ele?: number } = {}): string {
  const { startS = 0, ele = 0 } = opts;
  const distM = 25000;
  const durS = 3600;
  const step = 500;
  const n = distM / step;
  const specs = [];
  for (let i = 0; i <= n; i++) {
    specs.push({ m: i * step, s: startS + (i / n) * durS, ele });
  }
  return lineGpx(specs, { name });
}

function body(gpxText: string): UploadBody {
  const { payload, polyline } = deriveRide(gpxText);
  return { gpxText, payload, polyline };
}

async function clearBucket() {
  const { objects } = await env.GPX_BUCKET.list();
  await Promise.all(objects.map((o) => env.GPX_BUCKET.delete(o.key)));
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM ride_tracks');
  await env.DB.exec('DELETE FROM rides');
  await clearBucket();
});

describe('storeRide — new ride', () => {
  it('stores raw GPX in R2 and derived data in D1, immediately readable', async () => {
    const b = body(bigRide('Morning Loop'));
    const result = await storeRide(env, b);

    expect(result.outcome).toBe('saved');
    expect(result.id).toBe(b.payload.id);

    // D1: ride + track rows present and readable with no rebuild.
    const ride = await loadRide(env.DB, result.id);
    expect(ride).not.toBeNull();
    expect(ride!.name).toBe('Morning Loop');
    expect(ride!.track.lat.length).toBeGreaterThan(2);

    // R2: raw GPX stored under the ride's key.
    const obj = await env.GPX_BUCKET.get(`${result.id}.gpx`);
    expect(obj).not.toBeNull();
    expect(await obj!.text()).toBe(b.gpxText);

    const index = await loadIndex(env.DB);
    expect(index.rides.map((r) => r.id)).toContain(result.id);
  });
});

describe('storeRide — duplicate handling by first-trackpoint timestamp', () => {
  it('replaces the ride on an exact start match, even when the name (and id) changed', async () => {
    const first = body(bigRide('Morning Loop')); // start = 2026-01-01T12:00:00Z
    await storeRide(env, first);

    // Same start timestamp, renamed in Komoot → different id, same ride.
    const renamed = body(bigRide('Evening Loop'));
    expect(renamed.payload.start).toBe(first.payload.start);
    expect(renamed.payload.id).not.toBe(first.payload.id);

    const result = await storeRide(env, renamed);
    expect(result.outcome).toBe('overwritten');
    expect(result.overwrote?.id).toBe(first.payload.id);
    expect(result.id).toBe(renamed.payload.id);

    // Old rows gone (incl. the cascaded track row), new rows present, one ride total.
    expect(await loadRide(env.DB, first.payload.id)).toBeNull();
    expect(await loadRide(env.DB, renamed.payload.id)).not.toBeNull();
    const orphanTrack = await env.DB.prepare('SELECT ride_id FROM ride_tracks WHERE ride_id = ?')
      .bind(first.payload.id)
      .first();
    expect(orphanTrack).toBeNull();
    const index = await loadIndex(env.DB);
    expect(index.rides.length).toBe(1);

    // Old R2 object cleaned up; new one present.
    expect(await env.GPX_BUCKET.get(`${first.payload.id}.gpx`)).toBeNull();
    expect(await env.GPX_BUCKET.get(`${renamed.payload.id}.gpx`)).not.toBeNull();

    // Trophy vs. callout (issues 04/06): the ride still holds its records, but a
    // same-ride re-upload breaks nothing new — so the trophy shows, the callout doesn't.
    expect(result.heldRecords.length).toBeGreaterThan(0);
    expect(result.brokenRecords).toEqual([]);
  });

  it('keeps a same-date/same-name ride with a different start via a -2 suffix', async () => {
    const first = body(bigRide('Loop')); // start 12:00:00Z
    await storeRide(env, first);

    const second = body(bigRide('Loop', { startS: 7200 })); // start 14:00:00Z, same date+slug
    expect(second.payload.id).toBe(first.payload.id); // base ids collide
    expect(second.payload.start).not.toBe(first.payload.start);

    const result = await storeRide(env, second);
    expect(result.outcome).toBe('saved');
    expect(result.id).toBe(`${first.payload.id}-2`);

    const index = await loadIndex(env.DB);
    expect(index.rides.length).toBe(2);
    expect(index.rides.map((r) => r.id).sort()).toEqual(
      [first.payload.id, `${first.payload.id}-2`].sort(),
    );
  });
});

describe('storeRide — records self-heal from summaries', () => {
  it('recomputes record holders after each change (never incrementally)', async () => {
    const slow = body(bigRide('Slow Loop')); // 25 km in 1 h
    const r1 = await storeRide(env, slow);
    // First ride holds every applicable record and the diff reports them.
    expect(r1.brokenRecords).toContain('longestDistance');
    expect(r1.brokenRecords).toContain('fastest20k');

    let index = await loadIndex(env.DB);
    expect(index.records.fastest20k?.rideId).toBe(slow.payload.id);

    // A faster ride over the same distance should steal the speed/window records.
    const fastGpx = bigRide('Fast Loop', { startS: 100000 });
    const fast = body(fastGpx);
    // Halve its times to make it genuinely faster.
    fast.payload.track.t = fast.payload.track.t.map((t) => Math.round(t / 2));
    fast.payload.bests['20k'] = {
      time: Math.round((slow.payload.bests['20k']!.time as number) / 2),
      startDist: 0,
    };
    fast.payload.stats.movingTime = Math.round(slow.payload.stats.movingTime / 2);
    fast.payload.stats.avgMovingSpeed = slow.payload.stats.avgMovingSpeed * 2;
    fast.payload.stats.maxSpeed = slow.payload.stats.maxSpeed * 2;

    const r2 = await storeRide(env, fast);
    expect(r2.brokenRecords).toContain('fastest20k');
    expect(r2.brokenRecords).toContain('maxSpeed');

    index = await loadIndex(env.DB);
    expect(index.records.fastest20k?.rideId).toBe(fast.payload.id);

    // Deleting the fast ride heals records back to the slow one (recompute, not increment).
    await env.DB.prepare('DELETE FROM rides WHERE id = ?').bind(fast.payload.id).run();
    index = await loadIndex(env.DB);
    expect(index.records.fastest20k?.rideId).toBe(slow.payload.id);
  });
});

describe('validateUploadBody — malformed payloads are rejected', () => {
  const good = body(bigRide('Valid Ride'));

  it('accepts a well-formed body', () => {
    expect(() => validateUploadBody(good)).not.toThrow();
  });

  it('rejects a missing gpxText', () => {
    expect(() => validateUploadBody({ ...good, gpxText: '' })).toThrow(UploadValidationError);
  });

  it('rejects a wrong schema version', () => {
    const bad = { ...good, payload: { ...good.payload, schemaVersion: 99 } };
    expect(() => validateUploadBody(bad)).toThrow(UploadValidationError);
  });

  it('rejects a track with mismatched column lengths', () => {
    const bad = {
      ...good,
      payload: { ...good.payload, track: { ...good.payload.track, lat: [1, 2, 3] } },
    };
    expect(() => validateUploadBody(bad)).toThrow(UploadValidationError);
  });

  it('rejects a non-object body', () => {
    expect(() => validateUploadBody(null)).toThrow(UploadValidationError);
    expect(() => validateUploadBody('nope')).toThrow(UploadValidationError);
  });
});
