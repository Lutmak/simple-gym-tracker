import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import { loadDemoData } from './demoData';
import {
  buildEditRows,
  EditRoutineValidationError,
  saveRoutineEdit,
  type EditExercise,
  type EditRoutine,
  type EditSession,
} from './editRoutine';
import {
  loadRoutineSourceById,
  type RoutineDatabase,
  type RoutineSourceBundle,
} from './routineActions';

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

const exerciseFrom = (source: RoutineSourceBundle, name: string): EditExercise => {
  const exercise = source.exercises.find((row) => row.name === name);
  if (exercise === undefined) {
    throw new Error(`Fixture missing exercise ${name}`);
  }
  return {
    catalogExerciseId: exercise.catalogExerciseId,
    name: exercise.name,
    role: exercise.role,
    targetSets: exercise.targetSets,
    targetReps: exercise.targetReps,
    loadSource: exercise.loadSource,
    trainingMaxPct: exercise.trainingMaxPct,
    trainingMaxWeight: exercise.trainingMaxWeight,
    absoluteWeight: exercise.absoluteWeight,
    unitOverride: exercise.unitOverride,
    isAmrap: exercise.isAmrap,
  };
};

const sessionFrom = (
  source: RoutineSourceBundle,
  name: string,
  weekday: number,
): EditSession => {
  const sourceSession = source.sessions.find((row) => row.name === name);
  if (sourceSession === undefined) {
    throw new Error(`Fixture missing session ${name}`);
  }
  return {
    weekday,
    name: sourceSession.name,
    exercises: source.exercises
      .filter((row) => row.sessionId === sourceSession.sessionId)
      .map((row) => {
        const exercise = source.exercises.find((r) => r.exerciseId === row.exerciseId);
        if (exercise === undefined) {
          throw new Error(`Fixture missing exercise ${row.exerciseId}`);
        }
        return exerciseFrom(source, exercise.name);
      }),
  };
};

const demoRoutineDraft = async (
  executor: TestExecutor,
): Promise<EditRoutine> => {
  await runSchema(executor);
  await loadDemoData(executor);
  const source = await loadRoutineSourceById(executor, 1);
  return {
    name: source.routine.name,
    unit: source.routine.unit as 'kg' | 'lb',
    roundingIncrement: source.routine.roundingIncrement,
    restMainSeconds: source.routine.restMainSeconds,
    restAccessorySeconds: source.routine.restAccessorySeconds,
    sessions: [
      sessionFrom(source, 'Squat Day', 1),
      sessionFrom(source, 'Bench Day', 3),
      sessionFrom(source, 'Deadlift Day', 5),
    ],
  };
};

