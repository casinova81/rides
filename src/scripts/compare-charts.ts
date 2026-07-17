import { compareChartGeometry, type CompareChartGeometry, type ChartKind } from '../lib/chart';
import { fmtElevation, fmtSpeedKmh } from '../lib/format';
import type { Track } from '../lib/track';

// The compare charts' client half (ticket 6). The static SVGs are server-rendered
// from the same pure geometry (chart.ts); here we re-derive it to (a) map a click
// clientX back to a shared track distance and (b) place each ride's cursor line +
// readout. Each chart carries one cursor per ride: they diverge during the ghost
// race (each at its own distance) and coincide on a click (both at the clicked km).
// A cursor stops at its ride's own end, so a shorter ride's marker pins at its
// finish rather than running off the shared axis. Click-only by design — moving
// the pointer across a chart must never scrub the shared cursor.

interface CompareChartHandle {
  kind: ChartKind;
  svg: SVGSVGElement;
  cursors: SVGLineElement[]; // indexed by ride
  readouts: (HTMLElement | null)[]; // indexed by ride
  geom: CompareChartGeometry;
}

export interface CompareCharts {
  /** Move each ride's cursor + readout to that ride's own distance (m). */
  setCursors(distances: number[]): void;
  destroy(): void;
}

/**
 * Wire the stacked compare charts. `onScrub(distance)` fires when the pointer
 * presses on a chart (click or tap) — the controller turns that into a shared-km
 * cursor on both rides. Returns a no-op-safe handle when the charts aren't on the page.
 */
export function mountCompareCharts(tracks: Track[], onScrub: (dist: number) => void): CompareCharts {
  const root = document.getElementById('compare-charts');
  const handles: CompareChartHandle[] = [];
  const cleanups: Array<() => void> = [];

  root?.querySelectorAll<HTMLElement>('[data-chart-kind]').forEach((fig) => {
    const kind = fig.dataset.chartKind as ChartKind;
    const svg = fig.querySelector<SVGSVGElement>('svg.chart__svg');
    if (!svg) return;

    // Index cursors and readouts by their data-series so ride 0/1 always line up.
    const cursors: SVGLineElement[] = [];
    svg.querySelectorAll<SVGLineElement>('.chart__cursor').forEach((c) => {
      cursors[Number(c.dataset.series)] = c;
    });
    const readouts: (HTMLElement | null)[] = [];
    fig.querySelectorAll<HTMLElement>('[data-readout]').forEach((r) => {
      readouts[Number(r.dataset.series)] = r;
    });
    if (cursors.length === 0) return;

    const geom = compareChartGeometry(tracks, kind);
    handles.push({ kind, svg, cursors, readouts, geom });

    // clientX → viewBox x (the SVG stretches to its box, one linear factor) → distance.
    const toDist = (clientX: number): number => {
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return 0;
      return geom.distForX(((clientX - rect.left) / rect.width) * geom.width);
    };
    const onPress = (e: PointerEvent) => onScrub(toDist(e.clientX));
    svg.addEventListener('pointerdown', onPress);
    cleanups.push(() => {
      svg.removeEventListener('pointerdown', onPress);
    });
  });

  return {
    setCursors(distances) {
      for (const h of handles) {
        h.cursors.forEach((cursor, i) => {
          if (!cursor) return;
          // Clamp to the ride's own extent so a shorter ride's cursor stops at its end.
          const d = Math.min(distances[i] ?? 0, tracks[i].totalDistance);
          const x = String(h.geom.xForDist(d));
          cursor.setAttribute('x1', x);
          cursor.setAttribute('x2', x);
          cursor.style.display = '';
          const readout = h.readouts[i];
          if (readout) {
            const sample = tracks[i].sampleByDist(d);
            readout.textContent =
              h.kind === 'elevation' ? fmtElevation(sample.ele) : fmtSpeedKmh(sample.speed);
          }
        });
      }
    },
    destroy() {
      for (const c of cleanups) c();
    },
  };
}
