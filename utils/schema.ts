import {
  CATALOG_EXERCISE_SEED_SQL,
  CATALOG_MUSCLE_SEED_SQL,
} from '../data/catalog-seed.ts';
import { PRESET_ROUTINES } from '../data/presetRoutines.ts';

/**
 * The full Iteration 3 model (§3.1 of SPECS.md) as ordered SQL statements.
 * Pure module: no expo-sqlite import, runnable against any SQLite executor
 * (node:sqlite in tests, expo-sqlite in the app). `initialiseSchema` in
 * App.tsx is a thin shell over `runSchema`.
 */

export interface SchemaExecutor {
  exec(sql: string): Promise<void> | void;
  /** Parameterized statement execution (runAsync / prepared statement). */
  run(sql: string, params: readonly unknown[]): Promise<void> | void;
  getAll<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]> | T[];
}

/** Obsolete Iteration 2 tables and triggers, removed in the same pass that creates the new model. */
export const DROP_STATEMENTS: readonly string[] = [
  `DROP TRIGGER IF EXISTS update_recurring_workout_name;`,
  `DROP TRIGGER IF EXISTS update_recurring_day_name;`,
  `DROP TRIGGER IF EXISTS delete_recurring_workout;`,
  `DROP TRIGGER IF EXISTS delete_recurring_day;`,
  `DROP TABLE IF EXISTS Recurring_Workouts;`,
  `DROP TABLE IF EXISTS Template_Exercises;`,
  `DROP TABLE IF EXISTS Template_Days;`,
  `DROP TABLE IF EXISTS Template_Workouts;`,
  `DROP TABLE IF EXISTS FiveThreeOne_AmrapResults;`,
  `DROP TABLE IF EXISTS FiveThreeOne_WorkoutLink;`,
  `DROP TABLE IF EXISTS FiveThreeOne_LiftAssistance;`,
  `DROP TABLE IF EXISTS FiveThreeOne_Cycles;`,
  `DROP TABLE IF EXISTS FiveThreeOne_Lifts;`,
  `DROP TABLE IF EXISTS FiveThreeOne_AssistanceExercises;`,
  `DROP TABLE IF EXISTS FiveThreeOne_AssistanceTemplates;`,
  `DROP TABLE IF EXISTS FiveThreeOne_Programs;`,
  `DROP INDEX IF EXISTS FiveThreeOne_Lifts_program_weekday;`,
];

