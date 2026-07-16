// The payload contract (issue 03). Every producer (upload derivation) and every
// consumer (pages, endpoints, tests) codes against these shapes. Values are SI
// (meters, seconds, m/s); the formatting layer (format.ts) renders them.

export const SCHEMA_VERSION = 1;

/** Summary stats block — identical shape on a per-ride payload and an index summary. */
export interface RideStats {
  distance: number; // m, integer
  duration: number; // s, elapsed (last point time)
  movingTime: number; // s
  avgMovingSpeed: number; // m/s = distance / movingTime
  maxSpeed: number; // m/s, from the smoothed series
  elevationGain: number; // m
  elevationLoss: number; // m
  maxGradient: number; // %, over a 100 m window
  minGradient: number; // %
}

export interface Split {
  km: number; // 1-based index
  len: number; // m — real length (final partial km keeps its true length)
  time: number; // s
  avgSpeed: number; // m/s
  eleDelta: number; // m, signed
  avgGradient: number; // %
}

/** A fastest contiguous window of a fixed length; null when the ride is shorter. */
export interface Best {
  time: number; // s
  startDist: number; // m — distance at the window start
}

export interface Bests {
  '5k': Best | null;
  '10k': Best | null;
  '20k': Best | null;
}

/** Columnar parallel arrays, one entry per trackpoint. Consumers index straight in. */
export interface Track {
  lat: number[]; // 6 decimals
  lon: number[]; // 6 decimals
  ele: number[]; // m, smoothed, 1 decimal
  t: number[]; // s since start, integer
  dist: number[]; // cumulative m, integer
  speed: number[]; // m/s, smoothed, 2 decimals
}

/** Per-ride payload — `rides/<id>.json` equivalent, fetched by the detail page only. */
export interface RidePayload {
  schemaVersion: number;
  id: string; // YYYY-MM-DD-<slug>, "-2" on collision
  name: string; // raw Komoot <name>
  sport: string; // raw Komoot <type>
  start: string; // UTC ISO
  stats: RideStats;
  splits: Split[];
  bests: Bests;
  track: Track;
}

/** One ride's entry in the global index — everything the library/dashboard/heatmap needs. */
export interface IndexSummary {
  id: string;
  name: string;
  sport: string;
  start: string;
  stats: RideStats;
  polyline: string; // Douglas-Peucker 15 m, encoded polyline precision 5
}

export interface RecordEntry {
  rideId: string;
  value: number;
}

/** The 8 record categories (issue 03). */
export interface Records {
  longestDistance: RecordEntry | null; // m
  mostElevationGain: RecordEntry | null; // m
  fastest5k: RecordEntry | null; // s
  fastest10k: RecordEntry | null; // s
  fastest20k: RecordEntry | null; // s
  fastestAvgSpeed: RecordEntry | null; // m/s, rides ≥ 20 km
  maxSpeed: RecordEntry | null; // m/s, smoothed
  longestMovingTime: RecordEntry | null; // s
}

/** The global index — one fetch renders library, dashboard, records, heatmap. */
export interface RideIndex {
  schemaVersion: number;
  rides: IndexSummary[]; // newest first
  records: Records;
}

/** A single interpolated pose from the playback core, crossing the MapView seam (issue 09). */
export interface RidePose {
  lngLat: [number, number];
  elevation: number; // m
  bearing: number; // degrees, 0..360
  distance: number; // m along track
  time: number; // s since start
}

export const RECORD_KEYS = [
  'longestDistance',
  'mostElevationGain',
  'fastest5k',
  'fastest10k',
  'fastest20k',
  'fastestAvgSpeed',
  'maxSpeed',
  'longestMovingTime',
] as const;

export type RecordKey = (typeof RECORD_KEYS)[number];
