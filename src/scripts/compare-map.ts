import type { Map as MlMap, Marker as MlMarker } from 'maplibre-gl';
import { Track } from '../lib/track';

// The compare overlay map (ticket 6 / issue 13). Both rides drawn on one static
// 2D basemap in their identity colours, each with a moving marker. Unlike the
// ride-detail hero this is *not* a follow camera — the view stays fitted to both
// tracks while the two markers move along them (driven by the ghost race, or
// snapped to a clicked km). maplibre-gl is imported dynamically so the bundle only
// loads on this page (matching the ride-detail adapter's lazy-load invariant).

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export interface CompareMap {
  /** Move ride `index`'s marker to cumulative distance `dist` (m) along its track. */
  setCursor(index: number, dist: number): void;
  destroy(): void;
}

/** A travel-direction marker tinted to a ride's identity colour. */
function markerEl(color: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'ride-marker';
  const arrow = document.createElement('span');
  arrow.className = 'ride-marker__arrow';
  arrow.style.borderBottomColor = color;
  el.appendChild(arrow);
  return el;
}

// A click seeks the shared cursor only when it lands within this many screen
// pixels of a track line — clicking empty map must not jump the cursor. Matches
// the ride-detail adapter's SEEK_CLICK_RADIUS_PX.
const SEEK_CLICK_RADIUS_PX = 25;

/**
 * Mount the overlay map. `onSeek` fires the cumulative distance of the nearest
 * point across *either* track when the user clicks on (or near) a line, so the
 * controller can drive the shared km cursor. Click-only by design — hovering
 * never scrubs, and MapLibre suppresses `click` after a drag-pan.
 */
export async function mountCompareMap(
  container: HTMLElement,
  tracks: Track[],
  colors: string[],
  onSeek: (dist: number) => void,
): Promise<CompareMap> {
  const maplibregl = (await import('maplibre-gl')).default;

  // Map rule (issue 07): fit the whole overlay via constructor bounds, no flyTo.
  const bounds = new maplibregl.LngLatBounds();
  for (const t of tracks) for (const c of t.coordinates) bounds.extend(c);

  const map: MlMap = new maplibregl.Map({
    container,
    style: STYLE_URL,
    bounds,
    fitBoundsOptions: { padding: 44, duration: 0 },
    attributionControl: { compact: true },
  });

  const markers: MlMarker[] = tracks.map((t, i) =>
    new maplibregl.Marker({
      element: markerEl(colors[i]),
      rotationAlignment: 'map',
      pitchAlignment: 'map',
    }).setLngLat(t.coordinates[0]),
  );

  const ro = new ResizeObserver(() => map.resize());
  ro.observe(container);

  // Click → the nearest point across both tracks → shared cursor distance. The
  // query point is the same for both, so d2 (planar squared distance) is directly
  // comparable and picks the closer ride; its cumulative distance is the shared km.
  // Only clicks landing near a line seek — empty-map clicks are ignored.
  map.on('click', (e) => {
    let nearest = tracks[0].nearestByPoint(e.lngLat.lng, e.lngLat.lat);
    let nearestTrack = tracks[0];
    for (let i = 1; i < tracks.length; i++) {
      const cand = tracks[i].nearestByPoint(e.lngLat.lng, e.lngLat.lat);
      if (cand.d2 < nearest.d2) {
        nearest = cand;
        nearestTrack = tracks[i];
      }
    }
    const s = nearestTrack.sampleByDist(nearest.dist);
    const px = map.project([s.lon, s.lat]);
    if (Math.hypot(px.x - e.point.x, px.y - e.point.y) <= SEEK_CLICK_RADIUS_PX) {
      onSeek(nearest.dist);
    }
  });

  await new Promise<void>((resolve) => {
    map.on('load', () => {
      tracks.forEach((t, i) => {
        map.addSource(`track${i}`, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: t.coordinates },
          },
        });
        map.addLayer({
          id: `track${i}`,
          type: 'line',
          source: `track${i}`,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': colors[i], 'line-width': 3.5, 'line-opacity': 0.85 },
        });
      });
      markers.forEach((m) => m.addTo(map));
      resolve();
    });
  });

  return {
    setCursor(index, dist) {
      const t = tracks[index];
      const s = t.sampleByDist(dist);
      markers[index].setLngLat([s.lon, s.lat]).setRotation(t.bearingAt(dist));
    },
    destroy() {
      ro.disconnect();
      markers.forEach((m) => m.remove());
      map.remove(); // fully reclaims the WebGL context (map rule)
    },
  };
}
