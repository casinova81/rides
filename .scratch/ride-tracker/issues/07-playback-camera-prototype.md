# Playback camera prototype (2D follow, 3D tilt, chase cam)

Type: prototype
Status: resolved
Blocked by: 01

## Question

Does MapLibre with the chosen free tile/terrain stack deliver a playback that feels right — and what camera parameters work?

Build a throwaway prototype (via /prototype) using `airport.gpx`:

- Marker animating along the track with play/pause and speed multipliers (e.g. 10×/50×/200×).
- 2D follow (default), 3D tilted terrain view, and behind-the-bike chase cam (camera trails the marker along the bearing) as toggles.
- React with Carsten on: camera smoothing, chase-cam pitch/zoom, speed steps, whether terrain exaggeration helps.

The verdict (works / needs fallback) and chosen camera parameters are the answer. This prototype also informs the Cesium-seam ticket.

Constraints from the resolved [Free tile & terrain stack](01-free-tile-and-terrain-stack.md) research: use OpenFreeMap basemap + Mapterhorn terrarium raster-dem; MapLibre has **no FreeCameraOptions** — chase cam goes through `calculateCameraOptionsFromCameraLngLatAltRotation` / `calculateCameraOptionsFromTo` + `setCenterElevation`; camera–terrain collision is unhandled upstream, so clamp camera altitude from GPX elevations instead of `queryTerrainElevation`.

## Answer

**Verdict: works — no fallback needed.** MapLibre with OpenFreeMap liberty + Mapterhorn terrarium DEM delivers all three playback modes error-free over the full 57.9 km ride, including at 500×. Carsten approved the prototype's defaults as-is (2026-07-16); they are the locked camera parameters:

- **Smoothing**: exponential, position τ = 0.6 s, bearing τ = 1.2 s; bearing must be circularly (vector-)smoothed and taken from a ~25 m track look-ahead — raw per-point GPX bearing is too jittery.
- **2D follow** (default mode): zoom 14.8, pitch 0, north-up.
- **3D tilt**: pitch 55°, zoom 14.5, north-up (no rotate-with-heading), terrain exaggeration 1.
- **Chase cam**: camera 130 m behind / 55 m above the marker along reverse bearing via `calculateCameraOptionsFromTo(cameraPos, camAlt, markerPos, markerEle)` (computes to ≈ 67° pitch, zoom ≈ 19.3); camera altitude clamped to max GPX elevation in a trailing window + 12 m — never `queryTerrainElevation`.
- **Speed steps**: 10× / 50× / 200× / 500×, plus scrubber.
- **Implementation note for the build**: the liberty style's 3D building extrusions can occlude the marker in chase mode at street level — hide the 3D-buildings layer while chase mode is active (or accept brief occlusion; not a blocker).

Prototype asset (kept as reference for the build and the Cesium-seam ticket): [prototypes/07-playback-camera.html](../prototypes/07-playback-camera.html).

## Comments

**Prototype built and technically verified (2026-07-16).** Asset: [prototypes/07-playback-camera.html](../prototypes/07-playback-camera.html) — single throwaway HTML file, no build step. Run: `python3 -m http.server 4173` from the repo root (or the `prototype-server` entry in `.claude/launch.json`), then open `http://localhost:4173/.scratch/ride-tracker/prototypes/07-playback-camera.html`.

What it has: airport.gpx playback (57.9 km / 3.42 h, 4258 points) with play/pause/restart, scrubber, 10/50/200/500× speeds; 2D follow (default), 3D tilt, chase cam toggles; live sliders for position/bearing smoothing τ, chase distance/height, 3D pitch/zoom, 2D zoom, terrain exaggeration; a state readout (mode, ride time, distance, elevation, bearing, computed camera pitch/zoom/alt, clamp indicator).

Technical observations (all three modes ran error-free through the full ride, including 500×):

- OpenFreeMap liberty + Mapterhorn terrarium DEM + hillshade all load keyless as researched; terrain + 3D buildings render fine at pitch 55°.
- Chase cam via `calculateCameraOptionsFromTo(cameraPos, camAlt, markerPos, markerEle)` works and yields sensible values — defaults (130 m behind, 55 m up) compute to pitch ≈ 67°, zoom ≈ 19.3. Altitude clamped against max GPX elevation in a trailing window (no `queryTerrainElevation`), per the research caveats.
- **New caveat found**: at low chase heights in the city, the liberty style's 3D building extrusions occlude the marker (camera sits inside the urban canyon). Mitigations to react on: raise default chase height, and/or hide the 3D-buildings layer while in chase mode.
- Bearing needs circular (vector) smoothing plus a look-ahead point (~25 m) — frame-to-frame GPX bearing is far too jittery for the chase cam.

Awaiting Carsten's reactions on: camera smoothing feel, chase pitch/zoom (via distance/height), speed steps, terrain exaggeration, and the 3D-buildings-in-chase-mode question.
