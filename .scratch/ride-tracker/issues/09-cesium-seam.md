# Map-view abstraction: the CesiumJS seam

Type: grilling
Status: resolved
Blocked by: 07

## Question

What interface boundary lets a CesiumJS globe view be added later without rewriting playback?

Using what the playback-camera prototype revealed about MapLibre's camera API, define (via /codebase-design vocabulary):

- The map-view interface: what playback needs from *any* map engine (show track, move marker to time t, set camera mode, follow).
- What stays engine-agnostic (playback clock, track data, chart sync) vs. engine-specific (camera math, layers).
- How the 2D-default / 3D-toggle UI would later grow a third "globe" option.

The answer is a short interface spec — the seam the build must respect. Building the Cesium view itself stays out of scope.

## Answer

**Seam placement: engine level.** A whole map engine is one adapter satisfying one `MapView` interface. The MapLibre view owns all three camera modes (2D follow / 3D tilt / chase); a future Cesium view is a sibling adapter with its own mode(s) — "globe" is an engine swap, not a fourth camera mode.

**Three modules, one seam:**

1. **`Track`** (engine-agnostic, pure) — deep module over the columnar per-ride arrays: `sampleByTime(t)` / `sampleByDist(d)` → interpolated point, `maxElevationNear(d, halfWindow)`, `coordinates`, `duration`, `totalDistance`; sibling pure geodesy helpers (`haversine`, `bearingBetween`, `offset`). Used on both sides of the seam; unit-testable with no map.
2. **Playback core** (engine-agnostic) — owns the clock (virtual time, speed steps, play/pause, seek) and pose generation: position smoothing τ 0.6 s, circularly-smoothed bearing from 25 m look-ahead τ 1.2 s, smoothing state reset on seek. Emits one `RidePose` per animation frame: `{ lngLat, elevation, bearing, distance, time }`. Elevation/speed charts sync to the same clock and never touch the map view.
3. **`MapView`** — the seam:

```ts
interface MapViewFactory {
  modes: ReadonlyArray<{ id: string; label: string }>;   // advertised to the toggle
  create(container: HTMLElement, track: Track,
         opts: { onUserCameraInput?: () => void }): Promise<MapView>;
}
interface MapView {
  setMode(modeId: string): void;
  updateFrame(pose: RidePose): void;   // absolute — place exactly here, never ease
  destroy(): void;                     // must fully reclaim the engine
}
```

**Interface invariants** (part of the interface, beyond the types):

- `updateFrame` is **absolute**: views hold no pose-derived state between frames and must disable native camera inertia in follow modes. No seek concept crosses the seam — the core resets smoothing so the pose itself jumps cleanly.
- `create` is **async** so an engine's bundle lazy-loads (Cesium's multi-MB chunk `import()`s on first Globe selection).
- **One live view at a time**: switching views = `destroy()` → `await create()` → `setMode()` while the clock keeps running; the new view picks up at the current pose on its first `updateFrame`. Toggle-back re-creates (browser tile cache makes it fast).
- `onUserCameraInput` is the **only view→core channel** — fired when the user manually moves the camera (drag/pinch/scroll). What the UX does with it (pause follow, re-center button) is decided outside the seam, in the ride-detail-page work.

**Engine-specific (inside the MapLibre adapter, invisible to callers):** all camera math per mode — 2D follow (zoom 14.8), 3D tilt (pitch 55°, zoom 14.5), chase geometry (130 m behind / 55 m up via `calculateCameraOptionsFromTo`, altitude clamp = `track.maxElevationNear` + 12 m) — with the locked parameters from the [playback camera prototype](07-playback-camera-prototype.md) as adapter config; marker rendering; terrain/hillshade/layers; hiding 3D buildings in chase mode.

**Growth path:** an ordered const list `mapViews = [maplibreView]`; the mode toggle flat-maps `modes` across it; default = first mode of first view. Adding Cesium = append `cesiumView` (modes: `globe`) — the toggle grows a Globe button with zero UI changes, selection swaps engines behind the seam, playback code never changes.

## Comments

**Resolved via grilling (2026-07-16).** Eight forks put to Carsten, all recommendations accepted: (1) seam at engine level not camera-mode level; (2) seam carries a finished pose, not raw time — smoothing is locked ride-feel, not engine feel; (3) chase geometry lives in the MapLibre view on shared geodesy helpers, not in the core (revised from the Q2 aside — core computing camera goals would leak mode semantics across the seam); (4) views advertise modes, minimal const-list form; (5) async create / hard destroy, one live engine; (6) no seek signal — `updateFrame` absolute is the invariant; (7) yes to a single `onUserCameraInput` callback — the one deliberate pre-widening, since break-on-drag UX is near-certain; (8) `Track` as a shared deep module crossing the seam, not per-consumer raw data.
