# Tile & Terrain Research — Free, Keyless Sources for the Ride Tracker

Researched 2026-07-16 against primary sources (official sites, GitHub repos, live endpoints — all endpoints below were verified live with curl on this date).

## TL;DR — Recommended stack

| Layer | Source | URL | Key? |
|---|---|---|---|
| Basemap (vector) | **OpenFreeMap** | `https://tiles.openfreemap.org/styles/liberty` (or `bright` / `positron` / `dark` / `fiord`) | No |
| 3D terrain + hillshade | **Mapterhorn** | `https://tiles.mapterhorn.com/tilejson.json` (raster-dem, `encoding: "terrarium"`, 512px WebP) | No |
| Terrain fallback | AWS Terrain Tiles | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` (256px, max z15) | No |
| Basemap fallback | VersaTiles | `https://tiles.versatiles.org/assets/styles/colorful/style.json` | No |

- Both primary picks are keyless, registration-free, explicitly hotlinkable, and are what the MapLibre project itself points at (the official 3D-terrain example uses Mapterhorn).
- **Self-hosting PMTiles on R2 is overkill** for a single-user site; keep it as the resilience plan (see Q4). A Berlin/Brandenburg basemap extract would fit in R2's free 10 GB, a useful escape hatch if either public CDN ever degrades.
- Attribution block: see bottom of this file.

---

## Q1 — Basemap vector tiles

### OpenFreeMap (recommended)
- **Styles**: `liberty`, `bright`, `positron`, `dark`, plus `fiord` (dark blue). Style JSON served from `https://tiles.openfreemap.org/styles/{name}` (verified: `/styles/dark` returns 200). Liberty is the full-featured OSM look; positron/dark are muted Carto-style bases that suit a route-overlay site. Source: https://openfreemap.org/quick_start/
- **Usage policy**: "no limits on the number of map views or requests", no registration, no API keys, no cookies. Hotlinking the public CDN is the intended use; commercial use allowed. Source: https://openfreemap.org/ and https://github.com/hyperknot/openfreemap
- **Zoom**: full-planet OpenMapTiles schema, vector tiles to z14 (overzoomed beyond by MapLibre) — standard OpenMapTiles coverage.
- **Who runs it / funding**: Zsolt Ero (creator of MapHub), funded by donations/GitHub Sponsors; running since 2024 with a stated sustainability goal. Single-maintainer risk exists, but weekly full-planet Btrfs/MBTiles dumps are published, so self-hosting is a documented exit. Source: https://openfreemap.org/, https://github.com/hyperknot/openfreemap
- **License/attribution**: code MIT; data OSM (ODbL) via OpenMapTiles schema. Required: link to OpenMapTiles and OpenStreetMap; the "OpenFreeMap" credit itself is optional but encouraged. MapLibre picks the attribution up automatically from the style. Source: https://github.com/hyperknot/openfreemap (README, "Attribution")

### VersaTiles (solid fallback)
- **Styles**: `colorful`, `graybeard`, `eclipse`, `neutrino`, `shadow`, plus satellite — style JSON at `https://tiles.versatiles.org/assets/styles/{name}/style.json` (verified 200; styles themselves are CC0). Source: https://versatiles.org/, style JSON metadata
- **Tiles**: OSM in Shortbread schema, z0–14 vector (verified via `https://tiles.versatiles.org/tiles/osm/tiles.json`). Also hillshade-vectors, landcover, bathymetry, satellite tilesets. Source: https://docs.versatiles.org/basics/tilesets.html
- **Usage policy**: public server free to use; no explicit rate limits or formal SLA published — weaker written guarantee than OpenFreeMap's. Source: https://docs.versatiles.org/
- **Who runs it**: German community/FLOSS project (versatiles-org on GitHub), explicitly "free of any commercial interests"; docs released under Unlicense. Source: https://versatiles.org/, https://docs.versatiles.org/
- **License/attribution**: OSM data ODbL 1.0 → "© OpenStreetMap contributors" required. Source: https://docs.versatiles.org/basics/tilesets.html

### tile.openstreetmap.org (raster — not recommended as primary)
- Raster-only 256px PNG to z19, single "Standard" style, no dark mode, blurry on retina. Fine for a quick prototype.
- **Policy**: allowed for low-traffic sites, but best-effort with no SLA; requires visible attribution, a valid unique User-Agent/Referer, HTTPS, cache-respect; bulk downloading forbidden; heavy use blocked "without notice". Source: https://operations.osmfoundation.org/policies/tiles/
- Verdict: acceptable per policy for this site's traffic, but visually and technically inferior to the vector options (no 3D-friendly styling, no dark style).

### Protomaps (noted)
- **Hosted API**: free for non-commercial use but **requires an API key** (soft limit ~1M tile requests/month) — fails the "keyless" preference. Source: https://protomaps.com/api
- **Self-hosted PMTiles**: planet basemap build ≈ **120 GB** (z0–15); regional extracts via `pmtiles extract`; first-class MapLibre support via the `pmtiles://` protocol (`pmtiles` npm package, `addProtocol`). Sources: https://docs.protomaps.com/basemaps/downloads, https://docs.protomaps.com/pmtiles/maplibre
- Relevant here mainly as the R2 self-hosting path (Q4), not as a hotlink target.

