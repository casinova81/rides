# Ride Tracker — Build Spec (PRD)

Status: ready-for-agent

Synthesized 2026-07-16 from the completed [wayfinder map](map.md) — all 13 tickets resolved; each Implementation Decision below links the ticket that holds its full detail. Cloudflare resources are already provisioned and verified ([Cloudflare provisioning checklist](issues/11-cloudflare-provisioning.md)).

## Problem Statement

Carsten rides a bicycle and records every ride in Komoot, but has no place of his own to see them: no all-time picture of distance ridden, no personal records, no way to replay a ride on a map, compare two rides, or see everywhere he has ever ridden. Komoot's own views don't cut it, and third-party trackers mean subscriptions, accounts, and someone else owning the data. He wants a private site — his data, his hosting, effectively free — where he drops in Komoot GPX exports from any device and gets rich stats, map playback, and an archive that grows for years.

## Solution

A single-user ride-tracking site on Carsten's own Cloudflare free-tier account, protected by an email-PIN login (Cloudflare Access) with month-long sessions. He uploads Komoot GPX files on a dedicated upload page (works from the phone); the browser parses each file and computes all statistics, then stores raw GPX and derived data server-side. The site offers: a combined dashboard/library landing page (all-time tiles, monthly distance chart, 8 personal records, ride cards); a ride detail page with map playback (2D follow, 3D tilt, chase cam) and elevation/speed charts synced to the playback cursor; a full-screen everywhere-I've-ridden heatmap; and a two-ride comparison page with overlaid tracks, Δ stats, and a ghost race. New rides appear instantly — no rebuilds. The map engine sits behind a seam so a CesiumJS globe view can be added later without touching playback.

## User Stories

1. As the rider, I want the entire site behind a login only I can pass, so that my location history stays private.
2. As the rider, I want login to be an email PIN with a 1-month session, so that I authenticate roughly once a month per device instead of managing a password.
3. As the rider, I want uploads from my phone to reuse the same session cookie, so that uploading after a ride is friction-free.
4. As the rider, I want a dedicated upload page with one big drop zone that also opens a file picker on tap, so that upload works the same on desktop and phone.
5. As the rider, I want to drop many GPX files at once, so that I can backfill my whole Komoot archive in one go.
6. As the rider, I want dropped files saved immediately without a review step, so that routine uploads cost one gesture.
7. As the rider, I want a per-file results list with each ride's card, outcome, and key stats, so that I can see at a glance what was saved, what replaced an older ride, and what failed.
8. As the rider, I want a failed file to never block the other files in the batch, so that one corrupt export doesn't ruin a backfill.
9. As the rider, I want the results screen to announce any personal records the new ride broke, so that a great ride is celebrated the moment it lands.
10. As the rider, I want re-uploading a ride with the same start time to replace the old version, so that renaming or re-typing a ride in Komoot and re-exporting just works.
11. As the rider, I want two different rides that share a date and name to both survive upload, so that no data is silently lost to naming collisions.
12. As the rider, I want a landing page with all-time totals — distance, ride count, moving time — so that I see the big picture the moment I open the site.
13. As the rider, I want a bar chart of kilometers per month for a selected year, so that I can see my riding rhythm across seasons.
14. As the rider, I want a grid of my 8 personal records, each linking to the ride that holds it, so that my best efforts are always one click away.
15. As the rider, I want a library of ride cards, newest first, each with a route thumbnail, name, date, and key stats, so that I can recognize and open any ride quickly.
16. As the rider, I want one year selector that scopes both the monthly chart and the library, so that I can relive a past year without fiddling with two filters.
17. As the rider, I want the landing page to load without any map tiles, so that it renders fast even on a slow connection.
18. As the rider, I want a ride's name to always be exactly what Komoot exported, so that Komoot stays the single source of truth for titles.
19. As the rider, I want any ride that currently holds a record to wear a trophy badge in the library and on its detail page, so that record rides stand out without me maintaining anything.
20. As the rider, I want a ride detail page with a large map of the track as its hero, so that the ride's geography is the first thing I see.
21. As the rider, I want play/pause, speed steps, and a scrubber overlaid on the map, so that I can replay the ride at my own pace.
22. As the rider, I want a 2D follow camera by default, with 3D tilt and a behind-the-bike chase cam as toggles, so that I can choose between orientation and drama.
23. As the rider, I want four headline tiles — distance, moving time, average speed, elevation gain — so that the numbers that matter most are impossible to miss.
24. As the rider, I want elevation and speed charts synced bidirectionally with the map cursor and playback, so that hovering anywhere tells me where, how high, and how fast.
25. As the rider, I want secondary stats, fastest 5/10/20 km windows, and per-km splits behind a collapsed disclosure, so that depth is available without cluttering the page.
26. As the rider, I want moving time to exclude stops and speeds/elevation to be smoothed, so that the stats match my sense of the ride rather than GPS noise.
27. As the rider, I want distances, dates, and times shown in German formats with English labels and Berlin times, so that numbers read the way I read numbers.
28. As the rider, I want to delete a ride from its detail page behind a confirmation, so that a bad upload can be removed but never by accident.
29. As the rider, I want records and totals to heal themselves after a delete, so that removing a ride never leaves stale leaderboards.
30. As the rider, I want a full-screen heatmap page of everywhere I've ever ridden, so that years of riding read as one glowing network.
31. As the rider, I want heatmap intensity to reflect how often I've ridden each road, so that my regular routes visibly burn brighter than one-offs.
32. As the rider, I want a compare page where I pick two rides and see both tracks overlaid in two colors, so that I can study how two efforts relate.
33. As the rider, I want a "Compare…" button on a ride's detail page that prefills that ride, so that comparison starts from where curiosity strikes.
34. As the rider, I want both rides' elevation and speed series on shared-axis charts with distance-keyed cursors, so that hovering one km shows both efforts at that same km.
35. As the rider, I want a Δ stats table and a per-km splits diff colored by whoever was faster, so that the verdict is quantified, not just visual.
36. As the rider, I want a ghost race replaying both rides on a shared clock with a leader readout, so that comparing becomes watchable.
37. As the rider, I want new rides to appear on every page instantly after upload, so that I never wait for a build or cache.
38. As the rider, I want the whole site usable on my phone in a single column, so that checking a ride on the go works.
39. As the developer, I want one deploy command that typechecks, migrates the database, builds, and ships, so that a code change reaches production in one step that can't skip a migration.
40. As the developer, I want local development on simulated bindings with its own data, so that experiments can never corrupt production rides.
41. As the developer, I want all map-engine specifics behind one interface, so that a Cesium globe view later is an added adapter, not a rewrite.
42. As the developer, I want the domain pipeline and playback core to be pure and unit-tested, so that stats and playback stay correct as the code evolves.