export const SCHEMA_STATEMENTS: readonly string[] = [
  `PRAGMA foreign_keys = ON;`,

  // The history tables keep their Iteration 2 shape (§3.2 of SPECS.md): rows copy
  // exercise_name, sets and reps at log time and never reference the plan for display.
  // Weight_Log gains the per-row unit from §3.7 and the per-set timing columns from
  // §3.9; legacy databases get them from ensureWeightLogUnitColumn /
  // ensureWeightLogTimingColumns because the bundled database predates the columns.
  `CREATE TABLE IF NOT EXISTS Workouts (
    workout_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    workout_name TEXT NOT NULL UNIQUE
  );`,

  `CREATE TABLE IF NOT EXISTS Days (
    day_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    workout_id INTEGER NOT NULL,
    day_name TEXT NOT NULL,
    FOREIGN KEY (workout_id) REFERENCES Workouts(workout_id) ON DELETE CASCADE,
    UNIQUE (workout_id, day_name)
  );`,

  `CREATE TABLE IF NOT EXISTS Exercises (
    exercise_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    day_id INTEGER NOT NULL,
    exercise_name TEXT NOT NULL,
    sets INTEGER NOT NULL,
    reps INTEGER NOT NULL,
    FOREIGN KEY (day_id) REFERENCES Days(day_id) ON DELETE CASCADE
  );`,

  `CREATE TABLE IF NOT EXISTS Workout_Log (
    workout_log_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    workout_name TEXT NOT NULL,
    day_name TEXT NOT NULL,
    workout_date INTEGER NOT NULL,
    UNIQUE (workout_date, day_name, workout_name)
  );`,

  `CREATE TABLE IF NOT EXISTS Logged_Exercises (
    logged_exercise_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    workout_log_id INTEGER NOT NULL,
    exercise_name TEXT NOT NULL,
    sets INTEGER NOT NULL,
    reps INTEGER NOT NULL,
    FOREIGN KEY (workout_log_id) REFERENCES Workout_Log(workout_log_id) ON DELETE CASCADE
  );`,

  `CREATE TABLE IF NOT EXISTS Weight_Log (
    weight_log_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    workout_log_id INTEGER NOT NULL,
    logged_exercise_id INTEGER NOT NULL,
    exercise_name TEXT NOT NULL,
    set_number INTEGER NOT NULL,
    weight_logged REAL NOT NULL,
    reps_logged INTEGER NOT NULL,
    unit TEXT NOT NULL DEFAULT 'kg' CHECK (unit IN ('kg', 'lb')),
    started_at INTEGER,
    completed_at INTEGER,
    FOREIGN KEY (workout_log_id) REFERENCES Workout_Log(workout_log_id) ON DELETE CASCADE,
    FOREIGN KEY (logged_exercise_id) REFERENCES Logged_Exercises(logged_exercise_id),
    UNIQUE (workout_log_id, logged_exercise_id, set_number)
  );`,

  // Exercise catalog (§3.5). Seed data is generated at build time by
  // scripts/ingest-catalog.mts into data/catalog-seed.ts; the app never fetches.
  `CREATE TABLE IF NOT EXISTS Catalog_Exercises (
    exercise_key TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    level TEXT,
    force TEXT,
    mechanic TEXT,
    equipment TEXT,
    instructions TEXT
  );`,

  `CREATE TABLE IF NOT EXISTS Catalog_Exercise_Muscles (
    exercise_key TEXT NOT NULL,
    muscle_name TEXT NOT NULL,
    is_primary INTEGER NOT NULL CHECK (is_primary IN (0, 1)),
    FOREIGN KEY (exercise_key) REFERENCES Catalog_Exercises(exercise_key) ON DELETE CASCADE,
    PRIMARY KEY (exercise_key, muscle_name)
  );`,

  // Plan. A routine is an ordered set of training days plus a progression rule.
  `CREATE TABLE IF NOT EXISTS Routines (
    routine_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    routine_key TEXT UNIQUE,
    name TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('catalog', 'user')),
    progression_rule TEXT NOT NULL CHECK (progression_rule IN ('wave', 'linear', 'none')),
    unit TEXT NOT NULL CHECK (unit IN ('kg', 'lb')),
    rounding_increment REAL NOT NULL CHECK (rounding_increment > 0),
    rest_main_seconds INTEGER NOT NULL CHECK (rest_main_seconds >= 0),
    rest_accessory_seconds INTEGER NOT NULL CHECK (rest_accessory_seconds >= 0),
    is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
    created_at INTEGER NOT NULL,
    planned_jokers INTEGER NOT NULL DEFAULT 0 CHECK (planned_jokers >= 0)
  );`,

  `CREATE UNIQUE INDEX IF NOT EXISTS Routines_single_active
     ON Routines (is_active) WHERE is_active = 1;`,

  `CREATE TABLE IF NOT EXISTS Sessions (
    session_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    routine_id INTEGER NOT NULL,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL CHECK (sort_order > 0),
    FOREIGN KEY (routine_id) REFERENCES Routines(routine_id) ON DELETE CASCADE,
    UNIQUE (routine_id, weekday)
  );`,

  `CREATE TABLE IF NOT EXISTS SessionExercises (
    session_exercise_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    session_id INTEGER NOT NULL,
    catalog_exercise_id TEXT,
    exercise_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('main', 'accessory')),
    target_sets INTEGER NOT NULL CHECK (target_sets > 0),
    target_reps INTEGER NOT NULL CHECK (target_reps > 0),
    load_source TEXT NOT NULL CHECK (load_source IN ('training_max_pct', 'absolute', 'bodyweight')),
    training_max_pct REAL,
    training_max_weight REAL,
    absolute_weight REAL,
    unit_override TEXT CHECK (unit_override IS NULL OR unit_override IN ('kg', 'lb')),
    is_amrap INTEGER NOT NULL DEFAULT 0 CHECK (is_amrap IN (0, 1)),
    sort_order INTEGER NOT NULL CHECK (sort_order > 0),
    bar_profile TEXT CHECK (bar_profile IS NULL OR bar_profile IN ('olympic', 'semi-olympic', 'smith', 'ez', 'custom')),
    bar_weight REAL,
    FOREIGN KEY (session_id) REFERENCES Sessions(session_id) ON DELETE CASCADE,
    FOREIGN KEY (catalog_exercise_id) REFERENCES Catalog_Exercises(exercise_key) ON DELETE SET NULL,
    UNIQUE (session_id, sort_order),
    CHECK (
      (load_source = 'training_max_pct'
        AND training_max_pct IS NOT NULL
        AND absolute_weight IS NULL)
      OR (load_source = 'absolute'
        AND training_max_pct IS NULL AND training_max_weight IS NULL)
      OR (load_source = 'bodyweight'
        AND absolute_weight IS NULL AND training_max_pct IS NULL AND training_max_weight IS NULL)
    )
  );`,

  // Cycles and weeks (§3.3): a cycle has weeks, a week's sessions are resolved one by one.
  `CREATE TABLE IF NOT EXISTS Cycles (
    cycle_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    routine_id INTEGER NOT NULL,
    cycle_number INTEGER NOT NULL CHECK (cycle_number > 0),
    weeks INTEGER NOT NULL CHECK (weeks > 0),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planned', 'active', 'complete')),
    current_week INTEGER NOT NULL DEFAULT 1 CHECK (current_week > 0),
    started_at INTEGER,
    completed_at INTEGER,
    FOREIGN KEY (routine_id) REFERENCES Routines(routine_id) ON DELETE CASCADE,
    UNIQUE (routine_id, cycle_number)
  );`,

  `CREATE TABLE IF NOT EXISTS CycleWeeks (
    cycle_week_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    cycle_id INTEGER NOT NULL,
    week_number INTEGER NOT NULL CHECK (week_number > 0),
    FOREIGN KEY (cycle_id) REFERENCES Cycles(cycle_id) ON DELETE CASCADE,
    UNIQUE (cycle_id, week_number)
  );`,

  // One row per session per week. `pending` until the session is resolved; a completed
  // session links to its log, a moved one records the date it was moved to, a discarded
  // one records the date it was discarded (§3.6). The link to Workout_Log never cascades:
  // deleting a log must never destroy plan bookkeeping.
  `CREATE TABLE IF NOT EXISTS WeekSessions (
    week_session_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    cycle_week_id INTEGER NOT NULL,
    session_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'moved', 'discarded')),
    resolved_on_date INTEGER,
    completed_log_id INTEGER,
    FOREIGN KEY (cycle_week_id) REFERENCES CycleWeeks(cycle_week_id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES Sessions(session_id) ON DELETE CASCADE,
    FOREIGN KEY (completed_log_id) REFERENCES Workout_Log(workout_log_id) ON DELETE SET NULL,
    UNIQUE (cycle_week_id, session_id)
  );`,

  // Progression review state (§3.4): the app proposes, the user decides. One proposal
  // per exercise per cycle; `status` records the outcome and nothing is ever applied
  // without a resolved review.
  `CREATE TABLE IF NOT EXISTS Progression_Proposal (
    proposal_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    routine_id INTEGER NOT NULL,
    cycle_id INTEGER NOT NULL,
    session_exercise_id INTEGER NOT NULL,
    catalog_exercise_id TEXT,
    exercise_name TEXT NOT NULL,
    current_target REAL NOT NULL CHECK (current_target >= 0),
    proposed_target REAL NOT NULL CHECK (proposed_target >= 0),
    unit TEXT NOT NULL CHECK (unit IN ('kg', 'lb')),
    reason TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'held', 'edited', 'declined')),
    created_at INTEGER NOT NULL,
    FOREIGN KEY (routine_id) REFERENCES Routines(routine_id) ON DELETE CASCADE,
    FOREIGN KEY (cycle_id) REFERENCES Cycles(cycle_id) ON DELETE CASCADE,
    FOREIGN KEY (session_exercise_id) REFERENCES SessionExercises(session_exercise_id) ON DELETE CASCADE,
    FOREIGN KEY (catalog_exercise_id) REFERENCES Catalog_Exercises(exercise_key) ON DELETE SET NULL,
    UNIQUE (cycle_id, session_exercise_id)
  );`,

  `CREATE INDEX IF NOT EXISTS Catalog_Exercise_Muscles_muscle
     ON Catalog_Exercise_Muscles (muscle_name);`,

  `CREATE INDEX IF NOT EXISTS WeekSessions_week
     ON WeekSessions (cycle_week_id);`,

  `CREATE INDEX IF NOT EXISTS Progression_Proposal_routine
     ON Progression_Proposal (routine_id);`,

  // Preset routine catalog (SPECS.md F3). The 22 curated routines are committed data
  // (data/presetRoutines.ts), seeded idempotently. Activation (D2) COPIES a preset
  // into Routines/Sessions/SessionExercises; presets are never edited in place.
  `CREATE TABLE IF NOT EXISTS Preset_Routines (
    routine_key TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    philosophy TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('beginner', 'intermediate', 'advanced')),
    recommended_days INTEGER NOT NULL CHECK (recommended_days BETWEEN 1 AND 7),
    rest_main_seconds INTEGER NOT NULL CHECK (rest_main_seconds >= 0),
    rest_accessory_seconds INTEGER NOT NULL CHECK (rest_accessory_seconds >= 0),
    progression_rule TEXT NOT NULL CHECK (progression_rule IN ('wave', 'linear', 'none')),
    rounding_increment_kg REAL NOT NULL CHECK (rounding_increment_kg > 0)
  );`,

  `CREATE TABLE IF NOT EXISTS Preset_Sessions (
    preset_session_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    routine_key TEXT NOT NULL,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL CHECK (sort_order > 0),
    FOREIGN KEY (routine_key) REFERENCES Preset_Routines(routine_key) ON DELETE CASCADE,
    UNIQUE (routine_key, weekday),
    UNIQUE (routine_key, sort_order)
  );`,

  `CREATE TABLE IF NOT EXISTS Preset_SessionExercises (
    preset_session_exercise_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    preset_session_id INTEGER NOT NULL,
    catalog_exercise_id TEXT NOT NULL,
    exercise_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('main', 'accessory')),
    target_sets INTEGER NOT NULL CHECK (target_sets > 0),
    target_reps INTEGER NOT NULL CHECK (target_reps > 0),
    load_source TEXT NOT NULL CHECK (load_source IN ('training_max_pct', 'absolute', 'bodyweight')),
    training_max_pct REAL CHECK (training_max_pct IS NULL OR training_max_pct > 0),
    is_amrap INTEGER NOT NULL DEFAULT 0 CHECK (is_amrap IN (0, 1)),
    sort_order INTEGER NOT NULL CHECK (sort_order > 0),
    FOREIGN KEY (preset_session_id) REFERENCES Preset_Sessions(preset_session_id) ON DELETE CASCADE,
    FOREIGN KEY (catalog_exercise_id) REFERENCES Catalog_Exercises(exercise_key) ON DELETE SET NULL,
    UNIQUE (preset_session_id, sort_order)
  );`,
];