---

## Q2 — Terrain / elevation tiles

### Mapterhorn (recommended — this was the surprise of the research)
- **What**: open terrain tileset by Oliver Wipfli (former MapLibre project coordinator), NLnet-grant funded, with **Cloudflare sponsoring the R2 storage, Workers and bandwidth** for the public endpoint. Sources: https://protomaps.com/blog/mapterhorn-terrain/, https://mapterhorn.com/data-access
- **Endpoint**: `https://tiles.mapterhorn.com/{z}/{x}/{y}.webp`; TileJSON at `https://tiles.mapterhorn.com/tilejson.json`. Keyless — verified live. TileJSON declares `"encoding": "terrarium"`, `"tileSize": 512`. Source: live tilejson.json
- **Data**: Copernicus GLO-30 (30 m) globally, upgraded with national high-res LiDAR DEMs where available (e.g. swissALTI3D 0.5 m for Switzerland, BEV 1 m for Austria; Germany's Länder DEMs are in the source catalog) — meaningfully better than the aging SRTM-based AWS set in Europe. Sources: https://protomaps.com/blog/mapterhorn-terrain/, https://download.mapterhorn.com/attribution.json
- **It's the MapLibre default**: the official MapLibre 3D-terrain example now uses `https://tiles.mapterhorn.com/tilejson.json` for both terrain and hillshade sources. Source: https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/
- **Offline/extracts**: `planet.pmtiles` (z0–12) is ~706 GB (verified Content-Length 705,726,897,585) — do NOT download it; use `pmtiles extract --bbox=...` against `https://download.mapterhorn.com/planet.pmtiles` plus the regional z13–17 archives if you ever self-host. Source: https://mapterhorn.com/data-access
- **License/attribution**: code BSD-3; data from open sources (CC-BY-4.0 national DEMs, Copernicus). Required attribution per their TileJSON: `© Mapterhorn` linking to https://mapterhorn.com/attribution (which itself carries the per-source credits, incl. the Copernicus notice). Sources: https://github.com/mapterhorn/mapterhorn, live tilejson.json

### AWS Terrain Tiles / Terrarium (fallback)
- **Endpoint**: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` — keyless, no AWS account needed (verified: sample tile returns 200, ~98 KB). EU replica bucket: `elevation-tiles-prod-eu` (eu-central-1). Source: https://registry.opendata.aws/terrain-tiles/
- **Format**: Terrarium-encoded 256px PNG, **max zoom 15** (404 above); also `normal`, `geotiff`, `skadi` formats. Decoding: `elevation = (R * 256 + G + B / 256) - 32768`. Source: https://github.com/tilezen/joerd/blob/master/docs/use-service.md and joerd data-formats doc
- **Caveats**: S3 endpoint has **no CDN caching** ("meant for efficient networking with EC2 resources", "you could put your own CloudFront or other CDN in front"); data is the 2017-era Mapzen/Joerd composite (SRTM ~30–90 m in Europe), managed under the AWS Open Data program (Mapzen / Linux Foundation), updates only "based on community feedback". Sources: https://github.com/tilezen/joerd/blob/master/docs/use-service.md, https://registry.opendata.aws/terrain-tiles/
- **Attribution** (per Tilezen): a composite credit is required, e.g. "SRTM data courtesy of the U.S. Geological Survey", "Produced using Copernicus data and information funded by the European Union - EU-DEM layers", plus others depending on region. Full list: https://github.com/tilezen/joerd/blob/master/docs/attribution.md

### Others
- **VersaTiles elevation**: `https://tiles.versatiles.org/tiles/elevation/{z}/{x}/{y}` — terrarium WebP, but **maxzoom 12** and its TileJSON attribution is literally `© Mapterhorn`, i.e. it repackages Mapterhorn data at lower zoom (verified via live tiles.json). Use Mapterhorn directly for z13+ detail. VersaTiles also serves pre-rendered `hillshade-vectors` (CC-BY-4.0, based on Mapzen terrain). Sources: live `https://tiles.versatiles.org/tiles/elevation/tiles.json`, https://docs.versatiles.org/basics/tilesets.html
- **MapTiler terrain**: requires an API key even on the free tier — excluded by the keyless requirement. Source: https://www.maptiler.com/terrain/
- MapLibre consumption for any of these: `type: "raster-dem"` source with `encoding: "terrarium"` (or just the Mapterhorn TileJSON URL, which declares it), then `map.setTerrain({source, exaggeration})` + a separate `hillshade` layer. Source: https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/

---

## Q3 — MapLibre GL capability check

- **3D terrain & hillshade**: confirmed. `raster-dem` source → `terrain: {source, exaggeration}` in the style or `map.setTerrain(...)`; `hillshade` layer type; the official example uses two separate raster-dem sources (one for terrain, one for hillshade) for render quality. Source: https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/
- **Chase-cam camera control**: `easeTo({center, zoom, bearing, pitch, roll})`, `jumpTo`, `setBearing`, `setPitch`, `setRoll` all present. **Important: MapLibre has NO `FreeCameraOptions` API** — that's Mapbox GL v2+ (post-fork); it is absent from the MapLibre API class list (verified against https://maplibre.org/maplibre-gl-js/docs/API/). The MapLibre-native equivalents on `Map` are:
  - `calculateCameraOptionsFromCameraLngLatAltRotation(lngLat, alt, bearing, pitch, roll)` — position the camera itself at a lng/lat/altitude with a rotation (the free-camera workflow);
  - `calculateCameraOptionsFromTo(from, altitudeFrom, to, altitudeTo)` — aim from a camera point at a target point;
  - `setCenterElevation(elevation)` / `setCenterClampedToGround(bool)` — control the focal point's altitude.
  All verified present on the Map class docs: https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/
- **Marker animation along a line**: official example "Animate a point along a route" uses Turf (`along`/distance) + `requestAnimationFrame`, updating a GeoJSON source per frame; also "Animate a marker" and "Animate map camera around a point" examples. Source: https://maplibre.org/maplibre-gl-js/docs/examples/ (animate-point-along-route)
- **`queryTerrainElevation(lngLat)`**: exists; since **v5.0.0 it returns actual altitude** (previously a camera-relative offset — breaking change). Sources: https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/, https://github.com/maplibre/maplibre-gl-js/releases/tag/v5.0.0
- **Known limitations for a behind-the-rider cam over terrain**:
  - **No camera-terrain collision**: the camera can be moved inside the 3D terrain mesh; nothing stops it (open issue). Mitigate by sampling `queryTerrainElevation` along the look-ray each frame and clamping camera altitude above terrain + margin. Source: https://github.com/maplibre/maplibre-gl-js/issues/1542
  - `queryTerrainElevation` can return values off by up to ~hundreds of meters depending on zoom/pitch (terrain tiles are loaded at screen-appropriate zoom). For smooth chase-cam altitude, prefer elevations pre-computed from the GPX file itself and use queryTerrainElevation only as a sanity clamp. Source: https://github.com/maplibre/maplibre-gl-js/issues/6701
  - Historical freeze when mouse events hit "below terrain" geometry (fixed-era issue, but disable map interaction during the flythrough anyway). Source: https://github.com/maplibre/maplibre-gl-js/issues/3928

---

## Q4 — Self-hosting PMTiles on Cloudflare R2

- **Feasibility**: first-class and officially documented — Protomaps publishes a Cloudflare deployment guide (R2 bucket + Worker or direct range-requests via the `pmtiles://` protocol; a plain R2 public bucket works because PMTiles is read with HTTP range requests). Sources: https://docs.protomaps.com/deploy/cloudflare, https://protomaps.com/blog/serverless-self-hosted-maps/
- **R2 free tier**: 10 GB-month storage, 1M Class A + 10M Class B ops/month, and **zero egress fees**. Source: https://developers.cloudflare.com/r2/pricing/
- **Sizes**: Protomaps planet basemap ≈ 120 GB (z0–15); each dropped max-zoom roughly halves it; a Berlin/Brandenburg `pmtiles extract` at full detail is on the order of a few hundred MB–low GB → fits free tier. Mapterhorn terrain planet (z0–12) is ~706 GB; a bbox extract of the Berlin region + surrounding ride country would be small (their Interlaken example workflow: extract z0–12 + regional z13–17 archives, then `pmtiles merge`). Sources: https://docs.protomaps.com/basemaps/downloads, https://mapterhorn.com/data-access
- **Verdict**: for a single-user site, hotlinking OpenFreeMap + Mapterhorn is strictly better — zero maintenance, planet-wide coverage (rides outside Berlin still render), CDN-cached, and both projects explicitly welcome it. Note the pleasing irony: Mapterhorn's public endpoint already runs on Cloudflare R2/Workers, so "self-host on R2" would duplicate their infrastructure. Revisit R2 only if (a) either service degrades, or (b) you want fully pinned, immutable map data for reproducible renders. Data freshness is the main self-hosting cost: you own re-extracting after every upstream update.

---

## Attribution HTML

MapLibre's `AttributionControl` auto-collects attribution from the style/TileJSON (OpenFreeMap and Mapterhorn both declare theirs), so with the recommended stack this is mostly automatic. If rendering a custom attribution block (or for video exports), use:

```html
<div class="map-attribution">
  <a href="https://openfreemap.org">OpenFreeMap</a>
  <a href="https://www.openmaptiles.org/">&copy; OpenMapTiles</a>
  Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
  &middot; Terrain <a href="https://mapterhorn.com/attribution">&copy; Mapterhorn</a>
</div>
```

If the AWS terrain fallback is active, replace the Mapterhorn credit with:

```html
Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Tilezen Joerd</a> —
SRTM and 3DEP data courtesy of the U.S. Geological Survey; produced using Copernicus data and
information funded by the European Union &ndash; EU-DEM layers.
```
