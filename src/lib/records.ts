import type { IndexSummary, Records, RecordEntry } from './types';

// Records are recomputed from the index summaries on every change — never
// incrementally maintained (issue 03), so a delete or overwrite can never leave
// a stale leaderboard. 8 categories; each holds the ride id + winning value.

const MIN_AVG_SPEED_DISTANCE = 20000; // avg-speed record is for rides ≥ 20 km only

/** Pick the summary maximizing `value`, ignoring rides where `value` is null. */
function best(
  summaries: IndexSummary[],
  value: (s: IndexSummary) => number | null | undefined,
): RecordEntry | null {
  let winner: RecordEntry | null = null;
  for (const s of summaries) {
    const v = value(s);
    if (v == null) continue;
    if (winner === null || v > winner.value) winner = { rideId: s.id, value: v };
  }
  return winner;
}

/** Pick the summary minimizing `value` (fastest time), ignoring nulls. */
function fastest(
  summaries: IndexSummary[],
  value: (s: IndexSummary) => number | null | undefined,
): RecordEntry | null {
  let winner: RecordEntry | null = null;
  for (const s of summaries) {
    const v = value(s);
    if (v == null) continue;
    if (winner === null || v < winner.value) winner = { rideId: s.id, value: v };
  }
  return winner;
}

/**
 * The fastest-window records live on the per-ride `bests`, which the index
 * summary doesn't carry. Callers pass a lookup from ride id → its window times.
 */
export interface WindowTimes {
  '5k': number | null;
  '10k': number | null;
  '20k': number | null;
}

export function recomputeRecords(
  summaries: IndexSummary[],
  windowsById: Map<string, WindowTimes>,
): Records {
  const win = (id: string, k: keyof WindowTimes) => windowsById.get(id)?.[k] ?? null;
  return {
    longestDistance: best(summaries, (s) => s.stats.distance),
    mostElevationGain: best(summaries, (s) => s.stats.elevationGain),
    fastest5k: fastest(summaries, (s) => win(s.id, '5k')),
    fastest10k: fastest(summaries, (s) => win(s.id, '10k')),
    fastest20k: fastest(summaries, (s) => win(s.id, '20k')),
    fastestAvgSpeed: best(summaries, (s) =>
      s.stats.distance >= MIN_AVG_SPEED_DISTANCE ? s.stats.avgMovingSpeed : null,
    ),
    maxSpeed: best(summaries, (s) => s.stats.maxSpeed),
    longestMovingTime: best(summaries, (s) => s.stats.movingTime),
  };
}
