/**
 * Activating, duplicating and deleting routines (SPECS.md D2, §3.1).
 *
 * Catalog routines are seeds, not references: activating one COPIES the preset
 * rows into Routines/Sessions/SessionExercises, and everything the user does
 * afterwards acts on the copy. Preset_* tables are never written.
 *
 * `buildRoutineCopyRows` is the pure core — preset rows carry no weights, so the
 * caller supplies a training max per `training_max_pct` exercise and a starting
 * weight per `absolute` exercise; duplicates reuse the source rows' own values.
 * The thin edges load source rows, build the copy, and write it in one
 * transaction. The same transaction clears any other active routine, which is
 * what the partial unique index `Routines_single_active` enforces.
 */

export type RoutineUnit = 'kg' | 'lb';
export type RoutineLoadSource = 'training_max_pct' | 'absolute' | 'bodyweight';
export type RoutineProgressionRule = 'wave' | 'linear' | 'none';
export type RoutineRole = 'main' | 'accessory';
export type RoutineOrigin = 'catalog' | 'user';

export interface RoutineSource {
  routineKey: string | null;
  name: string;
  origin: RoutineOrigin;
  progressionRule: RoutineProgressionRule;
  /** Presets seed this in kg; a user routine carries its already-resolved increment. */
  roundingIncrement: number;
  /** Null for presets — the routine's unit is chosen at activation. */
  unit: RoutineUnit | null;
  restMainSeconds: number;
  restAccessorySeconds: number;
  isActive: boolean;
  description: string | null;
  philosophy: string | null;
  recommendedDays: number | null;
}

export interface SessionSource {
  sessionId: number;
  weekday: number;
  name: string;
  sortOrder: number;
}

export interface ExerciseSource {
  /** Stable id in the source table — the key weight inputs are collected under. */
  exerciseId: number;
  sessionId: number;
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
}

export interface RoutineSourceBundle {
  routine: RoutineSource;
  sessions: readonly SessionSource[];
  exercises: readonly ExerciseSource[];
}

export type RoutineWeightInputs = ReadonlyMap<
  number,
  { trainingMaxWeight: number | null; absoluteWeight: number | null }
>;

