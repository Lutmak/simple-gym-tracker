import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import {
  ASSISTANCE_BIAS_DEFAULTS,
  buildWaveRoutineRows,
  derivedCategory,
  estimateTrainingMax,
  warmupRampFor,
  WaveSetupValidationError,
  WAVE_REST_ACCESSORY_SECONDS,
  WAVE_REST_MAIN_SECONDS,
  writeWaveRoutine,
  type WaveAssistanceRow,
  type WaveDayDraft,
  type WaveSetupDraft,
} from './waveSetup';
import { loadDemoData } from './demoData';
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

const assistance = (name: string, sets: number, reps: number): WaveAssistanceRow => ({
  key: `a-${name}`,
  catalogExerciseId: null,
  name,
  sets,
  reps,
});

const day = (overrides: Partial<WaveDayDraft>): WaveDayDraft => ({
  key: 'd1',
  weekday: 1,
  liftName: 'Squat',
  catalogExerciseId: null,
  category: 'lower',
  trainingMax: 100,
  assistanceStartWeight: 20,
  assistance: [],
  ...overrides,
});

const draft = (overrides: Partial<WaveSetupDraft> = {}): WaveSetupDraft => ({
  name: 'My 5/3/1',
  unit: 'kg',
  roundingIncrement: 2.5,
  roundingDirection: 'nearest',
  tmPercentage: 0.9,
  includeDeload: true,
  warmupsEnabled: true,
  upperTmIncrement: 2.5,
  lowerTmIncrement: 5,
  assistanceBias: 'hybrid',
  days: [
    day({ key: 'd1', weekday: 1, liftName: 'Squat', category: 'lower' }),
    day({ key: 'd2', weekday: 2, liftName: 'Bench Press', category: 'upper' }),
    day({
      key: 'd3',
      weekday: 4,
      liftName: 'Deadlift',
      category: 'lower',
      assistance: [assistance('Chin-Up', 4, 8), assistance('Face Pull', 4, 8)],
    }),
    day({ key: 'd4', weekday: 5, liftName: 'Overhead Press', category: 'upper' }),
  ],
  ...overrides,
});

const expectThrows = (detail: unknown, code: string): void => {
  try {
    throw detail;
  } catch (error) {
    expect(error).toBeInstanceOf(WaveSetupValidationError);
    expect((error as WaveSetupValidationError).detail).toMatchObject({ code });
  }
};

describe('estimateTrainingMax — Epley 1RM x TM percentage, rounded', () => {
  it('computes 90% of the Epley estimate for a recent set', () => {
    // Epley: 100 x (1 + 5/30) = 116.67; 90% = 105.0; already on a 2.5 step.
    expect(estimateTrainingMax(100, 5, 0.9, 2.5, 'nearest')).toBe(105);
  });

  it('rounds to the routine increment in the chosen direction', () => {
    // Epley: 90 x (1 + 8/30) = 114; 90% = 102.6; nearest 2.5 step = 102.5.
    expect(estimateTrainingMax(90, 8, 0.9, 2.5, 'nearest')).toBe(102.5);
    expect(estimateTrainingMax(90, 8, 0.9, 2.5, 'down')).toBe(102.5);
    expect(estimateTrainingMax(90, 8, 0.9, 2.5, 'up')).toBe(105);
    // lb routine: 5 lb step.
    expect(estimateTrainingMax(200, 5, 0.9, 5, 'nearest')).toBe(210);
  });

  it('rejects an invalid recent set', () => {
    expect(() => estimateTrainingMax(0, 5, 0.9, 2.5, 'nearest')).toThrow();
    expect(() => estimateTrainingMax(100, 0, 0.9, 2.5, 'nearest')).toThrow();
    expect(() => estimateTrainingMax(100, 5.5, 0.9, 2.5, 'nearest')).toThrow();
  });
});

