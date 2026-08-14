/**
 * D3 — Editing a routine (SPECS.md D3, §3.2, §3.7).
 *
 * The editor screen mutates a local draft; `buildEditRows` turns the draft
 * into plan rows (pure, testable) and `saveRoutineEdit` rewrites the plan in
 * one transaction. History tables are never touched: Workout_Log /
 * Logged_Exercises / Weight_Log copy their values at log time and never
 * reference the plan (§3.2). Weight fields are normalized per load source so
 * the SessionExercises CHECK constraint holds by construction; invalid drafts
 * throw `EditRoutineValidationError` with a user-facing code.
 */

import type {
  RoutineDatabase,
  RoutineLoadSource,
  RoutineRole,
  RoutineUnit,
} from './routineActions';

export interface EditExercise {
  catalogExerciseId: string | null;
  name: string;
  role: RoutineRole;
  targetSets: number;
  targetReps: number;
  loadSource: RoutineLoadSource;
  trainingMaxPct: number | null;
  trainingMaxWeight: number | null;
  absoluteWeight: number | null;
  unitOverride: RoutineUnit | null;
  isAmrap: boolean;
}

export interface EditSession {
  weekday: number;
  name: string;
  exercises: EditExercise[];
}

export interface EditRoutine {
  name: string;
  unit: RoutineUnit;
  roundingIncrement: number;
  restMainSeconds: number;
  restAccessorySeconds: number;
  sessions: EditSession[];
}

export type EditRoutineError =
  | { code: 'routineNameRequired' }
  | { code: 'roundingIncrementInvalid' }
  | { code: 'restInvalid' }
  | { code: 'sessionNameRequired' }
  | { code: 'duplicateWeekday' }
  | { code: 'setsInvalid'; exercise: string }
  | { code: 'repsInvalid'; exercise: string }
  | { code: 'trainingMaxMissing'; exercise: string }
  | { code: 'weightMissing'; exercise: string };

export class EditRoutineValidationError extends Error {
  readonly detail: EditRoutineError;

  constructor(detail: EditRoutineError) {
    super(detail.code);
    this.name = 'EditRoutineValidationError';
    this.detail = detail;
  }
}

export interface EditRoutineRows {
  routine: {
    name: string;
    unit: RoutineUnit;
    roundingIncrement: number;
    restMainSeconds: number;
    restAccessorySeconds: number;
  };
  sessions: { weekday: number; name: string; sortOrder: number }[];
  exercises: {
    sessionIndex: number;
    catalogExerciseId: string | null;
    name: string;
    role: RoutineRole;
    targetSets: number;
    targetReps: number;
    loadSource: RoutineLoadSource;
    trainingMaxPct: number | null;
    trainingMaxWeight: number | null;
    absoluteWeight: number | null;
    unitOverride: RoutineUnit | null;
    isAmrap: boolean;
    sortOrder: number;
  }[];
}

const fail = (detail: EditRoutineError): never => {
  throw new EditRoutineValidationError(detail);
};

/** Normalizes the weight fields per load source, mirroring the SessionExercises CHECK. */
const normalizedLoad = (
  exercise: EditExercise,
): {
  loadSource: RoutineLoadSource;
  trainingMaxPct: number | null;
  trainingMaxWeight: number | null;
  absoluteWeight: number | null;
} => {
  switch (exercise.loadSource) {
    case 'training_max_pct':
      if (exercise.trainingMaxWeight === null || exercise.trainingMaxWeight <= 0) {
        fail({ code: 'trainingMaxMissing', exercise: exercise.name });
      }
      return {
        loadSource: 'training_max_pct',
        trainingMaxPct: exercise.trainingMaxPct ?? 0.9,
        trainingMaxWeight: exercise.trainingMaxWeight,
        absoluteWeight: null,
      };
    case 'absolute':
      if (exercise.absoluteWeight === null || exercise.absoluteWeight <= 0) {
        fail({ code: 'weightMissing', exercise: exercise.name });
      }
      return {
        loadSource: 'absolute',
        trainingMaxPct: null,
        trainingMaxWeight: null,
        absoluteWeight: exercise.absoluteWeight,
      };
    case 'bodyweight':
      return {
        loadSource: 'bodyweight',
        trainingMaxPct: null,
        trainingMaxWeight: null,
        absoluteWeight: null,
      };
  }
};

/**
 * The rows `saveRoutineEdit` writes. Sort orders come from list positions —
 * the routine's ordering is the order the user sees. Throws
 * `EditRoutineValidationError` on any input the schema would reject.
 */
