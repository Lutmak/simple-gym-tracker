import fixtureWave from '../data/fixtures/531-base-template.sgtroutine.json';
import fixtureLinear from '../data/fixtures/push-pull-legs.sgtroutine.json';
import { buildRoutineCopyRows, type RoutineSourceBundle } from './routineActions';
import {
  parseRoutineDocument,
  serialiseRoutine,
  type RoutineDocument,
  type RoutineDocumentError,
} from './routineDocument';
import type { CatalogExercise } from './exerciseCatalog';

const catalogRow = (overrides: Partial<CatalogExercise>): CatalogExercise => ({
  exerciseKey: 'Barbell_Squat',
  name: 'Barbell Squat',
  equipment: 'barbell',
  usesBar: null,
  origin: 'catalog',
  primaryMuscles: ['quadriceps'],
  bodyParts: ['legs'],
  ...overrides,
});

/** The catalog rows the two golden fixtures reference, standing in for the real seeded catalog. */
const goldenCatalog = (): Map<string, CatalogExercise> => {
  const rows: CatalogExercise[] = [
    catalogRow({ exerciseKey: 'Barbell_Squat', name: 'Barbell Squat', equipment: 'barbell', bodyParts: ['legs'] }),
    catalogRow({
      exerciseKey: 'Barbell_Bench_Press_-_Medium_Grip',
      name: 'Barbell Bench Press - Medium Grip',
      equipment: 'barbell',
      primaryMuscles: ['chest'],
      bodyParts: ['chest'],
    }),
    catalogRow({
      exerciseKey: 'Barbell_Deadlift',
      name: 'Barbell Deadlift',
      equipment: 'barbell',
      primaryMuscles: ['lower back'],
      bodyParts: ['back'],
    }),
    catalogRow({
      exerciseKey: 'Barbell_Shoulder_Press',
      name: 'Barbell Shoulder Press',
      equipment: 'barbell',
      primaryMuscles: ['shoulders'],
      bodyParts: ['shoulders'],
    }),
    catalogRow({
      exerciseKey: 'Dumbbell_Lunges',
      name: 'Dumbbell Lunges',
      equipment: 'dumbbell',
      primaryMuscles: ['quadriceps'],
      bodyParts: ['legs'],
    }),
    catalogRow({
      exerciseKey: 'Lying_Leg_Curls',
      name: 'Lying Leg Curls',
      equipment: 'machine',
      primaryMuscles: ['hamstrings'],
      bodyParts: ['legs'],
    }),
    catalogRow({
      exerciseKey: 'Standing_Calf_Raises',
      name: 'Standing Calf Raises',
      equipment: 'machine',
      primaryMuscles: ['calves'],
      bodyParts: ['legs'],
    }),
    catalogRow({
      exerciseKey: 'Bent_Over_Barbell_Row',
      name: 'Bent Over Barbell Row',
      equipment: 'barbell',
      primaryMuscles: ['middle back'],
      bodyParts: ['back'],
    }),
    catalogRow({
      exerciseKey: 'Triceps_Pushdown',
      name: 'Triceps Pushdown',
      equipment: 'cable',
      primaryMuscles: ['triceps'],
      bodyParts: ['arms'],
    }),
    catalogRow({
      exerciseKey: 'Chin-Up',
      name: 'Chin-Up',
      equipment: 'body only',
      primaryMuscles: ['lats'],
      bodyParts: ['back'],
    }),
    catalogRow({
      exerciseKey: 'Dumbbell_Bicep_Curl',
      name: 'Dumbbell Bicep Curl',
      equipment: 'dumbbell',
      primaryMuscles: ['biceps'],
      bodyParts: ['arms'],
    }),
    catalogRow({
      exerciseKey: 'Plank',
      name: 'Plank',
      equipment: 'body only',
      primaryMuscles: ['abdominals'],
      bodyParts: ['core'],
    }),
    catalogRow({
      exerciseKey: 'Seated_Cable_Rows',
      name: 'Seated Cable Rows',
      equipment: 'cable',
      primaryMuscles: ['middle back'],
      bodyParts: ['back'],
    }),
  ];
  return new Map(rows.map((row) => [row.exerciseKey, row]));
};