describe('derivedCategory — from the catalog primary muscles', () => {
  it('maps the lower-body muscle set and everything else to upper', () => {
    expect(derivedCategory(['quadriceps'])).toBe('lower');
    expect(derivedCategory(['hamstrings', 'glutes'])).toBe('lower');
    expect(derivedCategory(['lower back'])).toBe('lower');
    expect(derivedCategory(['calves'])).toBe('lower');
    expect(derivedCategory(['chest'])).toBe('upper');
    expect(derivedCategory(['shoulders'])).toBe('upper');
    expect(derivedCategory(['lats', 'biceps'])).toBe('upper');
    expect(derivedCategory([])).toBe('upper');
  });

  it('derives the real catalog lifts correctly', async () => {
    const { executor } = connect();
    await runSchema(executor);
    const musclesFor = async (key: string): Promise<string[]> => {
      const rows = await executor.getAll<{ muscle_name: string }>(
        `SELECT muscle_name FROM Catalog_Exercise_Muscles
         WHERE exercise_key = ? AND is_primary = 1;`,
        [key],
      );
      return rows.map((row) => row.muscle_name);
    };

    expect(derivedCategory(await musclesFor('Barbell_Squat'))).toBe('lower');
    expect(derivedCategory(await musclesFor('Barbell_Bench_Press_-_Medium_Grip'))).toBe('upper');
    expect(derivedCategory(await musclesFor('Barbell_Deadlift'))).toBe('lower');
    expect(derivedCategory(await musclesFor('Barbell_Shoulder_Press'))).toBe('upper');
  });
});

describe('warmupRampFor — the intrinsic ramp at real weights', () => {
  it('returns the 40/50/60 ramp off the first work set, rounded to the increment', () => {
    const ramp = warmupRampFor(day({ trainingMax: 200 }), 'kg', 2.5, 'nearest', 0.9);
    expect(ramp).not.toBeNull();
    // First work set = 200 x 0.9 = 180; 40% = 72, 50% = 90, 60% = 108.
    expect(ramp?.map((set) => ({ pct: set.percent, reps: set.reps, weight: set.weight }))).toEqual([
      { pct: 40, reps: 5, weight: 72.5 },
      { pct: 50, reps: 5, weight: 90 },
      { pct: 60, reps: 3, weight: 107.5 },
    ]);
  });

  it('is null while the training max is missing or invalid', () => {
    expect(warmupRampFor(day({ trainingMax: null }), 'kg', 2.5, 'nearest', 0.9)).toBeNull();
    expect(warmupRampFor(day({ trainingMax: 0 }), 'kg', 2.5, 'nearest', 0.9)).toBeNull();
  });
});

