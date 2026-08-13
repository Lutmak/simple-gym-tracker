import { normalizeCatalog, buildCatalogSeedSql } from './catalogNormalizer';
import fixture from '../data/catalog-fixture.json';

type RawExercise = {
  id: string;
  name: string;
  category: string;
  level: string | null;
  force: string | null;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
};

describe('normalizeCatalog', () => {
  it('keeps every distinct name and reports the dropped duplicates', () => {
    const result = normalizeCatalog(fixture as RawExercise[]);

    expect(fixture).toHaveLength(15);
    expect(result.exercises).toHaveLength(14);
    expect(result.droppedDuplicates).toBe(1);
  });

  it('keeps the first occurrence of a duplicated name', () => {
    const result = normalizeCatalog(fixture as RawExercise[]);
    const first = fixture[0] as RawExercise;
    const duplicate = fixture[14] as RawExercise;

    expect(first.name).toBe(duplicate.name);
    expect(result.exercises[0].exerciseKey).toBe(first.id);
    expect(result.exercises.map((e) => e.exerciseKey)).not.toContain(duplicate.id);
  });

  it('maps every source field into the catalog row', () => {
    const result = normalizeCatalog(fixture as RawExercise[]);
    const barbell = result.exercises.find((e) => e.exerciseKey === 'Barbell_Deadlift');

    expect(barbell).toBeDefined();
    expect(barbell).toMatchObject({
      exerciseKey: 'Barbell_Deadlift',
      name: 'Barbell Deadlift',
      category: 'strength',
      level: 'intermediate',
      force: 'pull',
      mechanic: 'compound',
      equipment: 'barbell',
    });
    expect(barbell?.instructions.length).toBeGreaterThan(100);
    expect(barbell?.instructions).not.toContain('\n[');
  });

  it('joins multi-part instructions into one text', () => {
    const result = normalizeCatalog(fixture as RawExercise[]);
    const [first] = result.exercises;
    const raw = fixture[0] as RawExercise;

    expect(raw.instructions.length).toBeGreaterThan(1);
    expect(first.instructions).toBe(raw.instructions.join('\n'));
  });

  it('produces primary and secondary muscle rows with lowercased names', () => {
    const result = normalizeCatalog(fixture as RawExercise[]);
    const deadlift = result.exercises.find((e) => e.exerciseKey === 'Barbell_Deadlift');

    expect(deadlift?.muscles).toEqual(
      expect.arrayContaining([
        { muscleName: 'lower back', isPrimary: true },
        { muscleName: 'hamstrings', isPrimary: false },
      ]),
    );
  });

  it('produces stable keys across repeated runs', () => {
    const raw = fixture as RawExercise[];
    const firstRun = normalizeCatalog(raw);
    const secondRun = normalizeCatalog(raw);

    expect(firstRun.exercises.map((e) => e.exerciseKey)).toEqual(
      secondRun.exercises.map((e) => e.exerciseKey),
    );
  });

  it('survives null metadata fields', () => {
    const raw = fixture as RawExercise[];
    const stripped: RawExercise[] = raw.map((e) => ({
      ...e,
      force: null,
      level: null,
      mechanic: null,
      equipment: null,
      primaryMuscles: [],
      secondaryMuscles: [],
      instructions: [],
    }));

    const result = normalizeCatalog(stripped);
    expect(result.exercises).toHaveLength(stripped.length - 1);
    for (const exercise of result.exercises) {
      expect(exercise.force).toBeNull();
      expect(exercise.equipment).toBeNull();
      expect(exercise.instructions).toBe('');
      expect(exercise.muscles).toEqual([]);
    }
  });
});

describe('buildCatalogSeedSql', () => {
  const exercises = normalizeCatalog(fixture as RawExercise[]);

  it('escapes single quotes inside text fields', () => {
    const row = exercises.exercises[0];
    const sql = buildCatalogSeedSql(
      'Catalog_Exercises',
      ['exercise_key', 'name'],
      [{ exercise_key: row.exerciseKey, name: "O'Brien's curl" }],
    );

    expect(sql).toContain("'O''Brien''s curl'");
    expect(sql).not.toContain("O'Brien's curl");
  });

  it('writes NULL for null fields', () => {
    const sql = buildCatalogSeedSql(
      'Catalog_Exercises',
      ['exercise_key', 'level'],
      [{ exercise_key: 'x', level: null }],
    );

    expect(sql).toContain("('x', NULL)");
  });

  it('emits one multi-row INSERT OR IGNORE for the whole catalog', () => {
    const exerciseSql = buildCatalogSeedSql(
      'Catalog_Exercises',
      ['exercise_key', 'name', 'category'],
      exercises.exercises.map((e) => ({
        exercise_key: e.exerciseKey,
        name: e.name,
        category: e.category,
      })),
    );

    expect(exerciseSql).toMatch(/^INSERT OR IGNORE INTO Catalog_Exercises/);
    expect(exerciseSql.match(/\('3_4_Sit-Up'/g)).toHaveLength(1);
    expect(exerciseSql.match(/\);\s*$/)).not.toBeNull();
    expect(exerciseSql.endsWith(';')).toBe(true);
  });
});