## Implementation Decisions

Every decision below was locked by a map ticket; the link holds the full rationale and detail.

### Platform & architecture ([Cloudflare architecture](issues/02-cloudflare-architecture.md), [provisioning](issues/11-cloudflare-provisioning.md))

- One Astro project deployed as **one Cloudflare Worker** (the adapter no longer supports Pages). Astro `output: 'static'`; the dynamic pages (ride detail, dashboard/library, heatmap, compare) opt out of prerendering and read storage per request — new rides need no rebuild. The upload endpoint is an Astro API route in the same Worker.
- Bindings are imported via the current `cloudflare:workers` env mechanism; binding names are **`DB`** (D1) and **`GPX_BUCKET`** (R2). Resources already exist — Worker `app` (live at app.rides.workers.dev), D1 `rides-db`, R2 `rides-gpx`; IDs and a ready binding snippet are recorded in the [provisioning ticket's answer](issues/11-cloudflare-provisioning.md).
- **Raw GPX → R2** (private; reachable only through the Worker binding). **All derived data → D1**. KV was disqualified (eventual consistency breaks upload-then-view).
- **GPX parsing and all stat computation run client-side in the browser at upload time** (free Workers cap CPU at 10 ms; browsers have DOMParser). The upload request carries raw GPX plus the computed derived payload; the Worker only validates and stores.

### Domain contract ([Ride stats definitions & derived data model](issues/03-stats-definitions-and-data-model.md))

- The two payload shapes in that ticket — per-ride (stats, splits, bests, columnar track) and index (summaries, DP-15 m encoded polylines, records) — are **the contract** every producer and consumer codes against. D1 stores the JSON blobs in a rides table plus a separate track table so list queries never read track rows; the schema is already applied and doubles as the first migration ([provisioning](issues/11-cloudflare-provisioning.md)).
- Stat algorithms (locked): 5-point speed smoothing; moving = smoothed speed ≥ 2 km/h; elevation via 5-point smoothing + 2 m hysteresis; gradients over 100 m windows; per-km splits with a real-length final partial; fastest rolling 5/10/20 km windows (null when shorter); max speed from the smoothed series.
- **8 record categories** (longest distance, most elevation gain, fastest 5/10/20 km, fastest avg moving speed for rides ≥ 20 km, max speed, longest moving time), recomputed from index summaries on every change — never incrementally maintained.
- Values stored SI; one formatting layer renders de-DE numbers/dates, English labels, Europe/Berlin times.
- Ride ID = date + slugified Komoot name; **duplicate key = first-trackpoint timestamp** (exact match → replace; ID collision without start match → `-2` suffix) ([Upload flow](issues/06-upload-and-ride-management-flow.md)).
- Point speeds must be derived from unrounded timestamps (rounding first produced absurd max speeds in the comparison prototype).

### Auth ([Authentication approach](issues/05-auth-approach.md))

- Cloudflare Access at the edge is the **only** auth: one gate covers assets, SSR pages, and the upload API; R2 inherits it by being binding-private. **Zero auth code in the project**; in-Worker JWT validation consciously declined. Already live: one-time PIN, allow-list = Carsten's personal email, 1-month sessions. Local dev therefore needs no auth stubbing.

### Map stack ([Free tile & terrain stack](issues/01-free-tile-and-terrain-stack.md))

- MapLibre GL with **OpenFreeMap** vector basemap (liberty; dark for the heatmap) and **Mapterhorn** terrarium raster-dem for 3D terrain + hillshade — all keyless and free; attribution rendered automatically from the styles. Fallbacks (AWS Terrain Tiles, VersaTiles, self-hosted PMTiles on R2) are documented in the research asset but not built.

### Playback & the engine seam ([Playback camera prototype](issues/07-playback-camera-prototype.md), [Cesium seam](issues/09-cesium-seam.md))

- Three modules, one seam: a pure **`Track`** module (time/distance sampling, `maxElevationNear`, geodesy helpers) used on both sides; an engine-agnostic **playback core** owning the clock (10×/50×/200×/500×, play/pause, seek) and pose smoothing (position τ 0.6 s; circularly-smoothed bearing from ~25 m look-ahead, τ 1.2 s; smoothing reset on seek), emitting one `RidePose` per frame; and the **`MapView`** seam (from the grilled interface spec):

```ts
interface MapViewFactory {
  modes: ReadonlyArray<{ id: string; label: string }>;
  create(container, track, opts: { onUserCameraInput?: () => void }): Promise<MapView>;
}
interface MapView {
  setMode(modeId: string): void;
  updateFrame(pose: RidePose): void; // absolute — place exactly here, never ease
  destroy(): void;                   // must fully reclaim the engine
}
```

- Invariants: `updateFrame` is absolute (views keep no pose-derived state, native inertia off in follow modes); `create` is async (future Cesium bundle lazy-loads); one live view at a time (`destroy` → `create` → `setMode` while the clock keeps running); `onUserCameraInput` is the only view→core channel. The mode toggle flat-maps an ordered const list of view factories — adding Cesium later appends one entry.
- MapLibre adapter owns all camera math with the locked parameters: 2D follow zoom 14.8 north-up (default); 3D tilt pitch 55°, zoom 14.5, exaggeration 1; chase cam 130 m behind / 55 m above via `calculateCameraOptionsFromTo`, camera altitude clamped to trailing-window max GPX elevation + 12 m (never `queryTerrainElevation`); hide the basemap's 3D-buildings layer while chase mode is active.

### Pages

- **Landing page** ([Ride library & dashboard UX](issues/04-ride-library-and-dashboard-ux.md)): all-time headline tiles (distance, ride count, moving time — derived client-side from the index, never stored) → monthly-km bar chart → 8-record grid → newest-first library of cards with **SVG polyline thumbnails** (no MapLibre on this page). One shared year selector (default current year, "All" option) scopes chart + library; tiles and records stay all-time. Trophy badges derived at render time from the records index. No streaks, no search, no sort options, no title editing.
- **Ride detail** ([Ride detail prototype](issues/08-ride-detail-page-prototype.md), variant "Map hero"): header (name; date · start · sport subline) → ~52vh map hero with translucent overlaid playback bar → four headline tiles (distance, moving time, avg speed, elevation gain) → stacked full-width elevation + speed charts → collapsed disclosure with secondary stats, fastest windows, splits. Full bidirectional chart↔map↔playback sync. Delete lives here behind a confirm. Mobile: same column, tiles 2×2.
- **Upload** ([Upload & ride-management flow](issues/06-upload-and-ride-management-flow.md)): dedicated page, multi-file, sequential client-side parse + single-ride POSTs, auto-save; per-file result cards (reusing library-card rendering) with outcome `saved` / `overwritten <ride>` / `failed: <reason>` and the ephemeral records-broken callout. Backfill is just a big first upload; order doesn't matter.
- **Heatmap** ([Heatmap rendering](issues/12-heatmap-rendering.md)): own full-screen page; **binned segments** — resample each index polyline at 25 m grid spacing, count rides per cell (deduped per ride), draw unique cell edges colored by min endpoint count on a log scale; strava-style ramp (dark red → red → orange → white) at 2.5 px on the OpenFreeMap dark basemap. Purely ambient — no hover/click. Client-side binning from the index (proven ~110 ms / 400 rides, 60 fps).
- **Compare** ([Ride comparison UI](issues/13-ride-comparison-ui.md), variant "Overlay"): dedicated page; two picker slots (ride 1 blue, ride 2 orange; identity colors carry through everything); "Compare…" button on ride detail deep-links with slot 1 prefilled; plain nav link from the dashboard. One map with both tracks → ghost-race bar (shared clock, leader readout, reuses the playback core) → shared-axis elevation and speed charts (both series) → Δ table (ride 2 − ride 1: distance, moving/elapsed time, avg/max speed, gain/loss, fastest 5/10/20 km with "—" when too short) → collapsed per-km splits diff colored by the faster ride. Any two rides; no route-similarity logic.

### Cross-cutting map/UI notes (prototype-earned)

- Initial map bounds go in the Map constructor, never the load handler (world-view flash); every map instance is `remove()`d on teardown (leaked WebGL contexts blank later maps); attach a `ResizeObserver → resize()` per map; run playback rAF loops only while playing; if a style switch is ever added, `setStyle` needs `{ diff: false }`.

### Build & deploy ([Build & deploy pipeline](issues/10-build-and-deploy-pipeline.md))

- Local git only, **no remote** (risk accepted). One `npm run deploy` = typecheck (`astro check`, the only gate) → remote D1 migrations apply (idempotent) → build → deploy. No preview deployments (preview URLs are disabled on the Worker); rollback via `wrangler rollback`. No runtime secrets anywhere; the wrangler config carries only non-sensitive binding IDs and is committed. Local dev runs on simulated Miniflare D1/R2 bindings, seeded by uploading GPX through the local app.

## Testing Decisions

A good test exercises a seam's externally observable behavior — inputs in, outputs/stored-effects out — and never reaches around it to assert on internals (private helpers, D1 row shapes from the client side, MapLibre calls). Three seams, confirmed with Carsten:

1. **Derivation pipeline (pure, highest-value)**: GPX text in → complete derived ride payload out (stats, splits, bests, columnar track, polyline, ride ID), plus records recomputation over summaries. Fixtures: `airport.gpx` (assert the prototype-validated contract numbers: 57,9 km, 3:25:27 moving, ↑97 m, per-km splits, fastest windows) and small synthetic GPX strings targeting each rule — stop detection at the 2 km/h threshold, 2 m hysteresis banking, partial final km, rides shorter than a best window, slug collisions, records ≥ 20 km eligibility, timestamp-rounding max-speed protection.
2. **Worker HTTP surface**: fetch-level tests against the Worker with simulated D1/R2 bindings (the same Miniflare setup local dev uses). Cover upload semantics (new ride; same-start replace including ID change and R2 cleanup; `-2` suffix; malformed payload rejected), delete (rows + object gone, records self-heal on next index read), and that dynamic pages/endpoints serve freshly-uploaded data with no rebuild.
3. **Playback core at the `RidePose` seam** plus the pure `Track` module: deterministic tests for time/distance sampling and interpolation, `maxElevationNear`, clock behavior across speed steps and seeks, smoothing convergence and its reset-on-seek, circular bearing smoothing across the 360°→0° wrap.

Beyond the seams — MapLibre adapters, camera feel, chart rendering, heatmap visuals — stays out of automated tests; the kept prototypes are the reference behavior for eye-verification. There is no prior test art in the repo (greenfield); the locked deploy gate is typecheck-only, so tests run on demand (and must pass before a deploy is *called* done, even though the script doesn't enforce them).

## Out of Scope

From the map's standing exclusions and per-ticket declines:

- Building the **CesiumJS globe view** (only the seam ships), live bike-computer stat overlays during playback, and auto-flyover cinematic intros.
- **Non-Komoot inputs**: FIT files, Garmin/Strava extensions, heart-rate/cadence anything.
- **Multi-user or social features**, sharing, public pages.
- In-app **editing beyond delete**: no rename, no sport-type editor (fix in Komoot and re-upload), no title editing ever.
- **In-Worker JWT validation** of Access (consciously declined), custom domains, preview deployments, git remotes/CI.
- Library search, sort options, streaks; heatmap hover/click; same-route detection in comparison; dedicated backfill tooling.
- Self-hosted tiles (documented fallback only).

## Further Notes

- The three kept prototypes ([playback camera](prototypes/07-playback-camera.html), [ride detail](prototypes/08-ride-detail.html), [comparison](prototypes/13-ride-comparison.html), plus [heatmap](prototypes/12-heatmap.html)) are layout/parameter references — throwaway code, not to be imported.
- Known accepted quirks: a GPS spike can survive 5-point smoothing and inflate max speed (observed once in `airport.gpx` at km 41); bulk backfill makes the first upload's records callout noisy (first ride breaks all 8) — both consciously accepted, no spec workarounds.
- The [wayfinder map](map.md) is the decision provenance: if an implementation question isn't answered here, check the linked ticket before re-deciding anything.