describe('buildWaveRoutineRows — valid input to CHECK-valid rows', () => {
  it('builds the routine, sessions and exercises for a 4-day week', () => {
    const rows = buildWaveRoutineRows(draft());

    expect(rows.routine).toMatchObject({
      routineKey: null,
      name: 'My 5/3/1',
      origin: 'user',
      progressionRule: 'wave',
      unit: 'kg',
      roundingIncrement: 2.5,
      restMainSeconds: WAVE_REST_MAIN_SECONDS,
      restAccessorySeconds: WAVE_REST_ACCESSORY_SECONDS,
      isActive: true,
    });

    expect(rows.sessions).toEqual([
      { weekday: 1, name: 'Squat', sortOrder: 1 },
      { weekday: 2, name: 'Bench Press', sortOrder: 2 },
      { weekday: 4, name: 'Deadlift', sortOrder: 3 },
      { weekday: 5, name: 'Overhead Press', sortOrder: 4 },
    ]);

    const mains = rows.exercises.filter((exercise) => exercise.role === 'main');
    expect(mains).toHaveLength(4);
    for (const main of mains) {
      expect(main).toMatchObject({
        role: 'main',
        loadSource: 'training_max_pct',
        trainingMaxPct: 0.9,
        trainingMaxWeight: 100,
        absoluteWeight: null,
        isAmrap: true,
        targetSets: 3,
        targetReps: 5,
      });
    }

    const accessories = rows.exercises.filter((exercise) => exercise.role === 'accessory');
    expect(accessories).toHaveLength(2);
    for (const accessory of accessories) {
      expect(accessory).toMatchObject({
        sessionIndex: 2,
        role: 'accessory',
        loadSource: 'absolute',
        absoluteWeight: 20,
        trainingMaxPct: null,
        trainingMaxWeight: null,
        isAmrap: false,
      });
    }
    expect(accessories.map((accessory) => accessory.sortOrder)).toEqual([2, 3]);
  });

  it('applies the advanced TM percentage to every main lift', () => {
    const rows = buildWaveRoutineRows(draft({ tmPercentage: 0.85 }));
    for (const main of rows.exercises.filter((exercise) => exercise.role === 'main')) {
      expect(main.trainingMaxPct).toBe(0.85);
    }
  });

  it('rejects a missing training max', () => {
    try {
      buildWaveRoutineRows(
        draft({ days: [day({ key: 'd1', trainingMax: null })] }),
      );
    } catch (error) {
      expectThrows(error, 'trainingMaxMissing');
    }
  });

  it('rejects duplicate weekdays', () => {
    try {
      buildWaveRoutineRows(
        draft({
          days: [day({ key: 'd1', weekday: 1 }), day({ key: 'd2', weekday: 1 })],
        }),
      );
    } catch (error) {
      expectThrows(error, 'duplicateWeekday');
    }
  });

  it('rejects a TM percentage outside 0.85-0.90', () => {
    for (const tmPercentage of [0.8, 0.84, 0.91, 1, NaN, 0.9, 0.85]) {
      if (tmPercentage === 0.9 || tmPercentage === 0.85) {
        expect(() => buildWaveRoutineRows(draft({ tmPercentage }))).not.toThrow();
      } else {
        try {
          buildWaveRoutineRows(draft({ tmPercentage }));
        } catch (error) {
          expectThrows(error, 'tmPercentageInvalid');
        }
      }
    }
  });

  it('rejects an empty program name, a bad increment and missing increments', () => {
    expect(() => buildWaveRoutineRows(draft({ name: '  ' }))).toThrowError(
      WaveSetupValidationError,
    );
    expect(() => buildWaveRoutineRows(draft({ roundingIncrement: 0 }))).toThrowError(
      WaveSetupValidationError,
    );
    expect(() => buildWaveRoutineRows(draft({ upperTmIncrement: 0 }))).toThrowError(
      WaveSetupValidationError,
    );
    expect(() => buildWaveRoutineRows(draft({ lowerTmIncrement: NaN }))).toThrowError(
      WaveSetupValidationError,
    );
  });

  it('rejects a day without a lift name', () => {
    expect(() =>
      buildWaveRoutineRows(draft({ days: [day({ liftName: ' ' })] })),
    ).toThrowError(WaveSetupValidationError);
  });

  it('rejects a day with assistance but no start weight', () => {
    try {
      buildWaveRoutineRows(
        draft({
          days: [
            day({
              assistanceStartWeight: null,
              assistance: [assistance('Chin-Up', 4, 8)],
            }),
          ],
        }),
      );
    } catch (error) {
      expectThrows(error, 'assistanceStartWeightMissing');
    }
  });

  it('rejects unnamed assistance and non-positive sets/reps', () => {
    expect(() =>
      buildWaveRoutineRows(
        draft({
          days: [day({ assistance: [assistance(' ', 4, 8)] })],
        }),
      ),
    ).toThrowError(WaveSetupValidationError);
    expect(() =>
      buildWaveRoutineRows(
        draft({ days: [day({ assistance: [assistance('Curl', 0, 8)] })] }),
      ),
    ).toThrowError(WaveSetupValidationError);
    expect(() =>
      buildWaveRoutineRows(
        draft({ days: [day({ assistance: [assistance('Curl', 3, 0)] })] }),
      ),
    ).toThrowError(WaveSetupValidationError);
  });

  it('rejects an empty week', () => {
    expect(() => buildWaveRoutineRows(draft({ days: [] }))).toThrowError(
      WaveSetupValidationError,
    );
  });

  it('biases new accessory rows through ASSISTANCE_BIAS_DEFAULTS', () => {
    expect(ASSISTANCE_BIAS_DEFAULTS.hypertrophy).toEqual({ sets: 4, reps: 10 });
    expect(ASSISTANCE_BIAS_DEFAULTS.strength).toEqual({ sets: 5, reps: 5 });
    expect(ASSISTANCE_BIAS_DEFAULTS.hybrid).toEqual({ sets: 4, reps: 8 });
  });
});