/**
 * The bundled assets/SimpleDB.db predates the per-row unit column. ALTER cannot add a
 * NOT NULL column without a default, and the historical rows have no honest unit, so
 * the legacy default is 'kg' — the bundled database ships empty of weight rows anyway.
 * Gated so it never runs twice and never touches a fresh database.
 */
export async function ensureWeightLogUnitColumn(
  executor: SchemaExecutor,
): Promise<void> {
  const columns = await executor.getAll<{ name: string }>(
    'PRAGMA table_info(Weight_Log);',
  );
  if (!columns.some((column) => column.name === 'unit')) {
    await executor.exec(
      `ALTER TABLE Weight_Log
       ADD COLUMN unit TEXT NOT NULL DEFAULT 'kg' CHECK (unit IN ('kg', 'lb'));`,
    );
  }
}

/** The §3.9 per-set timing columns on Weight_Log, for databases created before M2. */
export async function ensureWeightLogTimingColumns(
  executor: SchemaExecutor,
): Promise<void> {
  const columns = await executor.getAll<{ name: string }>(
    'PRAGMA table_info(Weight_Log);',
  );
  if (!columns.some((column) => column.name === 'started_at')) {
    await executor.exec('ALTER TABLE Weight_Log ADD COLUMN started_at INTEGER;');
  }
  if (!columns.some((column) => column.name === 'completed_at')) {
    await executor.exec('ALTER TABLE Weight_Log ADD COLUMN completed_at INTEGER;');
  }
}

