# Free tile & terrain stack for MapLibre

Type: research
Status: resolved

## Question

Which free, keyless tile sources should the site use with MapLibre GL — and do they actually support everything the destination needs?

Pin down, with sources and license/attribution requirements:

- **Basemap**: vector tiles from OpenFreeMap vs. Versatiles vs. raster OSM — quality, style options (light/dark/outdoors), usage terms for a low-traffic private site, no API key.
- **Terrain**: free DEM/terrain-RGB tiles (e.g. AWS Terrain Tiles / Terrarium on S3, Versatiles terrain) usable for MapLibre 3D terrain + hillshade — required for the 3D tilt and chase-cam modes.
- **Confirm** MapLibre GL supports: 3D terrain with the chosen DEM source, camera pitch/bearing animation along a route (chase cam), and smooth marker animation.
- Any CDN/self-hosting considerations for tiles on a Cloudflare-hosted site.

Deliver a markdown summary as a linked asset with a recommended stack.

## Answer

Full findings (every claim sourced, endpoints curl-verified 2026-07-16): [assets/01-tile-terrain-research.md](../assets/01-tile-terrain-research.md)

**Recommended stack — all keyless, free, hotlink-intended:**

- **Basemap**: OpenFreeMap — `https://tiles.openfreemap.org/styles/liberty` (also `bright`/`positron`/`dark`/`fiord`). "No limits on map views or requests", no registration. Attribution: OpenMapTiles + OpenStreetMap links (MapLibre renders it automatically from the style).
- **3D terrain + hillshade**: Mapterhorn — `https://tiles.mapterhorn.com/tilejson.json`, terrarium-encoded 512px WebP raster-dem. Run by an ex-MapLibre coordinator, infrastructure sponsored by Cloudflare, used by MapLibre's own official 3D-terrain example; better European resolution than AWS (national LiDAR DEMs).
- **Fallbacks**: AWS Terrain Tiles (keyless S3, max z15, 2017-era SRTM) for terrain; VersaTiles `colorful` for basemap. Resilience escape hatch: self-hosted PMTiles extract on R2 (Berlin/Brandenburg fits in free 10 GB) — documented but not needed now, especially since Mapterhorn itself already runs on Cloudflare R2.

**Capability confirmations & caveats for the chase cam (feed into the playback-camera prototype):**

1. MapLibre GL has **no `FreeCameraOptions`** (that's Mapbox v2-only). The chase cam must use `calculateCameraOptionsFromCameraLngLatAltRotation` / `calculateCameraOptionsFromTo` plus `setCenterElevation` — all confirmed in the current Map API.
2. **Camera–terrain collision is unhandled** (maplibre-gl-js issue #1542) and `queryTerrainElevation` results vary with zoom/pitch (#6701) → clamp camera altitude using the GPX's own elevation values rather than querying terrain.
3. 3D terrain via `raster-dem` + `setTerrain`, hillshade layer, and rAF-based smooth marker animation are all supported with official examples.