describe('writeWaveRoutine — one transaction, single active routine', () => {
  it('writes the routine and every row, CHECK-valid, and becomes the active routine', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(executor);
    const demoActiveBefore = db
      .prepare('SELECT COUNT(*) AS n FROM Routines WHERE is_active = 1;')
      .get() as { n: number };
    expect(demoActiveBefore.n).toBe(1);

    const routineId = await writeWaveRoutine(executor, draft());

    const routine = db
      .prepare('SELECT * FROM Routines WHERE routine_id = ?;')
      .get(routineId) as Record<string, unknown>;
    expect(routine.name).toBe('My 5/3/1');
    expect(routine.progression_rule).toBe('wave');
    expect(routine.origin).toBe('user');
    expect(routine.routine_key).toBeNull();
    expect(routine.is_active).toBe(1);
    expect(routine.rounding_increment).toBe(2.5);
    expect(routine.rest_main_seconds).toBe(WAVE_REST_MAIN_SECONDS);
    expect(routine.rest_accessory_seconds).toBe(WAVE_REST_ACCESSORY_SECONDS);

    // The demo routine is no longer active — the single-active index held.
    const active = db
      .prepare('SELECT routine_id FROM Routines WHERE is_active = 1;')
      .all() as { routine_id: number }[];
    expect(active).toEqual([{ routine_id: routineId }]);

    expect(
      (db
        .prepare('SELECT COUNT(*) AS n FROM Sessions WHERE routine_id = ?;')
        .get(routineId) as { n: number }).n,
    ).toBe(4);
    expect(
      (db
        .prepare(
          `SELECT COUNT(*) AS n FROM SessionExercises e
           JOIN Sessions s ON s.session_id = e.session_id
           WHERE s.routine_id = ?;`,
        )
        .get(routineId) as { n: number }).n,
    ).toBe(6);

    const sessions = db
      .prepare('SELECT weekday, name, sort_order FROM Sessions WHERE routine_id = ? ORDER BY sort_order;')
      .all(routineId) as { weekday: number; name: string; sort_order: number }[];
    expect(sessions).toEqual([
      { weekday: 1, name: 'Squat', sort_order: 1 },
      { weekday: 2, name: 'Bench Press', sort_order: 2 },
      { weekday: 4, name: 'Deadlift', sort_order: 3 },
      { weekday: 5, name: 'Overhead Press', sort_order: 4 },
    ]);

    const exercises = db
      .prepare(
        `SELECT e.role, e.load_source, e.training_max_pct, e.training_max_weight,
                e.absolute_weight, e.is_amrap
         FROM SessionExercises e JOIN Sessions s ON s.session_id = e.session_id
         WHERE s.routine_id = ? ORDER BY s.sort_order, e.sort_order;`,
      )
      .all(routineId) as Record<string, unknown>[];
    expect(exercises).toHaveLength(6);
    const invalid = exercises.filter((row) => {
      if (row.load_source === 'training_max_pct') {
        return row.training_max_pct === null || row.training_max_weight === null;
      }
      if (row.load_source === 'absolute') {
        return row.absolute_weight === null;
      }
      return row.absolute_weight !== null;
    });
    expect(invalid).toEqual([]);
    expect(exercises.filter((row) => row.role === 'main')).toHaveLength(4);
    expect(exercises.filter((row) => row.role === 'main').every((row) => row.is_amrap === 1)).toBe(
      true,
    );
    expect(exercises.filter((row) => row.role === 'accessory')).toHaveLength(2);
    expect(
      exercises
        .filter((row) => row.role === 'accessory')
        .every((row) => row.absolute_weight === 20),
    ).toBe(true);
  });

  it('rolls back on a duplicate weekday and changes nothing', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(executor);
    const routinesBefore = count(db, 'Routines');

    await expect(
      writeWaveRoutine(
        executor,
        draft({ days: [day({ key: 'd1', weekday: 1 }), day({ key: 'd2', weekday: 1 })] }),
      ),
    ).rejects.toThrow(WaveSetupValidationError);

    expect(count(db, 'Routines')).toBe(routinesBefore);
  });
});
