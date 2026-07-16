-- Initial D1 schema — the project's migrations/0001_init.sql.
-- Mechanical translation of the locked data model (issue 03) into the D1
-- architecture (issue 02): the JSON payload shapes are the contract and are
-- stored verbatim in JSON columns. Records are NOT stored — they are
-- recomputed from ride summaries (issue 03), so they can never drift.
--
-- Idempotent: the schema was already applied remotely during provisioning
-- (issue 11) before the migrations system existed, so the first
-- `migrations apply` runs this against a DB that already has the tables.
-- IF NOT EXISTS makes re-application a no-op.

CREATE TABLE IF NOT EXISTS rides (
  id         TEXT PRIMARY KEY,  -- YYYY-MM-DD-<slug>, "-2" suffix on collision (issue 03)
  name       TEXT NOT NULL,     -- raw Komoot <name>
  sport      TEXT NOT NULL,     -- raw Komoot <type>
  start      TEXT NOT NULL,     -- first-trackpoint timestamp, UTC ISO (duplicate key, issue 06)
  stats      TEXT NOT NULL,     -- JSON stats block (same shape as index summaries)
  splits     TEXT NOT NULL,     -- JSON per-km splits array
  bests      TEXT NOT NULL,     -- JSON rolling 5/10/20 km bests
  polyline   TEXT NOT NULL,     -- Douglas-Peucker 15 m encoded polyline, precision 5
  gpx_key    TEXT NOT NULL,     -- R2 object key of the raw GPX
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Same start timestamp = same ride: re-upload replaces in place (issue 06).
CREATE UNIQUE INDEX IF NOT EXISTS rides_start_unique ON rides (start);

-- Full-resolution columnar track, fetched by the detail page only.
-- Separate table so library/dashboard queries over rides never read
-- the ~200 KB track rows.
CREATE TABLE IF NOT EXISTS ride_tracks (
  ride_id TEXT PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  track   TEXT NOT NULL  -- JSON columnar arrays: lat/lon/ele/t/dist/speed
);
