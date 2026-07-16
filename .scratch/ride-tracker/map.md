# Ride Tracker — Wayfinder Map

Label: wayfinder:map

## Destination

A private (password-protected) ride-tracking site built with **Astro on Cloudflare Pages + Workers + R2**, where Carsten uploads **Komoot GPX** files from any device. Each ride gets full stats (distance, duration, moving time, avg/max speed, elevation gain/loss, gradients, splits) with **MapLibre GL** map playback — **2D follow by default**, 3D tilt and behind-the-bike chase cam as toggles, play/pause with speed control, and elevation/speed charts synced to the playback cursor. Plus an all-time dashboard, personal records, ride comparison, and an everywhere-I've-ridden heatmap. The architecture keeps a seam open for a future CesiumJS globe view.

**This map is done when nothing is left to decide before building starts** — it produces locked decisions and specs, not the site itself.

## Notes

- Domain: personal bicycle-ride tracking; sole user is Carsten (carsten.guhl@jakala.com). Sample data: `airport.gpx` (Komoot export, ~4,258 trackpoints, lat/lon + elevation + time only — no HR/cadence).
- Decisions locked during charting: hosting = Cloudflare free tier (Pages + Workers + R2); framework = Astro; map = MapLibre GL with free/keyless tiles; GPX source = always Komoot.
- Skills to consult when resolving tickets: `/grilling` + `/domain-modeling` for decisions, `/research` for AFK research tickets, `/prototype` for UI/feel tickets.
- Tracker: local markdown (this file + `issues/NN-<slug>.md` children). See `docs/agents` conventions in `~/.claude/skills/setup-matt-pocock-skills/issue-tracker-local.md`.

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [Free tile & terrain stack for MapLibre](issues/01-free-tile-and-terrain-stack.md) — OpenFreeMap basemap + Mapterhorn terrain (both keyless/free); chase cam must use MapLibre's calculate-camera APIs (no FreeCameraOptions) and clamp altitude from GPX elevations.
- [Ride stats definitions & derived data model](issues/03-stats-definitions-and-data-model.md) — moving = smoothed speed ≥ 2 km/h; elevation via smoothing + 2 m hysteresis; gradients over 100 m windows; per-km splits + rolling 5/10/20 km bests; 8 record categories; SI-stored values with de-DE/English-UI formatting; ride ID = date+name-slug; schema locked: per-ride JSON (stats + splits + bests + columnar track) + one `index.json` (summaries + DP-15 m polylines + records).
- [Cloudflare architecture: storage, parsing, and Astro deployment](issues/02-cloudflare-architecture.md) — single Astro project on a single Worker (adapter dropped Pages support); raw GPX → R2, all derived data → D1 (KV's 60s eventual consistency disqualified it); GPX parsed client-side before upload (free Workers still cap CPU at 10 ms); dynamic pages read bindings per request, so new rides need no rebuild. Full detail: [research asset](assets/02-cloudflare-architecture-research.md).
- [Ride library & all-time dashboard UX](issues/04-ride-library-and-dashboard-ux.md) — one combined landing page: all-time tiles (distance, ride count, moving time) → monthly-km bar chart → 8-record grid → library of SVG-thumbnail cards, newest-first; one shared year selector scopes chart + library; titles never editable; no streaks; heatmap gets its own full-screen page; records surfaced via derived holder badges + ephemeral post-upload callout (no stored "new" flag).
- [Authentication approach](issues/05-auth-approach.md) — Cloudflare Access one-click on `workers.dev`, edge gate only (in-Worker JWT check consciously declined); email one-time-PIN, 1-month sessions, allow-list = Carsten's personal email only; one gate covers assets + SSR + upload API, R2 stays binding-private; zero auth code in the project.
- [Playback camera prototype (2D follow, 3D tilt, chase cam)](issues/07-playback-camera-prototype.md) — verdict: MapLibre + OpenFreeMap + Mapterhorn works, no fallback needed; camera parameters locked (smoothing τ 0.6/1.2 s, chase 130 m behind / 55 m up via `calculateCameraOptionsFromTo`, GPX-clamped altitude, speeds 10–500×); hide 3D buildings in chase mode at build time.
- [Ride detail page prototype (map + synced charts + stats)](issues/08-ride-detail-page-prototype.md) — variant "Map hero" locked: map hero with overlaid playback bar → four headline tiles (distance, moving time, avg speed, elevation gain) → stacked full-width elevation + speed charts → splits/bests/secondary stats behind a collapsed disclosure; full bidirectional chart↔map↔playback sync; map bounds in constructor, `map.remove()` on teardown.
- [Map-view abstraction: the CesiumJS seam](issues/09-cesium-seam.md) — seam at the engine level: a `MapView` interface (`create`/`setMode`/`updateFrame`/`destroy` + `onUserCameraInput`) with views advertising their modes; engine-agnostic playback core emits smoothed `RidePose` frames (updateFrame is absolute, never eased); shared pure `Track` module crosses the seam; MapLibre adapter hides all camera math; Cesium later = append one view to a const list.
- [Upload & ride-management flow](issues/06-upload-and-ride-management-flow.md) — dedicated `/upload` page, multi-file, auto-save (no review step); results screen = per-file cards reusing library-card rendering + outcome + record callouts; duplicate key = first-trackpoint timestamp (same start → replace, enabling rename/sport fixes via Komoot re-upload; ID collision without it → `-2`); delete (detail page, confirm) is the only in-app edit; backfill = just the upload page, no tooling.
- [Heatmap rendering approach](issues/12-heatmap-rendering.md) — binned segments (25 m grid, rides counted per cell, edges colored by min endpoint count, log scale) with the strava ramp on the OpenFreeMap dark basemap; purely ambient, no hover; client-side binning from `index.json` confirmed fast (400 rides ≈ 110 ms, 60 fps).
- [Build & deploy pipeline](issues/10-build-and-deploy-pipeline.md) — local-only: no git remote (code-loss risk accepted), deploys via one `npm run deploy` = `astro check` → `d1 migrations apply --remote` → build → `wrangler deploy`; no previews (rollback via `wrangler rollback`); zero secrets (`wrangler login` + edge Access), `wrangler.jsonc` committed; local dev on simulated Miniflare bindings.
- [Ride comparison UI](issues/13-ride-comparison-ui.md) — dedicated `/compare` page (deep-linked from a "Compare…" button on the ride detail page, slot 1 prefilled); both tracks overlaid on one map + both series in shared-axis elevation/speed charts, distance-keyed cursor sync; Δ stats table + collapsed per-km splits diff; ghost-race replay stays; any-two-rides, no same-route detection.
- [Cloudflare provisioning checklist](issues/11-cloudflare-provisioning.md) — all resources live and verified: Worker `app` at app.rides.workers.dev (subdomain `rides` forced the rename from `rides`), private R2 bucket `rides-gpx`, D1 `rides-db` (id `928b92ad…a6ad`, WEUR) with initial schema applied, Access gate on (OTP, personal email only, 1-month session, previews off); the ticket's Answer holds all IDs + the `wrangler.jsonc` binding snippet.

## Not yet specified

<!-- (empty — all remaining work is ticketed) -->

## Out of scope

- **Live bike-computer stats overlay during playback** and **auto-flyover cinematic intro** — offered during charting, declined for now.
- **Building the CesiumJS globe view** — only the architectural seam is in scope; the Cesium view itself would be a fresh effort.
- **Non-Komoot inputs** (FIT files, Garmin/Strava extensions, heart rate/cadence stats) — source is always Komoot.
- **Multi-user / social features** — the site is for one person, behind a password.
