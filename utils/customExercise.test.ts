import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import type { RoutineDatabase } from './routineActions';
import {
  CUSTOM_EQUIPMENT_OPTIONS,
  buildCustomExerciseKey,
  createCustomExercise,
  usesBarByDefault,
  validateCustomExercise,
  type CustomExerciseDraft,
} from './customExercise';
import { filterCatalogExercises, loadCatalogExercises } from './exerciseCatalog';
import { defaultBarProfileForCatalogRow } from './barProfiles';

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

const draft = (overrides: Partial<CustomExerciseDraft> = {}): CustomExerciseDraft => ({
  name: 'Remo con mancuerna',
  primaryMuscle: 'lats',
  equipment: 'dumbbell',
  usesBar: false,
  ...overrides,
});

describe('validateCustomExercise', () => {
  it('accepts a complete draft', () => {
    expect(validateCustomExercise(draft(), new Set())).toBeNull();
  });

  it('requires a name', () => {
    expect(validateCustomExercise(draft({ name: '   ' }), new Set())).toBe('name-required');
  });

  it('rejects a name the catalog already uses, whatever the casing', () => {
    expect(
      validateCustomExercise(draft({ name: 'bench press' }), new Set(['Bench Press'])),
    ).toBe('name-taken');
  });

  it('requires a primary muscle from the catalog vocabulary', () => {
    expect(validateCustomExercise(draft({ primaryMuscle: null }), new Set())).toBe(
      'muscle-required',
    );
    expect(validateCustomExercise(draft({ primaryMuscle: 'gills' }), new Set())).toBe(
      'muscle-required',
    );
  });

  it('does not require equipment — "not sure" is an answer', () => {
    expect(validateCustomExercise(draft({ equipment: null }), new Set())).toBeNull();
  });
});

describe('buildCustomExerciseKey', () => {
  it('derives a readable key in the catalog style', () => {
    expect(buildCustomExerciseKey('Remo con mancuerna', new Set())).toBe(
      'user-Remo_con_mancuerna',
    );
  });

  it('suffixes a colliding key instead of overwriting one', () => {
    const existing = new Set(['user-Remo', 'user-Remo-2']);
    expect(buildCustomExerciseKey('Remo', existing)).toBe('user-Remo-3');
  });

  it('survives a name made entirely of punctuation', () => {
    expect(buildCustomExerciseKey('!!!', new Set())).toBe('user-exercise');
  });

  it('keeps accents and digits', () => {
    expect(buildCustomExerciseKey('Sentadilla 1/4', new Set())).toBe('user-Sentadilla_1_4');
  });
});

describe('usesBarByDefault', () => {
  it('proposes a bar for barbell equipment and none otherwise', () => {
    expect(usesBarByDefault('barbell')).toBe(true);
    expect(usesBarByDefault('dumbbell')).toBe(false);
    expect(usesBarByDefault(null)).toBe(false);
  });

  it('offers only catalog equipment values', () => {
    expect(CUSTOM_EQUIPMENT_OPTIONS).toContain('barbell');
    expect(CUSTOM_EQUIPMENT_OPTIONS).toContain('body only');
  });
});

describe('createCustomExercise', () => {
  it('writes a catalog row that filters, describes and carries a bar like any other', async () => {
    const { db, routineDb } = await withSchema();
    const created = await createCustomExercise(
      routineDb,
      draft({ name: 'Press Lutmak', primaryMuscle: 'chest', equipment: 'barbell', usesBar: true }),
      new Set(),
    );

    expect(created.exerciseKey).toBe('user-Press_Lutmak');
    expect(created.bodyParts).toEqual(['chest']);
    expect(defaultBarProfileForCatalogRow(created.equipment, created.usesBar)).toBe('olympic');

    const rows = await loadCatalogExercises(routineDb);
    const reloaded = rows.find((row) => row.exerciseKey === 'user-Press_Lutmak');
    expect(reloaded).toEqual(created);
    expect(
      filterCatalogExercises(rows, { query: 'lutmak', bodyPart: 'chest' }),
    ).toHaveLength(1);
    db.close();
  });

  it('keeps two custom exercises apart', async () => {
    const { db, routineDb } = await withSchema();
    const first = await createCustomExercise(routineDb, draft({ name: 'Remo' }), new Set());
    const second = await createCustomExercise(
      routineDb,
      draft({ name: 'Remo bajo' }),
      new Set([first.exerciseKey]),
    );
    expect(second.exerciseKey).not.toBe(first.exerciseKey);

    const rows = await loadCatalogExercises(routineDb);
    expect(rows.filter((row) => row.origin === 'user')).toHaveLength(2);
    db.close();
  });

  it('refuses to write a row with no primary muscle', async () => {
    const { db, routineDb } = await withSchema();
    await expect(
      createCustomExercise(routineDb, draft({ primaryMuscle: null }), new Set()),
    ).rejects.toThrow();
    db.close();
  });
});
