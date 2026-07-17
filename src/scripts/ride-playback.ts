import 'maplibre-gl/dist/maplibre-gl.css';
import { Track } from '../lib/track';
import { PlaybackCore } from '../lib/playback';
import { mapModes, type MapView } from '../lib/mapview';
import { fmtDuration } from '../lib/format';
import type { RidePose, Track as TrackData } from '../lib/types';

// The ride-detail playback controller (ticket 4b). Wires the engine-agnostic
// PlaybackCore to a live MapView over the map hero, plus the translucent playback
// bar. The rAF loop runs only while playing (map rule, issue 07); paused/seek
// states render a single frame. Everything engine-specific stays behind the seam.

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
  if (!dataEl || !container || !hero || !bar || !playBtn || !scrub) return;

  let trackData: TrackData;
  try {
    trackData = JSON.parse(dataEl.textContent ?? '') as TrackData;
  } catch {
    return;
  }
  if (!trackData?.t?.length) return;

  const track = new Track(trackData);

  // Default = first mode of the first registered view (issue 09 growth path); the
  // 2D/3D/chase toggle grows from the same registry in later tickets. Async create
  // lazy-loads the map engine bundle. On failure we leave the static SVG placeholder
  // in place rather than showing a broken hero.
  const [{ view: factory, mode }] = mapModes();
  let view: MapView;
  try {
    view = await factory.create(container, track, {});
    view.setMode(mode.id);
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

  const setPlayLabel = () => {
    playBtn.textContent = core.playing ? '⏸' : '▶';
    playBtn.setAttribute('aria-label', core.playing ? 'Pause' : 'Play');
  };

  const setClock = () => {
    if (timeEl) timeEl.textContent = `${fmtDuration(core.time)} / ${fmtDuration(core.duration)}`;
  };

  const render = (pose: RidePose) => {
    view.updateFrame(pose);
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
      view.destroy();
    },
    { once: true },
  );

  // Initial state: the constructor's fitted overview stays until the first play,
  // with the marker parked at the start; only the clock needs priming.
  setClock();
  setPlayLabel();
}
