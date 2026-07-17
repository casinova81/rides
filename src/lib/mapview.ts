import type { Track } from './track';
import type { RidePose } from './types';
import { maplibreFactory } from './maplibre-view';

// The MapView seam (issue 09). A whole map engine is one adapter satisfying one
// `MapViewFactory`; playback needs only "show this track, then place the camera at
// this absolute pose each frame." Everything engine-specific (camera math, layers,
// terrain) lives inside an adapter, invisible here. A future Cesium globe is a
// sibling factory appended to `mapViews` — the toggle grows a button, playback
// code never changes.

/** One selectable camera mode a view advertises to the toggle. */
export interface MapMode {
  id: string;
  label: string;
}

export interface MapViewFactory {
  /** Advertised to the toggle, in order; the first is the default. */
  modes: ReadonlyArray<MapMode>;
  /**
   * Build a live view in `container` for `track`. Async so an engine's bundle can
   * lazy-load (the MapLibre chunk `import()`s here, not at module load). The view
   * picks up at the current pose on its first `updateFrame`.
   */
  create(
    container: HTMLElement,
    track: Track,
    opts: { onUserCameraInput?: () => void },
  ): Promise<MapView>;
}

export interface MapView {
  setMode(modeId: string): void;
  /** Absolute: place the camera exactly here, never ease. Views hold no pose state. */
  updateFrame(pose: RidePose): void;
  /** Fully reclaim the engine (WebGL context, listeners, DOM). */
  destroy(): void;
}

/**
 * The ordered engine registry (issue 09 growth path). One MapLibre view today;
 * appending a Cesium factory here is the only change a globe engine needs.
 */
export const mapViews: ReadonlyArray<MapViewFactory> = [maplibreFactory];

/** A toggle entry: which mode, and the view that owns it. */
export interface ModeChoice {
  view: MapViewFactory;
  mode: MapMode;
}

/** Flat-map every view's advertised modes into the toggle's ordered button list. */
export function mapModes(views: ReadonlyArray<MapViewFactory> = mapViews): ModeChoice[] {
  return views.flatMap((view) => view.modes.map((mode) => ({ view, mode })));
}
