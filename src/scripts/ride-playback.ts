import 'maplibre-gl/dist/maplibre-gl.css';
import { Track } from '../lib/track';
import { PlaybackCore } from '../lib/playback';
import { mapModes, type MapView } from '../lib/mapview';
import { fmtDuration } from '../lib/format';
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
  if (!dataEl || !container || !hero || !bar || !playBtn || !scrub) return;

  let trackData: TrackData;
  try {
    trackData = JSON.parse(dataEl.textContent ?? '') as TrackData;
  } catch {
    return;
  }
  if (!trackData?.t?.length) return;

  const track = new Track(trackData);

  // The toggle is the flat-mapped registry (issue 09 growth path): each entry is a
  // {view factory, mode}. A mode change rebuilds the view from its factory, so the
  // controller never hard-codes an engine or a mode. Async create lazy-loads the
  // map bundle.
  const choices = mapModes();
  let view: MapView | null = null;

  /** Build (or rebuild) the live view for `modeId`, replacing any current one. */
  const buildView = async (modeId: string): Promise<void> => {
    const choice = choices.find((c) => c.mode.id === modeId) ?? choices[0];
    const next = await choice.view.create(container, track, {});
    next.setMode(choice.mode.id);
    view = next;
  };

  // On initial failure we leave the static SVG placeholder rather than a broken hero.
  try {
    await buildView(choices[0].mode.id);
  } catch (err) {
    console.error('Ride map failed to load:', err);
    return;
  }

  const core = new PlaybackCore(track);
  hero.classList.add('hero--live');
  bar.hidden = false;

  // The scrubber's integer range is the single source of seek resolution (the
  // markup owns `max`); the controller never hard-codes a step count of its own.
  const scrubMax = Number(scrub.max) || 1000;

  let rafId = 0;
  let lastTs = 0;
  let scrubbing = false;
  let swapping = false;

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

    // Swap the whole engine view (issue 09: destroy → create → setMode). The clock
    // is untouched, so playback keeps running through the rebuild; we place the new
    // camera at the current pose once it's ready. Destroy first so two WebGL
    // contexts never coexist.
    swapping = true;
    const old = view;
    view = null;
    old?.destroy();
    void buildView(modeId)
      .catch((err) => console.error('Camera mode switch failed:', err))
      .finally(() => {
        swapping = false;
        renderOnce();
      });
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
    },
    { once: true },
  );

  // Initial state: the constructor's fitted overview stays until the first play,
  // with the marker parked at the start; only the clock needs priming.
  setClock();
  setPlayLabel();
}
