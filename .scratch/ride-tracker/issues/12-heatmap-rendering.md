# Heatmap rendering approach

Type: prototype
Status: resolved

## Question

How should the everywhere-I've-ridden heatmap render all rides so overlap reads as intensity and it stays smooth as the ride count grows?

Inputs are now fixed (graduated from fog by [Ride stats definitions & derived data model](03-stats-definitions-and-data-model.md) and [Free tile & terrain stack for MapLibre](01-free-tile-and-terrain-stack.md)): one `index.json` fetch supplies every ride as a Douglas-Peucker-15 m encoded polyline (~1–2 KB/ride), rendered on the OpenFreeMap basemap.

Prototype with Carsten (via /prototype) to react to:

- **Overlap-as-heat technique**: single MapLibre line layer with low-opacity additive stacking (repeated segments glow brighter) vs. MapLibre's `heatmap` layer over densified points vs. pre-binned intensity. With a personal archive (dozens–hundreds of rides of simplified polylines) raw performance is likely fine — the real question is which looks right.
- **Styling**: color ramp, line width across zooms, dark vs. light basemap treatment.
- **Interaction**: hover/click a trace to identify the ride? Or purely ambient?

Link the prototype as an asset; the answer records the chosen technique + style parameters.

## Comments

**2026-07-16** — [Ride library & all-time dashboard UX](04-ride-library-and-dashboard-ux.md) resolved: the heatmap lives on its **own full-screen page**, linked from the dashboard — not embedded on the landing page. The prototype should assume the whole viewport and that MapLibre loads only on this page. (File renumbered from 10 → 12 to fix a numbering collision with the build-and-deploy-pipeline ticket.)

**2026-07-16** — Prototype built and verified: [prototypes/12-heatmap.html](../prototypes/12-heatmap.html). Run `python3 -m http.server 4173` from the repo root, open `http://localhost:4173/.scratch/ride-tracker/prototypes/12-heatmap.html`. Three variants, switchable via the floating bar / arrow keys / `?variant=`:

- **A — Glow stack**: one semi-transparent line layer, overlap alpha-stacks into brightness. Tune opacity/width/color/glow.
- **B — Heatmap layer**: MapLibre density heatmap over resampled points. Tune radius/intensity/spacing/ramp.
- **C — Binned segments**: 25 m grid cells, rides counted per cell, unique edges colored by count (Strava-style crisp network). Tune cell size/width/ramp, log vs linear.

Shared controls: dark/light/full basemap, archive size 10–400 synthetic rides (derived from airport.gpx: 8 route templates with zipf popularity + per-ride GPS jitter, DP-15 like the real index.json), hover-identify (invisible fat hit layer + highlight + name/km tooltip — works over ALL variants, so interaction doesn't constrain the technique choice).

Findings from building it:
- **Performance is a non-issue**: 400 rides / ~100k polyline points generate in ~110 ms and render at a locked 60 fps on all three variants. Even variant B's 170k+ heat points stay smooth.
- **A saturates as the archive grows**: fixed line opacity that looks right at 100 rides turns into a solid blob at 400 — opacity would need to scale with ride count.
- **B needs very low intensity** (0.03, not MapLibre's default ~1) at ride-archive densities, and single-pass roads then nearly vanish; it reads as ambient blur, no crisp roads.
- **C needed cell-level counting**: naive edge-counting fragments under GPS jitter (parallel rides rarely share the exact cell transition), so counts are per-cell and edges take min(endpoint counts). Counts are precomputable server-side later if we want.
- MapLibre gotcha for the real build: `setStyle()` defaults to diff mode, which strips custom layers **without firing `style.load`** — basemap switching must pass `{ diff: false }` (or re-add layers another way).

Awaiting Carsten's reaction: which technique reads right, ramp/color and basemap preference, hover vs purely ambient.

## Answer

**Technique: variant C — binned segments** (Strava-style crisp intensity network), chosen over additive line stacking (saturates as the archive grows) and MapLibre's density heatmap (ambient blur, washes out rare roads).

How it works: resample each ride's DP-15 polyline at cell-size spacing, snap to a square grid, count **rides per cell** (deduped per ride; cell-level counting is stable under GPS jitter where edge-level counting fragments), then render each unique cell-to-cell edge as a short line colored by `min(count[a], count[b])`, normalized on a **log scale**.

Style parameters (locked from the prototype):
- Grid cell: **25 m**; line width **2.5 px**; log intensity scaling
- Ramp: **strava** — `rgba(139,0,0,0.55)` at 0 → `#8b0000` (.25) → `#ff3b00` (.5) → `#ff9d00` (.75) → `#ffffff` (1), interpolated on normalized count
- Basemap: **OpenFreeMap dark** (`/styles/dark`)
- Interaction: **purely ambient** — no hover/click. (If ever wanted, the prototype proved an invisible hit layer works over any technique.)

Performance/build notes for the real page:
- Client-side binning of 400 rides (~100k points) takes ~110 ms and renders at 60 fps — computing from `index.json` polylines in the browser is fine; no precomputation needed at personal-archive scale (counts could move server-side later if that changes).
- MapLibre `setStyle()` diff mode strips custom layers without firing `style.load` — irrelevant here with one fixed basemap, but pass `{ diff: false }` if a style switch is ever added.

Prototype asset: [prototypes/12-heatmap.html](../prototypes/12-heatmap.html).
