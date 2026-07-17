import type { Map as MlMap, Marker as MlMarker } from 'maplibre-gl';
import type { Track } from './track';
import type { RidePose } from './types';
import type { MapView, MapViewFactory, MapMode } from './mapview';

// The MapLibre adapter (issue 09 / ticket 4b). One engine behind the MapView seam.
// Ticket 4b ships 2D follow only; 3D tilt + chase cam (issue 07 params) are 4c,
// added here as extra modes. maplibre-gl is imported dynamically inside `create`
// so the seam module stays node-importable and the map bundle only loads when a
// ride actually mounts a map (issue 09 async-create invariant).

const FOLLOW_2D = 'follow2d';
const FOLLOW_ZOOM = 14.8; // issue 07: locked 2D-follow zoom
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const TRACK_COLOR = '#e6413c'; // the ridden line on the map (matches the .ride-marker CSS)

const MODES: ReadonlyArray<MapMode> = [{ id: FOLLOW_2D, label: '2D follow' }];

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
        marker.setLngLat(coords[0]).addTo(map);
        resolve();
      });
    });

    return {
      setMode(modeId: string) {
        mode = modeId;
      },

      // Absolute placement (issue 09): jumpTo cancels any easing/inertia, so the
      // camera is exactly here every frame — never a lagging ease behind the pose.
      updateFrame(pose: RidePose) {
        marker.setLngLat(pose.lngLat).setRotation(pose.bearing);
        if (mode === FOLLOW_2D) {
          map.jumpTo({ center: pose.lngLat, zoom: FOLLOW_ZOOM, pitch: 0, bearing: 0 });
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
