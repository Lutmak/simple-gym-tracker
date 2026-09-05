/**
 * A routine's main lifts, coloured (ADR-0047 §4.1, SPEC.md U2/U3/U4).
 *
 * "The same lift is the same colour on every chart, tile and row of its routine" only holds if
 * the assignment is made the same way everywhere: Inicio's hero dot, Progreso's strength chart
 * and legend, and Rutinas' day-block markers must all agree on which of the four
 * `theme.data.series` slots belongs to Squat. This module is that one place.
 *
 * Order is the routine's own session order, then in-session `sort_order` — a main lift's plan
 * position, not its name or a database id — because that is the order a user reads the routine
 * in. This module does not re-derive that order itself: each caller is already walking its rows
 * in some display order of its own (a screen rendering day blocks, a chart already built from
 * lifts loaded in `sort_order`), so it trusts the order it is given rather than duplicating a
 * second, possibly disagreeing, definition of "the routine's order". Callers whose rows are not
 * already in that order (session `sort_order` then exercise `sort_order`) must sort before
 * calling.
 *
 * Identity is the exercise's name (or catalog key), not a row id: two `SessionExercises` rows
 * are two different database rows even when they are the same lift shown on two different days
 * (rare, but 5/3/1 templates can repeat a lift), and they must still resolve to one colour.
 * Accessories are never assigned a slot — they carry no series colour at all, so a caller can use
 * `has()` to ask "does this exercise carry a series colour" (ADR-0047 — colour means data, never
 * chrome). A fifth-or-later distinct main lift wraps back to slot 0 rather than growing the
 * palette: the palette is fixed at four (ADR-0047), and a routine with that many main lifts is
 * already reading its chart by the legend, not by memorised colour.
 *
 * The return value is the `theme.data.series` **index** (0-3), not a resolved colour string —
 * this module has no theme dependency, so a caller resolves `tokens.data.series[index]` itself
 * once it has its theme in scope.
 */

export interface LiftColourCandidate {
  /** The exercise's name, or its catalog key if the caller has one — whichever is the stable
   * identity the caller already has cheaply to hand. Two rows with the same name are the same
   * lift and share one colour. */
  name: string;
  role: 'main' | 'accessory';
}

const SERIES_SLOTS = 4;

/**
 * The main lifts in `exercisesInOrder`, each mapped to a `theme.data.series` index (0-3).
 * Accessories are absent from the result. A name seen more than once keeps the slot of its
 * first occurrence.
 */
export function mainLiftColours(
  exercisesInOrder: readonly LiftColourCandidate[],
): ReadonlyMap<string, number> {
  const colours = new Map<string, number>();
  for (const exercise of exercisesInOrder) {
    if (exercise.role !== 'main') {
      continue;
    }
    if (!colours.has(exercise.name)) {
      colours.set(exercise.name, colours.size % SERIES_SLOTS);
    }
  }
  return colours;
}
