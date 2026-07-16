import type { D1Database } from '@cloudflare/workers-types';
import type { RideIndex, IndexSummary, RidePayload, Bests, Track } from './types';
import { SCHEMA_VERSION } from './types';
import { recomputeRecords, type WindowTimes } from './records';

// Read-side data access. Dynamic pages call these per request (issue 02), so a
// freshly-uploaded ride is visible with no rebuild. Records are always derived
// here from the current rows, never read from storage.

interface IndexRow {
  id: string;
  name: string;
  sport: string;
  start: string;
  stats: string;
  bests: string;
  polyline: string;
}

interface RideRow {
  id: string;
  name: string;
  sport: string;
  start: string;
  stats: string;
  splits: string;
  bests: string;
}

/** Build the global index (summaries newest-first + recomputed records). */
export async function loadIndex(db: D1Database): Promise<RideIndex> {
  const { results } = await db
    .prepare('SELECT id, name, sport, start, stats, bests, polyline FROM rides ORDER BY start DESC')
    .all<IndexRow>();

  const rides: IndexSummary[] = [];
  const windows = new Map<string, WindowTimes>();
  for (const r of results) {
    rides.push({
      id: r.id,
      name: r.name,
      sport: r.sport,
      start: r.start,
      stats: JSON.parse(r.stats),
      polyline: r.polyline,
    });
    const bests = JSON.parse(r.bests) as Bests;
    windows.set(r.id, {
      '5k': bests['5k']?.time ?? null,
      '10k': bests['10k']?.time ?? null,
      '20k': bests['20k']?.time ?? null,
    });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    rides,
    records: recomputeRecords(rides, windows),
  };
}

/** Full per-ride payload (joins the separate track table). Null if not found. */
export async function loadRide(db: D1Database, id: string): Promise<RidePayload | null> {
  const ride = await db
    .prepare('SELECT id, name, sport, start, stats, splits, bests FROM rides WHERE id = ?')
    .bind(id)
    .first<RideRow>();
  if (!ride) return null;

  const trackRow = await db
    .prepare('SELECT track FROM ride_tracks WHERE ride_id = ?')
    .bind(id)
    .first<{ track: string }>();
  if (!trackRow) return null;

  return {
    schemaVersion: SCHEMA_VERSION,
    id: ride.id,
    name: ride.name,
    sport: ride.sport,
    start: ride.start,
    stats: JSON.parse(ride.stats),
    splits: JSON.parse(ride.splits),
    bests: JSON.parse(ride.bests) as Bests,
    track: JSON.parse(trackRow.track) as Track,
  };
}

/** Ride count — cheap dynamic-binding proof and a landing-page total. */
export async function countRides(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM rides').first<{ n: number }>();
  return row?.n ?? 0;
}
