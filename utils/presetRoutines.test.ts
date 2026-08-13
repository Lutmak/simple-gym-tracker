import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import { PRESET_ROUTINES, type PresetRoutine } from '../data/presetRoutines';

const connect = (): { db: DatabaseSync; executor: SchemaExecutor } => {
  const db = new DatabaseSync(':memory:');
  const executor: SchemaExecutor = {
    exec: (sql) => db.exec(sql),
    run: (sql, params) => {
      db.prepare(sql).run(...(params as SQLInputValue[]));
    },
    getAll: <T>(sql: string, params: SQLInputValue[] = []) =>
      Promise.resolve(db.prepare(sql).all(...params) as T[]),
  };
  return { db, executor };
};

const validRules = ['wave', 'linear', 'none'] as const;
const validLevels = ['beginner', 'intermediate', 'advanced'] as const;

const sessionCount = (routine: PresetRoutine): number => routine.sessions.length;

const exerciseCount = (routine: PresetRoutine): number =>
  routine.sessions.reduce((sum, session) => sum + session.exercises.length, 0);

describe('preset routines — committed data', () => {
  it('declares exactly the 22 routines the spec requires', () => {
    expect(PRESET_ROUTINES).toHaveLength(22);
    const names = PRESET_ROUTINES.map((routine) => routine.name);
    expect(new Set(names).size).toBe(22);
  });

  it('every routine has unique stable keys, a description, a philosophy, and valid metadata', () => {
    const keys = PRESET_ROUTINES.map((routine) => routine.key);
    expect(new Set(keys).size).toBe(PRESET_ROUTINES.length);

    for (const routine of PRESET_ROUTINES) {
      expect(routine.key).toMatch(/^[a-z0-9-]+$/);
      expect(routine.description.length).toBeGreaterThan(0);
      expect(routine.philosophy.length).toBeGreaterThan(0);
      expect(validLevels).toContain(routine.level);
      expect(validRules).toContain(routine.progressionRule);
      expect(routine.roundingIncrementKg).toBeGreaterThan(0);
      expect(routine.recommendedDays).toBeGreaterThan(0);
      expect(routine.recommendedDays).toBeLessThanOrEqual(7);
    }
  });

  it('recommended days is consistent with the session count', () => {
    for (const routine of PRESET_ROUTINES) {
      expect(routine.sessions.length).toBe(routine.recommendedDays);
    }
  });

  it('sessions are anchored to unique, valid weekdays within a routine', () => {
    for (const routine of PRESET_ROUTINES) {
      expect(routine.sessions.length).toBeGreaterThanOrEqual(1);
      expect(routine.sessions.length).toBeLessThanOrEqual(7);
      const weekdays = routine.sessions.map((session) => session.weekday);
      expect(new Set(weekdays).size).toBe(weekdays.length);
      for (const weekday of weekdays) {
        expect(weekday).toBeGreaterThanOrEqual(0);
        expect(weekday).toBeLessThanOrEqual(6);
      }
    }
  });

  it('every exercise carries sane sets, reps, role, load source and catalog key', () => {
    for (const routine of PRESET_ROUTINES) {
      for (const session of routine.sessions) {
        expect(session.name.length).toBeGreaterThan(0);
        expect(session.exercises.length).toBeGreaterThan(0);
        for (const exercise of session.exercises) {
          expect(exercise.sets).toBeGreaterThan(0);
          expect(exercise.reps).toBeGreaterThan(0);
          expect(exercise.catalogKey).toMatch(/^[A-Za-z0-9_-]+$/);
          expect(['main', 'accessory']).toContain(exercise.role);
          expect(['training_max_pct', 'absolute', 'bodyweight']).toContain(
            exercise.loadSource,
          );
        }
      }
    }
  });

  it('AMRAP is only ever declared on a main-role exercise', () => {
    for (const routine of PRESET_ROUTINES) {
      for (const session of routine.sessions) {
        for (const exercise of session.exercises) {
          if (exercise.isAmrap) {
            expect(exercise.role).toBe('main');
          }
        }
      }
    }
  });

  it('training-max-percentage loads only appear on routines with a progression rule that computes loads', () => {
    for (const routine of PRESET_ROUTINES) {
      for (const session of routine.sessions) {
        for (const exercise of session.exercises) {
          if (exercise.loadSource === 'training_max_pct') {
            expect(['wave', 'linear']).toContain(routine.progressionRule);
          }
        }
      }
    }
  });

  it('purely bodyweight routines declare the none rule — there is no weight to increment', () => {
    const allBodyweight = (routine: PresetRoutine): boolean =>
      routine.sessions.every((session) =>
        session.exercises.every((exercise) => exercise.loadSource === 'bodyweight'),
      );
    for (const routine of PRESET_ROUTINES) {
      if (allBodyweight(routine)) {
        expect(routine.progressionRule).toBe('none');
      }
    }
  });

  it('wave routines are exactly the 5/3/1 pair', () => {
    const wave = PRESET_ROUTINES.filter(
      (routine) => routine.progressionRule === 'wave',
    );
    expect(wave.map((routine) => routine.key).sort()).toEqual([
      '531',
      'high-volume-531-lp',
    ]);
  });
});

