import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import {
  activatePresetRoutine,
  activateRoutineById,
  buildRoutineCopyRows,
  deleteRoutine,
  duplicateRoutine,
  getActiveRoutine,
  loadPresetRoutineSource,
  loadRoutineSourceById,
  routineNeedsWeights,
  type RoutineDatabase,
  type RoutineSourceBundle,
  type RoutineWeightInputs,
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

const weightsFor = (bundle: RoutineSourceBundle): RoutineWeightInputs => {
  const inputs = new Map<
    number,
    { trainingMaxWeight: number | null; absoluteWeight: number | null }
  >();
  for (const exercise of bundle.exercises) {
    if (exercise.loadSource === 'training_max_pct') {
      inputs.set(exercise.exerciseId, { trainingMaxWeight: 100, absoluteWeight: null });
    } else if (exercise.loadSource === 'absolute') {
      inputs.set(exercise.exerciseId, { trainingMaxWeight: null, absoluteWeight: 20 });
    }
  }
  return inputs;
};

describe('buildRoutineCopyRows — pure copy builder', () => {
  const bundle = (): RoutineSourceBundle => ({
    routine: {
      routineKey: 'split-it',
      name: 'Split it!',
      origin: 'catalog',
      progressionRule: 'linear',
      roundingIncrement: 2.5,
      unit: null,
      restMainSeconds: 90,
      restAccessorySeconds: 60,
      isActive: false,
      description: 'A simple two-day upper/lower split.',
      philosophy: 'Fewer days, more focus.',
      recommendedDays: 2,
    },
    sessions: [
      { sessionId: 11, weekday: 1, name: 'Upper', sortOrder: 1 },
      { sessionId: 12, weekday: 4, name: 'Lower', sortOrder: 2 },
    ],
    exercises: [
      {
        exerciseId: 101,
        sessionId: 11,
        catalogExerciseId: 'Dumbbell_Bench_Press',
        name: 'Dumbbell Bench Press',
        role: 'main',
        targetSets: 3,
        targetReps: 10,
        loadSource: 'training_max_pct',
        trainingMaxPct: 0.9,
        trainingMaxWeight: null,
        absoluteWeight: null,
        unitOverride: null,
        isAmrap: false,
        sortOrder: 1,
      },
      {
        exerciseId: 102,
        sessionId: 11,
        catalogExerciseId: 'Dumbbell_Bicep_Curl',
        name: 'Dumbbell Bicep Curl',
        role: 'accessory',
        targetSets: 3,
        targetReps: 12,
        loadSource: 'absolute',
        trainingMaxPct: null,
        trainingMaxWeight: null,
        absoluteWeight: null,
        unitOverride: null,
        isAmrap: false,
        sortOrder: 2,
      },
      {
        exerciseId: 103,
        sessionId: 12,
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
        sortOrder: 1,
      },
    ],
  });

  it('resolves weights per load source and keeps bodyweight rows clean', () => {
    const rows = buildRoutineCopyRows(
      bundle(),
      'kg',
      new Map([
        [101, { trainingMaxWeight: 100, absoluteWeight: null }],
        [102, { trainingMaxWeight: null, absoluteWeight: 20 }],
      ]),
      { routineKey: 'split-it', origin: 'catalog', isActive: true },
    );

    expect(rows.routine).toMatchObject({
      routineKey: 'split-it',
      origin: 'catalog',
      unit: 'kg',
      roundingIncrement: 2.5,
      isActive: true,
    });
    expect(rows.sessions).toEqual([
      { weekday: 1, name: 'Upper', sortOrder: 1 },
      { weekday: 4, name: 'Lower', sortOrder: 2 },
    ]);

    const [press, curl, chinUp] = rows.exercises;
    expect(press).toMatchObject({
      sessionIndex: 0,
      loadSource: 'training_max_pct',
      trainingMaxPct: 0.9,
      trainingMaxWeight: 100,
      absoluteWeight: null,
      unitOverride: null,
    });
    expect(curl).toMatchObject({
      sessionIndex: 0,
      loadSource: 'absolute',
      trainingMaxPct: null,
      trainingMaxWeight: null,
      absoluteWeight: 20,
    });
    expect(chinUp).toMatchObject({
      sessionIndex: 1,
      loadSource: 'bodyweight',
      trainingMaxPct: null,
      trainingMaxWeight: null,
      absoluteWeight: null,
    });
  });

  it('doubles the kg increment once for an lb activation', () => {
    const rows = buildRoutineCopyRows(
      bundle(),
      'lb',
      new Map([
        [101, { trainingMaxWeight: 220, absoluteWeight: null }],
        [102, { trainingMaxWeight: null, absoluteWeight: 45 }],
      ]),
      { routineKey: 'split-it', origin: 'catalog', isActive: true },
    );
    expect(rows.routine.roundingIncrement).toBe(5);
  });

  it('throws when a training-max exercise has no training max', () => {
    expect(() =>
      buildRoutineCopyRows(
        bundle(),
        'kg',
        new Map(),
        { routineKey: 'split-it', origin: 'catalog', isActive: true },
      ),
    ).toThrow(/training max/i);
  });

  it('throws when an absolute exercise has no starting weight', () => {
    expect(() =>
      buildRoutineCopyRows(
        bundle(),
        'kg',
        new Map([[101, { trainingMaxWeight: 100, absoluteWeight: null }]]),
        { routineKey: 'split-it', origin: 'catalog', isActive: true },
      ),
    ).toThrow(/weight/i);
  });
});

describe("activation — copying a preset into the user's routines", () => {
  it('inserts the routine, sessions and exercises with the collected weights', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    const source = await loadPresetRoutineSource(executor, 'newbie-gains');
    const { routineId, copied } = await activatePresetRoutine(
      executor,
      'newbie-gains',
      'kg',
      weightsFor(source),
    );
    expect(copied).toBe(true);

    const routine = db
      .prepare(
        'SELECT * FROM Routines WHERE routine_id = ?;',
      )
      .get(routineId) as Record<string, unknown>;
    expect(routine.routine_key).toBe('newbie-gains');
    expect(routine.origin).toBe('catalog');
    expect(routine.is_active).toBe(1);
    expect(routine.unit).toBe('kg');
    expect(routine.rounding_increment).toBe(2.5);

    const sessionCount = (
      db.prepare('SELECT COUNT(*) AS n FROM Sessions WHERE routine_id = ?;').get(routineId) as {
        n: number;
      }
    ).n;
    expect(sessionCount).toBe(source.sessions.length);

    const exerciseCount = (
      db
        .prepare(
          'SELECT COUNT(*) AS n FROM SessionExercises e JOIN Sessions s ON s.session_id = e.session_id WHERE s.routine_id = ?;',
        )
        .get(routineId) as { n: number }
    ).n;
    expect(exerciseCount).toBe(source.exercises.length);

    const weights = db
      .prepare(
        `SELECT e.exercise_name, e.load_source, e.absolute_weight, e.training_max_pct, e.training_max_weight
         FROM SessionExercises e JOIN Sessions s ON s.session_id = e.session_id
         WHERE s.routine_id = ? ORDER BY e.sort_order;`,
      )
      .all(routineId) as {
      exercise_name: string;
      load_source: string;
      absolute_weight: number | null;
      training_max_pct: number | null;
      training_max_weight: number | null;
    }[];
    for (const row of weights) {
      if (row.load_source === 'absolute') {
        expect(row.absolute_weight).toBe(20);
        expect(row.training_max_pct).toBeNull();
        expect(row.training_max_weight).toBeNull();
      } else {
        expect(row.absolute_weight).toBeNull();
      }
    }
  });

  it('keeps exactly one active routine when activating a second preset', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    const first = await loadPresetRoutineSource(executor, 'newbie-gains');
    await activatePresetRoutine(executor, 'newbie-gains', 'kg', weightsFor(first));
    const second = await loadPresetRoutineSource(executor, 'split-it');
    await activatePresetRoutine(executor, 'split-it', 'kg', weightsFor(second));

    const active = db
      .prepare('SELECT routine_key FROM Routines WHERE is_active = 1;')
      .all() as { routine_key: string }[];
    expect(active).toEqual([{ routine_key: 'split-it' }]);
  });

  it('reactivates the existing copy instead of duplicating it', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    const source = await loadPresetRoutineSource(executor, 'optimize');
    const first = await activatePresetRoutine(executor, 'optimize', 'kg', weightsFor(source));
    const second = await activatePresetRoutine(executor, 'optimize', 'kg', weightsFor(source));

    expect(second.copied).toBe(false);
    expect(second.routineId).toBe(first.routineId);
    const count = (
      db.prepare('SELECT COUNT(*) AS n FROM Routines;').get() as { n: number }
    ).n;
    expect(count).toBe(1);
  });

  it('deactivates an existing active routine (the demo-data conflict)', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    await executor.run(
      `INSERT INTO Routines
         (routine_key, name, origin, progression_rule, unit, rounding_increment,
          rest_main_seconds, rest_accessory_seconds, is_active, created_at)
       VALUES ('demo-linear-3day', 'Demo Routine', 'user', 'linear', 'kg', 2.5, 180, 90, 1, 1);`,
      [],
    );

    const source = await loadPresetRoutineSource(executor, 'newbie-gains');
    await activatePresetRoutine(executor, 'newbie-gains', 'kg', weightsFor(source));

    const active = db
      .prepare('SELECT routine_key FROM Routines WHERE is_active = 1;')
      .all() as { routine_key: string }[];
    expect(active).toEqual([{ routine_key: 'newbie-gains' }]);
    const demoActive = (
      db
        .prepare('SELECT is_active FROM Routines WHERE routine_key = ?;')
        .get('demo-linear-3day') as { is_active: number }
    ).is_active;
    expect(demoActive).toBe(0);
  });
});