/** The M2 SessionExercises columns (bar profile + custom bar weight). */
export async function ensureSessionExercisesColumns(
  executor: SchemaExecutor,
): Promise<void> {
  const columns = await executor.getAll<{ name: string }>(
    'PRAGMA table_info(SessionExercises);',
  );
  if (!columns.some((column) => column.name === 'bar_profile')) {
    await executor.exec(
      `ALTER TABLE SessionExercises ADD COLUMN bar_profile TEXT
       CHECK (bar_profile IS NULL OR bar_profile IN ('olympic', 'semi-olympic', 'smith', 'ez', 'custom'));`,
    );
  }
  if (!columns.some((column) => column.name === 'bar_weight')) {
    await executor.exec('ALTER TABLE SessionExercises ADD COLUMN bar_weight REAL;');
  }
}

/** The M2 planned-jokers column on Routines. */
export async function ensureRoutinesPlannedJokers(
  executor: SchemaExecutor,
): Promise<void> {
  const columns = await executor.getAll<{ name: string }>(
    'PRAGMA table_info(Routines);',
  );
  if (!columns.some((column) => column.name === 'planned_jokers')) {
    await executor.exec(
      `ALTER TABLE Routines ADD COLUMN planned_jokers INTEGER NOT NULL DEFAULT 0
       CHECK (planned_jokers >= 0);`,
    );
  }
}

