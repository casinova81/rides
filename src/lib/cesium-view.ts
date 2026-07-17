import type { Viewer, Entity, ScreenSpaceEventHandler, Cartesian2 } from 'cesium';
import type { Track } from './track';
import type { RidePose } from './types';
import type { MapView, MapViewFactory, MapMode } from './mapview';
import { orbitShot, orbitRange, trackCenter } from './globe-cam';

declare global {
  // Cesium reads this global to resolve its runtime asset/worker URLs.
  // eslint-disable-next-line no-var
  var CESIUM_BASE_URL: string | undefined;
}

// The CesiumJS adapter — a second engine behind the MapView seam (issue 09). Where
// MapLibre owns the follow/tilt/chase modes, Cesium owns one: an ambient "globe"
// showpiece that frames the whole ride on a 3D Earth and slowly orbits it. Selecting
// it is an engine swap (the controller does destroy → create → setMode); playback,
// the clock, and the charts are untouched. The camera math is pure in ./globe-cam;
// here we only wire it to a live Cesium Viewer.
//
// Node-safety: this module is pulled in by mapview.ts, which the unit tests import in
// plain Node. So the top level must stay Cesium-free — only `import type`. The engine
// bundle and its CSS load exclusively through the dynamic `import()`s inside `create`
// (the seam's async-create invariant), so 2D/3D rides never download any Cesium.

const GLOBE = 'globe';
const MODES: ReadonlyArray<MapMode> = [{ id: GLOBE, label: 'Globe' }];

// Cesium fetches its Workers/Assets/Widgets at runtime relative to this base; the
// build stages them into /cesium/ (scripts/copy-cesium.mjs + public/).
const CESIUM_ASSET_BASE = '/cesium/';
// Keyless OpenStreetMap raster imagery — no Ion token, matching the project's keyless
// basemaps (OpenFreeMap, Mapterhorn). The globe uses the default ellipsoid (no terrain
// mesh); the ride line and camera still ride the GPX's own elevations.
const OSM_URL = 'https://tile.openstreetmap.org/';
const TRACK_COLOR = '#e6413c'; // matches the MapLibre track line + .ride-marker CSS
// A click seeks only when it lands within this many pixels of the track line, so
// clicking bare globe (to spin it) never jumps the cursor. Mirrors the MapLibre rule.
const SEEK_CLICK_RADIUS_PX = 25;

