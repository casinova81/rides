import { hudScale, hudFrame } from '../lib/speed-hud';
import { fmtKmhNumber } from '../lib/format';
import type { Track } from '../lib/track';

// The speed HUD's DOM half. The geometry lives in lib/speed-hud.ts; here we stamp
// one frame into the fixed-viewBox SVG the page renders and set the big number.
// Driven by the shared playback cursor (a track distance), exactly like the charts:
// the readout shows the track's own smoothed speed at that distance, and the
// sparkline is centred on that sample's ride time — so the number and the curve's
// centre always agree.

export interface SpeedHud {
  /** Repaint for the shared cursor at `distance` metres along the track. */
  update(distance: number): void;
}

/** Wire the HUD in the hero; a no-op handle when the markup isn't on the page. */
export function mountSpeedHud(track: Track): SpeedHud {
  const root = document.getElementById('speed-hud');
  const value = document.getElementById('hud-speed');
  const line = document.getElementById('hud-line');
  const area = document.getElementById('hud-area');
  if (!root || !value || !line || !area) return { update() {} };

  const scale = hudScale(track);
  root.hidden = false;

  let lastText = '';
  return {
    update(distance) {
      const now = track.sampleByDist(distance).time;
      const f = hudFrame(track, scale, now);
      line.setAttribute('d', f.path);
      area.setAttribute('d', f.area);
      // Only touch the text node when the rendered number changes (avoids a
      // layout pass per frame while the value holds steady).
      const text = fmtKmhNumber(f.speed);
      if (text !== lastText) {
        value.textContent = text;
        lastText = text;
      }
    },
  };
}
