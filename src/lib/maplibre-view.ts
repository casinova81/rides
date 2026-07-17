import type { Map as MlMap, Marker as MlMarker } from 'maplibre-gl';
import type { Track } from './track';
import type { RidePose } from './types';
import type { MapView, MapViewFactory, MapMode } from './mapview';
import { chaseCamera } from './chase-cam';

// The MapLibre adapter (issue 09 / ticket 4b + 4c). One engine behind the MapView
// seam. Advertises three camera modes — 2D follow (default), 3D tilt, and a
// behind-the-bike chase cam. maplibre-gl is imported dynamically inside `create`
// so the seam module stays node-importable and the map bundle only loads when a
// ride actually mounts a map (issue 09 async-create invariant). The pure camera
// math lives in ./chase-cam; here we only wire it to the live map.

const FOLLOW_2D = 'follow2d';
const TILT_3D = 'tilt3d';
const CHASE = 'chase';

const FOLLOW_ZOOM = 14.8; // issue 07: locked 2D-follow zoom
const TILT_ZOOM = 14.5; // issue 07: locked 3D-tilt zoom
const TILT_PITCH = 55; // issue 07: locked 3D-tilt pitch, north-up
const TERRAIN_EXAGGERATION = 1; // issue 07: exaggeration 1

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
// Mapterhorn terrarium raster-DEM (issue 01): keyless, Cloudflare-hosted, the DEM
// MapLibre's own 3D-terrain example uses. Drives both terrain and hillshade.
const DEM_URL = 'https://tiles.mapterhorn.com/tilejson.json';
const DEM_SOURCE = 'dem';
const HILLSHADE_LAYER = 'hillshade';
const TRACK_COLOR = '#e6413c'; // the ridden line on the map (matches the .ride-marker CSS)

const MODES: ReadonlyArray<MapMode> = [
  { id: FOLLOW_2D, label: '2D follow' },
  { id: TILT_3D, label: '3D tilt' },
  { id: CHASE, label: 'Chase cam' },
];

/** A north-pointing triangle marker, rotated to the travel bearing. */
function makeMarkerEl(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'ride-marker';
  el.innerHTML =
    '<span class="ride-marker__arrow" aria-hidden="true"></span>';
  return el;
}

export const maplibreFactory: MapViewFactory = {
  modes: MODES,

  async create(container, track: Track, opts): Promise<MapView> {
    const maplibregl = (await import('maplibre-gl')).default;

    const coords = track.coordinates;
    // Map rule (issue 07): fit the whole track via constructor bounds, no post-load flyTo.
    const bounds = coords.reduce(
      (b, c) => b.extend(c),
      new maplibregl.LngLatBounds(coords[0], coords[0]),
    );

    const map: MlMap = new maplibregl.Map({
      container,
      style: STYLE_URL,
      bounds,
      fitBoundsOptions: { padding: 40, duration: 0 },
      maxPitch: 85,
      // Kill gesture inertia (issue 09 invariant: no native camera inertia in follow
      // modes) while keeping the map interactive, so `onUserCameraInput` still fires.
      reduceMotion: true,
      attributionControl: { compact: true },
    });

    const marker: MlMarker = new maplibregl.Marker({
      element: makeMarkerEl(),
      rotationAlignment: 'map',
      pitchAlignment: 'map',
    });

    let mode = FOLLOW_2D;
    // The liberty style's 3D building extrusions can occlude the marker at street
    // level in chase mode (issue 07 caveat) → hidden while chasing. Collected from
    // the style so we don't hard-code layer ids.
    let buildingLayers: string[] = [];

    // The only view→core channel (issue 09): fire when the user grabs the camera.
    if (opts.onUserCameraInput) {
      const fire = opts.onUserCameraInput;
      map.on('dragstart', fire);
      map.on('zoomstart', fire);
      map.on('rotatestart', fire);
    }

    // A per-map ResizeObserver keeps the canvas sized to its container (map rule).
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);

    await new Promise<void>((resolve) => {
      map.on('load', () => {
        // Terrain DEM + hillshade (issue 01). The source is always present; terrain
        // itself is toggled per mode (off in 2D follow) by setMode.
        map.addSource(DEM_SOURCE, {
          type: 'raster-dem',
          url: DEM_URL,
          encoding: 'terrarium',
        });
        map.addLayer({
          id: HILLSHADE_LAYER,
          type: 'hillshade',
          source: DEM_SOURCE,
          paint: { 'hillshade-exaggeration': 0.35 },
        });
        map.addSource('track', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
        });
        map.addLayer({
          id: 'track',
          type: 'line',
          source: 'track',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': TRACK_COLOR, 'line-width': 3.5, 'line-opacity': 0.85 },
        });
        buildingLayers = map
          .getStyle()
          .layers.filter((l) => l.type === 'fill-extrusion')
          .map((l) => l.id);
        marker.setLngLat(coords[0]).addTo(map);
        resolve();
      });
    });

    const setBuildingsVisible = (visible: boolean) => {
      for (const id of buildingLayers) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }
      }
    };

    return {
      setMode(modeId: string) {
        mode = modeId;
        // 3D modes ride the terrain; 2D follow is flat (issue 07).
        map.setTerrain(
          modeId === FOLLOW_2D ? null : { source: DEM_SOURCE, exaggeration: TERRAIN_EXAGGERATION },
        );
        // Hide the occluding 3D buildings only while chasing (issue 07 caveat).
        setBuildingsVisible(modeId !== CHASE);
      },

      // Absolute placement (issue 09): jumpTo cancels any easing/inertia, so the
      // camera is exactly here every frame — never a lagging ease behind the pose.
      updateFrame(pose: RidePose) {
        marker.setLngLat(pose.lngLat).setRotation(pose.bearing);
        if (mode === FOLLOW_2D) {
          map.jumpTo({ center: pose.lngLat, zoom: FOLLOW_ZOOM, pitch: 0, bearing: 0 });
        } else if (mode === TILT_3D) {
          map.jumpTo({ center: pose.lngLat, zoom: TILT_ZOOM, pitch: TILT_PITCH, bearing: 0 });
        } else {
          // Chase: camera behind + above the marker, altitude clamped from GPX
          // elevations (never queryTerrainElevation), via calculateCameraOptionsFromTo.
          const cam = chaseCamera(track, pose);
          const camOpts = map.calculateCameraOptionsFromTo(
            new maplibregl.LngLat(cam.cameraLngLat[0], cam.cameraLngLat[1]),
            cam.cameraAltitude,
            new maplibregl.LngLat(pose.lngLat[0], pose.lngLat[1]),
            cam.targetAltitude,
          );
          map.jumpTo(camOpts);
        }
      },

      destroy() {
        ro.disconnect();
        marker.remove();
        map.remove(); // fully reclaims the WebGL context (map rule)
      },
    };
  },
};
