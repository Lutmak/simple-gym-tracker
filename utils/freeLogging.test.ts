import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import { loadDemoData } from './demoData';
import {
  buildFreeLogRows,
  saveFreeSession,
  type FreeLogExercise,
} from './freeLogging';
import type { RoutineDatabase } from './routineActions';

type TestExecutor = SchemaExecutor & {
  get: RoutineDatabase['get'];
};

const connect = (): { db: DatabaseSync; executor: TestExecutor } => {
  const db = new DatabaseSync(':memory:');
  const executor: TestExecutor = {
    exec: (sql) => db.exec(sql),
    run: (sql, params) => {
      db.prepare(sql).run(...((params ?? []) as SQLInputValue[]));
    },
    getAll: <T>(sql: string, params: SQLInputValue[] = []) =>
      Promise.resolve(db.prepare(sql).all(...params) as T[]),
    get: <T>(sql: string, params: SQLInputValue[] = []) =>
      Promise.resolve(db.prepare(sql).get(...params) as T | undefined),
  };
  return { db, executor };
};

const count = (db: DatabaseSync, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

const TODAY = Math.floor(Date.UTC(2026, 7, 14, 12, 0, 0) / 1000);

const SESSION: FreeLogExercise[] = [
  {
    name: 'Barbell Full Squat',
    unit: 'kg',
    sets: [
      { reps: 5, weight: 102.5 },
      { reps: 5, weight: 102.5 },
      { reps: 6, weight: 102.5 },
    ],
  },
  {
    name: 'Bent Over Two-Dumbbell Row',
    unit: 'lb',
    sets: [{ reps: 10, weight: 45 }],
  },
];

describe('buildFreeLogRows — the §3.2 history rows for a routine-less session', () => {
  it('writes one Logged_Exercises row per exercise and one Weight_Log row per set, 1..N, in the exercise unit', () => {
    const rows = buildFreeLogRows(SESSION, 'Free session', 'Free session', TODAY);

    expect(rows.workoutLog).toEqual({
      workoutName: 'Free session',
      dayName: 'Free session',
      workoutDate: TODAY,
    });
    expect(rows.loggedExercises).toEqual([
      { exerciseName: 'Barbell Full Squat', sets: 3, reps: 6 },
      { exerciseName: 'Bent Over Two-Dumbbell Row', sets: 1, reps: 10 },
    ]);
    expect(rows.weightLog).toHaveLength(4);
    const squatSets = rows.weightLog.filter((s) => s.loggedExerciseIndex === 0);
    expect(squatSets.map((s) => s.setNumber)).toEqual([1, 2, 3]);
    expect(squatSets.map((s) => s.reps)).toEqual([5, 5, 6]);
    expect(squatSets.every((s) => s.unit === 'kg')).toBe(true);
    const rowSets = rows.weightLog.filter((s) => s.loggedExerciseIndex === 1);
    expect(rowSets.map((s) => s.setNumber)).toEqual([1]);
    expect(rowSets.every((s) => s.unit === 'lb')).toBe(true);
  });

  it('records the actual set count in sets and the last set reps in reps', () => {
    const rows = buildFreeLogRows(
      [
        {
          name: 'Barbell Full Squat',
          unit: 'kg',
          sets: [{ reps: 5, weight: 100 }, { reps: 8, weight: 100 }],
        },
      ],
      'Free session',
      'Free session',
      TODAY,
    );
    expect(rows.loggedExercises).toEqual([
      { exerciseName: 'Barbell Full Squat', sets: 2, reps: 8 },
    ]);
  });

  it('produces no rows at all for an exercise with no sets', () => {
    const rows = buildFreeLogRows(
      [{ name: 'Barbell Full Squat', unit: 'kg', sets: [] }],
      'Free session',
      'Free session',
      TODAY,
    );
    expect(rows.loggedExercises).toHaveLength(0);
    expect(rows.weightLog).toHaveLength(0);
  });
});

describe('saveFreeSession — one atomic transaction, no routine bookkeeping', () => {
  it('writes only the history rows and leaves every plan, cycle and proposal table untouched', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(executor);

    const before = {
      workoutLog: count(db, 'Workout_Log'),
      logged: count(db, 'Logged_Exercises'),
      weight: count(db, 'Weight_Log'),
      routines: count(db, 'Routines'),
      sessions: count(db, 'Sessions'),
      sessionExercises: count(db, 'SessionExercises'),
      cycles: count(db, 'Cycles'),
      cycleWeeks: count(db, 'CycleWeeks'),
      weekSessions: count(db, 'WeekSessions'),
      proposals: count(db, 'Progression_Proposal'),
    };
    expect(before.weekSessions).toBeGreaterThan(0);
    expect(before.proposals).toBeGreaterThan(0);

    const saved = await saveFreeSession(executor, 'Free session', TODAY, SESSION);

    expect(saved.workoutLogId).toEqual(expect.any(Number));
    expect(saved.workoutName).toBe('Free session');
    expect(saved.loggedSets).toBe(4);
    expect(saved.loggedExercises).toBe(2);

    expect(count(db, 'Workout_Log')).toBe(before.workoutLog + 1);
    expect(count(db, 'Logged_Exercises')).toBe(before.logged + 2);
    expect(count(db, 'Weight_Log')).toBe(before.weight + 4);

    expect(count(db, 'Routines')).toBe(before.routines);
    expect(count(db, 'Sessions')).toBe(before.sessions);
    expect(count(db, 'SessionExercises')).toBe(before.sessionExercises);
    expect(count(db, 'Cycles')).toBe(before.cycles);
    expect(count(db, 'CycleWeeks')).toBe(before.cycleWeeks);
    expect(count(db, 'WeekSessions')).toBe(before.weekSessions);
    expect(count(db, 'Progression_Proposal')).toBe(before.proposals);

    const log = db
      .prepare('SELECT * FROM Workout_Log WHERE workout_log_id = ?;')
      .get(saved.workoutLogId) as Record<string, unknown>;
    expect(log.workout_name).toBe('Free session');
    expect(log.day_name).toBe('Free session');
    expect(log.workout_date).toBe(TODAY);

    const weightRows = db
      .prepare(
        `SELECT exercise_name, unit, set_number, weight_logged, reps_logged
         FROM Weight_Log WHERE workout_log_id = ? ORDER BY weight_log_id;`,
      )
      .all(saved.workoutLogId) as {
      exercise_name: string;
      unit: string;
      set_number: number;
      weight_logged: number;
      reps_logged: number;
    }[];
    expect(weightRows).toEqual([
      { exercise_name: 'Barbell Full Squat', unit: 'kg', set_number: 1, weight_logged: 102.5, reps_logged: 5 },
      { exercise_name: 'Barbell Full Squat', unit: 'kg', set_number: 2, weight_logged: 102.5, reps_logged: 5 },
      { exercise_name: 'Barbell Full Squat', unit: 'kg', set_number: 3, weight_logged: 102.5, reps_logged: 6 },
      { exercise_name: 'Bent Over Two-Dumbbell Row', unit: 'lb', set_number: 1, weight_logged: 45, reps_logged: 10 },
    ]);
  });

  it('names a second same-day session `label #2` so the UNIQUE constraint holds', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(executor);

    await saveFreeSession(executor, 'Free session', TODAY, SESSION);
    const second = await saveFreeSession(executor, 'Free session', TODAY, [
      { name: 'Barbell Full Squat', unit: 'kg', sets: [{ reps: 5, weight: 100 }] },
    ]);

    expect(second.workoutName).toBe('Free session #2');
    const names = db
      .prepare(
        `SELECT workout_name FROM Workout_Log
         WHERE workout_date = ? AND workout_name LIKE 'Free session%'
         ORDER BY workout_log_id;`,
      )
      .all(TODAY) as { workout_name: string }[];
    expect(names.map((row) => row.workout_name)).toEqual([
      'Free session',
      'Free session #2',
    ]);
  });

  it('an abandoned session writes nothing', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(executor);
    const before = {
      workoutLog: count(db, 'Workout_Log'),
      logged: count(db, 'Logged_Exercises'),
      weight: count(db, 'Weight_Log'),
      weekSessions: count(db, 'WeekSessions'),
      proposals: count(db, 'Progression_Proposal'),
    };

    await expect(saveFreeSession(executor, 'Free session', TODAY, [])).rejects.toThrow(
      'nothing to save',
    );

    expect(count(db, 'Workout_Log')).toBe(before.workoutLog);
    expect(count(db, 'Logged_Exercises')).toBe(before.logged);
    expect(count(db, 'Weight_Log')).toBe(before.weight);
    expect(count(db, 'WeekSessions')).toBe(before.weekSessions);
    expect(count(db, 'Progression_Proposal')).toBe(before.proposals);
  });

  it('rolls back the whole write when any statement fails', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(executor);
    const before = {
      workoutLog: count(db, 'Workout_Log'),
      logged: count(db, 'Logged_Exercises'),
      weight: count(db, 'Weight_Log'),
    };
    const failing: TestExecutor = {
      ...executor,
      run: async (sql, params) => {
        if (sql.includes('INSERT INTO Weight_Log')) {
          throw new Error('boom');
        }
        return executor.run(sql, params);
      },
    };

    await expect(saveFreeSession(failing, 'Free session', TODAY, SESSION)).rejects.toThrow(
      'boom',
    );

    expect(count(db, 'Workout_Log')).toBe(before.workoutLog);
    expect(count(db, 'Logged_Exercises')).toBe(before.logged);
    expect(count(db, 'Weight_Log')).toBe(before.weight);
  });
});