export interface RoutineCopyRows {
  routine: {
    routineKey: string | null;
    name: string;
    origin: RoutineOrigin;
    progressionRule: RoutineProgressionRule;
    unit: RoutineUnit;
    roundingIncrement: number;
    restMainSeconds: number;
    restAccessorySeconds: number;
    isActive: boolean;
    createdAt: number;
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

/**
 * The rows an activation or duplicate inserts. Weight resolution per load
 * source matches the SessionExercises CHECK constraint exactly: a training-max
 * exercise carries both percentage and weight, an absolute exercise carries
 * only its weight, bodyweight carries none.
 */
export function buildRoutineCopyRows(
  source: RoutineSourceBundle,
  unit: RoutineUnit,
  weightInputs: RoutineWeightInputs,
  copy: { routineKey: string | null; origin: RoutineOrigin; isActive: boolean },
): RoutineCopyRows {
  const sessionIndexBySourceId = new Map<number, number>();
  source.sessions.forEach((session, index) =>
    sessionIndexBySourceId.set(session.sessionId, index),
  );

  const exercises = source.exercises.map((exercise) => {
    const sessionIndex = sessionIndexBySourceId.get(exercise.sessionId);
    if (sessionIndex === undefined) {
      throw new Error(`Copy source references unknown session ${exercise.sessionId}`);
    }

    let trainingMaxPct = exercise.trainingMaxPct;
    let trainingMaxWeight: number | null = null;
    let absoluteWeight: number | null = null;

    if (exercise.loadSource === 'training_max_pct') {
      trainingMaxWeight =
        weightInputs.get(exercise.exerciseId)?.trainingMaxWeight ??
        exercise.trainingMaxWeight;
      if (trainingMaxWeight === null || trainingMaxWeight <= 0) {
        throw new Error(`Training max missing for ${exercise.name}`);
      }
      if (trainingMaxPct === null) {
        trainingMaxPct = 0.9;
      }
    } else if (exercise.loadSource === 'absolute') {
      absoluteWeight =
        weightInputs.get(exercise.exerciseId)?.absoluteWeight ?? exercise.absoluteWeight;
      if (absoluteWeight === null || absoluteWeight <= 0) {
        throw new Error(`Starting weight missing for ${exercise.name}`);
      }
    }

    return {
      sessionIndex,
      catalogExerciseId: exercise.catalogExerciseId,
      name: exercise.name,
      role: exercise.role,
      targetSets: exercise.targetSets,
      targetReps: exercise.targetReps,
      loadSource: exercise.loadSource,
      trainingMaxPct,
      trainingMaxWeight,
      absoluteWeight,
      unitOverride: exercise.unitOverride,
      isAmrap: exercise.isAmrap,
      sortOrder: exercise.sortOrder,
    };
  });

  const roundingIncrement =
    copy.origin === 'catalog' && unit === 'lb'
      ? source.routine.roundingIncrement * 2 // presets seed the increment in kg; lb copies double it once
      : source.routine.roundingIncrement;

  return {
    routine: {
      routineKey: copy.routineKey,
      name: source.routine.name,
      origin: copy.origin,
      progressionRule: source.routine.progressionRule,
      unit,
      roundingIncrement,
      restMainSeconds: source.routine.restMainSeconds,
      restAccessorySeconds: source.routine.restAccessorySeconds,
      isActive: copy.isActive,
      createdAt: Date.now(),
    },
    sessions: source.sessions.map((session) => ({
      weekday: session.weekday,
      name: session.name,
      sortOrder: session.sortOrder,
    })),
    exercises,
  };
}

export function routineNeedsWeights(source: RoutineSourceBundle): boolean {
  return source.exercises.some((exercise) => exercise.loadSource !== 'bodyweight');
}

export interface RoutineDatabase {
  run(sql: string, params?: readonly unknown[]): Promise<unknown> | unknown;
  get(
    sql: string,
    params?: readonly unknown[],
  ): Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;
  getAll(
    sql: string,
    params?: readonly unknown[],
  ): Promise<Record<string, unknown>[]> | Record<string, unknown>[];
}

const num = (value: unknown): number => Number(value);
const str = (value: unknown): string => String(value);
const nullableStr = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);
const nullableNum = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

const toSessionSource = (row: Record<string, unknown>): SessionSource => ({
  sessionId: num(row.session_id),
  weekday: num(row.weekday),
  name: str(row.name),
  sortOrder: num(row.sort_order),
});

const toExerciseSource = (row: Record<string, unknown>): ExerciseSource => ({
  exerciseId: num(row.exercise_id),
  sessionId: num(row.session_id),
  catalogExerciseId: nullableStr(row.catalog_exercise_id),
  name: str(row.name),
  role: str(row.role) as RoutineRole,
  targetSets: num(row.target_sets),
  targetReps: num(row.target_reps),
  loadSource: str(row.load_source) as RoutineLoadSource,
  trainingMaxPct: nullableNum(row.training_max_pct),
  trainingMaxWeight: nullableNum(row.training_max_weight),
  absoluteWeight: nullableNum(row.absolute_weight),
  unitOverride: nullableStr(row.unit_override) as RoutineUnit | null,
  isAmrap: num(row.is_amrap) === 1,
  sortOrder: num(row.sort_order),
});

export async function loadPresetRoutineSource(
  db: RoutineDatabase,
  presetKey: string,
): Promise<RoutineSourceBundle> {
  const routineRow = await db.get(
    `SELECT routine_key, name, description, philosophy, recommended_days,
            rest_main_seconds, rest_accessory_seconds, progression_rule, rounding_increment_kg
     FROM Preset_Routines WHERE routine_key = ?;`,
    [presetKey],
  );
  if (!routineRow) {
    throw new Error(`Unknown preset routine ${presetKey}`);
  }

  const sessionRows = await db.getAll(
    `SELECT preset_session_id AS session_id, weekday, name, sort_order
     FROM Preset_Sessions WHERE routine_key = ? ORDER BY sort_order;`,
    [presetKey],
  );
  const exerciseRows = await db.getAll(
    `SELECT e.preset_session_exercise_id AS exercise_id, e.preset_session_id AS session_id,
            e.catalog_exercise_id, e.exercise_name AS name, e.role, e.target_sets,
            e.target_reps, e.load_source, e.training_max_pct, e.is_amrap, e.sort_order
     FROM Preset_SessionExercises e
     JOIN Preset_Sessions s ON s.preset_session_id = e.preset_session_id
     WHERE s.routine_key = ? ORDER BY s.sort_order, e.sort_order;`,
    [presetKey],
  );

  return {
    routine: {
      routineKey: str(routineRow.routine_key),
      name: str(routineRow.name),
      origin: 'catalog',
      progressionRule: str(routineRow.progression_rule) as RoutineProgressionRule,
      roundingIncrement: num(routineRow.rounding_increment_kg),
      unit: null,
      restMainSeconds: num(routineRow.rest_main_seconds),
      restAccessorySeconds: num(routineRow.rest_accessory_seconds),
      isActive: false,
      description: nullableStr(routineRow.description),
      philosophy: nullableStr(routineRow.philosophy),
      recommendedDays: nullableNum(routineRow.recommended_days),
    },
    sessions: sessionRows.map(toSessionSource),
    exercises: exerciseRows.map(toExerciseSource),
  };
}

export async function loadRoutineSourceById(
  db: RoutineDatabase,
  routineId: number,
): Promise<RoutineSourceBundle> {
  const routineRow = await db.get(
    `SELECT routine_id, routine_key, name, origin, progression_rule, unit,
            rounding_increment, rest_main_seconds, rest_accessory_seconds, is_active
     FROM Routines WHERE routine_id = ?;`,
    [routineId],
  );
  if (!routineRow) {
    throw new Error(`Unknown routine ${routineId}`);
  }

  const sessionRows = await db.getAll(
    `SELECT session_id, weekday, name, sort_order
     FROM Sessions WHERE routine_id = ? ORDER BY sort_order;`,
    [routineId],
  );
  const exerciseRows = await db.getAll(
    `SELECT e.session_exercise_id AS exercise_id, e.session_id, e.catalog_exercise_id,
            e.exercise_name AS name, e.role, e.target_sets, e.target_reps, e.load_source,
            e.training_max_pct, e.training_max_weight, e.absolute_weight, e.unit_override,
            e.is_amrap, e.sort_order
     FROM SessionExercises e
     JOIN Sessions s ON s.session_id = e.session_id
     WHERE s.routine_id = ? ORDER BY s.sort_order, e.sort_order;`,
    [routineId],
  );

  return {
    routine: {
      routineKey: nullableStr(routineRow.routine_key),
      name: str(routineRow.name),
      origin: str(routineRow.origin) as RoutineOrigin,
      progressionRule: str(routineRow.progression_rule) as RoutineProgressionRule,
      roundingIncrement: num(routineRow.rounding_increment),
      unit: str(routineRow.unit) as RoutineUnit,
      restMainSeconds: num(routineRow.rest_main_seconds),
      restAccessorySeconds: num(routineRow.rest_accessory_seconds),
      isActive: num(routineRow.is_active) === 1,
      description: null,
      philosophy: null,
      recommendedDays: null,
    },
    sessions: sessionRows.map(toSessionSource),
    exercises: exerciseRows.map(toExerciseSource),
  };
}

async function insertCopyRows(db: RoutineDatabase, rows: RoutineCopyRows): Promise<number> {
  await db.run('BEGIN;');
  try {
    if (rows.routine.isActive) {
      await db.run('UPDATE Routines SET is_active = 0 WHERE is_active = 1;');
    }
    await db.run(
      `INSERT INTO Routines
         (routine_key, name, origin, progression_rule, unit, rounding_increment,
          rest_main_seconds, rest_accessory_seconds, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        rows.routine.routineKey,
        rows.routine.name,
        rows.routine.origin,
        rows.routine.progressionRule,
        rows.routine.unit,
        rows.routine.roundingIncrement,
        rows.routine.restMainSeconds,
        rows.routine.restAccessorySeconds,
        rows.routine.isActive ? 1 : 0,
        rows.routine.createdAt,
      ],
    );
    const routineIdRow = await db.get('SELECT last_insert_rowid() AS id;', []);
    if (!routineIdRow) {
      throw new Error('Could not read the new routine id');
    }
    const routineId = num(routineIdRow.id);

    const sessionIds: number[] = [];
    for (const session of rows.sessions) {
      await db.run(
        `INSERT INTO Sessions (routine_id, weekday, name, sort_order) VALUES (?, ?, ?, ?);`,
        [routineId, session.weekday, session.name, session.sortOrder],
      );
      const sessionIdRow = await db.get('SELECT last_insert_rowid() AS id;', []);
      if (!sessionIdRow) {
        throw new Error('Could not read the new session id');
      }
      sessionIds.push(num(sessionIdRow.id));
    }

    for (const exercise of rows.exercises) {
      const sessionId = sessionIds[exercise.sessionIndex];
      if (sessionId === undefined) {
        throw new Error(`Copy exercise has no session ${exercise.sessionIndex}`);
      }
      await db.run(
        `INSERT INTO SessionExercises
           (session_id, catalog_exercise_id, exercise_name, role, target_sets, target_reps,
            load_source, training_max_pct, training_max_weight, absolute_weight,
            unit_override, is_amrap, sort_order)
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
    return routineId;
  } catch (error) {
    await db.run('ROLLBACK;');
    throw error;
  }
}

export async function activatePresetRoutine(
  db: RoutineDatabase,
  presetKey: string,
  unit: RoutineUnit,
  weightInputs: RoutineWeightInputs,
): Promise<{ routineId: number; copied: boolean }> {
  const existing = await db.get(
    'SELECT routine_id FROM Routines WHERE routine_key = ?;',
    [presetKey],
  );
  if (existing) {
    const routineId = num(existing.routine_id);
    await activateRoutineById(db, routineId);
    return { routineId, copied: false };
  }

  const source = await loadPresetRoutineSource(db, presetKey);
  const rows = buildRoutineCopyRows(source, unit, weightInputs, {
    routineKey: presetKey,
    origin: 'catalog',
    isActive: true,
  });
  const routineId = await insertCopyRows(db, rows);
  return { routineId, copied: true };
}

export async function activateRoutineById(db: RoutineDatabase, routineId: number): Promise<void> {
  await db.run('BEGIN;');
  try {
    await db.run('UPDATE Routines SET is_active = 0 WHERE is_active = 1;');
    await db.run('UPDATE Routines SET is_active = 1 WHERE routine_id = ?;', [routineId]);
    await db.run('COMMIT;');
  } catch (error) {
    await db.run('ROLLBACK;');
    throw error;
  }
}

export async function duplicateRoutine(db: RoutineDatabase, routineId: number): Promise<number> {
  const source = await loadRoutineSourceById(db, routineId);
  if (source.routine.unit === null) {
    throw new Error(`Cannot duplicate routine ${routineId}: it has no unit`);
  }
  const rows = buildRoutineCopyRows(source, source.routine.unit, new Map(), {
    routineKey: null,
    origin: 'user',
    isActive: false,
  });
  return insertCopyRows(db, rows);
}

export async function deleteRoutine(db: RoutineDatabase, routineId: number): Promise<void> {
  await db.run('DELETE FROM Routines WHERE routine_id = ?;', [routineId]);
}

export async function getActiveRoutine(
  db: RoutineDatabase,
): Promise<{ routineId: number; name: string } | null> {
  const row = await db.get(
    'SELECT routine_id, name FROM Routines WHERE is_active = 1 LIMIT 1;',
    [],
  );
  if (!row) {
    return null;
  }
  return { routineId: num(row.routine_id), name: str(row.name) };
}
