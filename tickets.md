# Tickets: Ride Tracker build

Builds the private single-user ride-tracking site specified in [PRD](.scratch/ride-tracker/PRD.md) — Astro on one Cloudflare Worker (D1 + R2), Komoot GPX upload, stats, MapLibre playback, dashboard, heatmap, and compare. Cloudflare resources are already provisioned and the D1 schema applied ([provisioning](.scratch/ride-tracker/issues/11-cloudflare-provisioning.md)); every decision is locked in the linked map tickets — check them before re-deciding anything.

Work the **frontier**: any ticket whose blockers are all done. Order here is dependency order (blockers first). After **1** and **2**, ticket **3a** is the spine; finishing it opens **3b**, **4a**, and **5** in parallel. **4b** opens **4c** and **4d**. **6** is last.

## 1. Walking skeleton & deploy pipeline

**What to build:** A deployed, empty-but-live site. Scaffold a single Astro project (`output: 'static'`, dynamic pages opt out of prerender) that deploys as one Cloudflare Worker, with the `DB` (D1) and `GPX_BUCKET` (R2) bindings wired to the already-provisioned resources and imported via `cloudflare:workers`. Commit the already-applied D1 schema as the first migration. One `npm run deploy` command runs `astro check` → `wrangler d1 migrations apply --remote` → build → `wrangler deploy`, in that order, so a deploy can't skip a migration. Local dev runs on simulated Miniflare D1/R2 bindings; a vitest setup exists for later tickets. One dynamic page reads D1 per request (e.g. renders the ride count) to prove the binding works end-to-end behind the live Cloudflare Access gate. `wrangler.jsonc` is committed and carries only non-sensitive IDs.

**Blocked by:** None — can start immediately.

- [ ] `npm run deploy` typechecks, applies remote migrations, builds, and deploys in one step
- [ ] A dynamic (non-prerendered) page reads `DB` per request and renders live data with no rebuild
- [ ] Local dev serves the app on Miniflare D1/R2 bindings with data separate from production
- [ ] The initial D1 migration matches the applied schema and is idempotent to re-apply
- [ ] The site loads only behind the existing Access gate; no auth code in the project

## 2. Track module + derivation pipeline (pure core)

**What to build:** The pure domain core the whole site codes against. Given raw GPX text, produce the complete derived ride payload — stats (distance, elapsed/moving time, avg/max speed, elevation gain/loss, gradients), per-km splits, fastest rolling 5/10/20 km windows, columnar track, DP-15 m encoded polyline, and the ride ID (date + slugified Komoot name) — plus recomputation of the 8 records over a set of index summaries. Export the per-ride and index payload **types**; they are the contract every later producer and consumer imports. Include the shared `Track` module (time/distance sampling, interpolation, `maxElevationNear`, geodesy helpers). No UI, no storage — a pure module verified by its tests. Algorithms are locked in [stats definitions](.scratch/ride-tracker/issues/03-stats-definitions-and-data-model.md): 5-point speed smoothing; moving = smoothed speed ≥ 2 km/h; elevation via 5-point smoothing + 2 m hysteresis; gradients over 100 m windows; real-length final partial split; best windows null when the ride is shorter; max speed from the smoothed series; point speeds derived from **unrounded** timestamps.

**Blocked by:** Ticket 1 (lives in the scaffolded project; uses its vitest setup).

- [ ] `airport.gpx` produces the prototype-validated contract numbers (57,9 km, 3:25:27 moving, ↑97 m, per-km splits, fastest windows)
- [ ] Synthetic fixtures cover each rule: 2 km/h stop threshold, 2 m hysteresis banking, partial final km, ride shorter than a best window, records ≥ 20 km eligibility, and timestamp-rounding max-speed protection
- [ ] Ride ID collision handling is exercised (slug collision behavior)
- [ ] Records recompute correctly from a set of index summaries (all 8 categories), never incrementally
- [ ] `Track` sampling, `maxElevationNear`, and geodesy helpers are unit-tested
- [ ] Exported payload/index types are the single shared contract

## 3a. Upload flow + Worker storage + results screen

