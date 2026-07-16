# Ride stats definitions & derived data model

Type: grilling
Status: resolved

## Question

What exactly does every statistic mean, and what is the derived per-ride data schema?

Decide with Carsten (via /grilling + /domain-modeling):

- **Moving time**: speed threshold below which time counts as stopped; smoothing window.
- **Elevation gain/loss**: Komoot elevation is noisy/stepped (sample file repeats identical values) — smoothing/threshold algorithm so climbing numbers are believable.
- **Splits**: per-km splits? fastest rolling 10 km? what granularity.
- **Personal records**: which categories (longest ride, most climbing, fastest avg, fastest N km…).
- **Units & locale**: metric assumed; date/number formatting (German locale?).
- **Derived ride schema**: the JSON shape stored per ride (summary stats + simplified track + full-resolution track for playback) and the aggregate schema feeding dashboard/records/heatmap.

Record the resulting schema as the ticket's answer; it becomes the contract every UI ticket builds on.

## Answer

Resolved 2026-07-16 via grilling with Carsten. All values below are locked; this is the contract every UI ticket builds on.

### Stat definitions

- **Speed smoothing**: all speed-derived values use a 5-point rolling average (~10 s at Komoot's 2–3 s sampling) over point-to-point speeds.
- **Moving time**: a point counts as *stopped* when its smoothed speed is below **2 km/h**. `movingTime` = sum of segment durations between consecutive moving points.
- **Average moving speed**: `distance / movingTime`. **Max speed**: max of the smoothed speed series (never raw point-to-point).
- **Elevation gain/loss**: smooth elevation with a 5-point rolling average, then accumulate with **2 m hysteresis** — a climb/descent is only banked once cumulative change since the last turning point exceeds 2 m. (Komoot elevation is DEM-interpolated: plateaus + millimeter-precision ramps; naive delta-summing inflates gain.)
- **Gradients**: computed over a **100 m rolling distance window** on the smoothed elevation, never point-to-point. Summary stores max uphill and max downhill gradient; splits store per-km average; the gradient *curve* is derived client-side from `track.ele`/`track.dist` with the same window (no seventh track array).
- **Splits**: per-km table (time, avg speed, elevation delta, avg gradient); the final partial km carries its real length. Plus **fastest rolling windows at 5, 10, 20 km** — fastest contiguous stretch of that length, `null` when the ride is shorter.
- **Personal records** (8 categories): longest distance, most elevation gain, fastest 5 km, fastest 10 km, fastest 20 km, fastest average moving speed (**rides ≥ 20 km only**), max speed (smoothed), longest moving time. Records are recomputed from the index summaries on every upload and stored in `index.json`. How a freshly-set record is *highlighted* is UI — folded into the ride-library/dashboard ticket.
- **Units & locale**: stored values are **SI** (meters, seconds, m/s). A single formatting layer converts for display using **`de-DE`** number/date formats (comma decimals, DD.MM.YYYY, 24-h) with **English UI labels**, locale as one constant, times displayed in Europe/Berlin (GPX times are UTC).
- **Ride ID**: `YYYY-MM-DD-<slugified Komoot name>` (e.g. `2026-07-05-berliner-mauerweg-und-flughafen-schleife`), `-2` suffix on collision; re-uploading the same GPX overwrites the same ride. Display name stays the raw Komoot `<name>`.

### Derived data layout

Two artifact kinds (storage medium is the Cloudflare-architecture ticket's call; these shapes are fixed):

**Per ride — `rides/<id>.json`** (fetched by the detail page only):

```jsonc
{
  "schemaVersion": 1,
  "id": "2026-07-05-berliner-mauerweg-und-flughafen-schleife",
  "name": "Berliner Mauerweg und Flughafen-Schleife",   // raw Komoot <name>
  "sport": "mtb_easy",                                   // raw Komoot <type>
  "start": "2026-07-05T10:00:57Z",                       // UTC ISO
  "stats": {
    "distance": 42345,          // m, integer
    "duration": 12327,          // s, elapsed
    "movingTime": 11020,        // s
    "avgMovingSpeed": 3.84,     // m/s = distance / movingTime
    "maxSpeed": 11.4,           // m/s, smoothed
    "elevationGain": 123,       // m
    "elevationLoss": 118,       // m
    "maxGradient": 6.4,         // %, 100 m window
    "minGradient": -7.1         // %
  },
  "splits": [
    { "km": 1, "time": 152, "avgSpeed": 6.6, "eleDelta": 4, "avgGradient": 0.4 }
    // …last entry is the partial km with its real length
  ],
  "bests": {                    // fastest contiguous windows; null if ride shorter
    "5k":  { "time": 612, "startDist": 12400 },
    "10k": { "time": 1290, "startDist": 9800 },
    "20k": null
  },
  "track": {                    // columnar parallel arrays, one entry per trackpoint
    "lat": [], "lon": [],       // 6 decimals
    "ele": [],                  // m, smoothed, 1 decimal
    "t": [],                    // s since start, integer
    "dist": [],                 // cumulative m, integer
    "speed": []                 // m/s, smoothed, 2 decimals
  }
}
```

Charts, playback cursor, and camera all index straight into the parallel arrays — the client does no math. MapLibre's GeoJSON LineString is built from `lat`/`lon` in one line. ~4,300 points ≈ 50 KB gzipped.

**Global — `index.json`** (one fetch renders library, dashboard, records, heatmap):

```jsonc
{
  "schemaVersion": 1,
  "rides": [                    // newest first
    {
      "id": "…", "name": "…", "sport": "…", "start": "…",
      "stats": { /* identical shape to the ride stats block */ },
      "polyline": "u{~vFvyys@fS…"   // Douglas-Peucker 15 m → encoded polyline, precision 5
    }
  ],
  "records": {
    "longestDistance":   { "rideId": "…", "value": 82345 },  // m
    "mostElevationGain": { "rideId": "…", "value": 1240 },   // m
    "fastest5k":         { "rideId": "…", "value": 588 },    // s
    "fastest10k":        { "rideId": "…", "value": 1201 },   // s
    "fastest20k":        { "rideId": "…", "value": 2510 },   // s
    "fastestAvgSpeed":   { "rideId": "…", "value": 6.91 },   // m/s, rides ≥ 20 km
    "maxSpeed":          { "rideId": "…", "value": 14.2 },   // m/s, smoothed
    "longestMovingTime": { "rideId": "…", "value": 19410 }   // s
  }
}
```

Dashboard totals (ride count, total km, total climbing, trends) are **not stored** — the client derives them from `rides[]` in one pass, so they can never drift. Simplified polylines run ~1–2 KB per ride, so the index stays a single small fetch for years of riding.

## Comments

**2026-07-16** — [Cloudflare architecture](02-cloudflare-architecture.md) resolved concurrently: derived data lives in **D1** (raw GPX in R2), and GPX is parsed client-side before upload. The two schemas above are therefore the **payload contract** — the shapes the upload code produces and the pages/endpoints serve — not literal R2 files. Whether D1 stores them as JSON blobs or normalized rows is an implementation choice inside that architecture; every consumer codes against these shapes either way. The stat *algorithms* (smoothing, hysteresis, splits, bests) run wherever parsing runs — per that ticket, in the client at upload time.
