import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import type { RoutineDatabase } from './routineActions';
import { createCustomExercise } from './customExercise';
import {
  accessoryVolumeRationale,
  buildExerciseDetail,
  digestExerciseHistory,
  loadExerciseDetail,
} from './exerciseSheet';
import type { ExerciseSeriesData } from './exerciseHistory';

const withSchema = async (): Promise<{
  db: DatabaseSync;
  routineDb: RoutineDatabase;
}> => {
  const db = new DatabaseSync(':memory:');
  const executor: SchemaExecutor = {
    exec: (sql) => db.exec(sql),
    run: (sql, params) => {
      db.prepare(sql).run(...((params ?? []) as SQLInputValue[]));
    },
    getAll: <T>(sql: string, params: SQLInputValue[] = []) =>
      Promise.resolve(db.prepare(sql).all(...params) as T[]),
  };
  await runSchema(executor);
  const routineDb: RoutineDatabase = {
    run: (sql, params) => {
      db.prepare(sql).run(...((params ?? []) as SQLInputValue[]));
      return undefined;
    },
    get: (sql, params) =>
      db.prepare(sql).get(...((params ?? []) as SQLInputValue[])) as
        | Record<string, unknown>
        | undefined,
    getAll: (sql, params) =>
      db.prepare(sql).all(...((params ?? []) as SQLInputValue[])) as Record<
        string,
        unknown
      >[],
  };
  return { db, routineDb };
};

describe('buildExerciseDetail', () => {
  it('splits muscles by role and instructions by line', () => {
    const detail = buildExerciseDetail(
      {
        exercise_key: 'Bench',
        name: 'Bench Press',
        origin: 'catalog',
        level: 'beginner',
        force: 'push',
        mechanic: 'compound',
        equipment: 'barbell',
        instructions: 'Lie on the bench.\n\n  Lower the bar.  \n',
      },
      [
        { muscle_name: 'chest', is_primary: 1 },
        { muscle_name: 'triceps', is_primary: 0 },
        { muscle_name: 'shoulders', is_primary: 0 },
      ],
    );

    expect(detail.primaryMuscles).toEqual(['chest']);
    expect(detail.secondaryMuscles).toEqual(['triceps', 'shoulders']);
    expect(detail.bodyParts).toEqual(['chest']);
    expect(detail.instructions).toEqual(['Lie on the bench.', 'Lower the bar.']);
    expect(detail.origin).toBe('catalog');
  });

  it('handles a row with no instructions and no muscles', () => {
    const detail = buildExerciseDetail(
      {
        exercise_key: 'user-Mi',
        name: 'Mi ejercicio',
        origin: 'user',
        level: null,
        force: null,
        mechanic: null,
        equipment: null,
        instructions: null,
      },
      [],
    );
    expect(detail.instructions).toEqual([]);
    expect(detail.primaryMuscles).toEqual([]);
    expect(detail.origin).toBe('user');
  });
});

describe('loadExerciseDetail', () => {
  it('resolves by catalog key', async () => {
    const { db, routineDb } = await withSchema();
    const detail = await loadExerciseDetail(routineDb, {
      name: 'anything',
      catalogExerciseId: 'Barbell_Full_Squat',
    });
    expect(detail?.name).toBe('Barbell Full Squat');
    expect(detail?.primaryMuscles).toContain('quadriceps');
    expect(detail?.instructions.length).toBeGreaterThan(0);
    db.close();
  });

  it('resolves by name when the surface only snapshotted one', async () => {
    const { db, routineDb } = await withSchema();
    const detail = await loadExerciseDetail(routineDb, { name: 'Barbell Full Squat' });
    expect(detail?.exerciseKey).toBe('Barbell_Full_Squat');
    db.close();
  });

  it('returns null for a pre-R2 custom exercise the catalog never knew', async () => {
    const { db, routineDb } = await withSchema();
    expect(await loadExerciseDetail(routineDb, { name: 'Mi invento' })).toBeNull();
    db.close();
  });

  it('describes a custom exercise like a seeded one', async () => {
    const { db, routineDb } = await withSchema();
    await createCustomExercise(
      routineDb,
      { name: 'Mi remo', primaryMuscle: 'lats', equipment: 'dumbbell', usesBar: false },
      new Set(),
    );
    const detail = await loadExerciseDetail(routineDb, { name: 'Mi remo' });
    expect(detail?.origin).toBe('user');
    expect(detail?.primaryMuscles).toEqual(['lats']);
    expect(detail?.bodyParts).toEqual(['back']);
    expect(detail?.equipment).toBe('dumbbell');
    db.close();
  });
});

describe('digestExerciseHistory', () => {
  const series = (points: ExerciseSeriesData['points']): ExerciseSeriesData => ({
    unit: 'kg',
    mixedUnits: false,
    points,
  });

  it('reports the last session and the heaviest set', () => {
    const digest = digestExerciseHistory(
      series([
        { date: 1, weight: 60, reps: 8, estimated1RM: 74, volume: 480 },
        { date: 2, weight: 80, reps: 5, estimated1RM: 93, volume: 400 },
        { date: 3, weight: 70, reps: 10, estimated1RM: 93, volume: 700 },
      ]),
    );
    expect(digest.sessions).toBe(3);
    expect(digest.lastDate).toBe(3);
    expect(digest.lastWeight).toBe(70);
    expect(digest.lastReps).toBe(10);
    expect(digest.bestWeight).toBe(80);
    expect(digest.chartable).toBe(true);
  });

  it('says an empty history is empty rather than zero', () => {
    const digest = digestExerciseHistory(series([]));
    expect(digest.sessions).toBe(0);
    expect(digest.lastDate).toBeNull();
    expect(digest.bestWeight).toBeNull();
    expect(digest.chartable).toBe(false);
  });

  it('needs two sessions before a trend is chartable', () => {
    const digest = digestExerciseHistory(
      series([{ date: 1, weight: 60, reps: 8, estimated1RM: 74, volume: 480 }]),
    );
    expect(digest.sessions).toBe(1);
    expect(digest.chartable).toBe(false);
  });

  it('carries the mixed-unit warning through', () => {
    const digest = digestExerciseHistory({
      unit: 'lb',
      mixedUnits: true,
      points: [{ date: 1, weight: 135, reps: 5, estimated1RM: 158, volume: 675 }],
    });
    expect(digest.unit).toBe('lb');
    expect(digest.mixedUnits).toBe(true);
  });
});

describe('accessoryVolumeRationale', () => {
  it('explains the app’s 4 × 8 as hypertrophy volume', () => {
    expect(
      accessoryVolumeRationale({ role: 'accessory', targetSets: 4, targetReps: 8 }),
    ).toBe('hypertrophy');
  });

  it('calls low reps strength and high reps endurance', () => {
    expect(
      accessoryVolumeRationale({ role: 'accessory', targetSets: 5, targetReps: 5 }),
    ).toBe('strength');
    expect(
      accessoryVolumeRationale({ role: 'accessory', targetSets: 3, targetReps: 15 }),
    ).toBe('endurance');
  });

  it('stays silent on a main lift, whose load the runner already explains', () => {
    expect(
      accessoryVolumeRationale({ role: 'main', targetSets: 3, targetReps: 5 }),
    ).toBeNull();
  });

  it('stays silent on a prescription that is not one', () => {
    expect(
      accessoryVolumeRationale({ role: 'accessory', targetSets: 3, targetReps: 0 }),
    ).toBeNull();
  });
});
