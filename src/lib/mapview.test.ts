import { describe, it, expect } from 'vitest';
import { mapModes, mapBasemaps, mapViews, viewForMode } from './mapview';
import type { MapMode, MapViewFactory } from './mapview';

// The MapView seam's engine-agnostic surface (issue 09 / ticket 4b): the toggle
// flat-maps every view's advertised modes into an ordered button list. The
// MapLibre adapter itself needs a browser (WebGL), so only the pure registry
// wiring is unit-tested here.

/** Throwaway factories with no real `create` — only their advertised modes/basemaps matter. */
function fakeView(modes: MapMode[], basemaps?: MapMode[]): MapViewFactory {
  return { modes, basemaps, create: async () => ({ setMode() {}, updateFrame() {}, destroy() {} }) };
}

describe('mapModes — the toggle flat-map', () => {
  it('flattens every view’s modes in view-then-mode order', () => {
    const a = fakeView([
      { id: 'follow', label: 'Follow' },
      { id: 'tilt', label: 'Tilt' },
    ]);
    const b = fakeView([{ id: 'globe', label: 'Globe' }]);

    const choices = mapModes([a, b]);
    expect(choices.map((c) => c.mode.id)).toEqual(['follow', 'tilt', 'globe']);
    // Each choice keeps a handle to the view that owns it (for the engine swap).
    expect(choices[0].view).toBe(a);
    expect(choices[2].view).toBe(b);
  });

  it('defaults to 2D follow — the first mode of the first registered view', () => {
    const choices = mapModes(); // real registry
    expect(choices.length).toBeGreaterThan(0);
    expect(choices[0].mode.id).toBe('follow2d');
    expect(mapViews[0].modes[0].id).toBe('follow2d');
  });

  it('advertises the MapLibre modes then the Cesium globe, in registry order', () => {
    // MapLibre owns follow/tilt/chase; the Cesium engine appends "globe" (issue 09
    // growth path — a sibling factory grows the toggle with no playback change).
    expect(mapModes().map((c) => c.mode.id)).toEqual(['follow2d', 'tilt3d', 'chase', 'globe']);
  });
});

describe('mapBasemaps — the basemap toggle list (issue 07)', () => {
  it('collects advertised basemaps in registry order, deduped by id', () => {
    const a = fakeView([{ id: 'follow', label: 'Follow' }], [
      { id: 'map', label: 'Map' },
      { id: 'satellite', label: 'Satellite' },
    ]);
    // A second engine sharing a basemap id contributes only its new one.
    const b = fakeView([{ id: 'globe', label: 'Globe' }], [
      { id: 'map', label: 'Map' },
      { id: 'terrain', label: 'Terrain' },
    ]);
    expect(mapBasemaps([a, b]).map((base) => base.id)).toEqual(['map', 'satellite', 'terrain']);
  });

  it('omits engines that advertise no basemaps', () => {
    const withBases = fakeView([{ id: 'follow', label: 'Follow' }], [{ id: 'map', label: 'Map' }]);
    const none = fakeView([{ id: 'globe', label: 'Globe' }]); // no basemaps → contributes nothing
    expect(mapBasemaps([withBases, none]).map((base) => base.id)).toEqual(['map']);
  });

  it('defaults to the real registry: MapLibre offers Map then Satellite; the globe adds none', () => {
    // Only the MapLibre engine advertises basemaps; Cesium's globe carries its own
    // imagery, so the toggle is Map + Satellite and its default (first) is Map.
    expect(mapBasemaps().map((base) => base.id)).toEqual(['map', 'satellite']);
  });
});

describe('viewForMode — same-engine setMode vs. cross-engine swap (issue 09)', () => {
  const ml = fakeView([
    { id: 'follow', label: 'Follow' },
    { id: 'tilt', label: 'Tilt' },
  ]);
  const globe = fakeView([{ id: 'globe', label: 'Globe' }]);
  const views = [ml, globe];

  it('resolves a mode id to the view that advertises it', () => {
    expect(viewForMode('follow', views)).toBe(ml);
    expect(viewForMode('tilt', views)).toBe(ml);
    expect(viewForMode('globe', views)).toBe(globe);
  });

  it('reports the same owner for two modes of one engine (→ in-place setMode)', () => {
    // follow→tilt stays inside the MapLibre engine: the controller must NOT tear down.
    expect(viewForMode('follow', views)).toBe(viewForMode('tilt', views));
  });

  it('reports different owners across engines (→ destroy → create swap)', () => {
    expect(viewForMode('tilt', views)).not.toBe(viewForMode('globe', views));
  });

  it('returns null for an unknown mode id', () => {
    expect(viewForMode('nope', views)).toBeNull();
  });

  it('defaults to the real registry — every advertised mode resolves to a view', () => {
    for (const { mode } of mapModes()) {
      expect(viewForMode(mode.id)).not.toBeNull();
    }
  });
});
