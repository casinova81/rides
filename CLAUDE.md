# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Private single-user ride-tracking site: Komoot GPX upload, stats, MapLibre playback, dashboard, heatmap, compare. One Astro project deployed as a single Cloudflare Worker (D1 + R2), behind an existing Cloudflare Access gate (no auth code in the project).

**Planning docs are the source of truth for decisions.** `tickets.md` is the build plan; `.scratch/ride-tracker/` holds the PRD, planning map (`map.md`), and issue files where every algorithm and architecture decision is locked (stats definitions in issue 03, D1 architecture in issue 02, map rules in issue 07, MapView seam in issue 09). Check them before re-deciding anything.

## Commands

- `npm run dev` — Astro dev server on :4321 with simulated Miniflare D1/R2 bindings (via `platformProxy`), data separate from production
- `npm run check` — typecheck (`astro check`)
- `npm test` — all tests (`vitest run`); `npm run test:watch` for watch mode
- `npx vitest run --project unit` / `--project worker` — one test project
- `npx vitest run src/lib/derive.test.ts` — single file; add `-t "name"` for a single test
- `npm run deploy` — full pipeline in locked order: `astro check` → `wrangler d1 migrations apply rides-db --remote` → `npm run build` → `wrangler deploy` (a deploy can never skip a migration)
- `npm run build` then `npm run preview` — run the built worker locally under wrangler
- `npm run copy:cesium` — stage CesiumJS runtime assets into `public/cesium/` (gitignored). Runs automatically via `predev`/`prebuild`, so `dev`, `build`, and `deploy` all trigger it; only run it by hand if `public/cesium/` is missing outside those flows.

## Testing setup (two seams, two environments)

`vitest.config.ts` defines two projects:

- **unit** — `src/**/*.test.ts`, plain Node. The pure domain core (derivation, Track, playback, records, rendering helpers).
- **worker** — `test/worker/**/*.test.ts`, runs inside workerd via `@cloudflare/vitest-pool-workers` with Miniflare D1/R2 bindings declared **directly in `vitest.worker.config.ts`** — deliberately not via `wrangler.jsonc`, whose `main` points at the built `dist/_worker.js` (the whole Astro app), which the test runner must not load. Migrations are applied per run in `test/worker/setup.ts`. `isolatedStorage` is `false` (its sqlite sidecar teardown breaks on this platform); every suite clears rides + bucket in `beforeEach`.

Keep `@cloudflare/vitest-pool-workers` pinned at 0.12.x.

`airport.gpx` at the repo root is the reference fixture; its derived numbers (57,8 km, 3:25:27 elapsed, 2:47:40 moving, ↑97 m) are the validated contract for the derivation pipeline. Synthetic fixtures live in `test/gpx-fixtures.ts`.

## Architecture

### Rendering model: static shell, dynamic data

`astro.config.mjs` sets `output: 'static'`; dynamic pages opt out with `export const prerender = false` and read bindings per request via `Astro.locals.runtime.env` (`DB`, `GPX_BUCKET`) — so a freshly-uploaded ride is visible with no rebuild. API routes live in `src/pages/api/`.

### The payload contract

`src/lib/types.ts` is the single shared contract every producer and consumer imports. Values are SI (meters, seconds, m/s); `format.ts` renders them de-DE (German number formats, English labels, Europe/Berlin times). Two payload shapes:

- `RidePayload` (full stats + columnar `Track` arrays) — fetched by the detail page only
- `RideIndex` (`IndexSummary[]` + `Records`) — one fetch renders library, dashboard, records, and heatmap

### Data flow

1. **Upload** (`/upload`): the *browser* parses GPX and computes the full derived payload with the pure pipeline (`gpx.ts` → `derive.ts`), then POSTs raw GPX + payload per ride to `/api/upload`.
2. **Worker storage** (`upload-store.ts`): validates the shape, stores raw GPX → R2, rows → D1. Duplicate handling keys off the **first-trackpoint timestamp** (exact start match → replace in place, incl. R2 cleanup); id collision without a start match → `-2` suffix.
3. **Reads** (`db.ts`): `rides` table holds summary JSON columns; the ~200 KB columnar track lives in a separate `ride_tracks` table so index queries never touch it.
4. **Records are never stored** — `loadIndex` recomputes all 8 from the current rows on every read, so replace/delete can never strand a stale leaderboard. Deletes self-heal on the next index read.

### Playback engine (core + seam + two engines)

