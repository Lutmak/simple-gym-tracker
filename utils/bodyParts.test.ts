import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import {
  BODY_PARTS,
  PRIMARY_MUSCLE_OPTIONS,
  bodyPartLabelKey,
  bodyPartOfMuscle,
  bodyPartsOfMuscles,
} from './bodyParts';

describe('bodyPartOfMuscle', () => {
  it('maps the catalog vocabulary to its region', () => {
    expect(bodyPartOfMuscle('chest')).toBe('chest');
    expect(bodyPartOfMuscle('lats')).toBe('back');
    expect(bodyPartOfMuscle('lower back')).toBe('back');
    expect(bodyPartOfMuscle('triceps')).toBe('arms');
    expect(bodyPartOfMuscle('abdominals')).toBe('core');
    expect(bodyPartOfMuscle('glutes')).toBe('legs');
  });

  it('is case and whitespace insensitive', () => {
    expect(bodyPartOfMuscle('  Quadriceps ')).toBe('legs');
  });

  it('returns null for a name outside the vocabulary', () => {
    expect(bodyPartOfMuscle('gills')).toBeNull();
  });
});

describe('bodyPartsOfMuscles', () => {
  it('returns regions in BODY_PARTS order, without repeats', () => {
    expect(bodyPartsOfMuscles(['triceps', 'chest', 'shoulders', 'biceps'])).toEqual([
      'chest',
      'shoulders',
      'arms',
    ]);
  });

  it('ignores unknown muscles instead of inventing a region', () => {
    expect(bodyPartsOfMuscles(['gills', 'calves'])).toEqual(['legs']);
  });

  it('is empty for an exercise with no muscles', () => {
    expect(bodyPartsOfMuscles([])).toEqual([]);
  });
});

describe('the grouping covers the catalog', () => {
  it('assigns every seeded muscle name to exactly one region', () => {
    const db = new DatabaseSync(':memory:');
    const executor: SchemaExecutor = {
      exec: (sql) => db.exec(sql),
      run: (sql, params) => {
        db.prepare(sql).run(...((params ?? []) as SQLInputValue[]));
      },
      getAll: <T>(sql: string, params: SQLInputValue[] = []) =>
        Promise.resolve(db.prepare(sql).all(...params) as T[]),
    };

    return runSchema(executor).then(() => {
      const rows = db
        .prepare('SELECT DISTINCT muscle_name FROM Catalog_Exercise_Muscles;')
        .all() as { muscle_name: string }[];
      expect(rows.length).toBeGreaterThan(0);
      const unmapped = rows
        .map((row) => row.muscle_name)
        .filter((muscle) => bodyPartOfMuscle(muscle) === null);
      expect(unmapped).toEqual([]);
      db.close();
    });
  });

  it('lists every grouped muscle once as a custom-exercise option', () => {
    expect([...new Set(PRIMARY_MUSCLE_OPTIONS)]).toEqual(PRIMARY_MUSCLE_OPTIONS);
    expect(PRIMARY_MUSCLE_OPTIONS).toHaveLength(
      BODY_PARTS.reduce((total, part) => total + part.muscles.length, 0),
    );
  });

  it('gives every region an icon and a translatable label', () => {
    for (const part of BODY_PARTS) {
      expect(part.icon).not.toBe('');
      expect(bodyPartLabelKey(part.key)).toBe(`bodyPart_${part.key}`);
    }
  });
});
