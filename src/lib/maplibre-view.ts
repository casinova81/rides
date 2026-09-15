import type { Map as MlMap, Marker as MlMarker, LngLatLike, CameraOptions } from 'maplibre-gl';
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

// Basemap toggle (issue 07): the vector Liberty style vs. an opaque satellite raster.
// Esri World Imagery — keyless (like every other tile source here), 256 px tiles.
// The raster layer sits above the vector basemap + hillshade but below the track, so
// flipping its visibility swaps the whole base out from under the red line. It rides
// terrain in the 3D/chase modes for free (draped like any raster). Orthogonal to
// camera mode: the choice persists across every in-place setMode within this engine.
const BASE_MAP = 'map';
const BASE_SATELLITE = 'satellite';
const SAT_SOURCE = 'satellite';
const SAT_LAYER = 'satellite';
const SAT_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SAT_ATTRIBUTION =
  'Imagery © <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics';

const BASEMAPS: ReadonlyArray<MapMode> = [
  { id: BASE_MAP, label: 'Map' },
  { id: BASE_SATELLITE, label: 'Satellite' },
];
// A click seeks playback only when it lands within this many screen pixels of the
// track line — clicking empty map (to focus/pan) must not jump the cursor.
const SEEK_CLICK_RADIUS_PX = 25;

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
  basemaps: BASEMAPS,

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
      // Placed every frame; rounding to whole pixels would add jitter.
      subpixelPositioning: true,
    });

    // Terrain re-sync (map rule, found in the wild): MapLibre positions a DOM Marker
    // on `move` with the *pre-render* transform, but `_render` then resets the centre
    // elevation from the DEM before painting — and `jumpTo` with a fractional zoom
    // (our locked 14.5) first sets it to 0, because the elevation lookup only
    // resolves integer tile zooms. So in 3D the canvas is painted with a different
    // camera elevation than the marker was placed with, and the arrow floats ~13 px
    // above the draped line on every frame (and stays there when paused).
    // Re-projecting after each paint puts the marker exactly where the painted frame
    // has the ground. Flat 2D has no elevation, so the move-time placement is right.
    map.on('render', () => {
      if (map.terrain) marker.setLngLat(marker.getLngLat());
    });

    let mode = FOLLOW_2D;
    let basemap = opts.basemap === BASE_SATELLITE ? BASE_SATELLITE : BASE_MAP;
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

    // The map-cursor channel (ticket 4d): a click on (or near) the track line
    // reports its distance so the map drives the charts + playback. Click-only —
    // hovering must never scrub (and MapLibre suppresses `click` after a drag-pan,
    // so repositioning the camera can't seek either). Nearest-point math is pure
    // (Track.nearestByPoint); the adapter converts screen ↔ lng/lat and rejects
    // clicks landing further than a small pixel radius from the line.
    if (opts.onSeek) {
      const onSeek = opts.onSeek;
      map.on('click', (e) => {
        const nearest = track.nearestByPoint(e.lngLat.lng, e.lngLat.lat);
        const s = track.sampleByDist(nearest.dist);
        const px = map.project([s.lon, s.lat]);
        if (Math.hypot(px.x - e.point.x, px.y - e.point.y) <= SEEK_CLICK_RADIUS_PX) {
          onSeek(nearest.dist);
        }
      });
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
        // Satellite raster: above the vector basemap + hillshade, below the track
        // (added next). Hidden by default; setBasemap flips its visibility. It is
        // opaque, so making it visible hides everything under it in one property set.
        map.addSource(SAT_SOURCE, {
          type: 'raster',
          tiles: [SAT_TILES],
          tileSize: 256,
          maxzoom: 19,
          attribution: SAT_ATTRIBUTION,
        });
        map.addLayer({
          id: SAT_LAYER,
          type: 'raster',
          source: SAT_SOURCE,
          layout: { visibility: basemap === BASE_SATELLITE ? 'visible' : 'none' },
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

    // The centre elevation MapLibre will paint with (map rule): `_render` resets the
    // transform's centre elevation from the DEM at the integer tile zoom on every
    // frame, and `jumpTo` with a fractional zoom looks it up wrongly (→ 0 m). Passing
    // the same value explicitly makes the move-time marker placement agree with the
    // painted frame; the `render` re-sync above covers late DEM tile loads.
    const paintedElevation = (center: [number, number] | LngLatLike, zoom: number): number | undefined =>
      map.terrain
        ? map.terrain.getElevationForLngLatZoom(maplibregl.LngLat.convert(center), Math.floor(zoom))
        : undefined;
    const withElevation = (opts: CameraOptions, elevation: number | undefined): CameraOptions =>
      elevation === undefined ? opts : { ...opts, elevation };

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

      // Orthogonal to setMode (issue 07): flip the opaque satellite raster on/off.
      // Persists across camera-mode changes because the view instance survives them.
      setBasemap(basemapId: string) {
        basemap = basemapId;
        if (map.getLayer(SAT_LAYER)) {
          map.setLayoutProperty(
            SAT_LAYER,
            'visibility',
            basemapId === BASE_SATELLITE ? 'visible' : 'none',
          );
        }
      },

      // Absolute placement (issue 09): jumpTo cancels any easing/inertia, so the
      // camera is exactly here every frame — never a lagging ease behind the pose.
      updateFrame(pose: RidePose) {
        marker.setLngLat(pose.lngLat).setRotation(pose.bearing);
        if (mode === FOLLOW_2D) {
          map.jumpTo({ center: pose.lngLat, zoom: FOLLOW_ZOOM, pitch: 0, bearing: 0 });
        } else if (mode === TILT_3D) {
          map.jumpTo(
            withElevation(
              { center: pose.lngLat, zoom: TILT_ZOOM, pitch: TILT_PITCH, bearing: 0 },
              paintedElevation(pose.lngLat, TILT_ZOOM),
            ),
          );
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
          // calculateCameraOptionsFromTo sets `elevation` to the GPX target altitude;
          // replace it with the DEM value the paint will use (see paintedElevation).
          map.jumpTo(
            camOpts.center && camOpts.zoom !== undefined
              ? withElevation(camOpts, paintedElevation(camOpts.center, camOpts.zoom))
              : camOpts,
          );
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
