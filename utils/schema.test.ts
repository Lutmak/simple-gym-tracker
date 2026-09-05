import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runSchema,
  DROP_STATEMENTS,
  SCHEMA_STATEMENTS,
  seedCatalog,
  ensureWeightLogUnitColumn,
  ensureWeightLogTimingColumns,
  ensureSessionExercisesColumns,
  ensureRoutinesPlannedJokers,
  ensureRoutinesWaveSetupColumns,
  ensureLoggedExercisesRoleColumn,
  type SchemaExecutor,
} from './schema';

const connect = (): { db: DatabaseSync; executor: SchemaExecutor } => {
  const db = new DatabaseSync(':memory:');
  const executor: SchemaExecutor = {
    exec: (sql) => db.exec(sql),
    run: (sql, params) => {
      db.prepare(sql).run(...(params as SQLInputValue[]));
    },
    getAll: <T>(sql: string, params: SQLInputValue[] = []) =>
      db.prepare(sql).all(...params) as T[],
  };
  return { db, executor };
};

const tableNames = (db: DatabaseSync): string[] =>
  (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as { name: string }[]
  ).map((row) => row.name);

const triggerNames = (db: DatabaseSync): string[] =>
  (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name`)
      .all() as { name: string }[]
  ).map((row) => row.name);

const columnNames = (db: DatabaseSync, table: string): string[] =>
  (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map(
    (row) => row.name,
  );

const count = (db: DatabaseSync, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('schema statements', () => {
  it('execute in order on a fresh in-memory database', () => {
    const { db, executor } = connect();

    expect(() => {
      for (const statement of DROP_STATEMENTS) {
        executor.exec(statement);
      }
      for (const statement of SCHEMA_STATEMENTS) {
        executor.exec(statement);
      }
    }).not.toThrow();
  });

  it('declares the new-model tables', () => {
    const { db } = connect();
    expect(SCHEMA_STATEMENTS.join('\n')).toContain('CREATE TABLE IF NOT EXISTS Routines');
    expect(SCHEMA_STATEMENTS.join('\n')).toContain(
      'CREATE TABLE IF NOT EXISTS Progression_Proposal',
    );
    expect(SCHEMA_STATEMENTS.join('\n')).toContain(
      'CREATE TABLE IF NOT EXISTS Catalog_Exercises',
    );
  });
});

describe('runSchema', () => {
  it('creates every new-model table on a fresh database', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    const expected = [
      'Routines',
      'Sessions',
      'SessionExercises',
      'Cycles',
      'CycleWeeks',
      'WeekSessions',
      'Progression_Proposal',
      'Catalog_Exercises',
      'Catalog_Exercise_Muscles',
      'Workouts',
      'Days',
      'Exercises',
      'Workout_Log',
      'Logged_Exercises',
      'Weight_Log',
    ];
    for (const table of expected) {
      expect(tableNames(db)).toContain(table);
    }
  });

  it('gives the new tables their required columns', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    expect(columnNames(db, 'Weight_Log')).toEqual(
      expect.arrayContaining([
        'weight_log_id',
        'unit',
        'reps_logged',
        'weight_logged',
        'started_at',
        'completed_at',
      ]),
    );
    expect(columnNames(db, 'Routines')).toEqual(
      expect.arrayContaining([
        'routine_id',
        'routine_key',
        'name',
        'origin',
        'progression_rule',
        'unit',
        'rounding_increment',
        'rest_main_seconds',
        'rest_accessory_seconds',
        'is_active',
        'planned_jokers',
      ]),
    );
    expect(columnNames(db, 'SessionExercises')).toEqual(
      expect.arrayContaining([
        'session_exercise_id',
        'catalog_exercise_id',
        'exercise_name',
        'role',
        'target_sets',
        'target_reps',
        'load_source',
        'absolute_weight',
        'unit_override',
        'sort_order',
        'bar_profile',
        'bar_weight',
      ]),
    );
    expect(columnNames(db, 'Progression_Proposal')).toEqual(
      expect.arrayContaining([
        'proposal_id',
        'routine_id',
        'cycle_id',
        'session_exercise_id',
        'current_target',
        'proposed_target',
        'unit',
        'reason',
        'status',
      ]),
    );
  });

  it('drops the obsolete tables and their triggers', async () => {
    const { db, executor } = connect();
    db.exec(`
      CREATE TABLE Workouts (workout_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, workout_name TEXT NOT NULL UNIQUE);
      CREATE TABLE Recurring_Workouts (
        recurring_workout_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        workout_id INTEGER NOT NULL,
        workout_name TEXT NOT NULL,
        day_name TEXT NOT NULL,
        recurring_start_date INTEGER NOT NULL,
        recurring_interval INTEGER NOT NULL,
        recurring_days TEXT,
        notification_id TEXT,
        notification_enabled BOOLEAN NOT NULL,
        notification_time TEXT
      );
      CREATE TRIGGER update_recurring_workout_name AFTER UPDATE OF workout_name ON Workouts
      BEGIN UPDATE Recurring_Workouts SET workout_name = NEW.workout_name; END;
      CREATE TABLE Template_Workouts (workout_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, workout_name TEXT NOT NULL UNIQUE, workout_difficulty TEXT NOT NULL);
      CREATE TABLE Template_Days (day_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, workout_id INTEGER NOT NULL, day_name TEXT NOT NULL);
      CREATE TABLE Template_Exercises (exercise_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, day_id INTEGER NOT NULL, exercise_name TEXT NOT NULL, sets INTEGER NOT NULL, reps INTEGER NOT NULL);
      CREATE TABLE FiveThreeOne_Programs (
        program_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        program_name TEXT NOT NULL UNIQUE,
        unit TEXT NOT NULL CHECK (unit IN ('kg', 'lb')),
        rounding_increment REAL NOT NULL CHECK (rounding_increment > 0),
        rounding_direction TEXT NOT NULL CHECK (rounding_direction IN ('up', 'down', 'nearest')),
        tm_percentage REAL NOT NULL DEFAULT 0.90 CHECK (tm_percentage BETWEEN 0.85 AND 0.90),
        include_deload INTEGER NOT NULL DEFAULT 1 CHECK (include_deload IN (0, 1)),
        upper_tm_increment REAL NOT NULL CHECK (upper_tm_increment > 0),
        lower_tm_increment REAL NOT NULL CHECK (lower_tm_increment > 0),
        warmup_enabled INTEGER NOT NULL DEFAULT 1 CHECK (warmup_enabled IN (0, 1))
      );
      CREATE TABLE FiveThreeOne_AssistanceTemplates (template_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, template_key TEXT NOT NULL UNIQUE, template_name TEXT NOT NULL, description TEXT, is_builtin INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE FiveThreeOne_AssistanceExercises (assistance_exercise_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, template_id INTEGER NOT NULL, exercise_key TEXT NOT NULL UNIQUE, exercise_name TEXT NOT NULL, sets INTEGER NOT NULL, reps INTEGER NOT NULL, sort_order INTEGER NOT NULL);
      CREATE TABLE FiveThreeOne_Lifts (lift_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, program_id INTEGER NOT NULL, lift_name TEXT NOT NULL, lift_type TEXT NOT NULL, training_max REAL NOT NULL, day_slot INTEGER NOT NULL, weekday INTEGER, warmup_enabled INTEGER NOT NULL DEFAULT 1, assistance_template_id INTEGER);
      CREATE TABLE FiveThreeOne_Cycles (cycle_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, program_id INTEGER NOT NULL, cycle_number INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'planned', current_week INTEGER NOT NULL DEFAULT 1, include_deload INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER);
      CREATE TABLE FiveThreeOne_WorkoutLink (workout_link_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, cycle_id INTEGER, lift_id INTEGER, workout_id INTEGER, day_id INTEGER, exercise_id INTEGER, workout_log_id INTEGER, weight_log_id INTEGER, week_number INTEGER NOT NULL, set_number INTEGER NOT NULL, work_set_number INTEGER, training_max REAL NOT NULL, percentage REAL NOT NULL, target_weight REAL NOT NULL, target_reps INTEGER NOT NULL, is_amrap INTEGER NOT NULL DEFAULT 0, is_warmup INTEGER NOT NULL DEFAULT 0, warmup_completed_at INTEGER);
      CREATE TABLE FiveThreeOne_LiftAssistance (lift_assistance_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, lift_id INTEGER NOT NULL, exercise_name TEXT NOT NULL, sets INTEGER NOT NULL, reps INTEGER NOT NULL, sort_order INTEGER NOT NULL);
      CREATE TABLE FiveThreeOne_AmrapResults (amrap_result_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, workout_link_id INTEGER, weight_log_id INTEGER NOT NULL, program_id INTEGER, cycle_id INTEGER, lift_id INTEGER, lift_name TEXT NOT NULL, workout_date INTEGER NOT NULL, week_number INTEGER NOT NULL, work_set_number INTEGER NOT NULL, weight REAL NOT NULL, reps INTEGER NOT NULL, estimated_1rm REAL NOT NULL, is_pr INTEGER NOT NULL DEFAULT 0);
      CREATE UNIQUE INDEX FiveThreeOne_Lifts_program_weekday ON FiveThreeOne_Lifts (program_id, weekday);
    `);

    await runSchema(executor);

    const remaining = tableNames(db);
    expect(remaining).not.toContain('Recurring_Workouts');
    expect(remaining).not.toContain('Template_Workouts');
    expect(remaining).not.toContain('Template_Days');
    expect(remaining).not.toContain('Template_Exercises');
    for (const table of [
      'FiveThreeOne_Programs',
      'FiveThreeOne_AssistanceTemplates',
      'FiveThreeOne_AssistanceExercises',
      'FiveThreeOne_Lifts',
      'FiveThreeOne_Cycles',
      'FiveThreeOne_WorkoutLink',
      'FiveThreeOne_LiftAssistance',
      'FiveThreeOne_AmrapResults',
    ]) {
      expect(remaining).not.toContain(table);
    }
    expect(triggerNames(db)).not.toContain('update_recurring_workout_name');
  });

  it('keeps the history tables and their documented columns', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    expect(columnNames(db, 'Workout_Log')).toEqual(
      expect.arrayContaining(['workout_log_id', 'workout_name', 'day_name', 'workout_date']),
    );
    expect(columnNames(db, 'Logged_Exercises')).toEqual(
      expect.arrayContaining([
        'logged_exercise_id',
        'workout_log_id',
        'exercise_name',
        'sets',
        'reps',
      ]),
    );
  });

  it('enforces exactly one active routine', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    const insertRoutine = (key: string) =>
      db
        .prepare(
          `INSERT INTO Routines
             (routine_key, name, origin, progression_rule, unit, rounding_increment,
              rest_main_seconds, rest_accessory_seconds, is_active, created_at)
           VALUES (?, 'R', 'user', 'linear', 'kg', 2.5, 180, 90, 1, 0)`,
        )
        .run(key);

    insertRoutine('first');
    expect(() => insertRoutine('second')).toThrow();

    db.prepare(`UPDATE Routines SET is_active = 0 WHERE routine_key = 'first'`).run();
    expect(() => insertRoutine('second')).not.toThrow();
  });

  it('allows a routine to carry no loads — every weight column may be NULL (§3.2)', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    db.prepare(
      `INSERT INTO Routines
         (routine_key, name, origin, progression_rule, unit, rounding_increment,
          rest_main_seconds, rest_accessory_seconds, is_active, created_at)
       VALUES ('nw', 'No Weights', 'user', 'wave', 'kg', 2.5, 180, 90, 1, 0);`,
    ).run();
    db.prepare(
      `INSERT INTO Sessions (routine_id, weekday, name, sort_order)
       VALUES (1, 1, 'Day', 1);`,
    ).run();

    // A training-max exercise with NO training max yet — the CHECK used to reject this.
    expect(() =>
      db
        .prepare(
          `INSERT INTO SessionExercises
             (session_id, catalog_exercise_id, exercise_name, role, target_sets, target_reps,
              load_source, training_max_pct, training_max_weight, absolute_weight,
              unit_override, is_amrap, sort_order)
           VALUES (1, NULL, 'Squat', 'main', 3, 5, 'training_max_pct', 0.9, NULL, NULL, NULL, 1, 1);`,
        )
        .run(),
    ).not.toThrow();

    // An absolute exercise with no starting weight.
    expect(() =>
      db
        .prepare(
          `INSERT INTO SessionExercises
             (session_id, catalog_exercise_id, exercise_name, role, target_sets, target_reps,
              load_source, training_max_pct, training_max_weight, absolute_weight,
              unit_override, is_amrap, sort_order)
           VALUES (1, NULL, 'Curl', 'accessory', 3, 10, 'absolute', NULL, NULL, NULL, NULL, 0, 2);`,
        )
        .run(),
    ).not.toThrow();

    // The mutual exclusion still holds: a pct row must not carry an absolute weight.
    expect(() =>
      db
        .prepare(
          `INSERT INTO SessionExercises
             (session_id, catalog_exercise_id, exercise_name, role, target_sets, target_reps,
              load_source, training_max_pct, training_max_weight, absolute_weight,
              unit_override, is_amrap, sort_order)
           VALUES (1, NULL, 'Bad', 'accessory', 3, 10, 'training_max_pct', 0.9, NULL, 20, NULL, 0, 3);`,
        )
        .run(),
    ).toThrow();
  });

  it('adds the M2 columns to a legacy Weight_Log, SessionExercises and Routines, idempotently', async () => {
    const { db, executor } = connect();
    db.exec(`
      CREATE TABLE Weight_Log (
        weight_log_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        workout_log_id INTEGER NOT NULL,
        logged_exercise_id INTEGER NOT NULL,
        exercise_name TEXT NOT NULL,
        set_number INTEGER NOT NULL,
        weight_logged REAL NOT NULL,
        reps_logged INTEGER NOT NULL,
        FOREIGN KEY (workout_log_id) REFERENCES Workout_Log(workout_log_id) ON DELETE CASCADE,
        FOREIGN KEY (logged_exercise_id) REFERENCES Logged_Exercises(logged_exercise_id),
        UNIQUE (workout_log_id, logged_exercise_id, set_number)
      );
      CREATE TABLE SessionExercises (
        session_exercise_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        session_id INTEGER NOT NULL,
        catalog_exercise_id TEXT,
        exercise_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('main', 'accessory')),
        target_sets INTEGER NOT NULL,
        target_reps INTEGER NOT NULL,
        load_source TEXT NOT NULL,
        training_max_pct REAL,
        training_max_weight REAL,
        absolute_weight REAL,
        unit_override TEXT,
        is_amrap INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL
      );
      CREATE TABLE Routines (
        routine_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        routine_key TEXT UNIQUE,
        name TEXT NOT NULL,
        origin TEXT NOT NULL,
        progression_rule TEXT NOT NULL,
        unit TEXT NOT NULL,
        rounding_increment REAL NOT NULL,
        rest_main_seconds INTEGER NOT NULL,
        rest_accessory_seconds INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE Logged_Exercises (
        logged_exercise_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        workout_log_id INTEGER NOT NULL,
        exercise_name TEXT NOT NULL,
        sets INTEGER NOT NULL,
        reps INTEGER NOT NULL
      );
    `);

    expect(columnNames(db, 'Weight_Log')).not.toContain('started_at');
    expect(columnNames(db, 'SessionExercises')).not.toContain('bar_profile');
    expect(columnNames(db, 'SessionExercises')).not.toContain('category');
    expect(columnNames(db, 'Routines')).not.toContain('planned_jokers');
    expect(columnNames(db, 'Routines')).not.toContain('cycle_weeks');
    expect(columnNames(db, 'Logged_Exercises')).not.toContain('role');

    await ensureWeightLogTimingColumns(executor);
    await ensureSessionExercisesColumns(executor);
    await ensureRoutinesPlannedJokers(executor);
    await ensureRoutinesWaveSetupColumns(executor);
    await ensureLoggedExercisesRoleColumn(executor);

    expect(columnNames(db, 'Weight_Log')).toEqual(
      expect.arrayContaining(['started_at', 'completed_at']),
    );
    expect(columnNames(db, 'SessionExercises')).toEqual(
      expect.arrayContaining(['bar_profile', 'bar_weight', 'category']),
    );
    expect(columnNames(db, 'Routines')).toEqual(
      expect.arrayContaining([
        'planned_jokers',
        'tm_increment_upper',
        'tm_increment_lower',
        'cycle_weeks',
      ]),
    );
    expect(columnNames(db, 'Logged_Exercises')).toEqual(expect.arrayContaining(['role']));

    // Idempotent: a second pass changes nothing.
    await ensureWeightLogTimingColumns(executor);
    await ensureSessionExercisesColumns(executor);
    await ensureRoutinesPlannedJokers(executor);
    await ensureRoutinesWaveSetupColumns(executor);
    await ensureLoggedExercisesRoleColumn(executor);
    expect(columnNames(db, 'Weight_Log')).toEqual(
      expect.arrayContaining(['started_at', 'completed_at']),
    );
    expect(columnNames(db, 'Routines')).toEqual(
      expect.arrayContaining(['planned_jokers', 'cycle_weeks']),
    );
    expect(columnNames(db, 'Logged_Exercises')).toEqual(expect.arrayContaining(['role']));
  });

  it('seeds the catalog idempotently', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    const exerciseCount = () => count(db, 'Catalog_Exercises');
    const muscleCount = () => count(db, 'Catalog_Exercise_Muscles');

    expect(exerciseCount()).toBeGreaterThan(500);
    expect(muscleCount()).toBeGreaterThan(1000);

    const exercisesBefore = exerciseCount();
    const musclesBefore = muscleCount();
    seedCatalog(executor);
    expect(exerciseCount()).toBe(exercisesBefore);
    expect(muscleCount()).toBe(musclesBefore);
  });

  it('adds the unit column to a legacy Weight_Log', async () => {
    const { db, executor } = connect();
    db.exec(`
      CREATE TABLE Workout_Log (
        workout_log_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        workout_name TEXT NOT NULL,
        day_name TEXT NOT NULL,
        workout_date INTEGER NOT NULL,
        UNIQUE (workout_date, day_name, workout_name)
      );
      CREATE TABLE Logged_Exercises (
        logged_exercise_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        workout_log_id INTEGER NOT NULL,
        exercise_name TEXT NOT NULL,
        sets INTEGER NOT NULL,
        reps INTEGER NOT NULL,
        FOREIGN KEY (workout_log_id) REFERENCES Workout_Log(workout_log_id) ON DELETE CASCADE
      );
      CREATE TABLE Weight_Log (
        weight_log_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        workout_log_id INTEGER NOT NULL,
        logged_exercise_id INTEGER NOT NULL,
        exercise_name TEXT NOT NULL,
        set_number INTEGER NOT NULL,
        weight_logged REAL NOT NULL,
        reps_logged INTEGER NOT NULL,
        FOREIGN KEY (workout_log_id) REFERENCES Workout_Log(workout_log_id) ON DELETE CASCADE,
        FOREIGN KEY (logged_exercise_id) REFERENCES Logged_Exercises(logged_exercise_id),
        UNIQUE (workout_log_id, logged_exercise_id, set_number)
      );
    `);

    expect(columnNames(db, 'Weight_Log')).not.toContain('unit');
    await ensureWeightLogUnitColumn(executor);
    expect(columnNames(db, 'Weight_Log')).toContain('unit');

    await ensureWeightLogUnitColumn(executor);
    expect(columnNames(db, 'Weight_Log')).toContain('unit');
  });

  it('brings a bundled legacy database to the full schema (fresh-install path)', async () => {
    const bundled = join(process.cwd(), 'assets', 'SimpleDB.db');
    const temp = join(tmpdir(), 'sgt-f1-bundled-test.db');
    copyFileSync(bundled, temp);
    const db = new DatabaseSync(temp);
    const executor: SchemaExecutor = {
      exec: (sql) => db.exec(sql),
      run: (sql, params) => {
        db.prepare(sql).run(...(params as SQLInputValue[]));
      },
      getAll: <T>(sql: string, params: SQLInputValue[] = []) =>
        db.prepare(sql).all(...params) as T[],
    };

    await runSchema(executor);

    expect(tableNames(db)).toContain('Routines');
    expect(tableNames(db)).toContain('Catalog_Exercises');
    expect(columnNames(db, 'Weight_Log')).toContain('unit');
    expect(count(db, 'Catalog_Exercises')).toBeGreaterThan(500);
  });
});
