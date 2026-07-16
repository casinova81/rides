# Ride comparison UI (picking + side-by-side view)

Type: prototype
Status: resolved
Blocked by: 08

## Question

How are two rides picked for comparison, and what does the side-by-side view show?

Build a rough prototype (via /prototype) reacting against the locked page specs:

- **Picking**: where does comparison start — a "compare" affordance on the library cards ([Ride library & dashboard](04-ride-library-and-dashboard-ux.md)), on the ride detail page ([Ride detail page](08-ride-detail-page-prototype.md)), or a dedicated compare page? How is the second ride chosen?
- **View**: which elements of the detail-page spec (map, elevation/speed charts, headline tiles, splits) appear per ride, and how are they arranged — two columns, overlaid charts, or a diff-style stats table? Do the two maps/charts share a distance axis or sync cursors?
- **Scope check**: same-route comparison vs any-two-rides comparison — does route similarity matter for what the view emphasizes?

Carsten's reactions lock the comparison spec. Use `airport.gpx` plus a synthetic second ride (offset/scaled copy) as sample data.

## Answer

**Variant B — "Overlay (compare page)" — wins** (Carsten, 2026-07-16). The comparison spec:

- **Entry points**: a dedicated `/compare` page. A "Compare…" button on the ride detail page deep-links to it with that ride prefilled in slot 1; a plain nav link from the dashboard opens it with empty slots. **No** compare affordance on library cards.
- **Picking**: two picker slots — ride 1 (blue `#2a78d6`), ride 2 (orange `#e8590c`) — listing name, date, distance. Ride identity color carries through everything on the page (tracks, cursors, chart series, table headers).
- **View**, top to bottom: one map with **both tracks overlaid** in identity colors → ghost-race bar → elevation chart → speed chart (each with both series, sharing one distance axis 0→max of the two rides) → Δ stats table → collapsed per-km splits diff.
- **Sync**: cursors keyed by absolute distance — hovering either chart or either track moves both map cursors and both charts' crosshairs to the same km.
- **Ghost race stays**: both cursors replay on a shared ride-time clock (50/200/500×) with a "leader ahead by X km" readout. Reuses the playback machinery, engine-agnostic (`RidePose` core per the [Cesium seam](09-cesium-seam.md)).
- **Δ table metrics** (Δ = ride 2 − ride 1): distance, moving time, elapsed time, avg speed, max speed, elevation gain, elevation loss, fastest 5/10/20 km ("—" where a ride is too short).
- **Splits diff** (folded in from variant C): per-km table — km, time₁, time₂, Δ colored by whoever was faster that km — behind a **collapsed disclosure** below the stats table.
- **Scope**: any-two-rides; no route-similarity detection or special same-route mode — the overlay simply degrades gracefully for different routes (accepted consciously).

**Implementation notes**: attach an explicit `ResizeObserver → map.resize()` per MapLibre map (auto-resize missed container settling in an embedded pane); run playback rAF loops only while playing; derive point speeds from **unrounded** timestamps (rounding to whole seconds before dividing produced absurd max speeds when timestamps collapse onto the same second).

Prototype asset (kept as layout reference for the build): [prototypes/13-ride-comparison.html](../prototypes/13-ride-comparison.html) — variant B.

## Comments

**Prototype built and verified (2026-07-16).** Asset: [prototypes/13-ride-comparison.html](../prototypes/13-ride-comparison.html) — standalone, no build step. Run `python3 -m http.server 4173` from the repo root (or the `prototype-server` launch entry), open `http://localhost:4173/.scratch/ride-tracker/prototypes/13-ride-comparison.html`. Three variants, switchable with the floating bar, `←`/`→`, or `?variant=A|B|C`. Each variant answers *both* halves of the question — where comparison starts **and** what the view is:

- **A — Side-by-side (from ride page)**: entry is a "Compare with…" picker on the ride detail page; the view is two full columns, each a mini detail page (map, four headline tiles, elevation + speed charts). All charts share one distance axis, and hovering any chart or map moves the cursor on **both** rides at the same km.
- **B — Overlay (dedicated compare page)**: both rides picked on a `/compare` page; one map with both tracks, elevation/speed charts with both series overlaid, a metric/Δ table (Δ = ride 2 − ride 1), and a **ghost race**: both cursors replay on a shared clock with a "leader X ahead by Y km" readout.
- **C — Scoreboard (from the library)**: entry is a compare mode on the library grid (click two cards, ①/② badges); the view is numbers-only — SVG thumbnails, tug-of-war bars per metric with the better value bolded, and a per-km splits table whose Δ is colored by whoever was faster on that km. No MapLibre at all.

Sample data: `airport.gpx` plus **two** synthetics derived from it — a same-route copy ridden ~12 % slower ("Flughafen-Schleife im Gegenwind") and a genuinely different, shorter, hillier route ("Feierabendrunde Süd") — so the scope check (same-route vs any-two-rides) can be felt in every picker: B's chart overlay and ghost race read beautifully for the same route and degrade visibly for the different one; C stays meaningful for any pair.

Technical notes for the build: MapLibre's automatic resize missed the container settling in an embedded pane — attach an explicit `ResizeObserver → map.resize()` per map; run playback `requestAnimationFrame` loops only while playing (an always-on loop keeps the page from ever going idle); and derive point speeds from **unrounded** timestamps — deriving from the per-second-rounded time array let scaled timestamps collapse onto the same second and produced a billions-km/h max speed on the synthetic ride.

Awaiting Carsten's reactions on: winning entry point (detail page vs dedicated page vs library — or several at once), winning view (columns vs overlay vs scoreboard, or a mix), whether the ghost race earns its place, shared-distance-axis cursor sync vs none, which metrics belong in the diff (incl. splits/fastest windows), and whether same-route comparison deserves special treatment or any-two is enough.
