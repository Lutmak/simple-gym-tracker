import type { DataTokens } from './theme';

/**
 * Enough of an exercise to place it in `theme.data.series` (ADR-0047 §4.1): its name and whether
 * it is a main lift. `sort_order` is not a field here — every query this app loads exercises with
 * already orders by it (`ORDER BY sort_order` in `SessionExercises`/routine reads), so the array
 * itself carries the order; a caller holding exercises in any other order must sort them first.
 */
export interface LiftForColour {
  name: string;
  role: 'main' | 'accessory';
}

/**
 * Assigns each of a routine's main lifts one of the four `data.series` colours, in the routine's
 * own `sort_order` — so the same lift is the same colour on every chart, tile and row of that
 * routine (ADR-0047). Accessories never receive one. A lift with the same name met twice (an
 * upper/lower split training the same main lift on two days) keeps the colour of its first
 * occurrence rather than claiming a second slot; a fifth main lift cycles back to the first
 * colour rather than running out.
 */
export function mainLiftColours(
  exercises: readonly LiftForColour[],
  series: DataTokens['series'],
): ReadonlyMap<string, string> {
  const colours = new Map<string, string>();
  for (const exercise of exercises) {
    if (exercise.role !== 'main' || colours.has(exercise.name)) {
      continue;
    }
    colours.set(exercise.name, series[colours.size % series.length]);
  }
  return colours;
}