/** Idempotent catalog seed: stable exercise keys, INSERT OR IGNORE. */
export async function seedCatalog(executor: SchemaExecutor): Promise<void> {
  await executor.exec(CATALOG_EXERCISE_SEED_SQL);
  await executor.exec(CATALOG_MUSCLE_SEED_SQL);
}

/**
 * Idempotent preset-routine seed (SPECS.md F3). A routine referencing an exercise that is
 * not in the catalog is a build-time failure, not a runtime surprise: the catalog name
 * lookup throws here, and utils/presetRoutines.test.ts asserts the same invariant.
 */
export async function seedPresetRoutines(executor: SchemaExecutor): Promise<void> {
  for (const routine of PRESET_ROUTINES) {
    await executor.run(
      `INSERT OR IGNORE INTO Preset_Routines
       (routine_key, name, description, philosophy, level, recommended_days,
        rest_main_seconds, rest_accessory_seconds, progression_rule, rounding_increment_kg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        routine.key,
        routine.name,
        routine.description,
        routine.philosophy,
        routine.level,
        routine.recommendedDays,
        routine.restMainSeconds,
        routine.restAccessorySeconds,
        routine.progressionRule,
        routine.roundingIncrementKg,
      ],
    );

    for (const [sessionIndex, session] of routine.sessions.entries()) {
      await executor.run(
        `INSERT OR IGNORE INTO Preset_Sessions
         (routine_key, weekday, name, sort_order)
         VALUES (?, ?, ?, ?);`,
        [routine.key, session.weekday, session.name, sessionIndex + 1],
      );

      const sessionRow = await executor.getAll<{ preset_session_id: number }>(
        `SELECT preset_session_id FROM Preset_Sessions
         WHERE routine_key = ? AND weekday = ?;`,
        [routine.key, session.weekday],
      );
      const presetSessionId = sessionRow[0]?.preset_session_id;
      if (presetSessionId === undefined) {
        throw new Error(`Could not seed preset session: ${routine.key} / ${session.name}`);
      }

      for (const [exerciseIndex, exercise] of session.exercises.entries()) {
        const catalogRow = await executor.getAll<{ name: string }>(
          `SELECT name FROM Catalog_Exercises WHERE exercise_key = ?;`,
          [exercise.catalogKey],
        );
        const catalogName = catalogRow[0]?.name;
        if (catalogName === undefined) {
          throw new Error(
            `Preset routine "${routine.name}" references unknown catalog exercise ` +
              `"${exercise.catalogKey}". Regenerate or fix the key; see data/presetRoutines.ts.`,
          );
        }

        await executor.run(
          `INSERT OR IGNORE INTO Preset_SessionExercises
           (preset_session_id, catalog_exercise_id, exercise_name, role, target_sets,
            target_reps, load_source, training_max_pct, is_amrap, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            presetSessionId,
            exercise.catalogKey,
            catalogName,
            exercise.role,
            exercise.sets,
            exercise.reps,
            exercise.loadSource,
            exercise.loadSource === 'training_max_pct' ? 0.9 : null,
            exercise.isAmrap ? 1 : 0,
            exerciseIndex + 1,
          ],
        );
      }
    }
  }
}

/** Drops the obsolete tables, creates the new model, and seeds the catalog. */
export async function runSchema(executor: SchemaExecutor): Promise<void> {
  await executor.exec('PRAGMA foreign_keys = ON;');
  for (const statement of DROP_STATEMENTS) {
    await executor.exec(statement);
  }
  for (const statement of SCHEMA_STATEMENTS) {
    await executor.exec(statement);
  }
  await ensureWeightLogUnitColumn(executor);
  await ensureWeightLogTimingColumns(executor);
  await ensureSessionExercisesColumns(executor);
  await ensureRoutinesPlannedJokers(executor);
  await seedCatalog(executor);
  await seedPresetRoutines(executor);
}