export const cesiumFactory: MapViewFactory = {
  modes: MODES,

  async create(container, track: Track, opts): Promise<MapView> {
    // Set the asset base before the engine initialises, then lazy-load the bundle and
    // its widget CSS — both kept out of the module top level so Node never sees them.
    globalThis.CESIUM_BASE_URL = CESIUM_ASSET_BASE;
    const Cesium = await import('cesium');
    await import('cesium/Build/Cesium/Widgets/widgets.css');

    const osm = new Cesium.OpenStreetMapImageryProvider({ url: OSM_URL });

    const viewer: Viewer = new Cesium.Viewer(container, {
      baseLayer: new Cesium.ImageryLayer(osm),
      // All the Viewer chrome off — this is a bare cinematic globe, driven by playback.
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      selectionIndicator: false,
      infoBox: false,
      // Render only on change (camera move, our requestRender) instead of a constant
      // rAF loop — the spirit of the "rAF only while playing" map rule for this engine.
      requestRenderMode: true,
    });

    const scene = viewer.scene;
    const camera = viewer.camera;
    // Absolute placement (issue 09 invariant): kill camera inertia so a manual spin
    // never keeps gliding after the gesture, and every updateFrame lands exactly.
    const ctrl = scene.screenSpaceCameraController;
    ctrl.inertiaSpin = 0;
    ctrl.inertiaTranslate = 0;
    ctrl.inertiaZoom = 0;

    // The ridden line, drawn at its true GPX elevations on the ellipsoid.
    const degHeights: number[] = [];
    for (let i = 0; i < track.n; i++) {
      degHeights.push(track.data.lon[i], track.data.lat[i], track.data.ele[i]);
    }
    viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights(degHeights),
        width: 3,
        material: Cesium.Color.fromCssColorString(TRACK_COLOR),
        clampToGround: false,
      },
    });

    // The moving position marker.
    const start = track.sampleByDist(0);
    const marker: Entity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(start.lon, start.lat, start.ele),
      point: {
        pixelSize: 12,
        color: Cesium.Color.fromCssColorString(TRACK_COLOR),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
      },
    });

    // The orbit target (ride centre) and range are constant per ride; only the heading
    // moves, as a pure function of ride progress.
    const center = trackCenter(track);
    const range = orbitRange(track);
    const target = Cesium.Cartesian3.fromDegrees(center.lon, center.lat, center.ele);
    const duration = track.duration;

    // The only view→core channel (issue 09): fire when the user moves the camera.
    // `camera.moveStart` is raised by the screen-space controller on user drag/pinch/
    // scroll only — our per-frame `lookAt` placements don't raise it — so this never
    // false-fires from playback. `addEventListener` returns its own remover.
    let removeCameraInput: (() => void) | null = null;
    if (opts.onUserCameraInput) {
      removeCameraInput = camera.moveStart.addEventListener(opts.onUserCameraInput);
    }

    // The map-cursor channel (ticket 4d): a click on (or near) the ride line reports
    // its distance so the globe drives the charts + playback. Click-only, and guarded
    // by a pixel radius so spinning the empty globe never scrubs.
    let clickHandler: ScreenSpaceEventHandler | null = null;
    if (opts.onSeek) {
      const onSeek = opts.onSeek;
      clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
      clickHandler.setInputAction((e: { position: Cartesian2 }) => {
        const hit = camera.pickEllipsoid(e.position, scene.globe.ellipsoid);
        if (!hit) return;
        const carto = Cesium.Cartographic.fromCartesian(hit);
        const nearest = track.nearestByPoint(
          Cesium.Math.toDegrees(carto.longitude),
          Cesium.Math.toDegrees(carto.latitude),
        );
        const s = track.sampleByDist(nearest.dist);
        const win = Cesium.SceneTransforms.worldToWindowCoordinates(
          scene,
          Cesium.Cartesian3.fromDegrees(s.lon, s.lat, s.ele),
        );
        if (win && Cesium.Cartesian2.distance(win, e.position) <= SEEK_CLICK_RADIUS_PX) {
          onSeek(nearest.dist);
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }

    /** Place the camera absolutely for `pose`, orbiting the ride centre. */
    const place = (pose: RidePose) => {
      const progress = duration > 0 ? pose.time / duration : 0;
      const shot = orbitShot(progress, range);
      // lookAt positions the camera relative to the target frame; releasing the
      // transform (IDENTITY) converts that to a plain world pose so the camera isn't
      // left locked — the documented "position via lookAt, don't stay locked" idiom.
      camera.lookAt(
        target,
        new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(shot.heading),
          Cesium.Math.toRadians(shot.pitch),
          shot.range,
        ),
      );
      camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      marker.position = new Cesium.ConstantPositionProperty(
        Cesium.Cartesian3.fromDegrees(pose.lngLat[0], pose.lngLat[1], pose.elevation),
      );
      scene.requestRender();
    };

    // Frame the ride immediately so the async gap before the first updateFrame doesn't
    // flash an arbitrary view.
    place({ lngLat: [start.lon, start.lat], elevation: start.ele, bearing: 0, distance: 0, time: 0 });

    return {
      // One mode; nothing engine-internal to switch. Present for the seam.
      setMode() {},

      updateFrame(pose: RidePose) {
        place(pose);
      },

      destroy() {
        removeCameraInput?.();
        clickHandler?.destroy();
        viewer.destroy(); // reclaims the WebGL context + Cesium DOM
      },
    };
  },
};