describe('buildEditRows — pure draft to plan rows', () => {
  const draft = (): EditRoutine => ({
    name: 'My Routine',
    unit: 'kg',
    roundingIncrement: 2.5,
    restMainSeconds: 180,
    restAccessorySeconds: 90,
    sessions: [
      {
        weekday: 1,
        name: 'Upper',
        exercises: [
          {
            catalogExerciseId: 'Dumbbell_Bench_Press',
            name: 'Dumbbell Bench Press',
            role: 'main',
            targetSets: 3,
            targetReps: 10,
            loadSource: 'training_max_pct',
            trainingMaxPct: null,
            trainingMaxWeight: 100,
            absoluteWeight: null,
            unitOverride: null,
            isAmrap: true,
          },
          {
            catalogExerciseId: 'Chin-Up',
            name: 'Chin-Up',
            role: 'accessory',
            targetSets: 3,
            targetReps: 8,
            loadSource: 'bodyweight',
            trainingMaxPct: null,
            trainingMaxWeight: null,
            absoluteWeight: null,
            unitOverride: null,
            isAmrap: false,
          },
        ],
      },
      {
        weekday: 4,
        name: 'Lower',
        exercises: [
          {
            catalogExerciseId: null,
            name: 'My custom lift',
            role: 'main',
            targetSets: 5,
            targetReps: 5,
            loadSource: 'absolute',
            trainingMaxPct: null,
            trainingMaxWeight: null,
            absoluteWeight: 120,
            unitOverride: 'lb',
            isAmrap: false,
          },
        ],
      },
    ],
  });

  it('assigns sort orders from list positions and normalizes per load source', () => {
    const rows = buildEditRows(draft());

    expect(rows.routine).toEqual({
      name: 'My Routine',
      unit: 'kg',
      roundingIncrement: 2.5,
      restMainSeconds: 180,
      restAccessorySeconds: 90,
    });
    expect(rows.sessions).toEqual([
      { weekday: 1, name: 'Upper', sortOrder: 1 },
      { weekday: 4, name: 'Lower', sortOrder: 2 },
    ]);

    const [press, chinUp, custom] = rows.exercises;
    expect(press).toMatchObject({
      sessionIndex: 0,
      sortOrder: 1,
      loadSource: 'training_max_pct',
      trainingMaxPct: 0.9,
      trainingMaxWeight: 100,
      absoluteWeight: null,
      unitOverride: null,
      isAmrap: true,
    });
    expect(chinUp).toMatchObject({
      sessionIndex: 0,
      sortOrder: 2,
      loadSource: 'bodyweight',
      trainingMaxPct: null,
      trainingMaxWeight: null,
      absoluteWeight: null,
    });
    expect(custom).toMatchObject({
      sessionIndex: 1,
      sortOrder: 1,
      catalogExerciseId: null,
      loadSource: 'absolute',
      trainingMaxPct: null,
      trainingMaxWeight: null,
      absoluteWeight: 120,
      unitOverride: 'lb',
    });
  });

  it('keeps an explicit training max percentage', () => {
    const rows = buildEditRows({
      ...draft(),
      sessions: [
        {
          ...draft().sessions[0],
          exercises: [
            { ...draft().sessions[0].exercises[0], trainingMaxPct: 0.85 },
          ],
        },
      ],
    });
    expect(rows.exercises[0].trainingMaxPct).toBe(0.85);
  });

  it('rejects duplicate weekdays', () => {
    const dup = {
      ...draft(),
      sessions: [
        draft().sessions[0],
        { ...draft().sessions[1], weekday: 1 },
      ],
    };
    expect(() => buildEditRows(dup)).toThrowError(EditRoutineValidationError);
    try {
      buildEditRows(dup);
    } catch (error) {
      expect((error as EditRoutineValidationError).detail).toEqual({
        code: 'duplicateWeekday',
      });
    }
  });

  it('rejects a missing training max and a missing absolute weight', () => {
    expect(() =>
      buildEditRows({
        ...draft(),
        sessions: [
          {
            ...draft().sessions[0],
            exercises: [
              { ...draft().sessions[0].exercises[0], trainingMaxWeight: null },
            ],
          },
        ],
      }),
    ).toThrowError(EditRoutineValidationError);

    expect(() =>
      buildEditRows({
        ...draft(),
        sessions: [
          {
            ...draft().sessions[1],
            exercises: [
              { ...draft().sessions[1].exercises[0], absoluteWeight: null },
            ],
          },
        ],
      }),
    ).toThrowError(EditRoutineValidationError);
  });

  it('rejects non-positive sets and reps', () => {
    const badSets = {
      ...draft(),
      sessions: [
        {
          ...draft().sessions[0],
          exercises: [{ ...draft().sessions[0].exercises[0], targetSets: 0 }],
        },
      ],
    };
    expect(() => buildEditRows(badSets)).toThrowError(EditRoutineValidationError);

    const badReps = {
      ...draft(),
      sessions: [
        {
          ...draft().sessions[0],
          exercises: [{ ...draft().sessions[0].exercises[0], targetReps: -2 }],
        },
      ],
    };
    expect(() => buildEditRows(badReps)).toThrowError(EditRoutineValidationError);
  });

  it('rejects an empty routine name, an empty session name and a bad rounding increment', () => {
    expect(() => buildEditRows({ ...draft(), name: '  ' })).toThrowError(
      EditRoutineValidationError,
    );
    expect(() =>
      buildEditRows({
        ...draft(),
        sessions: [{ ...draft().sessions[0], name: ' ' }],
      }),
    ).toThrowError(EditRoutineValidationError);
    expect(() =>
      buildEditRows({ ...draft(), roundingIncrement: 0 }),
    ).toThrowError(EditRoutineValidationError);
  });
});