**What to build:** Dropping Komoot GPX files saves rides. A dedicated `/upload` page with one big drop zone that also opens a file picker on tap (works on phone and desktop), accepting many files at once. The browser parses each file and computes the derived payload with the ticket-2 pipeline, then POSTs raw GPX + derived payload per ride, sequentially, auto-saving with no review step. The Worker upload endpoint validates the payload, stores raw GPX → R2 and derived data → D1 (rides table + separate track table), and applies duplicate handling by **first-trackpoint timestamp**: exact start match → replace the old ride (including R2 cleanup and ID change); ID collision without a start match → `-2` suffix. Records are recomputed from index summaries on every change. A per-file results screen shows each ride's card with outcome (`saved` / `overwritten <ride>` / `failed: <reason>`) and an ephemeral records-broken callout; a failed file never blocks the rest of the batch. Extract the shared **ride-card** component here (reused by the dashboard/library). New data is readable immediately with no rebuild.

**Blocked by:** Tickets 1, 2.

- [ ] Uploading a new GPX stores raw GPX in R2 and derived data in D1, and the ride is immediately readable
- [ ] Re-uploading a ride with the same first-trackpoint timestamp replaces the old one (rows updated, old R2 object cleaned up, ID change handled)
- [ ] A same-date/same-name ride with a different start survives via a `-2` suffix
- [ ] A malformed payload is rejected; one bad file in a batch doesn't block the others
- [ ] The results screen shows per-file cards with outcome and any records-broken callout
- [ ] Records self-heal (recompute from summaries) after every upload

## 3b. Landing dashboard & library

**What to build:** The combined home page, rendered from the index with no map tiles. Top: all-time headline tiles (total distance, ride count, moving time), derived client-side from the index. Then a bar chart of kilometers per month for the selected year, an 8-record grid where each record links to the ride that holds it, and a newest-first library of ride cards (reusing the ticket-3a card) each with an SVG polyline thumbnail, name, date, and key stats. One year selector (default current year, "All" option) scopes both the chart and the library; the tiles and records stay all-time. Any ride currently holding a record wears a trophy badge, derived at render time from the records index. Titles are exactly Komoot's export, never editable. No streaks, search, or sort.

**Blocked by:** Ticket 3a.

- [ ] All-time tiles (distance, ride count, moving time) render from the index without stored aggregates
- [ ] Monthly-km bar chart and card library both scope to the year selector; tiles/records stay all-time
- [ ] The 8-record grid links each record to its holder ride
- [ ] Ride cards show SVG polyline thumbnails, newest first, with trophy badges on record holders
- [ ] The page loads with no MapLibre / map tiles

## 4a. Ride detail shell + delete

**What to build:** Open a ride and see its full stats; delete a bad one. The detail route reads the per-ride payload and renders: a header (name; date · start · sport subline), four headline tiles (distance, moving time, avg speed, elevation gain), and a collapsed disclosure holding secondary stats, the fastest 5/10/20 km windows, and per-km splits. Numbers use German formats with English labels and Europe/Berlin times. A delete control behind a confirmation hits a Worker delete endpoint that removes the D1 rows and the R2 object and lets records/totals self-heal on the next index read. The map hero region is present as a static placeholder (SVG thumbnail or static line) until ticket 4b makes it live. Single column on mobile with tiles 2×2.

**Blocked by:** Ticket 3a.

- [ ] The detail page renders header, four tiles, and the collapsed disclosure (secondary stats, fastest windows, splits) from the payload
- [ ] Numbers/dates render in de-DE format with English labels and Berlin times
- [ ] Delete behind a confirm removes the D1 rows and the R2 object
- [ ] After delete, records and totals heal on the next index read (no stale leaderboards)
- [ ] Layout is a single column on mobile with tiles in a 2×2 grid

## 4b. Playback core + MapView seam + 2D-follow adapter

**What to build:** Press play and watch the bike ride the track in 2D. Introduce the three-module engine architecture from [the Cesium seam](.scratch/ride-tracker/issues/09-cesium-seam.md): the `MapView` interface + a `MapViewFactory`, a first MapLibre adapter offering **2D follow** (OpenFreeMap liberty basemap, zoom 14.8, north-up) built on the ticket-2 `Track`, and an engine-agnostic **playback core** that owns the clock (10×/50×/200×/500×, play/pause, seek) and pose smoothing (position τ 0.6 s; circularly-smoothed bearing from ~25 m look-ahead, τ 1.2 s; smoothing reset on seek), emitting one absolute `RidePose` per frame. `updateFrame` places the camera exactly, never eases; views keep no pose-derived state; native inertia off in follow mode. A translucent playback bar (play/pause, speed steps, scrubber) overlays the now-live map hero. Enforce the prototype-earned map rules: bounds in the Map constructor, `map.remove()` on teardown, a `ResizeObserver → resize()` per map, rAF loop only while playing.

**Blocked by:** Tickets 4a, 2.

