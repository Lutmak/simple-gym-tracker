/**
 * P1 — correcting a set that was already logged (SPECS.md P1, P2).
 *
 * A week and a day both open the same sheet, and both are described as *editable*: the app holds
 * the plan and the user reports reality (§7.3), so reality has to be correctable after the fact —
 * a set typed in the gym with one thumb is exactly the kind of number that comes out wrong.
 *
 * The scope is deliberately one set. Adding or removing sets after the fact would change what a
 * session *was*, and the model already has an answer for a session that did not happen (discard,
 * §3.1). Correcting reps, weight or the unit of a set that exists changes only how it was recorded.
 *
 * Nothing is converted between units, ever (§3.5): the row keeps the unit it is edited to and the
 * number the user typed. `Logged_Exercises.reps` is a denormalised summary of the exercise's last
 * set, written by the runner and by free logging; the writer refreshes it so an edit cannot leave
 * the two disagreeing.
 */

import type { LoggedSet } from './routineProgress';
import type { RoutineDatabase, RoutineUnit } from './routineActions';

export interface LoggedSetEdit {
  reps: number;
  weight: number;
  unit: RoutineUnit;
}

export type LoggedSetEditRejection = 'reps' | 'weight' | 'unknownSet';

export interface LoggedSetEditSuccess {
  ok: true;
  sets: LoggedSet[];
}

export interface LoggedSetEditFailure {
  ok: false;
  reason: LoggedSetEditRejection;
}

export type LoggedSetEditOutcome = LoggedSetEditSuccess | LoggedSetEditFailure;

/**
 * What a logged set may become: at least one whole rep, and a weight that is
 * not negative. Zero weight is legal — that is how a bodyweight set is stored
 * (sessionRunner.ts) — and there is no upper bound to invent.
 */
export function validateLoggedSetEdit(edit: LoggedSetEdit): LoggedSetEditRejection | null {
  if (!Number.isInteger(edit.reps) || edit.reps < 1) {
    return 'reps';
  }
  if (!Number.isFinite(edit.weight) || edit.weight < 0) {
    return 'weight';
  }
  return null;
}

/** The set list with one set corrected, or the reason it may not be. */
export function applyLoggedSetEdit(
  sets: readonly LoggedSet[],
  weightLogId: number,
  edit: LoggedSetEdit,
): LoggedSetEditOutcome {
  if (!sets.some((set) => set.weightLogId === weightLogId)) {
    return { ok: false, reason: 'unknownSet' };
  }
  const rejection = validateLoggedSetEdit(edit);
  if (rejection !== null) {
    return { ok: false, reason: rejection };
  }
  return {
    ok: true,
    sets: sets.map((set) =>
      set.weightLogId === weightLogId
        ? { ...set, reps: edit.reps, weight: edit.weight, unit: edit.unit }
        : set,
    ),
  };
}

/**
 * Writes one corrected set. Validation runs through the pure layer first, so a
 * rejected edit throws instead of reaching the database, and the exercise's
 * denormalised summary is refreshed from the rows that remain.
 */
export async function updateLoggedSet(
  db: RoutineDatabase,
  weightLogId: number,
  edit: LoggedSetEdit,
): Promise<void> {
  const rejection = validateLoggedSetEdit(edit);
  if (rejection !== null) {
    throw new Error(`updateLoggedSet: ${rejection}`);
  }

  await db.run(
    `UPDATE Weight_Log
       SET reps_logged = ?, weight_logged = ?, unit = ?
     WHERE weight_log_id = ?;`,
    [edit.reps, edit.weight, edit.unit, weightLogId],
  );

  await db.run(
    `UPDATE Logged_Exercises
       SET reps = (
         SELECT wl.reps_logged FROM Weight_Log wl
         WHERE wl.logged_exercise_id = Logged_Exercises.logged_exercise_id
         ORDER BY wl.set_number DESC LIMIT 1
       )
     WHERE logged_exercise_id = (
       SELECT logged_exercise_id FROM Weight_Log WHERE weight_log_id = ?
     );`,
    [weightLogId],
  );
}