describe('parseRoutineDocument — golden fixtures', () => {
  it('parses the 4-day 5/3/1 (wave) fixture clean, one custom exercise created', () => {
    const result = parseRoutineDocument(fixtureWave, goldenCatalog());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rows.routine.name).toBe('5/3/1 — Base Template');
    expect(result.rows.routine.progressionRule).toBe('wave');
    expect(result.rows.sessions).toHaveLength(4);
    expect(result.rows.exercises).toHaveLength(16);
    expect(result.newCustomExercises).toHaveLength(1);
    expect(result.newCustomExercises[0].name).toBe('Face Pull');
    expect(result.newCustomExercises[0].exerciseKey).toBe('user-Face_Pull');
    const facePull = result.rows.exercises.find((exercise) => exercise.name === 'Face Pull');
    expect(facePull?.catalogExerciseId).toBe('user-Face_Pull');
  });

  it('parses the 3-day linear fixture clean, with no weights anywhere', () => {
    const result = parseRoutineDocument(fixtureLinear, goldenCatalog());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rows.routine.name).toBe('Push Pull Legs');
    expect(result.rows.routine.progressionRule).toBe('linear');
    expect(result.rows.sessions).toHaveLength(3);
    expect(result.newCustomExercises).toHaveLength(0);
    for (const exercise of result.rows.exercises) {
      expect(exercise.trainingMaxWeight).toBeNull();
      expect(exercise.absoluteWeight).toBeNull();
    }
  });
});

describe('serialiseRoutine → parseRoutineDocument — round trip', () => {
  it('reproduces a wave bundle with a training max, a custom exercise, a custom bar and a unit override', () => {
    const catalog = new Map<string, CatalogExercise>([
      ['Barbell_Squat', catalogRow({ exerciseKey: 'Barbell_Squat', name: 'Barbell Squat', equipment: 'barbell' })],
      [
        'user-face_pull',
        catalogRow({
          exerciseKey: 'user-face_pull',
          name: 'Face Pull',
          equipment: 'cable',
          usesBar: false,
          origin: 'user',
          primaryMuscles: ['shoulders'],
          bodyParts: ['shoulders'],
        }),
      ],
    ]);

    const bundle: RoutineSourceBundle = {
      routine: {
        routineKey: null,
        name: 'My Program',
        origin: 'user',
        progressionRule: 'wave',
        roundingIncrement: 2.5,
        unit: 'kg',
        restMainSeconds: 180,
        restAccessorySeconds: 90,
        isActive: false,
        description: null,
        philosophy: null,
        descriptionEs: null,
        philosophyEs: null,
        recommendedDays: null,
        plannedJokers: 1,
        tmIncrementUpper: 2.5,
        tmIncrementLower: 5,
        cycleWeeks: 3,
      },
      sessions: [{ sessionId: 1, weekday: 1, name: 'Squat Day', sortOrder: 1 }],
      exercises: [
        {
          exerciseId: 1,
          sessionId: 1,
          catalogExerciseId: 'Barbell_Squat',
          name: 'Barbell Squat',
          role: 'main',
          targetSets: 3,
          targetReps: 5,
          loadSource: 'training_max_pct',
          trainingMaxPct: 0.9,
          trainingMaxWeight: 140,
          absoluteWeight: null,
          unitOverride: null,
          isAmrap: true,
          sortOrder: 1,
          equipment: 'barbell',
          barProfile: 'olympic',
          barWeight: null,
          warmupsEnabled: true,
          category: 'lower',
        },
        {
          exerciseId: 2,
          sessionId: 1,
          catalogExerciseId: 'user-face_pull',
          name: 'Face Pull',
          role: 'accessory',
          targetSets: 3,
          targetReps: 15,
          loadSource: 'absolute',
          trainingMaxPct: null,
          trainingMaxWeight: null,
          absoluteWeight: 15,
          unitOverride: 'lb',
          isAmrap: false,
          sortOrder: 2,
          equipment: null,
          barProfile: 'custom',
          barWeight: 9.5,
          warmupsEnabled: false,
          category: null,
        },
      ],
    };

    const doc = serialiseRoutine(bundle, catalog);
    const result = parseRoutineDocument(doc, catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.newCustomExercises).toEqual([]);

    const expected = buildRoutineCopyRows(bundle, 'kg', new Map(), {
      routineKey: null,
      origin: 'user',
      isActive: false,
    });

    expect(result.rows.routine.name).toBe(expected.routine.name);
    expect(result.rows.routine.progressionRule).toBe(expected.routine.progressionRule);
    expect(result.rows.routine.unit).toBe(expected.routine.unit);
    expect(result.rows.routine.roundingIncrement).toBe(expected.routine.roundingIncrement);
    expect(result.rows.routine.restMainSeconds).toBe(expected.routine.restMainSeconds);
    expect(result.rows.routine.restAccessorySeconds).toBe(expected.routine.restAccessorySeconds);
    expect(result.rows.routine.isActive).toBe(expected.routine.isActive);
    expect(result.rows.routine.plannedJokers).toBe(expected.routine.plannedJokers);
    // Z1: tmIncrementUpper/Lower, cycleWeeks and per-exercise category all round-trip too.
    expect(result.rows.routine.tmIncrementUpper).toBe(expected.routine.tmIncrementUpper);
    expect(result.rows.routine.tmIncrementLower).toBe(expected.routine.tmIncrementLower);
    expect(result.rows.routine.cycleWeeks).toBe(expected.routine.cycleWeeks);
    expect(result.rows.sessions).toEqual(expected.sessions);
    expect(result.rows.exercises).toEqual(expected.exercises);
  });

  it('omits tmIncrementUpper/Lower and cycleWeeks when they are the wave engine\'s own defaults, and category when inferred', () => {
    const catalog = new Map<string, CatalogExercise>([
      ['Barbell_Squat', catalogRow({ exerciseKey: 'Barbell_Squat', name: 'Barbell Squat', equipment: 'barbell' })],
    ]);
    const bundle: RoutineSourceBundle = {
      routine: {
        routineKey: null,
        name: 'Defaults Only',
        origin: 'user',
        progressionRule: 'wave',
        roundingIncrement: 2.5,
        unit: 'kg',
        restMainSeconds: 180,
        restAccessorySeconds: 90,
        isActive: false,
        description: null,
        philosophy: null,
        descriptionEs: null,
        philosophyEs: null,
        recommendedDays: null,
        plannedJokers: 0,
        tmIncrementUpper: null,
        tmIncrementLower: null,
        cycleWeeks: 4,
      },
      sessions: [{ sessionId: 1, weekday: 1, name: 'Squat Day', sortOrder: 1 }],
      exercises: [
        {
          exerciseId: 1,
          sessionId: 1,
          catalogExerciseId: 'Barbell_Squat',
          name: 'Barbell Squat',
          role: 'main',
          targetSets: 3,
          targetReps: 5,
          loadSource: 'training_max_pct',
          trainingMaxPct: 0.9,
          trainingMaxWeight: 140,
          absoluteWeight: null,
          unitOverride: null,
          isAmrap: true,
          sortOrder: 1,
          equipment: 'barbell',
          barProfile: 'olympic',
          barWeight: null,
          warmupsEnabled: true,
          category: null,
        },
      ],
    };

    const doc = serialiseRoutine(bundle, catalog);
    expect(doc.routine.tmIncrementUpper).toBeUndefined();
    expect(doc.routine.tmIncrementLower).toBeUndefined();
    expect(doc.routine.cycleWeeks).toBeUndefined();
    expect(doc.sessions[0].exercises[0].category).toBeUndefined();

    const result = parseRoutineDocument(doc, catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rows.routine.tmIncrementUpper).toBeNull();
    expect(result.rows.routine.tmIncrementLower).toBeNull();
    expect(result.rows.routine.cycleWeeks).toBe(4);
    expect(result.rows.exercises[0].category).toBeNull();
  });
});

