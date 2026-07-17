import { describe, it, expect } from 'vitest';
import { mapModes, mapViews } from './mapview';
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

  it('advertises 2D follow, 3D tilt, and chase cam in order (ticket 4c)', () => {
    // The toggle offers exactly the adapter's ordered mode list; 4c adds two modes.
    expect(mapModes().map((c) => c.mode.id)).toEqual(['follow2d', 'tilt3d', 'chase']);
  });
});