describe('saveRoutineEdit — rewriting the plan without touching history', () => {
  const editedDraft = (base: EditRoutine): EditRoutine => ({
    ...base,
    name: 'Renamed Routine',
    unit: 'lb',
    roundingIncrement: 5,
    restMainSeconds: 150,
    restAccessorySeconds: 75,
    sessions: base.sessions
      .filter((session) => session.name !== 'Deadlift Day')
      .map((session) =>
        session.name === 'Squat Day' ? { ...session, weekday: 2 } : session,
      ),
  });

  it('updates the plan and leaves Workout_Log / Logged_Exercises / Weight_Log untouched', async () => {
    const { db, executor } = connect();
    const base = await demoRoutineDraft(executor);
    const historyBefore = {
      workoutLog: count(db, 'Workout_Log'),
      logged: count(db, 'Logged_Exercises'),
      weight: count(db, 'Weight_Log'),
    };
    expect(historyBefore.workoutLog).toBeGreaterThan(0);
    expect(historyBefore.weight).toBeGreaterThan(0);

    await saveRoutineEdit(executor, 1, editedDraft(base));

    expect(count(db, 'Workout_Log')).toBe(historyBefore.workoutLog);
    expect(count(db, 'Logged_Exercises')).toBe(historyBefore.logged);
    expect(count(db, 'Weight_Log')).toBe(historyBefore.weight);

    const routine = db
      .prepare('SELECT * FROM Routines WHERE routine_id = 1;')
      .get() as Record<string, unknown>;
    expect(routine.name).toBe('Renamed Routine');
    expect(routine.unit).toBe('lb');
    expect(routine.rounding_increment).toBe(5);
    expect(routine.rest_main_seconds).toBe(150);
    expect(routine.rest_accessory_seconds).toBe(75);
    expect(routine.progression_rule).toBe('linear');
    expect(routine.origin).toBe('user');
    expect(routine.is_active).toBe(1);

    const sessions = db
      .prepare('SELECT weekday, name FROM Sessions WHERE routine_id = 1 ORDER BY sort_order;')
      .all() as { weekday: number; name: string }[];
    expect(sessions).toEqual([
      { weekday: 2, name: 'Squat Day' },
      { weekday: 3, name: 'Bench Day' },
    ]);
  });

  it('moves a session to a new weekday with its exercises intact', async () => {
    const { db, executor } = connect();
    const base = await demoRoutineDraft(executor);

    const squatSession = base.sessions.find((s) => s.name === 'Squat Day');
    if (squatSession === undefined) {
      throw new Error('Fixture missing Squat Day');
    }
    const squatExercises = squatSession.exercises.map((e) => e.name).sort();

    await saveRoutineEdit(executor, 1, {
      ...base,
      sessions: base.sessions.map((s) =>
        s.name === 'Squat Day' ? { ...s, weekday: 2 } : s,
      ),
    });

    const moved = db
      .prepare(
        'SELECT weekday FROM Sessions WHERE routine_id = 1 AND name = ?;',
      )
      .get('Squat Day') as { weekday: number };
    expect(moved.weekday).toBe(2);

    const movedExercises = db
      .prepare(
        `SELECT e.exercise_name FROM SessionExercises e
         JOIN Sessions s ON s.session_id = e.session_id
         WHERE s.routine_id = 1 AND s.name = ? ORDER BY e.sort_order;`,
      )
      .all('Squat Day') as { exercise_name: string }[];
    expect(movedExercises.map((row) => row.exercise_name).sort()).toEqual(
      squatExercises,
    );
  });

  it('keeps the SessionExercises CHECK valid across a load-source switch', async () => {
    const { db, executor } = connect();
    const base = await demoRoutineDraft(executor);

    const bench = base.sessions
      .find((s) => s.name === 'Bench Day')
      ?.exercises.find((e) => e.name === 'Barbell Bench Press - Medium Grip');
    if (bench === undefined) {
      throw new Error('Fixture missing bench press');
    }
    const latPulldown = base.sessions
      .find((s) => s.name === 'Bench Day')
      ?.exercises.find((e) => e.name === 'Wide-Grip Lat Pulldown');
    if (latPulldown === undefined) {
      throw new Error('Fixture missing lat pulldown');
    }

    await saveRoutineEdit(executor, 1, {
      ...base,
      sessions: base.sessions.map((s) =>
        s.name === 'Bench Day'
          ? {
              ...s,
              exercises: s.exercises.map((e) =>
                e.name === bench.name
                  ? { ...e, loadSource: 'bodyweight' }
                  : e.name === latPulldown.name
                    ? {
                        ...e,
                        loadSource: 'training_max_pct',
                        trainingMaxPct: null,
                        trainingMaxWeight: 100,
                        absoluteWeight: null,
                      }
                    : e,
              ),
            }
          : s,
      ),
    });

    const rows = db
      .prepare(
        `SELECT e.exercise_name, e.load_source, e.training_max_pct,
                e.training_max_weight, e.absolute_weight
         FROM SessionExercises e JOIN Sessions s ON s.session_id = e.session_id
         WHERE s.routine_id = 1 AND e.exercise_name IN (?, ?);`,
      )
      .all(bench.name, latPulldown.name) as {
      exercise_name: string;
      load_source: string;
      training_max_pct: number | null;
      training_max_weight: number | null;
      absolute_weight: number | null;
    }[];

    const bodyweight = rows.find((row) => row.exercise_name === bench.name);
    expect(bodyweight).toMatchObject({
      load_source: 'bodyweight',
      training_max_pct: null,
      training_max_weight: null,
      absolute_weight: null,
    });
    const trainingMax = rows.find((row) => row.exercise_name === latPulldown.name);
    expect(trainingMax).toMatchObject({
      load_source: 'training_max_pct',
      training_max_pct: 0.9,
      training_max_weight: 100,
      absolute_weight: null,
    });

    const invalid = db
      .prepare(
        `SELECT COUNT(*) AS n FROM SessionExercises
         WHERE (load_source = 'training_max_pct' AND (training_max_pct IS NULL OR training_max_weight IS NULL))
            OR (load_source = 'absolute' AND absolute_weight IS NULL)
            OR (load_source = 'bodyweight' AND (absolute_weight IS NOT NULL OR training_max_pct IS NOT NULL OR training_max_weight IS NOT NULL));`,
      )
      .get() as { n: number };
    expect(invalid.n).toBe(0);
  });

  it('swapping an exercise to a custom row clears the catalog id but keeps the name snapshot', async () => {
    const { db, executor } = connect();
    const base = await demoRoutineDraft(executor);

    await saveRoutineEdit(executor, 1, {
      ...base,
      sessions: base.sessions.map((s) =>
        s.name === 'Squat Day'
          ? {
              ...s,
              exercises: s.exercises.map((e) =>
                e.name === 'Barbell Full Squat'
                  ? { ...e, catalogExerciseId: null, name: 'My Squat' }
                  : e,
              ),
            }
          : s,
      ),
    });

    const row = db
      .prepare(
        `SELECT e.catalog_exercise_id, e.exercise_name FROM SessionExercises e
         JOIN Sessions s ON s.session_id = e.session_id
         WHERE s.routine_id = 1 AND s.name = 'Squat Day';`,
      )
      .all() as { catalog_exercise_id: string | null; exercise_name: string }[];
    expect(row).toContainEqual({
      catalog_exercise_id: null,
      exercise_name: 'My Squat',
    });
    const squatCount = row.filter((r) => r.exercise_name === 'My Squat').length;
    expect(squatCount).toBe(1);
  });
});
