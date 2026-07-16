# Ride detail page prototype (map + synced charts + stats)

Type: prototype
Status: resolved
Blocked by: 01, 03

## Question

How should the ride detail page be laid out — map, playback controls, elevation/speed charts synced to the cursor, and the per-ride stats block?

Build a rough layout prototype (via /prototype) with real numbers from `airport.gpx` and the schema from the stats-definitions ticket:

- Placement: map size vs. charts vs. stats panel; mobile layout.
- Chart↔map sync interaction: hover/scrub chart moves the marker and vice versa.
- Which stats are headline vs. collapsed detail.

Carsten's reactions lock the page spec; ride-comparison fog sharpens after this.

## Answer

**Variant A — "Map hero" — wins** (Carsten, 2026-07-16). The page spec, top to bottom, one column:

1. **Header**: ride name (raw Komoot name), then date · start time · sport as a subline (de-DE dates, Berlin time, English labels — per the stats contract).
2. **Map hero** (~52vh): full-width map with the ride track; playback controls **overlaid on the map's bottom edge** as a translucent bar — play/pause, 10×/50×/200× speed steps, scrubber. Playback camera behavior comes from the resolved [Playback camera prototype](07-playback-camera-prototype.md) (2D follow default, 3D tilt + chase toggles).
3. **Four headline stat tiles**: Distance, Moving time, Avg speed, Elevation gain.
4. **Elevation chart** then **speed chart**, stacked full-width (blue area + violet line, crosshair + tooltip).
5. **Collapsed disclosure** ("All stats, splits & personal bests"): secondary stats (max speed, elapsed time, elevation loss, max/min gradient, sport), fastest 5/10/20 km windows, per-km splits table. Collapsed by default.

**Interactions locked**: full bidirectional sync — hovering either chart moves the map cursor and the other chart's crosshair; hovering the track sets both chart crosshairs; playback drives all three. Mobile: the same single column; tiles wrap 2×2.

**Implementation notes**: set initial map bounds via the Map constructor (`bounds` + `fitBoundsOptions`), never in the `load` handler (world-view flash); `map.remove()` on any view teardown (leaked WebGL contexts blank later maps). Known data caveat, no spec change: a GPS spike can survive the contract's 5-point smoothing and inflate max speed.

Prototype asset (kept as layout reference for the build): [prototypes/08-ride-detail.html](../prototypes/08-ride-detail.html) — variant A.

## Comments

**Prototype built and verified (2026-07-16).** Asset: [prototypes/08-ride-detail.html](../prototypes/08-ride-detail.html) — standalone, no build step. Run `python3 -m http.server 4173` from the repo root (or the `prototype-server` launch entry), open `http://localhost:4173/.scratch/ride-tracker/prototypes/08-ride-detail.html`. Three structurally different layouts, switchable with the floating bar, `←`/`→` keys, or `?variant=A|B|C`:

- **A — Map hero**: scroll page; big map with playback controls overlaid on it, four headline stat tiles, elevation + speed charts stacked full-width, everything else (secondary stats, fastest windows, splits) behind a collapsed "All stats" disclosure.
- **B — Split dashboard**: two columns; left rail = full stats list + fastest windows + splits always visible, right = map, playback bar, charts. Stacks on mobile (rail drops below).
- **C — Full-screen cockpit**: map fills the viewport; title + headline stats float top-left; charts + playback dock over the map as a bottom HUD; secondary stats/splits in a toggle drawer on the right.

All variants share: real numbers from airport.gpx computed with the locked ticket-03 algorithms (57,9 km · 3:25:27 moving · 16,9 km/h avg · ↑97 m/↓94 m · max 60,6 km/h · per-km splits · fastest 5/10/20 km windows), de-DE formatting with English labels, Berlin times; chart↔map sync both ways (hover a chart → map cursor + other chart follow; hover the track → crosshairs on both charts; playback drives all three); dataviz-skill chart styling (single-series blue elevation area, violet speed line, crosshair + tooltip).

Technical notes: initial map bounds must go in the Map constructor (`bounds` + `fitBoundsOptions`), not in the `load` handler — otherwise the page flashes a world view while style tiles load; and switching variants must `map.remove()` the previous instance or leaked WebGL contexts leave later maps blank. Observation for later: the speed series shows one GPS spike (~65 km/h at km 41) that survives the contract's 5-point smoothing — max-speed stat/record is exposed to such spikes.

Awaiting Carsten's reactions on: winning variant (or mix), the four headline stats, where splits/bests live (collapsed vs always-on vs drawer), playback-control placement, chart stacking, mobile behavior.
