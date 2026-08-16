/**
 * R3 — the training days of a routine, as a pure value (SPECS.md R3).
 *
 * The defect this module removes: both routine builders let the user reorder
 * training days with a pair of up/down arrows, and refused a weekday that was
 * already taken with an alert ("Muévela primero"). That is a list editor
 * pretending to be a calendar — the order of a week is not a user preference,
 * it is Monday to Sunday, and a day the user configured must never disappear
 * because they tapped another one.
 *
 * So: **days are chosen directly**, the week's order is derived from the
 * weekday plus the `firstWeekday` setting, and reassigning a day that another
 * session already owns **swaps the two** — both sessions keep their exercises
 * and their names, only their dates change (§3.1's "a moved session keeps its
 * exercises"). Nothing here can delete a day; removal is its own explicit
 * action in the screen.
 *
 * Everything is a pure function over `{ key, weekday }`, which is all the two
 * builders' drafts have in common — `EditRoutineScreen`'s sessions and
 * `FiveThreeOneSetupScreen`'s lift days both satisfy it.
 */

export type FirstWeekday = 'Sunday' | 'Monday';

/** The least a value needs to be placeable in a week. */
export interface TrainingDaySlot {
  /** Stable client key for React; the database assigns its own row id. */
  key: string;
  /** 0 = Sunday … 6 = Saturday, as every other date value in this app. */
  weekday: number;
}

const WEEKDAYS = 7;

/** The seven weekdays in the user's own week order. */
export function weekdayOrder(firstWeekday: FirstWeekday): number[] {
  const start = firstWeekday === 'Monday' ? 1 : 0;
  return Array.from({ length: WEEKDAYS }, (_, index) => (start + index) % WEEKDAYS);
}

/** The weekdays already spoken for, so a picker can say what a cell holds. */
export function usedWeekdays(days: readonly TrainingDaySlot[]): Set<number> {
  return new Set(days.map((day) => day.weekday));
}

/** The day sitting on a weekday, ignoring one key — the one being moved. */
export function dayOnWeekday<T extends TrainingDaySlot>(
  days: readonly T[],
  weekday: number,
  exceptKey?: string,
): T | null {
  return (
    days.find((day) => day.weekday === weekday && day.key !== exceptKey) ?? null
  );
}

/**
 * Moves one day to a weekday. When another day already holds it the two swap,
 * so the count of training days is invariant under any sequence of
 * assignments — a reassignment is a move, never a delete. An unknown key or a
 * weekday outside 0–6 leaves the week untouched.
 */
export function assignWeekday<T extends TrainingDaySlot>(
  days: readonly T[],
  key: string,
  weekday: number,
): T[] {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday >= WEEKDAYS) {
    return [...days];
  }
  const moving = days.find((day) => day.key === key);
  if (moving === undefined || moving.weekday === weekday) {
    return [...days];
  }
  const displaced = dayOnWeekday(days, weekday, key);
  return days.map((day) => {
    if (day.key === key) {
      return { ...day, weekday };
    }
    if (displaced !== null && day.key === displaced.key) {
      return { ...day, weekday: moving.weekday };
    }
    return day;
  });
}

/** The days in the order the user's own week runs, which is the plan's order. */
export function orderByWeekday<T extends TrainingDaySlot>(
  days: readonly T[],
  firstWeekday: FirstWeekday,
): T[] {
  const order = weekdayOrder(firstWeekday);
  const position = (day: T): number => {
    const index = order.indexOf(day.weekday);
    return index === -1 ? order.length : index;
  };
  return [...days].sort((left, right) => position(left) - position(right));
}

/**
 * The weekday a new training day lands on: the first free one in the user's
 * week order, or null when all seven are taken — a full week is a legitimate
 * state, not an error.
 */
export function firstFreeWeekday(
  days: readonly TrainingDaySlot[],
  firstWeekday: FirstWeekday,
): number | null {
  const used = usedWeekdays(days);
  return weekdayOrder(firstWeekday).find((weekday) => !used.has(weekday)) ?? null;
}
