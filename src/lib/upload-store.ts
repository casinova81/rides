import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { RidePayload, RideStats, Track, RecordKey } from './types';
import { SCHEMA_VERSION, RECORD_KEYS } from './types';
import { resolveRideId } from './derive';
import { loadIndex } from './db';

// Worker-side upload storage (issue 06). The browser has already parsed the GPX
// and derived the payload (issue 02); the Worker only validates the shape and
// stores it: raw GPX → R2, rows → D1. Duplicate handling keys off the
// first-trackpoint timestamp (`payload.start`), never the id. Records are never
// stored — every consumer recomputes them from the index (issue 03), so a
// replace or delete can't strand a stale leaderboard.

/** Bindings this module touches — a structural subset of the Worker env. */
export interface StoreEnv {
  DB: D1Database;
  GPX_BUCKET: R2Bucket;
}

/** The single-ride upload contract the client POSTs. */
export interface UploadBody {
  gpxText: string;
  payload: RidePayload;
  polyline: string;
}

export interface UploadResult {
  outcome: 'saved' | 'overwritten';
  id: string; // final stored id (may carry a -2 suffix, or differ from the old id on overwrite)
  overwrote?: { id: string; name: string };
  heldRecords: RecordKey[]; // record categories this ride holds now (drives the trophy badge, issue 04)
  brokenRecords: RecordKey[]; // subset it did NOT hold before (drives the ephemeral callout, issue 06)
}

/** Thrown for a malformed payload — the API route maps it to a 400. */
export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadValidationError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function reqString(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new UploadValidationError(`${field} must be a non-empty string`);
  }
  return v;
}

function reqNumber(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new UploadValidationError(`${field} must be a finite number`);
  }
  return v;
}

const STAT_FIELDS: (keyof RideStats)[] = [
  'distance',
  'duration',
  'movingTime',
  'avgMovingSpeed',
  'maxSpeed',
  'elevationGain',
  'elevationLoss',
  'maxGradient',
  'minGradient',
];

const TRACK_COLS: (keyof Track)[] = ['lat', 'lon', 'ele', 't', 'dist', 'speed'];

/**
 * Validate an untrusted request body into an `UploadBody`, or throw
 * `UploadValidationError`. Structural only — the client is the single trusted
 * source of the numbers; this guards against corrupt/incomplete posts, not fraud.
 */
export function validateUploadBody(raw: unknown): UploadBody {
  if (!isObj(raw)) throw new UploadValidationError('body must be an object');

  const gpxText = reqString(raw.gpxText, 'gpxText');
  const polyline = reqString(raw.polyline, 'polyline');

  const p = raw.payload;
  if (!isObj(p)) throw new UploadValidationError('payload must be an object');
  if (p.schemaVersion !== SCHEMA_VERSION) {
    throw new UploadValidationError(`payload.schemaVersion must be ${SCHEMA_VERSION}`);
  }
  reqString(p.id, 'payload.id');
  reqString(p.name, 'payload.name');
  if (typeof p.sport !== 'string') throw new UploadValidationError('payload.sport must be a string');
  const start = reqString(p.start, 'payload.start');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(start)) {
    throw new UploadValidationError('payload.start must be a UTC ISO instant');
  }

  if (!isObj(p.stats)) throw new UploadValidationError('payload.stats must be an object');
  for (const f of STAT_FIELDS) reqNumber(p.stats[f], `payload.stats.${f}`);

  if (!Array.isArray(p.splits)) throw new UploadValidationError('payload.splits must be an array');
  if (!isObj(p.bests)) throw new UploadValidationError('payload.bests must be an object');

  if (!isObj(p.track)) throw new UploadValidationError('payload.track must be an object');
  const track = p.track;
  const n = Array.isArray(track.lat) ? track.lat.length : -1;
  if (n < 2) throw new UploadValidationError('payload.track must have at least 2 points');
  for (const c of TRACK_COLS) {
    const col = track[c];
    if (!Array.isArray(col) || col.length !== n) {
      throw new UploadValidationError(`payload.track.${c} must be an array of length ${n}`);
    }
  }

  return { gpxText, payload: p as unknown as RidePayload, polyline };
}

interface ExistingRow {
  id: string;
  name: string;
  start: string;
  gpx_key: string;
}

/**
 * Persist one derived ride. On an exact `start` match, the existing ride is
 * replaced in place (old rows + old R2 object removed, new id honoured); on a
 * base-id collision without a start match, a `-2` suffix is appended; otherwise
 * it is a fresh ride. Returns the outcome plus the records this ride just broke.
 */
export async function storeRide(env: StoreEnv, body: UploadBody): Promise<UploadResult> {
  const { payload, polyline, gpxText } = body;
  const baseId = payload.id;

  const { results: rows } = await env.DB.prepare(
    'SELECT id, name, start, gpx_key FROM rides',
  ).all<ExistingRow>();
  const existingIds = new Set(rows.map((r) => r.id));
  const startMatch = rows.find((r) => r.start === payload.start);

  let outcome: UploadResult['outcome'];
  let finalId: string;
  let overwrote: UploadResult['overwrote'];
  if (startMatch) {
    outcome = 'overwritten';
    overwrote = { id: startMatch.id, name: startMatch.name };
    // Resolve the (possibly renamed) id against every ride except the one we replace.
    const others = new Set([...existingIds].filter((id) => id !== startMatch.id));
    finalId = resolveRideId(baseId, others);
  } else {
    outcome = 'saved';
    finalId = resolveRideId(baseId, existingIds);
  }

  const before = (await loadIndex(env.DB)).records;

  const gpxKey = `${finalId}.gpx`;
  await env.GPX_BUCKET.put(gpxKey, gpxText);

  const statements = [];
  if (startMatch) {
    // ride_tracks cascades on the rides delete.
    statements.push(env.DB.prepare('DELETE FROM rides WHERE id = ?').bind(startMatch.id));
  }
  statements.push(
    env.DB.prepare(
      'INSERT INTO rides (id, name, sport, start, stats, splits, bests, polyline, gpx_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      finalId,
      payload.name,
      payload.sport,
      payload.start,
      JSON.stringify(payload.stats),
      JSON.stringify(payload.splits),
      JSON.stringify(payload.bests),
      polyline,
      gpxKey,
    ),
    env.DB.prepare('INSERT INTO ride_tracks (ride_id, track) VALUES (?, ?)').bind(
      finalId,
      JSON.stringify(payload.track),
    ),
  );
  await env.DB.batch(statements);

  // Only after the rows are safely written do we drop the old GPX object.
  if (startMatch && startMatch.gpx_key !== gpxKey) {
    await env.GPX_BUCKET.delete(startMatch.gpx_key);
  }

  const after = (await loadIndex(env.DB)).records;
  const overwroteId = startMatch?.id;
  // Records the ride holds now — the trophy badge (issue 04) is "currently holds
  // a record", independent of whether this upload is what set it.
  const heldRecords = RECORD_KEYS.filter((k) => after[k]?.rideId === finalId);
  // The subset it did NOT hold before — the ephemeral "new record" callout
  // (issue 06). A record the replaced ride already held isn't newly broken.
  const brokenRecords = heldRecords.filter((k) => {
    const holderBefore = before[k]?.rideId;
    if (holderBefore === finalId) return false;
    if (overwroteId !== undefined && holderBefore === overwroteId) return false;
    return true;
  });

  return { outcome, id: finalId, overwrote, heldRecords, brokenRecords };
}
