/**
 * U4 — colour assignment for a routine's main lifts (ADR-0047 §4.1, SPEC.md §3.6/§4.1).
 *
 * `theme.data.series` is four fixed slots. A main lift always wears the same slot on every
 * chart, tile and dot of its routine, so the routine's exercises must be walked in one stable
 * order and the first main lift seen takes slot 0, the second slot 1, and so on. `sort_order` on
 * `SessionExercises` is scoped to one session, not the whole routine (each day starts back at
 * 0), so this module does not re-derive the order itself — it trusts the order it is given and
 * only decides which of those exercises are main lifts and which slot each gets. The caller
 * (a screen already walking sessions in display order to render day blocks) is where "the whole
 * routine's order" is actually known; duplicating that walk here would be a second, possibly
 * disagreeing, definition of order.
 *
 * Accessories never get a slot: they are not in the returned map, so `has()` doubles as
 * "does this exercise carry a series colour at all" (ADR-0047 — colour means data, never chrome).
 * A fifth-or-later main lift wraps back to slot 0 rather than growing the palette — the palette
 * is fixed at four (ADR-0047), and a routine with that many main lifts is already reading its
 * chart by the legend, not by memorised colour.
 */

export interface LiftColourCandidate {
  /** Whatever identifies this exercise row to the caller — an exerciseId, a session-exercise id. */
  id: number;
  role: 'main' | 'accessory';
}

const SERIES_SLOT_COUNT = 4;

/**
 * Main lifts, in the order they are given, mapped to their fixed `theme.data.series` slot
 * (0-3). Accessories are absent from the result.
 */
export function mainLiftColours(
  exercisesInOrder: readonly LiftColourCandidate[],
): ReadonlyMap<number, number> {
  const colours = new Map<number, number>();
  let nextSlot = 0;
  for (const exercise of exercisesInOrder) {
    if (exercise.role !== 'main') {
      continue;
    }
    colours.set(exercise.id, nextSlot % SERIES_SLOT_COUNT);
    nextSlot += 1;
  }
  return colours;
}
