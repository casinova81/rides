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
- `npm run deploy` — full pipeline in locked order: `astro check` → `wrangler d1 migrations apply rides-db --remote` → `astro build` → `wrangler deploy` (a deploy can never skip a migration)
- `npm run build` then `npm run preview` — run the built worker locally under wrangler

## Testing setup (two seams, two environments)

`vitest.config.ts` defines two projects:

- **unit** — `src/**/*.test.ts`, plain Node. The pure domain core (derivation, Track, playback, records, rendering helpers).
- **worker** — `test/worker/**/*.test.ts`, runs inside workerd via `@cloudflare/vitest-pool-workers` with Miniflare D1/R2 bindings declared **directly in `vitest.worker.config.ts`** — deliberately not via `wrangler.jsonc`, whose `main` points at the built `dist/_worker.js` (the whole Astro app), which the test runner must not load. Migrations are applied per run in `test/worker/setup.ts`. `isolatedStorage` is `false` (its sqlite sidecar teardown breaks on this platform); every suite clears rides + bucket in `beforeEach`.

Keep `@cloudflare/vitest-pool-workers` pinned at 0.12.x.

`airport.gpx` at the repo root is the reference fixture; its derived numbers (57,9 km, 3:25:27 moving, ↑97 m) are the validated contract for the derivation pipeline. Synthetic fixtures live in `test/gpx-fixtures.ts`.

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

### Playback engine (three modules behind a seam)

- `playback.ts` — engine-agnostic core: owns the clock (10×–500×, play/pause/seek) and pose smoothing (position τ 0.6 s; bearing smoothed circularly per metre travelled from ~25 m look-ahead; smoothing resets on seek). Emits one absolute `RidePose` per frame.
- `mapview.ts` — the `MapView`/`MapViewFactory` seam. Views place the camera exactly on `updateFrame`, never ease, and keep no pose-derived state. A future engine (e.g. Cesium) is a sibling factory appended to the mode list; playback code never changes.
- `maplibre-view.ts` — the MapLibre adapter: 2D follow (default), 3D tilt, chase cam (camera altitude clamped from GPX elevations, never `queryTerrainElevation`; basemap 3D buildings hidden in chase mode). The engine bundle is lazy-`import()`ed inside `create`.

Mode changes split by ownership (issue 09): a mode owned by the *live* engine switches in place via `view.setMode()` (no teardown — every 2D↔3D↔chase toggle today, since MapLibre owns all three); only switching to a mode owned by a *different* engine swaps the whole view (`destroy` → `create` → `setMode`). Either way the clock keeps running. `viewForMode(modeId)` in `mapview.ts` is the pivot; the controller compares it to the live factory.

`src/scripts/` holds the client-side controllers Astro pages load (playback, charts, compare, heatmap); `src/lib/` stays pure and unit-testable. Chart↔map↔playback cursor sync is bidirectional and distance-keyed; the map cursor is click-only (hover never scrubs).

### Map rules (prototype-earned, issue 07)

- Bounds go in the Map constructor; call `map.remove()` on teardown; one `ResizeObserver → resize()` per map; run the rAF loop only while playing.
- The map container needs a position selector of ≥2-class specificity or `.maplibregl-map` collapses it to 0 height (black map).
- For binned/short-edge GeoJSON layers (heatmap), set `tolerance: 0` on the source — geojson-vt drops short segments at low zoom otherwise.
- MapLibre renders in the Claude Code browser pane, but screenshots don't capture the WebGL canvas — verify via `queryRenderedFeatures` instead.

### Conventions

- Untrusted text (raw Komoot names, filenames) always goes through `escapeHtml` from `html.ts`; API routes reply via `json()` from `http.ts`.
- `wrangler.jsonc` carries only non-sensitive IDs and is committed. New D1 changes go in `migrations/` (idempotent — `IF NOT EXISTS`).
- Dev servers for the browser pane are defined in `.claude/launch.json` (config name: `dev`).