describe('parseRoutineDocument — validation', () => {
  const baseDoc = (): RoutineDocument => ({
    format: 'sgt-routine',
    version: 1,
    routine: {
      name: 'Test routine',
      progressionRule: 'linear',
      unit: 'kg',
      roundingIncrement: 2.5,
      restMainSeconds: 120,
      restAccessorySeconds: 60,
      plannedJokers: 0,
    },
    sessions: [
      {
        weekday: 1,
        name: 'Day one',
        exercises: [
          {
            catalogKey: 'Barbell_Squat',
            role: 'main',
            targetSets: 3,
            targetReps: 8,
            loadSource: 'absolute',
            absoluteWeight: 100,
          },
        ],
      },
    ],
  });

  const catalog = goldenCatalog();
  const codeOf = (errors: RoutineDocumentError[]): string[] => errors.map((entry) => entry.code);

  it('rejects a version newer than supported', () => {
    const doc = { ...baseDoc(), version: 2 };
    const result = parseRoutineDocument(doc, catalog);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(codeOf(result.errors)).toEqual(['unsupportedVersion']);
  });

  it('rejects two sessions sharing a weekday', () => {
    const doc = baseDoc();
    doc.sessions.push({ ...doc.sessions[0], name: 'Day two' });
    const result = parseRoutineDocument(doc, catalog);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(codeOf(result.errors)).toContain('duplicateWeekday');
  });

  it('rejects a bar weight on a non-custom profile', () => {
    const doc = baseDoc();
    doc.sessions[0].exercises[0].barProfile = 'olympic';
    doc.sessions[0].exercises[0].barWeight = 25;
    const result = parseRoutineDocument(doc, catalog);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(codeOf(result.errors)).toEqual(['barWeightNotAllowed']);
  });

  it('rejects a catalogKey that resolves to nothing, naming the line', () => {
    const doc = baseDoc();
    doc.sessions[0].exercises[0].catalogKey = 'Barbel_Squat';
    const result = parseRoutineDocument(doc, catalog);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors).toEqual([
      {
        code: 'exerciseNotFound',
        session: { index: 0, name: 'Day one' },
        exercise: { index: 0, name: 'Barbel_Squat' },
        field: 'catalogKey',
        detail: 'Barbel_Squat',
      },
    ]);
  });

  it('reuses an existing custom exercise by name instead of erroring or duplicating', () => {
    const catalogWithCustom = new Map(catalog);
    catalogWithCustom.set(
      'user-face_pull',
      catalogRow({
        exerciseKey: 'user-face_pull',
        name: 'Face Pull',
        origin: 'user',
        equipment: 'cable',
        usesBar: false,
        primaryMuscles: ['shoulders'],
        bodyParts: ['shoulders'],
      }),
    );
    const doc = baseDoc();
    delete doc.sessions[0].exercises[0].catalogKey;
    doc.sessions[0].exercises[0].custom = {
      name: 'Face Pull',
      primaryMuscle: 'shoulders',
      equipment: 'cable',
      usesBar: false,
    };
    const result = parseRoutineDocument(doc, catalogWithCustom);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.newCustomExercises).toEqual([]);
    expect(result.rows.exercises[0].catalogExerciseId).toBe('user-face_pull');
  });

  it('rejects a trainingMaxPct outside (0, 1]', () => {
    const doc = baseDoc();
    doc.sessions[0].exercises[0].loadSource = 'training_max_pct';
    doc.sessions[0].exercises[0].trainingMaxPct = 1.5;
    delete doc.sessions[0].exercises[0].absoluteWeight;
    const result = parseRoutineDocument(doc, catalog);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(codeOf(result.errors)).toEqual(['trainingMaxPctInvalid']);
  });

  // Z1 — the four optional fields added to the v1 format without a version bump.
  it('accepts tmIncrementUpper/Lower and cycleWeeks when present and valid', () => {
    const doc = baseDoc();
    doc.routine.tmIncrementUpper = 2.5;
    doc.routine.tmIncrementLower = 5;
    doc.routine.cycleWeeks = 3;
    const result = parseRoutineDocument(doc, catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rows.routine.tmIncrementUpper).toBe(2.5);
    expect(result.rows.routine.tmIncrementLower).toBe(5);
    expect(result.rows.routine.cycleWeeks).toBe(3);
  });

  it('rejects a non-positive tmIncrementUpper', () => {
    const doc = baseDoc();
    doc.routine.tmIncrementUpper = 0;
    const result = parseRoutineDocument(doc, catalog);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(codeOf(result.errors)).toEqual(['tmIncrementUpperInvalid']);
  });

  it('rejects a non-positive tmIncrementLower', () => {
    const doc = baseDoc();
    doc.routine.tmIncrementLower = -1;
    const result = parseRoutineDocument(doc, catalog);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(codeOf(result.errors)).toEqual(['tmIncrementLowerInvalid']);
  });

  it('rejects a cycleWeeks that is neither 3 nor 4', () => {
    const doc = baseDoc();
    doc.routine.cycleWeeks = 5;
    const result = parseRoutineDocument(doc, catalog);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(codeOf(result.errors)).toEqual(['cycleWeeksInvalid']);
  });

  it('accepts an exercise category of "upper" or "lower"', () => {
    const doc = baseDoc();
    doc.sessions[0].exercises[0].category = 'upper';
    const result = parseRoutineDocument(doc, catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rows.exercises[0].category).toBe('upper');
  });

  it('rejects an exercise category that is neither "upper" nor "lower"', () => {
    const doc = baseDoc();
    // @ts-expect-error — deliberately invalid input, exactly what a hand-authored file might carry
    doc.sessions[0].exercises[0].category = 'core';
    const result = parseRoutineDocument(doc, catalog);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(codeOf(result.errors)).toEqual(['categoryInvalid']);
  });
});
