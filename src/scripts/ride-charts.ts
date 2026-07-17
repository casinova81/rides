import { chartGeometry, type ChartGeometry, type ChartKind } from '../lib/chart';
import { fmtElevation, fmtSpeedKmh } from '../lib/format';
import type { Track } from '../lib/track';

// The chart half of the ticket-4d sync. The static SVGs are server-rendered from
// the same pure geometry (chart.ts); here we re-derive it client-side to (a) map a
// hover clientX back to a track distance and (b) place each chart's cursor line at
// the shared position. Hover reports a distance out via `onScrub` — the controller
// seeks playback there, which drives the map and the readouts. So every surface
// funnels through one shared cursor (the playback position); the chart never holds
// state of its own. `update` is called each rendered frame with the current pose.

interface ChartHandle {
  kind: ChartKind;
  svg: SVGSVGElement;
  cursor: SVGLineElement;
  readout: HTMLElement | null;
  geom: ChartGeometry;
}

export interface Charts {
  /** Move both cursor lines + readouts to `distance` (m), reading the track sample there. */
  update(distance: number): void;
  /** Remove the hover listeners. */
  destroy(): void;
}

/**
 * Wire the stacked charts under the hero. `onScrub(distance)` fires as the pointer
 * moves over (or presses on) a chart — the controller turns that into a seek, so
 * the map cursor and playback follow. Returns a no-op-safe handle when the charts
 * aren't on the page (the controller is a single mount point for the detail hero).
 */
export function mountCharts(track: Track, onScrub: (dist: number) => void): Charts {
  const root = document.getElementById('ride-charts');
  const handles: ChartHandle[] = [];
  const cleanups: Array<() => void> = [];

  root?.querySelectorAll<HTMLElement>('[data-chart-kind]').forEach((fig) => {
    const kind = fig.dataset.chartKind as ChartKind;
    const svg = fig.querySelector<SVGSVGElement>('svg.chart__svg');
    const cursor = svg?.querySelector<SVGLineElement>('.chart__cursor') ?? null;
    if (!svg || !cursor) return;
    const readout = fig.querySelector<HTMLElement>('[data-readout]');
    const geom = chartGeometry(track, kind);
    handles.push({ kind, svg, cursor, readout, geom });

    // clientX → viewBox x (the SVG stretches to its box, so this is one linear
    // factor) → distance. distForX clamps to the track, so edge hovers are safe.
    const toDist = (clientX: number): number => {
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return 0;
      return geom.distForX(((clientX - rect.left) / rect.width) * geom.width);
    };
    const onMove = (e: PointerEvent) => onScrub(toDist(e.clientX));
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerdown', onMove);
    cleanups.push(() => {
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerdown', onMove);
    });
  });

  return {
    update(distance) {
      const sample = track.sampleByDist(distance);
      for (const h of handles) {
        const x = String(h.geom.xForDist(distance));
        h.cursor.setAttribute('x1', x);
        h.cursor.setAttribute('x2', x);
        h.cursor.style.display = '';
        if (h.readout) {
          h.readout.textContent =
            h.kind === 'elevation' ? fmtElevation(sample.ele) : fmtSpeedKmh(sample.speed);
        }
      }
    },
    destroy() {
      for (const c of cleanups) c();
    },
  };
}
