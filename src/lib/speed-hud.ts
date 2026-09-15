import type { Track } from './track';

// The live speed HUD over the playback map: a large current-speed readout with a
// small time-keyed sparkline behind it showing the speed over the last and next
// `HUD_HALF_WINDOW` seconds of ride time. Pure geometry (like chart.ts) so the
// controller only stamps the path/number into a fixed-viewBox SVG each frame and
// the mapping itself is unit-tested. Time-keyed — not distance-keyed like the
// charts — because "the next thirty seconds" is a clock statement: a stop shows
// as a flat floor rather than collapsing to a point.
//
// The y scale is fixed per ride (0 .. the ride's max speed) so the curve does not
// re-scale from frame to frame; only the window slides. Samples outside the ride
// (before the start, after the end) are omitted rather than clamped, so the graph
// visibly starts at "now" at the beginning of a ride and runs out at the end.

/** Seconds of ride time shown on each side of "now". */
export const HUD_HALF_WINDOW = 30;
/** Fixed viewBox width; the SVG stretches to the HUD's box. */
export const HUD_W = 240;
/** Fixed viewBox height. */
export const HUD_H = 72;
/** Samples across the full window (one per second at ±30 s). */
const COLS = 2 * HUD_HALF_WINDOW + 1;

export interface HudScale {
  /** Ride time (s) → x in viewBox units, with `now` at the centre. */
  xForTime(t: number, now: number): number;
  /** Speed (m/s) → y in viewBox units (0 at the bottom edge, max at the top). */
  yForSpeed(v: number): number;
  /** The ride's speed ceiling the y axis is pinned to (m/s). */
  maxSpeed: number;
}

/** The fixed per-ride scale; the ceiling is the track's max smoothed speed (≥ 1 m/s so a stationary ride still draws). */
export function hudScale(track: Track): HudScale {
  let max = 0;
  for (const v of track.data.speed) if (v > max) max = v;
  const maxSpeed = Math.max(1, max);
  const halfW = HUD_W / 2;
  return {
    maxSpeed,
    xForTime: (t, now) => halfW + ((t - now) / HUD_HALF_WINDOW) * halfW,
    yForSpeed: (v) => HUD_H - (Math.max(0, Math.min(maxSpeed, v)) / maxSpeed) * HUD_H,
  };
}

export interface HudFrame {
  /** The speed at `now` (m/s), read from the track. */
  speed: number;
  /** The sparkline `M…L…` path over the visible part of the window (empty if none). */
  path: string;
  /** The same line closed down to the baseline for a fill (empty if no path). */
  area: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Geometry for one frame centred on ride time `now`. Samples the smoothed speed
 * once per second across [now − 30, now + 30], dropping seconds that fall outside
 * the ride, so the path covers only real track time.
 */
export function hudFrame(track: Track, scale: HudScale, now: number): HudFrame {
  const duration = track.duration;
  const speed = track.sampleByTime(now).speed;
  let path = '';
  let first = -1;
  let last = -1;
  for (let i = 0; i < COLS; i++) {
    const t = now - HUD_HALF_WINDOW + i;
    if (t < 0 || t > duration) continue;
    const x = round(scale.xForTime(t, now));
    const y = round(scale.yForSpeed(track.sampleByTime(t).speed));
    path += `${path ? 'L' : 'M'}${x} ${y}`;
    if (first < 0) first = x;
    last = x;
  }
  const area = path ? `${path}L${last} ${HUD_H}L${first} ${HUD_H}Z` : '';
  return { speed, path, area };
}
