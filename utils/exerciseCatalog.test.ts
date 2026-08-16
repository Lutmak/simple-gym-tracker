import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import type { RoutineDatabase } from './routineActions';
import {
  buildCatalogExercise,
  filterCatalogExercises,
  initialBodyPart,
  loadCatalogExercises,
  type CatalogExercise,
} from './exerciseCatalog';

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

const exercise = (
  name: string,
  primaryMuscles: string[],
  extra: Partial<CatalogExercise> = {},
): CatalogExercise =>
  buildCatalogExercise({
    exercise_key: extra.exerciseKey ?? name.replace(/\s/g, '_'),
    name,
    equipment: extra.equipment ?? 'barbell',
    uses_bar: extra.usesBar === undefined ? null : extra.usesBar ? 1 : 0,
    origin: extra.origin ?? 'catalog',
    primary_muscles: primaryMuscles.join('|'),
  });

describe('buildCatalogExercise', () => {
  it('derives body parts from the primary muscles', () => {
    const row = exercise('Bench Press', ['chest', 'triceps']);
    expect(row.bodyParts).toEqual(['chest', 'arms']);
    expect(row.primaryMuscles).toEqual(['chest', 'triceps']);
    expect(row.usesBar).toBeNull();
    expect(row.origin).toBe('catalog');
  });

  it('handles an exercise with no muscle rows', () => {
    const row = buildCatalogExercise({
      exercise_key: 'k',
      name: 'Mystery',
      equipment: null,
      uses_bar: null,
      origin: 'catalog',
      primary_muscles: null,
    });
    expect(row.primaryMuscles).toEqual([]);
    expect(row.bodyParts).toEqual([]);
    expect(row.equipment).toBeNull();
  });

  it('reads the user origin and the bar answer of a custom row', () => {
    const row = exercise('Mi press', ['chest'], { origin: 'user', usesBar: true });
    expect(row.origin).toBe('user');
    expect(row.usesBar).toBe(true);
  });
});

describe('filterCatalogExercises', () => {
  const rows = [
    exercise('Bench Press', ['chest']),
    exercise('Incline Bench Press', ['chest']),
    exercise('Barbell Row', ['middle back']),
    exercise('Back Squat', ['quadriceps', 'glutes']),
  ];

  it('matches the search anywhere in the name, case-insensitively', () => {
    expect(
      filterCatalogExercises(rows, { query: 'bench', bodyPart: null }).map((row) => row.name),
    ).toEqual(['Bench Press', 'Incline Bench Press']);
  });

  it('filters by body part', () => {
    expect(
      filterCatalogExercises(rows, { query: '', bodyPart: 'legs' }).map((row) => row.name),
    ).toEqual(['Back Squat']);
  });

  it('applies search and body part together', () => {
    expect(
      filterCatalogExercises(rows, { query: 'ba', bodyPart: 'back' }).map((row) => row.name),
    ).toEqual(['Barbell Row']);
  });

  it('returns everything when nothing is asked', () => {
    expect(filterCatalogExercises(rows, { query: '  ', bodyPart: null })).toHaveLength(4);
  });
});

describe('initialBodyPart', () => {
  const rows = [
    exercise('Bench Press', ['chest']),
    exercise('Back Squat', ['quadriceps']),
  ];

  it('opens on the tapped exercise’s own region', () => {
    expect(initialBodyPart(rows, 'Bench_Press')).toBe('chest');
  });

  it('opens unfiltered when no exercise is in context', () => {
    expect(initialBodyPart(rows, null)).toBeNull();
  });

  it('opens unfiltered when the tapped exercise is not in the catalog', () => {
    expect(initialBodyPart(rows, 'Not_A_Key')).toBeNull();
  });
});

describe('loadCatalogExercises', () => {
  it('returns the seeded catalog with its primary muscles', async () => {
    const { db, routineDb } = await withSchema();
    const rows = await loadCatalogExercises(routineDb);

    expect(rows.length).toBeGreaterThan(500);
    const squat = rows.find((row) => row.exerciseKey === 'Barbell_Full_Squat');
    expect(squat).toBeDefined();
    expect(squat?.primaryMuscles).toContain('quadriceps');
    expect(squat?.bodyParts).toContain('legs');
    expect(squat?.origin).toBe('catalog');
    expect(squat?.usesBar).toBeNull();
    expect(rows.every((row) => row.name !== '')).toBe(true);
    db.close();
  });

  it('lists a custom exercise beside the seeded ones', async () => {
    const { db, routineDb } = await withSchema();
    db.prepare(
      `INSERT INTO Catalog_Exercises
         (exercise_key, name, category, equipment, origin, uses_bar)
       VALUES ('user-Mi_remo', 'Mi remo', 'strength', 'dumbbell', 'user', 0);`,
    ).run();
    db.prepare(
      `INSERT INTO Catalog_Exercise_Muscles (exercise_key, muscle_name, is_primary)
       VALUES ('user-Mi_remo', 'lats', 1);`,
    ).run();

    const rows = await loadCatalogExercises(routineDb);
    const custom = rows.find((row) => row.exerciseKey === 'user-Mi_remo');
    expect(custom?.origin).toBe('user');
    expect(custom?.usesBar).toBe(false);
    expect(custom?.bodyParts).toEqual(['back']);
    expect(
      filterCatalogExercises(rows, { query: '', bodyPart: 'back' }).some(
        (row) => row.exerciseKey === 'user-Mi_remo',
      ),
    ).toBe(true);
    db.close();
  });
});
