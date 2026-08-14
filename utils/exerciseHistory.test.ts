import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import { loadDemoData, type DemoDatabase } from './demoData';
import { saveFreeSession } from './freeLogging';
import { hasChartableSeries } from './routineProgress';
import {
  buildExerciseSeries,
  loadExerciseSeries,
  loadExercisesWithHistory,
  type ExerciseHistoryRow,
} from './exerciseHistory';
import type { RoutineDatabase } from './routineActions';

type TestExecutor = SchemaExecutor & {
  get: RoutineDatabase['get'];
};

const epoch = (ymd: string): number => {
  const [year, month, day] = ymd.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day, 12, 0, 0) / 1000);
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

const demoDb = (db: DatabaseSync): DemoDatabase => ({
  run: (sql: string, params: SQLInputValue[] = []) =>
    db.prepare(sql).run(...params),
  get: (sql: string, params: SQLInputValue[] = []) =>
    db.prepare(sql).get(...params) as Record<string, unknown> | undefined,
});

const setupDemo = async (): Promise<{ db: DatabaseSync; executor: TestExecutor }> => {
  const { db, executor } = connect();
  await runSchema(executor);
  await loadDemoData(demoDb(db));
  return { db, executor };
};

describe('pure core', () => {
  it('builds one point per session with top weight, session-max 1RM and volume', () => {
    const rows: ExerciseHistoryRow[] = [
      { date: epoch('2026-04-06'), setNumber: 1, weight: 100, reps: 5, unit: 'kg' },
      { date: epoch('2026-04-06'), setNumber: 2, weight: 100, reps: 5, unit: 'kg' },
      { date: epoch('2026-04-06'), setNumber: 3, weight: 100, reps: 6, unit: 'kg' },
      { date: epoch('2026-04-13'), setNumber: 1, weight: 80, reps: 8, unit: 'kg' },
      { date: epoch('2026-04-13'), setNumber: 2, weight: 100, reps: 5, unit: 'kg' },
    ];
    const { unit, mixedUnits, points } = buildExerciseSeries(rows);
    expect(unit).toBe('kg');
    expect(mixedUnits).toBe(false);
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({
      date: epoch('2026-04-06'),
      weight: 100,
      reps: 6,
      volume: 1600,
    });
    expect(points[0]?.estimated1RM).toBeCloseTo(120, 5);
    expect(points[1]).toMatchObject({
      date: epoch('2026-04-13'),
      weight: 100,
      reps: 5,
      volume: 1140,
    });
    // Per-set Epley max: 100×(1+5/30) beats 80×(1+8/30).
    expect(points[1]?.estimated1RM).toBeCloseTo(116.66667, 5);
  });

  it('is order-independent over the input rows and sorts points by date', () => {
    const rows: ExerciseHistoryRow[] = [
      { date: epoch('2026-04-13'), setNumber: 1, weight: 95, reps: 5, unit: 'kg' },
      { date: epoch('2026-04-06'), setNumber: 2, weight: 100, reps: 4, unit: 'kg' },
      { date: epoch('2026-04-06'), setNumber: 1, weight: 100, reps: 6, unit: 'kg' },
    ];
    const { points } = buildExerciseSeries(rows);
    expect(points.map((point) => point.date)).toEqual([
      epoch('2026-04-06'),
      epoch('2026-04-13'),
    ]);
    expect(points[0]?.weight).toBe(100);
    expect(points[0]?.reps).toBe(6);
  });

  it('handles empty and single-point series explicitly', () => {
    expect(buildExerciseSeries([])).toEqual({
      unit: 'kg',
      mixedUnits: false,
      points: [],
    });
    const single = buildExerciseSeries([
      { date: epoch('2026-04-06'), setNumber: 1, weight: 100, reps: 5, unit: 'kg' },
    ]);
    expect(single.points).toHaveLength(1);
    expect(single.points[0]).toMatchObject({
      weight: 100,
      reps: 5,
      volume: 500,
    });
    expect(hasChartableSeries(single.points)).toBe(false);
    expect(hasChartableSeries(buildExerciseSeries([]).points)).toBe(false);
    expect(hasChartableSeries(buildExerciseSeries([
      { date: 1, setNumber: 1, weight: 100, reps: 5, unit: 'kg' },
      { date: 2, setNumber: 1, weight: 102.5, reps: 5, unit: 'kg' },
    ]).points)).toBe(true);
  });

  it('labels the series with the latest row unit and flags mixed history', () => {
    const mixed = buildExerciseSeries([
      { date: epoch('2026-04-06'), setNumber: 1, weight: 100, reps: 5, unit: 'kg' },
      { date: epoch('2026-04-13'), setNumber: 1, weight: 200, reps: 5, unit: 'lb' },
    ]);
    expect(mixed.unit).toBe('lb');
    expect(mixed.mixedUnits).toBe(true);
    // Values are never converted (§3.7).
    expect(mixed.points.map((point) => point.weight)).toEqual([100, 200]);
  });

  it('never crashes the estimator on bodyweight sets logged as 0', () => {
    const { points } = buildExerciseSeries([
      { date: epoch('2026-04-06'), setNumber: 1, weight: 0, reps: 10, unit: 'kg' },
      { date: epoch('2026-04-06'), setNumber: 2, weight: 0, reps: 10, unit: 'kg' },
    ]);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ weight: 0, reps: 10, estimated1RM: 0, volume: 0 });
  });
});

