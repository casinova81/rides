import { describe, it, expect } from 'vitest';
import { mapModes, mapViews, viewForMode } from './mapview';
import type { MapViewFactory } from './mapview';

// The MapView seam's engine-agnostic surface (issue 09 / ticket 4b): the toggle
// flat-maps every view's advertised modes into an ordered button list. The
// MapLibre adapter itself needs a browser (WebGL), so only the pure registry
// wiring is unit-tested here.

/** Two throwaway factories with no real `create` — only their advertised modes matter. */
function fakeView(modes: { id: string; label: string }[]): MapViewFactory {
  return { modes, create: async () => ({ setMode() {}, updateFrame() {}, destroy() {} }) };
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
