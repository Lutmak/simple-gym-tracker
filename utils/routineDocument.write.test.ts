/**
 * X2 — the transactional write edge, against a real (in-memory) database. `routineDocument.test.ts`
 * proves the pure serialise/parse core without a database; this file proves the three things that
 * core cannot: a colliding routine name gets suffixed, a new custom exercise row actually lands in
 * `Catalog_Exercises`, the whole write rolls back on a mid-transaction failure, and the imported
 * routine is never `is_active = 1`.
 */

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import fixtureWave from '../data/fixtures/531-base-template.sgtroutine.json';
import { runSchema, type SchemaExecutor } from './schema';
import type { RoutineCopyRows, RoutineDatabase } from './routineActions';
import { loadCatalogExercises, type CatalogExercise } from './exerciseCatalog';
import { loadRoutineDocumentText, parseRoutineDocument, writeRoutineDocument } from './routineDocument';

type TestExecutor = SchemaExecutor & RoutineDatabase;

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

const realCatalog = async (executor: TestExecutor): Promise<Map<string, CatalogExercise>> => {
  const rows = await loadCatalogExercises(executor);
  return new Map(rows.map((row) => [row.exerciseKey, row]));
};

describe('writeRoutineDocument — the transactional edge', () => {
  it('imports the wave fixture: inactive, sessions/exercises counted', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    const parsed = parseRoutineDocument(fixtureWave, await realCatalog(executor));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    // The fixture's "Face Pull" custom block matches a real catalog exercise of that name
    // (yuhonas/free-exercise-db already has one) — the reuse-by-name rule resolves it there
    // rather than creating a duplicate, so this real-catalog import creates none.
    expect(parsed.newCustomExercises).toHaveLength(0);

    const { routineId, customExerciseCount } = await writeRoutineDocument(
      executor,
      parsed.rows,
      parsed.newCustomExercises,
    );
    expect(customExerciseCount).toBe(0);

    const routine = db
      .prepare('SELECT name, is_active, origin FROM Routines WHERE routine_id = ?;')
      .get(routineId) as { name: string; is_active: number; origin: string };
    expect(routine.name).toBe('5/3/1 — Base Template');
    expect(routine.is_active).toBe(0);
    expect(routine.origin).toBe('user');

    const sessionCount = (
      db.prepare('SELECT COUNT(*) AS n FROM Sessions WHERE routine_id = ?;').get(routineId) as {
        n: number;
      }
    ).n;
    expect(sessionCount).toBe(parsed.rows.sessions.length);

    const exerciseCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM SessionExercises e
           JOIN Sessions s ON s.session_id = e.session_id WHERE s.routine_id = ?;`,
        )
        .get(routineId) as { n: number }
    ).n;
    expect(exerciseCount).toBe(parsed.rows.exercises.length);

    const facePull = db
      .prepare('SELECT catalog_exercise_id FROM SessionExercises WHERE exercise_name = ?;')
      .get('Face Pull') as { catalog_exercise_id: string };
    expect(facePull.catalog_exercise_id).toBe('Face_Pull');
  });

  it('creates a genuinely new custom exercise row and its primary muscle', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    const doc = {
      format: 'sgt-routine',
      version: 1,
      routine: {
        name: 'Custom Exercise Routine',
        progressionRule: 'linear',
        unit: 'kg',
        roundingIncrement: 2.5,
        restMainSeconds: 90,
        restAccessorySeconds: 60,
        plannedJokers: 0,
      },
      sessions: [
        {
          weekday: 1,
          name: 'Day one',
          exercises: [
            {
              custom: {
                name: 'Zzz Test Only Cable Fly',
                primaryMuscle: 'chest',
                equipment: 'cable',
                usesBar: false,
              },
              role: 'accessory',
              targetSets: 3,
              targetReps: 12,
              loadSource: 'absolute',
              absoluteWeight: 15,
            },
          ],
        },
      ],
    };

    const parsed = parseRoutineDocument(doc, await realCatalog(executor));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.newCustomExercises).toHaveLength(1);
    expect(parsed.newCustomExercises[0].exerciseKey).toBe('user-Zzz_Test_Only_Cable_Fly');

    const { customExerciseCount } = await writeRoutineDocument(
      executor,
      parsed.rows,
      parsed.newCustomExercises,
    );
    expect(customExerciseCount).toBe(1);

    const custom = db
      .prepare('SELECT name, origin, equipment, uses_bar FROM Catalog_Exercises WHERE exercise_key = ?;')
      .get('user-Zzz_Test_Only_Cable_Fly') as {
      name: string;
      origin: string;
      equipment: string;
      uses_bar: number;
    };
    expect(custom.name).toBe('Zzz Test Only Cable Fly');
    expect(custom.origin).toBe('user');
    expect(custom.equipment).toBe('cable');
    expect(custom.uses_bar).toBe(0);

    const muscle = db
      .prepare('SELECT muscle_name, is_primary FROM Catalog_Exercise_Muscles WHERE exercise_key = ?;')
      .get('user-Zzz_Test_Only_Cable_Fly') as { muscle_name: string; is_primary: number };
    expect(muscle.muscle_name).toBe('chest');
    expect(muscle.is_primary).toBe(1);
  });

  it('suffixes a colliding name on a second import of the same file', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    const firstParse = parseRoutineDocument(fixtureWave, await realCatalog(executor));
    expect(firstParse.ok).toBe(true);
    if (!firstParse.ok) {
      return;
    }
    await writeRoutineDocument(executor, firstParse.rows, firstParse.newCustomExercises);

    const secondParse = parseRoutineDocument(fixtureWave, await realCatalog(executor));
    expect(secondParse.ok).toBe(true);
    if (!secondParse.ok) {
      return;
    }
    const second = await writeRoutineDocument(executor, secondParse.rows, secondParse.newCustomExercises);

    const routine = db
      .prepare('SELECT name FROM Routines WHERE routine_id = ?;')
      .get(second.routineId) as { name: string };
    expect(routine.name).toBe('5/3/1 — Base Template (2)');

    const routineRows = (
      db.prepare("SELECT COUNT(*) AS n FROM Routines WHERE name LIKE '5/3/1 — Base Template%';").get() as {
        n: number;
      }
    ).n;
    expect(routineRows).toBe(2);
  });

  it('X3 — export then import reproduces the routine (sessions, exercises, weights, bar, unit override)', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    // Import the wave fixture once — this is the routine that will be exported.
    const imported = parseRoutineDocument(fixtureWave, await realCatalog(executor));
    expect(imported.ok).toBe(true);
    if (!imported.ok) {
      return;
    }
    const original = await writeRoutineDocument(executor, imported.rows, imported.newCustomExercises);

    // Export it back out, then import the exported text as if it were a second device's file.
    const { text } = await loadRoutineDocumentText(executor, await realCatalog(executor), original.routineId);
    const reparsed = parseRoutineDocument(JSON.parse(text), await realCatalog(executor));
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) {
      return;
    }
    expect(reparsed.newCustomExercises).toHaveLength(0);
    const reimported = await writeRoutineDocument(executor, reparsed.rows, reparsed.newCustomExercises);

    const detailsOf = (routineId: number) =>
      db
        .prepare(
          `SELECT s.weekday, s.sort_order AS session_sort_order,
                  e.catalog_exercise_id, e.role, e.target_sets, e.target_reps, e.load_source,
                  e.training_max_pct, e.training_max_weight, e.absolute_weight, e.unit_override,
                  e.is_amrap, e.sort_order, e.bar_profile, e.bar_weight, e.warmups_enabled
           FROM SessionExercises e JOIN Sessions s ON s.session_id = e.session_id
           WHERE s.routine_id = ? ORDER BY s.sort_order, e.sort_order;`,
        )
        .all(routineId);

    expect(detailsOf(reimported.routineId)).toEqual(detailsOf(original.routineId));
  });

  it('rolls back the whole write on a mid-transaction failure', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    const brokenRows: RoutineCopyRows = {
      routine: {
        routineKey: null,
        name: 'Broken Routine',
        origin: 'user',
        progressionRule: 'linear',
        unit: 'kg',
        roundingIncrement: 2.5,
        restMainSeconds: 60,
        restAccessorySeconds: 60,
        isActive: false,
        createdAt: Date.now(),
        plannedJokers: 0,
        tmIncrementUpper: null,
        tmIncrementLower: null,
        cycleWeeks: 4,
      },
      sessions: [{ weekday: 1, name: 'Day', sortOrder: 1 }],
      exercises: [
        {
          // References a session index the routine does not have.
          sessionIndex: 5,
          catalogExerciseId: 'Barbell_Squat',
          name: 'Barbell Squat',
          role: 'main',
          targetSets: 3,
          targetReps: 5,
          loadSource: 'absolute',
          trainingMaxPct: null,
          trainingMaxWeight: null,
          absoluteWeight: 100,
          unitOverride: null,
          isAmrap: false,
          sortOrder: 1,
          barProfile: null,
          barWeight: null,
          warmupsEnabled: null,
          category: null,
        },
      ],
    };

    await expect(writeRoutineDocument(executor, brokenRows, [])).rejects.toThrow();

    const count = (
      db.prepare("SELECT COUNT(*) AS n FROM Routines WHERE name = 'Broken Routine';").get() as {
        n: number;
      }
    ).n;
    expect(count).toBe(0);
  });
});
