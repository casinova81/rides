import 'maplibre-gl/dist/maplibre-gl.css';
import { Track } from '../lib/track';
import { PlaybackCore } from '../lib/playback';
import {
  mapModes,
  mapBasemaps,
  viewForMode,
  type MapView,
  type MapViewFactory,
} from '../lib/mapview';
import { fmtDuration } from '../lib/format';
import { mountCharts } from './ride-charts';
import type { RidePose, Track as TrackData } from '../lib/types';

// The ride-detail playback controller (ticket 4b + 4c). Wires the engine-agnostic
// PlaybackCore to a live MapView over the map hero, plus the translucent playback
// bar. The rAF loop runs only while playing (map rule, issue 07); paused/seek
// states render a single frame. Everything engine-specific stays behind the seam.
// The camera-mode toggle swaps the whole view (destroy → create → setMode) while
// the clock keeps running — the core is untouched by a view swap (issue 09).

/** Mount live playback into the ride-detail hero. No-ops off the detail page. */
export async function mountRidePlayback(): Promise<void> {
  const dataEl = document.getElementById('ride-track');
  const container = document.getElementById('map-hero');
  const hero = document.getElementById('ride-hero');
  const bar = document.getElementById('playback');
  const playBtn = document.getElementById('pb-play') as HTMLButtonElement | null;
  const scrub = document.getElementById('pb-scrub') as HTMLInputElement | null;
  const timeEl = document.getElementById('pb-time');
  const speedGroup = document.getElementById('pb-speeds');
  const modeGroup = document.getElementById('pb-modes');
  const basemapGroup = document.getElementById('pb-basemaps');
  if (!dataEl || !container || !hero || !bar || !playBtn || !scrub) return;

  let trackData: TrackData;
  try {
    trackData = JSON.parse(dataEl.textContent ?? '') as TrackData;
  } catch {
    return;
  }
  if (!trackData?.t?.length) return;

  const track = new Track(trackData);
  const core = new PlaybackCore(track);

  // The toggle is the flat-mapped registry (issue 09 growth path): each entry is a
  // {view factory, mode}. A mode change rebuilds the view from its factory, so the
  // controller never hard-codes an engine or a mode. Async create lazy-loads the
  // map bundle.
  const choices = mapModes();
  let view: MapView | null = null;
  // The live engine — the pivot for the swap-vs-setMode decision below (see `viewForMode`).
  let currentFactory: MapViewFactory | null = null;

  // The basemap is orthogonal to camera mode (issue 07): one choice shared across
  // every MapLibre mode, remembered here so it survives both in-place setMode changes
  // and full engine swaps (a rebuild restores it via create's `basemap` opt). Defaults
  // to the first advertised basemap (Map).
  let currentBasemap = mapBasemaps()[0]?.id ?? 'map';

  // The map-cursor → shared-cursor channel (ticket 4d). Late-bound: the map is built
  // in the background, but it only ever fires this at runtime, by when `onCursor`
  // points at the real seek. Clicking the track line seeks playback, which moves the
  // charts too — closing the chart↔map↔playback loop.
  let onCursor: (dist: number) => void = () => {};

  // The basemap toggle only makes sense for engines that advertise basemaps (Cesium's
  // globe carries its own imagery), so it's shown/hidden per live engine. When shown,
  // its active button reflects the remembered `currentBasemap`.
  const syncBasemapToggle = (factory: MapViewFactory | null): void => {
    if (!basemapGroup) return;
    const supported = (factory?.basemaps?.length ?? 0) > 0;
    basemapGroup.hidden = !supported;
    if (!supported) return;
    basemapGroup
      .querySelectorAll<HTMLElement>('[data-basemap]')
      .forEach((b) => b.classList.toggle('active', b.dataset.basemap === currentBasemap));
  };

  /** Build (or rebuild) the live view for `modeId`, replacing any current one. */
  const buildView = async (modeId: string): Promise<void> => {
    const choice = choices.find((c) => c.mode.id === modeId) ?? choices[0];
    const next = await choice.view.create(container, track, {
      onSeek: (dist) => onCursor(dist),
      // Restore the remembered basemap at build time so a rebuild (e.g. back from the
      // globe) shows the right base with no vector-then-satellite flash.
      basemap: currentBasemap,
    });
    next.setMode(choice.mode.id);
    view = next;
    currentFactory = choice.view;
    syncBasemapToggle(choice.view);
    // The map is live now — hide the static SVG placeholder (idempotent across swaps).
    hero.classList.add('hero--live');
  };

  bar.hidden = false;

  // The scrubber's integer range is the single source of seek resolution (the
  // markup owns `max`); the controller never hard-codes a step count of its own.
  const scrubMax = Number(scrub.max) || 1000;

  let rafId = 0;
  let lastTs = 0;
  let scrubbing = false;
  let swapping = false;

  // The charts are the third sync surface (ticket 4d), mounted independently of the
  // map: they stay live while the map bundle loads (and even if it fails). Clicking
  // one calls back with a distance; we seek playback there so the map marker + clock
  // + both chart cursors all land on the same point. The controller owns no cursor
  // state beyond the playback clock — that is the single shared cursor.
  const charts = mountCharts(track, (dist) => seekToDist(dist));

  const setPlayLabel = () => {
    playBtn.textContent = core.playing ? '⏸' : '▶';
    playBtn.setAttribute('aria-label', core.playing ? 'Pause' : 'Play');
  };

  const setClock = () => {
    if (timeEl) timeEl.textContent = `${fmtDuration(core.time)} / ${fmtDuration(core.duration)}`;
  };

  const render = (pose: RidePose) => {
    // During a mode swap there's briefly no live view (destroy → create); the clock
    // still advances and the bar still updates, the camera just catches up on rebuild.
    if (view) view.updateFrame(pose);
    // Chart cursors track the same pose — the readout shows the track's own value at
    // this distance (not the smoothed camera elevation), so the numbers are honest.
    charts.update(pose.distance);
    if (!scrubbing) scrub.value = String(Math.round(core.progress * scrubMax));
    setClock();
    setPlayLabel();
  };

  const loop = (ts: number) => {
    const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    render(core.frame(dt));
    if (core.playing) {
      rafId = requestAnimationFrame(loop);
    } else {
      rafId = 0;
      lastTs = 0;
    }
  };

  const startLoop = () => {
    if (!rafId) {
      lastTs = 0;
      rafId = requestAnimationFrame(loop);
    }
  };

  // A single absolute frame for paused/seek states (dt=0 → snaps after a seek).
  const renderOnce = () => render(core.frame(0));

  // Seek to a track distance and repaint once. This is the shared-cursor setter the
  // charts and the map both drive; playback drives itself via the rAF loop. seek()
  // resets smoothing so the pose snaps exactly to the hovered point.
  const seekToDist = (dist: number) => {
    core.seek(track.sampleByDist(dist).time);
    renderOnce();
  };
  onCursor = seekToDist;

  playBtn.addEventListener('click', () => {
    core.toggle();
    if (core.playing) startLoop();
    else renderOnce();
  });

  speedGroup?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-speed]');
    if (!btn) return;
    core.setSpeed(Number(btn.dataset.speed));
    speedGroup
      .querySelectorAll<HTMLElement>('[data-speed]')
      .forEach((b) => b.classList.toggle('active', b === btn));
  });

  modeGroup?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]');
    if (!btn || swapping || !btn.dataset.mode) return;
    const modeId = btn.dataset.mode;
    modeGroup
      .querySelectorAll<HTMLElement>('[data-mode]')
      .forEach((b) => b.classList.toggle('active', b === btn));

    // Same engine? Switch the camera mode in place — no teardown (issue 09: a mode
    // change within one view is `setMode`, only a *view* swap destroys/recreates).
    // This keeps every 2D↔3D↔chase toggle instant — no WebGL context churn, no
    // reload flash — since MapLibre owns all three modes today.
    if (view && viewForMode(modeId) === currentFactory) {
      view.setMode(modeId);
      renderOnce();
      return;
    }

    // Different engine (or no live view yet): swap the whole view (issue 09: destroy
    // → create → setMode). The clock is untouched, so playback keeps running through
    // the rebuild; we place the new camera at the current pose once it's ready.
    // Destroy first so two WebGL contexts never coexist.
    swapping = true;
    const old = view;
    view = null;
    currentFactory = null;
    old?.destroy();
    void buildView(modeId)
      .catch((err) => console.error('Camera mode switch failed:', err))
      .finally(() => {
        swapping = false;
        renderOnce();
      });
  });

  basemapGroup?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-basemap]');
    if (!btn || !btn.dataset.basemap) return;
    currentBasemap = btn.dataset.basemap;
    basemapGroup
      .querySelectorAll<HTMLElement>('[data-basemap]')
      .forEach((b) => b.classList.toggle('active', b === btn));
    // In-place swap on the live view — no rebuild, orthogonal to camera mode. If no
    // view is live yet (still building), the next buildView applies it via create.
    view?.setBasemap?.(currentBasemap);
    renderOnce();
  });

  scrub.addEventListener('input', () => {
    scrubbing = true;
    core.seek((Number(scrub.value) / scrubMax) * core.duration);
    renderOnce();
  });
  scrub.addEventListener('change', () => {
    scrubbing = false;
  });

  // Reclaim the WebGL context on navigation away (map rule: remove() on teardown).
  window.addEventListener(
    'pagehide',
    () => {
      if (rafId) cancelAnimationFrame(rafId);
      view?.destroy();
      charts.destroy();
    },
    { once: true },
  );

  // Initial state: the clock and the chart cursors are primed at the start straight
  // away (no map needed). The map is built in the background — its constructor's
  // fitted overview stays until the first play; on failure the static SVG hero
  // remains and the charts + bar still work. `swapping` guards this first build too,
  // so a mode click mid-load can't race a second `create` (issue 09: one live view).
  setClock();
  setPlayLabel();
  charts.update(0);
  swapping = true;
  void buildView(choices[0].mode.id)
    .catch((err) => console.error('Ride map failed to load:', err))
    .finally(() => {
      swapping = false;
    });
}
