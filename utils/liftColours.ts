/**
 * A routine's main lifts, coloured (ADR-0047 §4.1, SPEC.md U2/U3).
 *
 * The same lift must be the same colour on every chart, tile and row of its routine — Inicio's
 * hero dot, Progreso's strength chart and legend, the runner's set rows. That single fact is the
 * whole module: assign `theme.data.series` in ascending `sort_order`, never by name, database id
 * or the order rows happen to load in, and never reassign once given.
 *
 * U2 is adding its own copy of this function under the same name and signature-by-intent, from
 * its own worktree; the supervisor reconciles the two at merge (SPEC.md U3 task brief).
 */

export interface MainLiftIdentity {
  name: string;
  sortOrder: number;
}

/**
 * `name` → its fixed series colour. Ties in `sortOrder` keep the order they arrived in; a lift
 * appearing more than once (rare — the same exercise as `main` in two sessions) is coloured once,
 * by its first occurrence, since every occurrence must agree.
 */
export function mainLiftColours(
  mainLifts: readonly MainLiftIdentity[],
  series: readonly [string, string, string, string],
): ReadonlyMap<string, string> {
  const ordered = [...mainLifts].sort((a, b) => a.sortOrder - b.sortOrder);
  const colours = new Map<string, string>();
  for (const lift of ordered) {
    if (!colours.has(lift.name)) {
      colours.set(lift.name, series[colours.size % series.length]);
    }
  }
  return colours;
}