- `playback.ts` — engine-agnostic core: owns the clock (10×–500×, play/pause/seek) and pose smoothing (position τ 0.6 s; bearing smoothed circularly per metre travelled from ~25 m look-ahead; smoothing resets on seek). Emits one absolute `RidePose` per frame.
- `mapview.ts` — the `MapView`/`MapViewFactory` seam plus the ordered `mapViews` registry. Views place the camera exactly on `updateFrame`, never ease, and keep no pose-derived state. Each engine is one factory in `mapViews`; the toggle flat-maps every factory's advertised `modes` into its button list, so adding an engine is a one-line append with no playback change. A factory may also advertise `basemaps` (base layers orthogonal to camera mode); `mapBasemaps()` flat-maps them into a second toggle, and `view.setBasemap()` swaps the base in place. Only MapLibre advertises basemaps today, so the controller hides that toggle for the globe.
- `maplibre-view.ts` — the MapLibre adapter: 2D follow (default), 3D tilt, chase cam (camera altitude clamped from GPX elevations, never `queryTerrainElevation`; basemap 3D buildings hidden in chase mode). Advertises two basemaps — Map (the vector Liberty style) and Satellite (keyless Esri World Imagery, an opaque raster added above the vector basemap + hillshade but below the track line, toggled by visibility). The basemap choice is orthogonal to camera mode: it persists across every in-place `setMode`, rides the terrain in 3D/chase for free, and is restored on an engine-swap rebuild via the `basemap` create opt (no vector flash).
- `cesium-view.ts` — the CesiumJS adapter: one "Globe" mode, an ambient whole-ride view on a 3D Earth that orbits the ride as playback runs. Keyless — OpenStreetMap imagery + the default ellipsoid globe (no Ion token, no terrain mesh); the line and camera use the GPX's own elevations. Orbit math is pure in `globe-cam.ts` (heading is a function of ride progress, so it stays absolute per the seam). Runs `requestRenderMode` (renders on change, not a constant loop).

Both engine bundles are lazy-`import()`ed inside `create`, so a ride only downloads MapLibre until the Globe mode is first selected (then Cesium). Cesium fetches its Workers/Assets/Widgets at runtime from `/cesium/` (`CESIUM_BASE_URL`), staged there by `scripts/copy-cesium.mjs`.

Mode changes split by ownership (issue 09): a mode owned by the *live* engine switches in place via `view.setMode()` (no teardown — every 2D↔3D↔chase toggle, since MapLibre owns all three); switching to a mode owned by a *different* engine (the Globe) swaps the whole view (`destroy` → `create` → `setMode`). Either way the clock keeps running. `viewForMode(modeId)` in `mapview.ts` is the pivot; the controller compares it to the live factory.

`src/scripts/` holds the client-side controllers Astro pages load (playback, charts, compare, heatmap); `src/lib/` stays pure and unit-testable. Chart↔map↔playback cursor sync is bidirectional and distance-keyed; the map cursor is click-only (hover never scrubs).

### Map rules (prototype-earned, issue 07)

- Bounds go in the Map constructor; call `map.remove()` on teardown; one `ResizeObserver → resize()` per map; run the rAF loop only while playing.
- The map container needs a position selector of ≥2-class specificity or `.maplibregl-map` collapses it to 0 height (black map).
- For binned/short-edge GeoJSON layers (heatmap), set `tolerance: 0` on the source — geojson-vt drops short segments at low zoom otherwise.
- DOM `Marker` on terrain (see `maplibre-view.ts`): MapLibre places markers on `move` with the pre-render transform, then resets the centre elevation from the DEM (integer tile zoom) before painting — and `jumpTo` with a fractional zoom (our locked 14.5) looks that elevation up as 0, while the chase helper returns the GPX altitude. Every terrain-mode `jumpTo` must therefore pass `elevation` = `terrain.getElevationForLngLatZoom(center, floor(zoom))` (what the paint will use), and the marker is re-projected on the `render` event for late DEM loads. Without both, the arrow floats ~13 px (tilt) / ~10 px (chase) off the draped line while playing and snaps back on pause.
- MapLibre renders in the Claude Code browser pane, but screenshots don't capture the WebGL canvas — verify via `queryRenderedFeatures` instead.

### Conventions

- Untrusted text (raw Komoot names, filenames) always goes through `escapeHtml` from `html.ts`; API routes reply via `json()` from `http.ts`.
- `wrangler.jsonc` carries only non-sensitive IDs and is committed. New D1 changes go in `migrations/` (idempotent — `IF NOT EXISTS`).
- Dev servers for the browser pane are defined in `.claude/launch.json` (config name: `dev`).
