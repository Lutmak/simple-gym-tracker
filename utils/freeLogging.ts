/**
 * D7 — Free logging (SPECS.md D7, §3.2, §3.7).
 *
 * A routine-less session: the user picks exercises and logs sets, and the write
 * lands in the same §3.2 history tables as any other session — one Workout_Log
 * row, one Logged_Exercises row per exercise that got at least one set, one
 * Weight_Log row per set sequenced 1..N. Unlike D6, no WeekSessions row is
 * completed and no Progression_Proposal is ever touched: a free session feeds
 * the per-exercise history (G3, keyed on exercise_name) and nothing else.
 *
 * `Logged_Exercises.sets` is the actual set count and `reps` the last set's
 * reps — there is no plan to copy, so the summary is the user's own. The unit
 * is stored per exercise at log time (§3.7: never converted).
 *
 * The history rows have no catalog column, so the G3 join key is the copied
 * exercise_name: a catalog-picked exercise must be stored under the catalog's
 * name (the picker snapshots it), which is what makes the join truthful.
 *
 * Workout_Log's UNIQUE(workout_date, day_name, workout_name) constraint would
 * reject a second same-day session sharing the label, so `saveFreeSession`
 * names the row `label` first and `label #2`, `label #3`, … afterwards.
 */

import type { RoutineDatabase, RoutineUnit } from './routineActions';

export interface FreeLogSet {
  reps: number;
  weight: number;
}

export interface FreeLogExercise {
  name: string;
  unit: RoutineUnit;
  sets: readonly FreeLogSet[];
}

export interface FreeLogRows {
  workoutLog: { workoutName: string; dayName: string; workoutDate: number };
  loggedExercises: { exerciseName: string; sets: number; reps: number }[];
  weightLog: {
    /** Position into `loggedExercises` — links sets to their log row by construction. */
    loggedExerciseIndex: number;
    setNumber: number;
    weight: number;
    reps: number;
    unit: RoutineUnit;
  }[];
}

/**
 * The §3.2 history rows for a finished free session: exercises without a
 * logged set produce no rows at all; `set_number` sequences the logged sets
 * 1..N in order.
 */
export function buildFreeLogRows(
  exercises: readonly FreeLogExercise[],
  workoutName: string,
  dayName: string,
  workoutDate: number,
): FreeLogRows {
  const loggedExercises: FreeLogRows['loggedExercises'] = [];
  const weightLog: FreeLogRows['weightLog'] = [];

  exercises.forEach((exercise) => {
    if (exercise.sets.length === 0) {
      return;
    }
    const loggedExerciseIndex = loggedExercises.length;
    const lastSet = exercise.sets[exercise.sets.length - 1];
    loggedExercises.push({
      exerciseName: exercise.name,
      sets: exercise.sets.length,
      reps: lastSet.reps,
    });
    exercise.sets.forEach((set, index) => {
      weightLog.push({
        loggedExerciseIndex,
        setNumber: index + 1,
        weight: set.weight,
        reps: set.reps,
        unit: exercise.unit,
      });
    });
  });

  return {
    workoutLog: { workoutName, dayName, workoutDate },
    loggedExercises,
    weightLog,
  };
}

export interface FreeSavedSession {
  workoutLogId: number;
  /** The row's name — the label, or `label #N` when the day already has one. */
  workoutName: string;
  loggedSets: number;
  loggedExercises: number;
}

/**
 * Writes the whole session atomically — Workout_Log, Logged_Exercises and
 * Weight_Log in one transaction — so an abandoned session writes nothing and a
 * failed write rolls everything back. Only the history tables are touched:
 * a free session never creates or modifies plan, cycle or proposal rows.
 * Refuses a session with no logged sets.
 */
export async function saveFreeSession(
  db: RoutineDatabase,
  label: string,
  workoutDate: number,
  exercises: readonly FreeLogExercise[],
): Promise<FreeSavedSession> {
  const base = buildFreeLogRows(exercises, label, label, workoutDate);
  if (base.loggedExercises.length === 0) {
    throw new Error('saveFreeSession: nothing to save');
  }

  await db.run('BEGIN;');
  try {
    const todayRow = await db.get(
      `SELECT COUNT(*) AS n FROM Workout_Log
       WHERE workout_date = ? AND workout_name = ?;`,
      [workoutDate, label],
    );
    const existing = todayRow === undefined ? 0 : Number(todayRow.n);
    const workoutName = existing === 0 ? label : `${label} #${existing + 1}`;

    const rows = buildFreeLogRows(exercises, workoutName, label, workoutDate);

    await db.run(
      `INSERT INTO Workout_Log (workout_name, day_name, workout_date)
       VALUES (?, ?, ?);`,
      [
        rows.workoutLog.workoutName,
        rows.workoutLog.dayName,
        rows.workoutLog.workoutDate,
      ],
    );
    const workoutLogRow = await db.get('SELECT last_insert_rowid() AS id;', []);
    if (!workoutLogRow) {
      throw new Error('Could not read the new workout log id');
    }
    const workoutLogId = Number(workoutLogRow.id);

    for (let index = 0; index < rows.loggedExercises.length; index += 1) {
      const logged = rows.loggedExercises[index];
      await db.run(
        `INSERT INTO Logged_Exercises (workout_log_id, exercise_name, sets, reps)
         VALUES (?, ?, ?, ?);`,
        [workoutLogId, logged.exerciseName, logged.sets, logged.reps],
      );
      const loggedRow = await db.get('SELECT last_insert_rowid() AS id;', []);
      if (!loggedRow) {
        throw new Error('Could not read the new logged exercise id');
      }
      const loggedExerciseId = Number(loggedRow.id);

      for (const set of rows.weightLog) {
        if (set.loggedExerciseIndex !== index) {
          continue;
        }
        await db.run(
          `INSERT INTO Weight_Log
             (workout_log_id, logged_exercise_id, exercise_name, set_number,
              weight_logged, reps_logged, unit)
           VALUES (?, ?, ?, ?, ?, ?, ?);`,
          [
            workoutLogId,
            loggedExerciseId,
            logged.exerciseName,
            set.setNumber,
            set.weight,
            set.reps,
            set.unit,
          ],
        );
      }
    }

    await db.run('COMMIT;');
    return {
      workoutLogId,
      workoutName,
      loggedSets: rows.weightLog.length,
      loggedExercises: rows.loggedExercises.length,
    };
  } catch (error) {
    await db.run('ROLLBACK;');
    throw error;
  }
}