export function buildEditRows(draft: EditRoutine): EditRoutineRows {
  const name = draft.name.trim();
  if (name === '') {
    fail({ code: 'routineNameRequired' });
  }
  if (!(draft.roundingIncrement > 0)) {
    fail({ code: 'roundingIncrementInvalid' });
  }
  if (
    !Number.isInteger(draft.restMainSeconds) ||
    !Number.isInteger(draft.restAccessorySeconds) ||
    draft.restMainSeconds < 0 ||
    draft.restAccessorySeconds < 0
  ) {
    fail({ code: 'restInvalid' });
  }

  const usedWeekdays = new Set<number>();
  const sessions = draft.sessions.map((session, index) => {
    const sessionName = session.name.trim();
    if (sessionName === '') {
      fail({ code: 'sessionNameRequired' });
    }
    if (usedWeekdays.has(session.weekday)) {
      fail({ code: 'duplicateWeekday' });
    }
    usedWeekdays.add(session.weekday);
    return { weekday: session.weekday, name: sessionName, sortOrder: index + 1 };
  });

  const exercises = draft.sessions.flatMap((session, sessionIndex) =>
    session.exercises.map((exercise, index) => {
      if (!Number.isInteger(exercise.targetSets) || exercise.targetSets < 1) {
        fail({ code: 'setsInvalid', exercise: exercise.name });
      }
      if (!Number.isInteger(exercise.targetReps) || exercise.targetReps < 1) {
        fail({ code: 'repsInvalid', exercise: exercise.name });
      }
      return {
        sessionIndex,
        catalogExerciseId: exercise.catalogExerciseId,
        name: exercise.name,
        role: exercise.role,
        targetSets: exercise.targetSets,
        targetReps: exercise.targetReps,
        ...normalizedLoad(exercise),
        unitOverride: exercise.unitOverride,
        isAmrap: exercise.isAmrap,
        sortOrder: index + 1,
      };
    }),
  );

  return {
    routine: {
      name,
      unit: draft.unit,
      roundingIncrement: draft.roundingIncrement,
      restMainSeconds: draft.restMainSeconds,
      restAccessorySeconds: draft.restAccessorySeconds,
    },
    sessions,
    exercises,
  };
}

/**
 * Rewrites the routine's plan in one transaction: header update, then
 * delete-and-reinsert the sessions and their exercises. The cascade handles
 * the plan's own children; Workout_Log / Logged_Exercises / Weight_Log have
 * no foreign key into the plan and are never touched (§3.2).
 */
export async function saveRoutineEdit(
  db: RoutineDatabase,
  routineId: number,
  draft: EditRoutine,
): Promise<void> {
  const rows = buildEditRows(draft);
  await db.run('BEGIN;');
  try {
    await db.run(
      `UPDATE Routines
         SET name = ?, unit = ?, rounding_increment = ?,
             rest_main_seconds = ?, rest_accessory_seconds = ?
       WHERE routine_id = ?;`,
      [
        rows.routine.name,
        rows.routine.unit,
        rows.routine.roundingIncrement,
        rows.routine.restMainSeconds,
        rows.routine.restAccessorySeconds,
        routineId,
      ],
    );
    await db.run('DELETE FROM Sessions WHERE routine_id = ?;', [routineId]);

    const sessionIds: number[] = [];
    for (const session of rows.sessions) {
      await db.run(
        `INSERT INTO Sessions (routine_id, weekday, name, sort_order)
         VALUES (?, ?, ?, ?);`,
        [routineId, session.weekday, session.name, session.sortOrder],
      );
      const sessionIdRow = await db.get('SELECT last_insert_rowid() AS id;', []);
      if (!sessionIdRow) {
        throw new Error('Could not read the new session id');
      }
      sessionIds.push(Number(sessionIdRow.id));
    }

    for (const exercise of rows.exercises) {
      const sessionId = sessionIds[exercise.sessionIndex];
      if (sessionId === undefined) {
        throw new Error(`Edit exercise has no session ${exercise.sessionIndex}`);
      }
      await db.run(
        `INSERT INTO SessionExercises
           (session_id, catalog_exercise_id, exercise_name, role, target_sets,
            target_reps, load_source, training_max_pct, training_max_weight,
            absolute_weight, unit_override, is_amrap, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          sessionId,
          exercise.catalogExerciseId,
          exercise.name,
          exercise.role,
          exercise.targetSets,
          exercise.targetReps,
          exercise.loadSource,
          exercise.trainingMaxPct,
          exercise.trainingMaxWeight,
          exercise.absoluteWeight,
          exercise.unitOverride,
          exercise.isAmrap ? 1 : 0,
          exercise.sortOrder,
        ],
      );
    }

    await db.run('COMMIT;');
  } catch (error) {
    await db.run('ROLLBACK;');
    throw error;
  }
}
