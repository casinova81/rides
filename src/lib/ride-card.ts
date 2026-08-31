import type { IndexSummary } from './types';
import { fmtKm, fmtElevation, fmtSpeedKmh, fmtDuration, fmtDate } from './format';
import { polylineThumb } from './thumb';
import { escapeHtml } from './html';

// The shared ride card (issue 04), extracted here in ticket 3a. Rendered from an
// index summary (dashboard/library) or a freshly-derived ride (upload results).
// Pure HTML string with no framework, so it drops into an Astro `set:html` and
// into client-side `innerHTML` unchanged. Card click → the ride detail page.

export interface RideCardOptions {
  /** Show the trophy badge — the ride currently holds ≥1 record (derived by the caller). */
  holdsRecord?: boolean;
}

function stat(label: string, value: string): string {
  return `<div class="rc-stat"><span class="rc-v">${value}</span><span class="rc-l">${label}</span></div>`;
}

/** One ride's card: route thumbnail, name, date, and key stats, linking to `/rides/<id>`. */
export function rideCardHTML(summary: IndexSummary, opts: RideCardOptions = {}): string {
  const { id, name, start, stats } = summary;
  const trophy = opts.holdsRecord ? '<span class="trophy" title="Holds a record">🏆</span>' : '';
  return `<a class="ride-card card" href="/rides/${encodeURIComponent(id)}">
  <div class="rc-thumb">${polylineThumb(summary.polyline)}${trophy}</div>
  <div class="rc-body">
    <div class="rc-name">${escapeHtml(name)}</div>
    <div class="rc-date">${fmtDate(start)}</div>
    <div class="rc-stats">
      ${stat('Distance', fmtKm(stats.distance))}
      ${stat('Elevation', `↑ ${fmtElevation(stats.elevationGain)}`)}
      ${stat('Avg speed', fmtSpeedKmh(stats.avgMovingSpeed))}
      ${stat('Moving', fmtDuration(stats.movingTime))}
      ${stat('Idle', fmtDuration(stats.duration - stats.movingTime))}
    </div>
  </div>
</a>`;
}