describe('duplicate — copying an existing routine', () => {
  it('copies weights, sets origin user, a null key and inactive', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    const source = await loadPresetRoutineSource(executor, 'split-it');
    const { routineId } = await activatePresetRoutine(executor, 'split-it', 'kg', weightsFor(source));

    const copyId = await duplicateRoutine(executor, routineId);

    const copy = db
      .prepare('SELECT * FROM Routines WHERE routine_id = ?;')
      .get(copyId) as Record<string, unknown>;
    expect(copy.origin).toBe('user');
    expect(copy.routine_key).toBeNull();
    expect(copy.is_active).toBe(0);
    expect(copy.unit).toBe('kg');
    expect(copy.rounding_increment).toBe(2.5);

    const copiedWeights = db
      .prepare(
        `SELECT e.absolute_weight, e.training_max_weight
         FROM SessionExercises e JOIN Sessions s ON s.session_id = e.session_id
         WHERE s.routine_id = ? AND e.load_source = 'absolute';`,
      )
      .all(copyId) as { absolute_weight: number | null; training_max_weight: number | null }[];
    expect(copiedWeights.length).toBeGreaterThan(0);
    for (const row of copiedWeights) {
      expect(row.absolute_weight).toBe(20);
    }

    const activeCount = (
      db.prepare('SELECT COUNT(*) AS n FROM Routines WHERE is_active = 1;').get() as {
        n: number;
      }
    ).n;
    expect(activeCount).toBe(1);
  });
});