describe('preset routines — seed', () => {
  it('seeds all 22 routines with their sessions and exercises', async () => {
    const { executor } = connect();
    await runSchema(executor);

    const seededRoutines = await executor.getAll<{ routine_key: string; name: string }>(
      'SELECT routine_key, name FROM Preset_Routines ORDER BY routine_key;',
    );
    expect(seededRoutines).toHaveLength(22);
    expect(seededRoutines.map((row) => row.name).sort()).toEqual(
      [...PRESET_ROUTINES].map((routine) => routine.name).sort(),
    );

    const seededSessions = await executor.getAll<{ routine_key: string }>(
      'SELECT routine_key FROM Preset_Sessions;',
    );
    expect(seededSessions).toHaveLength(
      PRESET_ROUTINES.reduce((total, routine) => total + sessionCount(routine), 0),
    );

    const seededExercises = await executor.getAll<{
      preset_session_id: number;
      catalog_exercise_id: string;
      exercise_name: string;
    }>('SELECT preset_session_id, catalog_exercise_id, exercise_name FROM Preset_SessionExercises;');
    expect(seededExercises).toHaveLength(
      PRESET_ROUTINES.reduce((total, routine) => total + exerciseCount(routine), 0),
    );
  });

  it('every exercise key in the data resolves to a real catalog exercise', async () => {
    const { executor } = connect();
    await runSchema(executor);

    for (const routine of PRESET_ROUTINES) {
      for (const session of routine.sessions) {
        for (const exercise of session.exercises) {
          const rows = await executor.getAll<{ name: string }>(
            'SELECT name FROM Catalog_Exercises WHERE exercise_key = ?;',
            [exercise.catalogKey],
          );
          expect(rows).toHaveLength(1);
          expect(rows[0].name.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('the seeded exercise name is the catalog name (display without joins)', async () => {
    const { executor } = connect();
    await runSchema(executor);

    const rows = await executor.getAll<{ catalog_exercise_id: string; exercise_name: string }>(
      'SELECT catalog_exercise_id, exercise_name FROM Preset_SessionExercises;',
    );
    for (const row of rows) {
      const catalog = await executor.getAll<{ name: string }>(
        'SELECT name FROM Catalog_Exercises WHERE exercise_key = ?;',
        [row.catalog_exercise_id],
      );
      expect(catalog).toHaveLength(1);
      expect(row.exercise_name).toBe(catalog[0].name);
    }
  });

  it('is idempotent — running the schema twice does not duplicate presets', async () => {
    const { executor } = connect();
    await runSchema(executor);
    await runSchema(executor);

    const count = (await executor.getAll<{ n: number }>(
      'SELECT COUNT(*) AS n FROM Preset_SessionExercises;',
    ))[0].n;
    const expected = PRESET_ROUTINES.reduce(
      (total, routine) => total + exerciseCount(routine),
      0,
    );
    expect(count).toBe(expected);
  });

  it('training_max_pct exercises carry the 0.9 default; others carry none', async () => {
    const { executor } = connect();
    await runSchema(executor);

    const rows = await executor.getAll<{
      load_source: string;
      training_max_pct: number | null;
    }>('SELECT load_source, training_max_pct FROM Preset_SessionExercises;');

    for (const row of rows) {
      if (row.load_source === 'training_max_pct') {
        expect(row.training_max_pct).toBe(0.9);
      } else {
        expect(row.training_max_pct).toBeNull();
      }
    }
  });
});
