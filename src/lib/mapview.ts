import type { Track } from './track';
import type { RidePose } from './types';
import { maplibreFactory } from './maplibre-view';
import { cesiumFactory } from './cesium-view';

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
  /** Advertised to the camera-mode toggle, in order; the first is the default. */
  modes: ReadonlyArray<MapMode>;
  /**
   * Base layers this engine can swap under the track, orthogonal to camera mode
   * (issue 07 basemap toggle). Advertised to the basemap toggle, in order; the
   * first is the default. Omitted by engines with a single fixed basemap (Cesium's
   * globe already carries its own imagery), so the controller hides the toggle for
   * them. MapLibre advertises Map (vector) + Satellite (imagery).
   */
  basemaps?: ReadonlyArray<MapMode>;
  /**
   * Build a live view in `container` for `track`. Async so an engine's bundle can
   * lazy-load (the MapLibre chunk `import()`s here, not at module load). The view
   * picks up at the current pose on its first `updateFrame`.
   */
  create(
    container: HTMLElement,
    track: Track,
    opts: {
      onUserCameraInput?: () => void;
      /**
       * The map cursor channel (ticket 4d): fires the track distance (m) nearest
       * a click on (or near) the track line. The controller feeds this into the
       * shared cursor so the map drives the charts and playback, closing the
       * chart↔map↔playback loop. Click-only by design — hovering never scrubs.
       */
      onSeek?: (distance: number) => void;
      /**
       * Initial basemap id (issue 07). Lets a rebuild restore the user's basemap
       * choice with no vector flash — the raster is created already visible rather
       * than toggled on after load. Ignored by engines without `basemaps`.
       */
      basemap?: string;
    },
  ): Promise<MapView>;
}

export interface MapView {
  setMode(modeId: string): void;
  /**
   * Swap the base layer under the track (issue 07 basemap toggle). Present only on
   * engines that advertise `basemaps`; orthogonal to `setMode`, so a basemap choice
   * survives every in-place camera-mode change within one engine.
   */
  setBasemap?(basemapId: string): void;
  /** Absolute: place the camera exactly here, never ease. Views hold no pose state. */
  updateFrame(pose: RidePose): void;
  /** Fully reclaim the engine (WebGL context, listeners, DOM). */
  destroy(): void;
}

/**
 * The ordered engine registry (issue 09 growth path). The MapLibre engine owns the
 * follow/tilt/chase modes; the Cesium engine adds the "Globe" mode. The toggle
 * flat-maps their modes in this order, and the controller swaps engines when a
 * chosen mode belongs to a different factory than the live one — no playback change.
 */
export const mapViews: ReadonlyArray<MapViewFactory> = [maplibreFactory, cesiumFactory];

/** A toggle entry: which mode, and the view that owns it. */
export interface ModeChoice {
  view: MapViewFactory;
  mode: MapMode;
}

/** Flat-map every view's advertised modes into the toggle's ordered button list. */
export function mapModes(views: ReadonlyArray<MapViewFactory> = mapViews): ModeChoice[] {
  return views.flatMap((view) => view.modes.map((mode) => ({ view, mode })));
}

/**
 * Every distinct basemap any engine advertises, in order — the static button list
 * for the basemap toggle. Deduped by id (a basemap common to two engines is one
 * button); the controller shows the toggle only while the live engine advertises
 * basemaps, so an engine without them (Cesium) simply hides it.
 */
export function mapBasemaps(views: ReadonlyArray<MapViewFactory> = mapViews): MapMode[] {
  const seen = new Set<string>();
  const out: MapMode[] = [];
  for (const view of views) {
    for (const base of view.basemaps ?? []) {
      if (!seen.has(base.id)) {
        seen.add(base.id);
        out.push(base);
      }
    }
  }
  return out;
}

/**
 * The view factory that advertises `modeId`, or null if none does. This is how the
 * controller tells a same-engine mode change (both modes resolve to one factory → a
 * cheap in-place `setMode`) from a cross-engine view swap (different factories →
 * `destroy` → `create` → `setMode`, issue 09). Today MapLibre owns every mode, so
 * every toggle stays in-engine; appending a Cesium factory makes globe↔map a swap
 * with no controller change.
 */
export function viewForMode(
  modeId: string,
  views: ReadonlyArray<MapViewFactory> = mapViews,
): MapViewFactory | null {
  return views.find((view) => view.modes.some((mode) => mode.id === modeId)) ?? null;
}
