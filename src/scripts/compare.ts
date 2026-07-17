import 'maplibre-gl/dist/maplibre-gl.css';
import { Track } from '../lib/track';
import { PlaybackCore } from '../lib/playback';
import { COMPARE_COLOR_LIST, GHOST_DEFAULT_SPEED, leaderReadout } from '../lib/compare';
import { fmtDuration, fmtKm } from '../lib/format';
import { escapeHtml } from '../lib/html';
import { mountCompareMap, type CompareMap } from './compare-map';
import { mountCompareCharts } from './compare-charts';
import type { Track as TrackData } from '../lib/types';

// The compare-page controller (ticket 6 / issue 13). Wires two engine-agnostic
// PlaybackCores to the overlay map, the shared-axis charts, and the ghost-race bar.
// The two cores run in lockstep off one shared clock: same speed, same dt, so they
// diverge only when the shorter ride reaches its end (its core auto-pauses there
// while the longer keeps going). The controller — not core.play() — owns restart,
// so a mid-race pause/resume never desyncs a ride that had already finished.
// Cursors are keyed by distance: hovering a chart or the map moves both rides to
// the same km; the race moves each ride to its own distance at the shared time.

interface RideData {
  name: string;
  track: TrackData;
}

/** Mount the ghost race + synced surfaces. No-ops when the markup isn't present. */
export async function mountCompare(): Promise<void> {
  const dataEl = document.getElementById('compare-data');
  const container = document.getElementById('compare-map');
  const bar = document.getElementById('ghost');
  const playBtn = document.getElementById('gh-play') as HTMLButtonElement | null;
  const scrub = document.getElementById('gh-scrub') as HTMLInputElement | null;
  const timeEl = document.getElementById('gh-time');
  const speedGroup = document.getElementById('gh-speeds');
  const leaderEl = document.getElementById('gh-leader');
  if (!dataEl || !container || !bar || !playBtn || !scrub) return;

  let parsed: RideData[];
  try {
    parsed = JSON.parse(dataEl.textContent ?? '') as RideData[];
  } catch {
    return;
  }
  if (parsed?.length !== 2 || !parsed[0].track?.t?.length || !parsed[1].track?.t?.length) return;

  const names = parsed.map((p) => p.name);
  const tracks = parsed.map((p) => new Track(p.track));
  const colors = COMPARE_COLOR_LIST;
  const cores = tracks.map((t) => new PlaybackCore(t));
  cores.forEach((c) => c.setSpeed(GHOST_DEFAULT_SPEED));

  const durMax = Math.max(...cores.map((c) => c.duration));
  // The shared clock reads from the longer ride's core (the one still advancing
  // after the shorter has finished); both share the same virtual time until then.
  const master = cores[0].duration >= cores[1].duration ? cores[0] : cores[1];

  // Charts mount synchronously and stay live even if the map bundle fails to load.
  const charts = mountCompareCharts(tracks, (dist) => hoverAt(dist));
  let map: CompareMap | null = null;

  bar.hidden = false;
  const scrubMax = Number(scrub.max) || 1000;
  let rafId = 0;
  let lastTs = 0;
  let scrubbing = false;

  const anyPlaying = () => cores.some((c) => c.playing);

  const setPlayLabel = () => {
    playBtn.textContent = anyPlaying() ? '⏸' : '▶';
    playBtn.setAttribute('aria-label', anyPlaying() ? 'Pause' : 'Play');
  };

  const setClock = () => {
    if (timeEl) timeEl.textContent = `${fmtDuration(master.time)} / ${fmtDuration(durMax)}`;
  };

  const setLeader = (distances: number[]) => {
    if (!leaderEl) return;
    const { leader, gap } = leaderReadout(distances[0], distances[1]);
    if (leader === null) {
      leaderEl.textContent = 'Neck and neck';
      return;
    }
    const i = leader === 'a' ? 0 : 1;
    leaderEl.innerHTML = `<b style="color:${colors[i]}">${escapeHtml(names[i])}</b> ahead by ${fmtKm(gap)}`;
  };

  /** Place both markers + both chart cursors at the given per-ride distances. */
  const renderCursors = (distances: number[]) => {
    distances.forEach((d, i) => map?.setCursor(i, d));
    charts.setCursors(distances);
  };

  const renderFrame = (distances: number[]) => {
    renderCursors(distances);
    setLeader(distances);
    if (!scrubbing) {
      scrub.value = String(Math.round((durMax > 0 ? master.time / durMax : 0) * scrubMax));
    }
    setClock();
    setPlayLabel();
  };

  const loop = (ts: number) => {
    const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    renderFrame(cores.map((c) => c.frame(dt).distance));
    if (anyPlaying()) {
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

  // A single absolute frame for paused/seek/hover states (dt=0 snaps after a seek).
  const renderOnce = () => renderFrame(cores.map((c) => c.frame(0).distance));

  const pause = () => {
    cores.forEach((c) => c.pause());
    renderOnce();
  };

  const resume = () => {
    // Restart is a whole-race decision: only when the shared clock is spent do both
    // rides go back to 0. Otherwise resume just the cores that haven't finished —
    // a ride already at its end stays pinned there rather than restarting alone.
    if (master.time >= durMax) cores.forEach((c) => c.seek(0));
    cores.forEach((c) => {
      if (c.time < c.duration) c.play();
    });
    startLoop();
  };

  /**
   * Hover inspection: move both rides to the same km. Ignored while the race runs —
   * the rAF loop owns the cursors then, so hover only bites when paused/idle.
   */
  const hoverAt = (dist: number) => {
    if (anyPlaying()) return;
    renderCursors([dist, dist]);
  };

  playBtn.addEventListener('click', () => {
    if (anyPlaying()) pause();
    else resume();
  });

  speedGroup?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-speed]');
    if (!btn) return;
    cores.forEach((c) => c.setSpeed(Number(btn.dataset.speed)));
    speedGroup
      .querySelectorAll<HTMLElement>('[data-speed]')
      .forEach((b) => b.classList.toggle('active', b === btn));
  });

  scrub.addEventListener('input', () => {
    scrubbing = true;
    const t = (Number(scrub.value) / scrubMax) * durMax;
    cores.forEach((c) => c.seek(t));
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
      map?.destroy();
      charts.destroy();
    },
    { once: true },
  );

  // Prime the clock, cursors, and leader at the start; the map builds in the
  // background (its fitted overview stays until then) and snaps its markers on load.
  renderOnce();
  void mountCompareMap(container, tracks, colors, (dist) => {
    if (dist !== null) hoverAt(dist);
  })
    .then((m) => {
      map = m;
      renderOnce();
    })
    .catch((err) => {
      console.error('Compare map failed to load:', err);
    });
}
