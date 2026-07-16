# Ride library & all-time dashboard UX

Type: grilling
Status: resolved

## Question

How are rides browsed, and what does the all-time dashboard show?

Decide with Carsten:

- **Library**: list vs. calendar vs. cards with map thumbnails; sort/filter (by date, distance, area); where ride titles come from (GPX `<name>` — e.g. "Berliner Mauerweg und Flughafen-Schleife" — editable?).
- **Dashboard**: which totals and trends (km per week/month/year, cumulative climbing, ride count, streaks), which chart types, what the landing page is (dashboard vs. library).
- **Placement**: where personal records and the heatmap live (dashboard sections vs. own pages).
- **New-record highlighting**: the 8 record categories and their detection (recomputed from `index.json` summaries on every upload) are locked by [Ride stats definitions & derived data model](03-stats-definitions-and-data-model.md) — decide here how a freshly-set record is surfaced (badge on the ride, dashboard callout, both).

Answers here sharpen the heatmap and ride-comparison fog patches on the map.

## Answer

Resolved 2026-07-16 via grilling with Carsten. All locked.

### Landing page — one combined page

Dashboard and library share a single landing page, top to bottom:

1. **Headline tiles** (all-time, derived client-side from `index.json` rides): **total distance, ride count, total moving time**. No total-elevation tile.
2. **Monthly distance bar chart** — km per month for the selected year. The only trend chart. **No streaks** (deliberately declined).
3. **Records grid** — the 8 personal-record categories as small cards, each linking to its holding ride. Records live here, not on a separate page.
4. **Ride library** — grid of cards, **newest-first**.

### Year selector

**One shared control** scopes both the monthly chart and the library's ride list. Defaults to the current year; offers an "All" option for the library. Headline tiles and the records grid are always all-time, unaffected by the selector.

### Library cards

- Card = **SVG route thumbnail** drawn from the ride's stored DP-15 m polyline (a bare path, no map tiles/MapLibre on the landing page) + name, date, and key stats (distance, elevation gain, avg moving speed).
- Sorting/filtering: newest-first + the shared year filter only. No sort dropdown, no text search.
- Card click → ride detail page.

### Titles

**Never editable.** Display name is always the raw Komoot `<name>`; to change it, rename in Komoot and re-upload (the date+slug ride-ID overwrite logic already handles this).

### Heatmap placement

**Own full-screen page** (`/heatmap`), linked prominently from the dashboard. Keeps MapLibre + tile loads off the landing page entirely.

### New-record surfacing — zero stored state

Two mechanisms, neither persisting a "new" flag:

1. **Holder badges**: any ride whose ID appears in `index.json` `records` shows a trophy badge on its library card and detail page — derived at render time.
2. **Upload callout**: the post-upload confirmation screen announces which records the ride just broke, computed by comparing records before/after during the upload flow. Ephemeral by design.
