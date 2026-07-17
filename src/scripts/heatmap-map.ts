import 'maplibre-gl/dist/maplibre-gl.css';
import {
  heatmapFeatureCollection,
  heatColorExpression,
  HEAT_LINE_WIDTH,
  HEAT_STYLE_URL,
} from '../lib/heatmap';

// The heatmap page controller (ticket 5). Ambient only: it bins the index's
// encoded polylines into a crisp intensity network (heatmap.ts) and paints one
// MapLibre line layer over the OpenFreeMap dark basemap. No hover/click — the map
// is just pannable. maplibre-gl is imported dynamically so the bundle loads only
// on this page (matching the ride-detail adapter's lazy-load invariant).

const SOURCE = 'heat';
const LAYER = 'heat';

/** Mount the full-screen heatmap. No-ops when its markup isn't on the page. */
export async function mountHeatmap(): Promise<void> {
  const container = document.getElementById('heat-map');
  const dataEl = document.getElementById('heat-data');
  if (!container || !dataEl) return;
  try {
    await mount(container, dataEl);
  } catch (err) {
    // Never fail to a silent black screen — surface the reason on the page.
    console.error('Heatmap failed to mount:', err);
    container.textContent = `Heatmap failed: ${err instanceof Error ? err.message : String(err)}`;
    container.style.cssText += ';color:#fff;display:grid;place-items:center;padding:24px;text-align:center;';
  }
}

async function mount(container: HTMLElement, dataEl: HTMLElement): Promise<void> {
  const polylines = JSON.parse(dataEl.textContent ?? '[]') as string[];

  // Bin on the main thread — proven ~110 ms for 400 rides (issue 12), well within
  // one frame's worth of jank on load, so no worker is warranted at this scale.
  const fc = heatmapFeatureCollection(polylines);

  const maplibregl = (await import('maplibre-gl')).default;

  // Fit the whole network via constructor bounds (map rule: no post-load flyTo).
  let bounds: import('maplibre-gl').LngLatBoundsLike | undefined;
  if (fc.features.length > 0) {
    const b = new maplibregl.LngLatBounds();
    for (const f of fc.features) for (const c of f.geometry.coordinates) b.extend(c);
    bounds = b;
  }

  const map = new maplibregl.Map({
    container,
    style: HEAT_STYLE_URL,
    bounds,
    fitBoundsOptions: { padding: 48, duration: 0 },
    attributionControl: { compact: true },
  });

  const ro = new ResizeObserver(() => map.resize());
  ro.observe(container);

  map.on('load', () => {
    // `tolerance: 0` disables geojson-vt's Douglas-Peucker simplification. Every
    // binned edge is a single ~25 m grid step, so at the fitted overview zoom the
    // default tolerance (0.375 tile units) collapses them all below a pixel and
    // drops the entire layer — the map renders empty. Keeping full fidelity costs
    // nothing here: the archive is already simplified upstream (DP-15 m polylines).
    map.addSource(SOURCE, { type: 'geojson', data: fc, tolerance: 0 });
    map.addLayer({
      id: LAYER,
      type: 'line',
      source: SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': heatColorExpression() as never,
        'line-width': HEAT_LINE_WIDTH,
      },
    });
  });

  // Reclaim the WebGL context on navigation away (map rule: remove() on teardown).
  window.addEventListener(
    'pagehide',
    () => {
      ro.disconnect();
      map.remove();
    },
    { once: true },
  );
}
