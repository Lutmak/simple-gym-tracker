/**
 * U2 — the routine-wide main-lift colour assignment (ADR-0047 §4.1, SPEC.md U2/U3).
 *
 * "The same lift is the same colour on every chart, tile and row of that routine" only holds if
 * the assignment is made once, from the routine's own plan, rather than once per screen: Inicio's
 * exercise-row dot and Progreso's chart legend must agree on which of the four `theme.data.series`
 * slots belongs to Squat. This module is that one place. It is shape-agnostic on purpose — Inicio's
 * queue rows and Progreso's plan rows carry the same three facts (which session, that session's
 * own order, and the exercise's role and order within it) under different type names, so this
 * takes a minimal row shape rather than importing either screen's own row type and coupling them
 * to each other.
 *
 * Order is session order first, then in-session order — a main lift's plan position, not its name
 * or its database id — because that is the order a user reads the routine in and the only one a
 * screen can already sort by without a fourth lookup. Only `role === 'main'` rows count: an
 * accessory is never assigned a series slot, it has no chart of its own to colour.
 */

export interface MainLiftOrderRow {
  sessionSortOrder: number;
  exerciseSortOrder: number;
  name: string;
  role: 'main' | 'accessory';
}

/** `theme.data.series` has exactly four slots (ADR-0047); a fifth distinct main lift wraps. */
const SERIES_SLOTS = 4;

/**
 * The routine's main lifts, first-occurrence order, each mapped to a `theme.data.series` index.
 * A lift named more than once (the same exercise as the main lift of two sessions) keeps the slot
 * of its first appearance rather than being assigned a second one.
 */
export function mainLiftColours(rows: readonly MainLiftOrderRow[]): ReadonlyMap<string, number> {
  const ordered = [...rows]
    .filter((row) => row.role === 'main')
    .sort(
      (a, b) =>
        a.sessionSortOrder - b.sessionSortOrder || a.exerciseSortOrder - b.exerciseSortOrder,
    );

  const colours = new Map<string, number>();
  for (const row of ordered) {
    if (!colours.has(row.name)) {
      colours.set(row.name, colours.size % SERIES_SLOTS);
    }
  }
  return colours;
}