- [ ] The `MapView`/`MapViewFactory` seam exists with a MapLibre 2D-follow adapter; the mode list is an ordered const the toggle flat-maps
- [ ] The playback core drives a smoothed `RidePose` stream; play/pause, speed steps, and seek work from the overlaid playback bar
- [ ] Smoothing resets on seek; bearing smoothing handles the 360°→0° wrap
- [ ] Playback-core + `Track` seam tests cover clock behavior across speed steps/seeks and smoothing convergence
- [ ] Map uses constructor bounds, `remove()` on teardown, a per-map `ResizeObserver`, and runs rAF only while playing

## 4c. 3D tilt + chase-cam modes

**What to build:** Toggle from 2D follow into 3D tilt or a behind-the-bike chase cam mid-playback. Add the Mapterhorn terrarium raster-DEM (3D terrain + hillshade) and two more modes to the MapLibre adapter: 3D tilt (pitch 55°, zoom 14.5, exaggeration 1) and chase cam (130 m behind / 55 m above via `calculateCameraOptionsFromTo`, camera altitude clamped to the trailing-window max GPX elevation + 12 m — never `queryTerrainElevation`), hiding the basemap's 3D-buildings layer while chase mode is active. Mode switching swaps views (`destroy` → `create` → `setMode`) while the clock keeps running.

**Blocked by:** Ticket 4b.

- [ ] 2D follow (default), 3D tilt, and chase cam are all selectable and advertised by the adapter's mode list
- [ ] Chase-cam altitude is clamped from GPX elevations (no terrain queries) and stays stable over terrain
- [ ] 3D buildings are hidden while chase mode is active
- [ ] Switching modes keeps the clock running and doesn't leak WebGL contexts

## 4d. Synced elevation + speed charts

**What to build:** Stacked full-width elevation and speed charts below the map hero, fully synced with the map cursor and playback. Hovering anywhere on a chart moves the map cursor and the playback position; playback moves the chart cursors; the map cursor moves both — bidirectional across chart↔map↔playback.

**Blocked by:** Ticket 4b.

- [ ] Elevation and speed charts render stacked and full-width from the ride payload
- [ ] Hovering a chart moves the map cursor and playback position
- [ ] Playback and the map cursor both drive the chart cursors
- [ ] Sync is bidirectional and consistent across all three surfaces

## 5. Heatmap page

**What to build:** A full-screen page showing everywhere Carsten has ever ridden, brighter where he rides most. On the OpenFreeMap **dark** basemap, resample each index polyline at a 25 m grid spacing, count rides per cell (deduped per ride so one ride counts a cell once), and draw the unique cell edges colored by the minimum endpoint count on a log scale using the strava ramp (dark red → red → orange → white) at 2.5 px. Binning runs client-side from the index (proven ~110 ms / 400 rides, 60 fps). Purely ambient — no hover or click.

**Blocked by:** Ticket 3a.

- [ ] Full-screen heatmap renders from the index on the OpenFreeMap dark basemap
- [ ] Segments are binned on a 25 m grid, deduped per ride, colored by min endpoint count on a log scale with the strava ramp
- [ ] Binning runs client-side and stays smooth at scale (target ~60 fps)
- [ ] No hover/click interaction — ambient only

## 6. Compare page

**What to build:** Pick two rides and study how the efforts relate. A dedicated `/compare` page with two picker slots — ride 1 blue, ride 2 orange, and those identity colors carry through every surface. A "Compare…" button on the ride detail page deep-links here with slot 1 prefilled; the dashboard links in plainly. The page shows: one map with both tracks overlaid; a ghost-race bar replaying both rides on a shared clock with a leader readout (reuses the playback core); shared-axis elevation and speed charts with both series and distance-keyed cursors (hovering one km shows both efforts at that km); a Δ table (ride 2 − ride 1: distance, moving/elapsed time, avg/max speed, gain/loss, fastest 5/10/20 km with "—" when a ride is too short); and a collapsed per-km splits diff colored by whoever was faster. Any two rides — no route-similarity logic.

**Blocked by:** Tickets 3b, 4b, 4d.

- [ ] Two picker slots with blue/ride-1 and orange/ride-2 identity colors carried through map, charts, and tables
- [ ] The "Compare…" button on ride detail deep-links to `/compare` with slot 1 prefilled
- [ ] Both tracks overlay on one map; the ghost race replays both on a shared clock with a leader readout
- [ ] Shared-axis elevation/speed charts show both series with distance-keyed cursor sync
- [ ] Δ table and collapsed per-km splits diff render, with "—" for windows a ride is too short for