describe('activateRoutineById — reactivating a saved routine', () => {
  it('makes the routine active and clears the previous one', async () => {
    const { executor } = connect();
    await runSchema(executor);

    const source = await loadPresetRoutineSource(executor, 'push-pull-legs');
    const { routineId } = await activatePresetRoutine(executor, 'push-pull-legs', 'kg', weightsFor(source));
    const copyId = await duplicateRoutine(executor, routineId);

    await activateRoutineById(executor, copyId);

    const active = await getActiveRoutine(executor);
    expect(active?.name).toBe('Push Pull Legs');
    expect(active?.routineId).toBe(copyId);

    const originalActive = (
      await executor.getAll<{ is_active: number }>(
        'SELECT is_active FROM Routines WHERE routine_id = ?;',
        [routineId],
      )
    )[0].is_active;
    expect(originalActive).toBe(0);
  });
});

describe('deleteRoutine — cascading removal', () => {
  it('removes the routine and its sessions and exercises', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    const source = await loadPresetRoutineSource(executor, '531');
    const { routineId } = await activatePresetRoutine(executor, '531', 'kg', weightsFor(source));

    await deleteRoutine(executor, routineId);

    const routineCount = (
      db.prepare('SELECT COUNT(*) AS n FROM Routines WHERE routine_id = ?;').get(routineId) as {
        n: number;
      }
    ).n;
    expect(routineCount).toBe(0);
    const sessionCount = (
      db.prepare('SELECT COUNT(*) AS n FROM Sessions WHERE routine_id = ?;').get(routineId) as {
        n: number;
      }
    ).n;
    expect(sessionCount).toBe(0);
    const exerciseCount = (
      db
        .prepare(
          'SELECT COUNT(*) AS n FROM SessionExercises e JOIN Sessions s ON s.session_id = e.session_id WHERE s.routine_id = ?;',
        )
        .get(routineId) as { n: number }
    ).n;
    expect(exerciseCount).toBe(0);
  });
});

describe('routineNeedsWeights', () => {
  it('is true only when an exercise carries a weight load', async () => {
    const { executor } = connect();
    await runSchema(executor);

    const bodyweight = await loadPresetRoutineSource(executor, 'home-alone');
    expect(routineNeedsWeights(bodyweight)).toBe(false);

    const barbell = await loadPresetRoutineSource(executor, '531');
    expect(routineNeedsWeights(barbell)).toBe(true);
  });

  it('loadRoutineSourceById exposes the routine for display', async () => {
    const { executor } = connect();
    await runSchema(executor);

    const source = await loadPresetRoutineSource(executor, 'bro-split');
    const { routineId } = await activatePresetRoutine(executor, 'bro-split', 'lb', weightsFor(source));
    const userSource = await loadRoutineSourceById(executor, routineId);

    expect(userSource.routine).toMatchObject({
      name: 'Bro Split',
      origin: 'catalog',
      unit: 'lb',
      isActive: true,
      roundingIncrement: 5,
    });
    expect(userSource.sessions).toHaveLength(5);
    expect(userSource.exercises.length).toBeGreaterThan(0);
  });
});