describe('demo data through the db edges', () => {
  it('lists exercises with history ordered by recency', async () => {
    const { executor } = await setupDemo();
    const summaries = await loadExercisesWithHistory(executor);
    expect(summaries.map((entry) => entry.name)).toEqual([
      'Barbell Deadlift',
      'Lying Leg Curls',
      'Barbell Bench Press - Medium Grip',
      'Barbell Shoulder Press',
      'Wide-Grip Lat Pulldown',
      'Barbell Full Squat',
      'Bent Over Two-Dumbbell Row',
    ]);
    expect(summaries[0]?.lastDate).toBe(epoch('2026-05-22'));
  });

  it('builds the squat history across every session of both cycles', async () => {
    const { executor } = await setupDemo();
    const series = await loadExerciseSeries(executor, 'Barbell Full Squat');

    expect(series.exerciseName).toBe('Barbell Full Squat');
    expect(series.unit).toBe('kg');
    expect(series.mixedUnits).toBe(false);
    expect(series.points.map((point) => point.date)).toEqual([
      epoch('2026-04-06'),
      epoch('2026-04-13'),
      epoch('2026-04-20'),
      epoch('2026-04-27'),
      epoch('2026-05-04'),
      epoch('2026-05-11'),
      epoch('2026-05-18'),
    ]);
    expect(series.points.map((point) => point.weight)).toEqual([
      100, 100, 100, 100, 102.5, 102.5, 102.5,
    ]);
    expect(series.points.map((point) => point.reps)).toEqual([6, 5, 6, 5, 6, 5, 8]);

    // The last session's AMRAP: 2×102.5×5 + 1×102.5×8, session-max Epley 1RM.
    const amrap = series.points[series.points.length - 1];
    expect(amrap?.volume).toBe(1845);
    expect(amrap?.estimated1RM).toBeCloseTo(129.83333, 5);
  });

  it('keeps the lb override exercise in pounds with its own volume', async () => {
    const { executor } = await setupDemo();
    const series = await loadExerciseSeries(executor, 'Wide-Grip Lat Pulldown');
    expect(series.unit).toBe('lb');
    expect(series.mixedUnits).toBe(false);
    expect(series.points).toHaveLength(6);
    expect(series.points.every((point) => point.weight === 110)).toBe(true);
    expect(series.points[0]?.volume).toBe(3300);
    expect(series.points[0]?.estimated1RM).toBeCloseTo(146.66667, 5);
  });

  it('pulls a free session into the same series via the free logging write path', async () => {
    const { executor } = await setupDemo();
    await saveFreeSession(
      executor,
      'Free session',
      epoch('2026-05-25'),
      [
        {
          name: 'Barbell Full Squat',
          unit: 'kg',
          sets: [{ weight: 105, reps: 5 }, { weight: 105, reps: 5 }],
        },
      ],
    );

    const series = await loadExerciseSeries(executor, 'Barbell Full Squat');
    expect(series.points).toHaveLength(8);
    const last = series.points[series.points.length - 1];
    expect(last).toMatchObject({ date: epoch('2026-05-25'), weight: 105, reps: 5 });
    expect(last?.volume).toBe(1050);
    expect(last?.estimated1RM).toBeCloseTo(122.5, 5);

    const summaries = await loadExercisesWithHistory(executor);
    expect(summaries[0]).toMatchObject({
      name: 'Barbell Full Squat',
      lastDate: epoch('2026-05-25'),
    });
  });

  it('returns an empty series for an exercise with no history', async () => {
    const { executor } = await setupDemo();
    const series = await loadExerciseSeries(executor, 'Never Logged Exercise');
    expect(series).toEqual({
      exerciseName: 'Never Logged Exercise',
      unit: 'kg',
      mixedUnits: false,
      points: [],
    });
    expect(hasChartableSeries(series.points)).toBe(false);
  });
});
