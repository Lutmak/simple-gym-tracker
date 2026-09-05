import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import { loadDemoData } from './demoData';
import {
  buildEditRows,
  editRemovalWarning,
  EditRoutineValidationError,
  saveRoutineEdit,
  type EditExercise,
  type EditRoutine,
  type EditSession,
} from './editRoutine';
import {
  createBlankRoutine,
  loadRoutineSourceById,
  type RoutineDatabase,
  type RoutineSourceBundle,
} from './routineActions';
import { blankRoutineDraft } from './routineLibrary';
import { nominalSessionStamp } from './today';

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

const exerciseFrom = (source: RoutineSourceBundle, name: string): EditExercise => {
  const exercise = source.exercises.find((row) => row.name === name);
  if (exercise === undefined) {
    throw new Error(`Fixture missing exercise ${name}`);
  }
  return {
    exerciseId: exercise.exerciseId,
    catalogExerciseId: exercise.catalogExerciseId,
    name: exercise.name,
    role: exercise.role,
    targetSets: exercise.targetSets,
    targetReps: exercise.targetReps,
    loadSource: exercise.loadSource,
    trainingMaxPct: exercise.trainingMaxPct,
    trainingMaxWeight: exercise.trainingMaxWeight,
    absoluteWeight: exercise.absoluteWeight,
    unitOverride: exercise.unitOverride,
    isAmrap: exercise.isAmrap,
  };
};

const sessionFrom = (
  source: RoutineSourceBundle,
  name: string,
  weekday: number,
): EditSession => {
  const sourceSession = source.sessions.find((row) => row.name === name);
  if (sourceSession === undefined) {
    throw new Error(`Fixture missing session ${name}`);
  }
  return {
    sessionId: sourceSession.sessionId,
    weekday,
    name: sourceSession.name,
    exercises: source.exercises
      .filter((row) => row.sessionId === sourceSession.sessionId)
      .map((row) => {
        const exercise = source.exercises.find((r) => r.exerciseId === row.exerciseId);
        if (exercise === undefined) {
          throw new Error(`Fixture missing exercise ${row.exerciseId}`);
        }
        return exerciseFrom(source, exercise.name);
      }),
  };
};

const demoRoutineDraft = async (
  executor: TestExecutor,
): Promise<EditRoutine> => {
  await runSchema(executor);
  await loadDemoData(executor);
  const source = await loadRoutineSourceById(executor, 1);
  return {
    name: source.routine.name,
    unit: source.routine.unit as 'kg' | 'lb',
    roundingIncrement: source.routine.roundingIncrement,
    restMainSeconds: source.routine.restMainSeconds,
    restAccessorySeconds: source.routine.restAccessorySeconds,
    sessions: [
      sessionFrom(source, 'Squat Day', 1),
      sessionFrom(source, 'Bench Day', 2),
      sessionFrom(source, 'Deadlift Day', 4),
      sessionFrom(source, 'Press Day', 5),
    ],
  };
};

describe('buildEditRows — pure draft to plan rows', () => {
  const draft = (): EditRoutine => ({
    name: 'My Routine',
    unit: 'kg',
    roundingIncrement: 2.5,
    restMainSeconds: 180,
    restAccessorySeconds: 90,
    sessions: [
      {
        sessionId: null,
        weekday: 1,
        name: 'Upper',
        exercises: [
          {
            exerciseId: null,
            catalogExerciseId: 'Dumbbell_Bench_Press',
            name: 'Dumbbell Bench Press',
            role: 'main',
            targetSets: 3,
            targetReps: 10,
            loadSource: 'training_max_pct',
            trainingMaxPct: null,
            trainingMaxWeight: 100,
            absoluteWeight: null,
            unitOverride: null,
            isAmrap: true,
          },
          {
            exerciseId: null,
            catalogExerciseId: 'Chin-Up',
            name: 'Chin-Up',
            role: 'accessory',
            targetSets: 3,
            targetReps: 8,
            loadSource: 'bodyweight',
            trainingMaxPct: null,
            trainingMaxWeight: null,
            absoluteWeight: null,
            unitOverride: null,
            isAmrap: false,
          },
        ],
      },
      {
        sessionId: null,
        weekday: 4,
        name: 'Lower',
        exercises: [
          {
            exerciseId: null,
            catalogExerciseId: null,
            name: 'My custom lift',
            role: 'main',
            targetSets: 5,
            targetReps: 5,
            loadSource: 'absolute',
            trainingMaxPct: null,
            trainingMaxWeight: null,
            absoluteWeight: 120,
            unitOverride: 'lb',
            isAmrap: false,
          },
        ],
      },
    ],
  });

  it('assigns sort orders from list positions and normalizes per load source', () => {
    const rows = buildEditRows(draft());

    expect(rows.routine).toEqual({
      name: 'My Routine',
      unit: 'kg',
      roundingIncrement: 2.5,
      restMainSeconds: 180,
      restAccessorySeconds: 90,
      plannedJokers: null,
    });
    expect(rows.sessions).toEqual([
      { sessionId: null, weekday: 1, name: 'Upper', sortOrder: 1 },
      { sessionId: null, weekday: 4, name: 'Lower', sortOrder: 2 },
    ]);

    const [press, chinUp, custom] = rows.exercises;
    expect(press).toMatchObject({
      sessionIndex: 0,
      sortOrder: 1,
      loadSource: 'training_max_pct',
      trainingMaxPct: 0.9,
      trainingMaxWeight: 100,
      absoluteWeight: null,
      unitOverride: null,
      isAmrap: true,
    });
    expect(chinUp).toMatchObject({
      sessionIndex: 0,
      sortOrder: 2,
      loadSource: 'bodyweight',
      trainingMaxPct: null,
      trainingMaxWeight: null,
      absoluteWeight: null,
    });
    expect(custom).toMatchObject({
      sessionIndex: 1,
      sortOrder: 1,
      catalogExerciseId: null,
      loadSource: 'absolute',
      trainingMaxPct: null,
      trainingMaxWeight: null,
      absoluteWeight: 120,
      unitOverride: 'lb',
    });
  });

  it('keeps an explicit training max percentage', () => {
    const rows = buildEditRows({
      ...draft(),
      sessions: [
        {
          ...draft().sessions[0],
          exercises: [
            { ...draft().sessions[0].exercises[0], trainingMaxPct: 0.85 },
          ],
        },
      ],
    });
    expect(rows.exercises[0].trainingMaxPct).toBe(0.85);
  });

  it('rejects duplicate weekdays', () => {
    const dup = {
      ...draft(),
      sessions: [
        draft().sessions[0],
        { ...draft().sessions[1], weekday: 1 },
      ],
    };
    expect(() => buildEditRows(dup)).toThrowError(EditRoutineValidationError);
    try {
      buildEditRows(dup);
    } catch (error) {
      expect((error as EditRoutineValidationError).detail).toEqual({
        code: 'duplicateWeekday',
      });
    }
  });

  it('passes a missing training max and a missing absolute weight through as NULL', () => {
    const rows = buildEditRows({
      ...draft(),
      sessions: [
        {
          ...draft().sessions[0],
          exercises: [
            { ...draft().sessions[0].exercises[0], trainingMaxWeight: null },
          ],
        },
        {
          ...draft().sessions[1],
          exercises: [
            { ...draft().sessions[1].exercises[0], absoluteWeight: null },
          ],
        },
      ],
    });

    const [press, custom] = rows.exercises;
    expect(press.trainingMaxWeight).toBeNull();
    expect(press.trainingMaxPct).toBe(0.9);
    expect(custom.absoluteWeight).toBeNull();
  });

  it('treats a zero weight as no load, not a 0 in the plan', () => {
    const rows = buildEditRows({
      ...draft(),
      sessions: [
        {
          ...draft().sessions[0],
          exercises: [
            { ...draft().sessions[0].exercises[0], trainingMaxWeight: 0 },
          ],
        },
        {
          ...draft().sessions[1],
          exercises: [
            { ...draft().sessions[1].exercises[0], absoluteWeight: 0 },
          ],
        },
      ],
    });

    const [press, custom] = rows.exercises;
    expect(press.trainingMaxWeight).toBeNull();
    expect(custom.absoluteWeight).toBeNull();
  });

  it('keeps planned jokers only when the draft carries them', () => {
    expect(buildEditRows(draft()).routine.plannedJokers).toBeNull();
    expect(buildEditRows({ ...draft(), plannedJokers: 2 }).routine.plannedJokers).toBe(2);
  });

  it('rejects non-positive sets and reps', () => {
    const badSets = {
      ...draft(),
      sessions: [
        {
          ...draft().sessions[0],
          exercises: [{ ...draft().sessions[0].exercises[0], targetSets: 0 }],
        },
      ],
    };
    expect(() => buildEditRows(badSets)).toThrowError(EditRoutineValidationError);

    const badReps = {
      ...draft(),
      sessions: [
        {
          ...draft().sessions[0],
          exercises: [{ ...draft().sessions[0].exercises[0], targetReps: -2 }],
        },
      ],
    };
    expect(() => buildEditRows(badReps)).toThrowError(EditRoutineValidationError);
  });

  it('rejects an empty routine name, an empty session name and a bad rounding increment', () => {
    expect(() => buildEditRows({ ...draft(), name: '  ' })).toThrowError(
      EditRoutineValidationError,
    );
    expect(() =>
      buildEditRows({
        ...draft(),
        sessions: [{ ...draft().sessions[0], name: ' ' }],
      }),
    ).toThrowError(EditRoutineValidationError);
    expect(() =>
      buildEditRows({ ...draft(), roundingIncrement: 0 }),
    ).toThrowError(EditRoutineValidationError);
  });
});

describe('saveRoutineEdit — rewriting the plan without touching history', () => {
  const editedDraft = (base: EditRoutine): EditRoutine => ({
    ...base,
    name: 'Renamed Routine',
    unit: 'lb',
    roundingIncrement: 5,
    restMainSeconds: 150,
    restAccessorySeconds: 75,
    sessions: base.sessions
      .filter((session) => session.name !== 'Deadlift Day' && session.name !== 'Press Day')
      .map((session) =>
        session.name === 'Squat Day' ? { ...session, weekday: 3 } : session,
      ),
  });

  it('updates the plan and leaves Workout_Log / Logged_Exercises / Weight_Log untouched', async () => {
    const { db, executor } = connect();
    const base = await demoRoutineDraft(executor);
    const historyBefore = {
      workoutLog: count(db, 'Workout_Log'),
      logged: count(db, 'Logged_Exercises'),
      weight: count(db, 'Weight_Log'),
    };
    expect(historyBefore.workoutLog).toBeGreaterThan(0);
    expect(historyBefore.weight).toBeGreaterThan(0);

    await saveRoutineEdit(executor, 1, editedDraft(base));

    expect(count(db, 'Workout_Log')).toBe(historyBefore.workoutLog);
    expect(count(db, 'Logged_Exercises')).toBe(historyBefore.logged);
    expect(count(db, 'Weight_Log')).toBe(historyBefore.weight);

    const routine = db
      .prepare('SELECT * FROM Routines WHERE routine_id = 1;')
      .get() as Record<string, unknown>;
    expect(routine.name).toBe('Renamed Routine');
    expect(routine.unit).toBe('lb');
    expect(routine.rounding_increment).toBe(5);
    expect(routine.rest_main_seconds).toBe(150);
    expect(routine.rest_accessory_seconds).toBe(75);
    expect(routine.progression_rule).toBe('wave');
    expect(routine.origin).toBe('user');
    expect(routine.is_active).toBe(1);

    const sessions = db
      .prepare('SELECT weekday, name FROM Sessions WHERE routine_id = 1 ORDER BY sort_order;')
      .all() as { weekday: number; name: string }[];
    expect(sessions).toEqual([
      { weekday: 3, name: 'Squat Day' },
      { weekday: 2, name: 'Bench Day' },
    ]);
  });

  it('moves a session to a new weekday with its exercises intact', async () => {
    const { db, executor } = connect();
    const base = await demoRoutineDraft(executor);

    const squatSession = base.sessions.find((s) => s.name === 'Squat Day');
    if (squatSession === undefined) {
      throw new Error('Fixture missing Squat Day');
    }
    const squatExercises = squatSession.exercises.map((e) => e.name).sort();

    await saveRoutineEdit(executor, 1, {
      ...base,
      sessions: base.sessions.map((s) =>
        s.name === 'Squat Day' ? { ...s, weekday: 3 } : s,
      ),
    });

    const moved = db
      .prepare(
        'SELECT weekday FROM Sessions WHERE routine_id = 1 AND name = ?;',
      )
      .get('Squat Day') as { weekday: number };
    expect(moved.weekday).toBe(3);

    const movedExercises = db
      .prepare(
        `SELECT e.exercise_name FROM SessionExercises e
         JOIN Sessions s ON s.session_id = e.session_id
         WHERE s.routine_id = 1 AND s.name = ? ORDER BY e.sort_order;`,
      )
      .all('Squat Day') as { exercise_name: string }[];
    expect(movedExercises.map((row) => row.exercise_name).sort()).toEqual(
      squatExercises,
    );
  });

  it(
    "F7: restamps a still-pending week session's nominal_date to the new weekday, but " +
      'leaves an already-resolved one at the day it actually happened on',
    async () => {
      const { db, executor } = connect();
      const base = await demoRoutineDraft(executor);

      // Press Day is the one day the demo fixture leaves with a genuinely
      // pending week session (Friday's press, per the M1 queue fixtures) —
      // its earlier weeks are completed, giving both states on one session.
      const beforeRows = db
        .prepare(
          `SELECT ws.week_session_id AS week_session_id, ws.status AS status,
                  ws.nominal_date AS nominal_date, cw.week_number AS week_number,
                  c.started_at AS started_at
           FROM WeekSessions ws
           JOIN Sessions s ON s.session_id = ws.session_id
           JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
           JOIN Cycles c ON c.cycle_id = cw.cycle_id
           WHERE s.routine_id = 1 AND s.name = 'Press Day'
           ORDER BY ws.week_session_id;`,
        )
        .all() as {
        week_session_id: number;
        status: string;
        nominal_date: number | null;
        week_number: number;
        started_at: number;
      }[];
      const completedBefore = beforeRows.find((row) => row.status === 'completed');
      const pendingBefore = beforeRows.find((row) => row.status === 'pending');
      if (completedBefore === undefined || pendingBefore === undefined) {
        throw new Error('Fixture needs both a completed and a pending Press Day week session');
      }

      // Press Day moves from Friday (5) to Sunday (0) — free on this routine.
      await saveRoutineEdit(executor, 1, {
        ...base,
        sessions: base.sessions.map((s) => (s.name === 'Press Day' ? { ...s, weekday: 0 } : s)),
      });

      // The completed week session is untouched — the day it actually
      // happened on never changes underneath it.
      const completedAfter = db
        .prepare('SELECT nominal_date FROM WeekSessions WHERE week_session_id = ?;')
        .get(completedBefore.week_session_id) as { nominal_date: number | null };
      expect(completedAfter.nominal_date).toBe(completedBefore.nominal_date);

      // The still-pending one is restamped to the new weekday.
      const pendingAfter = db
        .prepare('SELECT nominal_date FROM WeekSessions WHERE week_session_id = ?;')
        .get(pendingBefore.week_session_id) as { nominal_date: number | null };
      const expectedNewNominal = nominalSessionStamp(
        pendingBefore.started_at,
        pendingBefore.week_number,
        0,
      );
      expect(pendingAfter.nominal_date).toBe(expectedNewNominal);
      expect(pendingAfter.nominal_date).not.toBe(pendingBefore.nominal_date);
    },
  );

  it(
    'F7: names a removed day with logged history and a removed exercise with a stored ' +
      'proposal, both in the active cycle, and nothing when there is nothing to lose',
    async () => {
      const { db, executor } = connect();
      const base = await demoRoutineDraft(executor);

      const activeCycle = (await executor.get(
        `SELECT cycle_id FROM Cycles WHERE routine_id = 1 AND status = 'active'
         ORDER BY cycle_number DESC LIMIT 1;`,
      )) as { cycle_id: number } | undefined;
      if (activeCycle === undefined) {
        throw new Error('Fixture has no active cycle for routine 1');
      }
      const cycleId = Number(activeCycle.cycle_id);

      const benchSession = base.sessions.find((s) => s.name === 'Bench Day');
      const removedExercise = benchSession?.exercises[0];
      if (benchSession === undefined || removedExercise === undefined || removedExercise.exerciseId === null) {
        throw new Error('Fixture missing a Bench Day exercise with an id');
      }
      // A stored proposal for that exercise in the active cycle — exactly
      // what removing it would discard.
      db.prepare(
        `INSERT INTO Progression_Proposal
           (routine_id, cycle_id, session_exercise_id, catalog_exercise_id, exercise_name,
            current_target, proposed_target, unit, reason, status, created_at)
         VALUES (1, ?, ?, NULL, ?, 10, 12.5, 'kg', 'test', 'pending', 1);`,
      ).run(cycleId, removedExercise.exerciseId, removedExercise.name);

      // Remove Press Day entirely (it has completed history, per the F7
      // test above) and one exercise from Bench Day (which survives).
      const draftWithRemovals: EditRoutine = {
        ...base,
        sessions: base.sessions
          .filter((s) => s.name !== 'Press Day')
          .map((s) =>
            s.name === 'Bench Day'
              ? {
                  ...s,
                  exercises: s.exercises.filter(
                    (e) => e.exerciseId !== removedExercise.exerciseId,
                  ),
                }
              : s,
          ),
      };

      const warning = await editRemovalWarning(executor, 1, draftWithRemovals);
      expect(warning.days).toEqual(['Press Day']);
      expect(warning.exercises).toEqual([removedExercise.name]);

      // An edit that removes nothing has nothing to confirm.
      expect(await editRemovalWarning(executor, 1, base)).toEqual({
        days: [],
        exercises: [],
      });
    },
  );

  it('keeps the SessionExercises CHECK valid across a load-source switch', async () => {
    const { db, executor } = connect();
    const base = await demoRoutineDraft(executor);

    const bench = base.sessions
      .find((s) => s.name === 'Bench Day')
      ?.exercises.find((e) => e.name === 'Barbell Bench Press - Medium Grip');
    if (bench === undefined) {
      throw new Error('Fixture missing bench press');
    }
    const pulldownSession = base.sessions.find((s) =>
      s.exercises.some((e) => e.name === 'Wide-Grip Lat Pulldown'),
    );
    if (pulldownSession === undefined) {
      throw new Error('Fixture missing the lat pulldown session');
    }

    await saveRoutineEdit(executor, 1, {
      ...base,
      sessions: base.sessions.map((s) =>
        s.name === 'Bench Day'
          ? {
              ...s,
              exercises: s.exercises.map((e) =>
                e.name === bench.name ? { ...e, loadSource: 'bodyweight' } : e,
              ),
            }
          : s.name === pulldownSession.name
            ? {
                ...s,
                exercises: s.exercises.map((e) =>
                  e.name === 'Wide-Grip Lat Pulldown'
                    ? {
                        ...e,
                        loadSource: 'training_max_pct',
                        trainingMaxPct: null,
                        trainingMaxWeight: 100,
                        absoluteWeight: null,
                      }
                    : e,
                ),
              }
            : s,
      ),
    });

    const rows = db
      .prepare(
        `SELECT e.exercise_name, e.load_source, e.training_max_pct,
                e.training_max_weight, e.absolute_weight
         FROM SessionExercises e JOIN Sessions s ON s.session_id = e.session_id
         WHERE s.routine_id = 1 AND e.exercise_name IN (?, ?);`,
      )
      .all(bench.name, 'Wide-Grip Lat Pulldown') as {
      exercise_name: string;
      load_source: string;
      training_max_pct: number | null;
      training_max_weight: number | null;
      absolute_weight: number | null;
    }[];

    const bodyweight = rows.find((row) => row.exercise_name === bench.name);
    expect(bodyweight).toMatchObject({
      load_source: 'bodyweight',
      training_max_pct: null,
      training_max_weight: null,
      absolute_weight: null,
    });
    const trainingMax = rows.find((row) => row.exercise_name === 'Wide-Grip Lat Pulldown');
    expect(trainingMax).toMatchObject({
      load_source: 'training_max_pct',
      training_max_pct: 0.9,
      training_max_weight: 100,
      absolute_weight: null,
    });

    const invalid = db
      .prepare(
        `SELECT COUNT(*) AS n FROM SessionExercises
         WHERE (load_source = 'training_max_pct' AND training_max_pct IS NULL)
            OR (load_source = 'absolute' AND (training_max_pct IS NOT NULL OR training_max_weight IS NOT NULL))
            OR (load_source = 'bodyweight' AND (absolute_weight IS NOT NULL OR training_max_pct IS NOT NULL OR training_max_weight IS NOT NULL));`,
      )
      .get() as { n: number };
    expect(invalid.n).toBe(0);
  });

  it('swapping an exercise to a custom row clears the catalog id but keeps the name snapshot', async () => {
    const { db, executor } = connect();
    const base = await demoRoutineDraft(executor);

    await saveRoutineEdit(executor, 1, {
      ...base,
      sessions: base.sessions.map((s) =>
        s.name === 'Squat Day'
          ? {
              ...s,
              exercises: s.exercises.map((e) =>
                e.name === 'Barbell Full Squat'
                  ? { ...e, catalogExerciseId: null, name: 'My Squat' }
                  : e,
              ),
            }
          : s,
      ),
    });

    const row = db
      .prepare(
        `SELECT e.catalog_exercise_id, e.exercise_name FROM SessionExercises e
         JOIN Sessions s ON s.session_id = e.session_id
         WHERE s.routine_id = 1 AND s.name = 'Squat Day';`,
      )
      .all() as { catalog_exercise_id: string | null; exercise_name: string }[];
    expect(row).toContainEqual({
      catalog_exercise_id: null,
      exercise_name: 'My Squat',
    });
    const squatCount = row.filter((r) => r.exercise_name === 'My Squat').length;
    expect(squatCount).toBe(1);
  });

  it('keeps WeekSessions and Progression_Proposal intact across a mid-cycle edit', async () => {
    const { db, executor } = connect();
    const base = await demoRoutineDraft(executor);

    const weekSessionIdsBefore = (db
      .prepare('SELECT week_session_id FROM WeekSessions ORDER BY week_session_id;')
      .all() as { week_session_id: number }[]).map((row) => row.week_session_id);
    expect(weekSessionIdsBefore.length).toBeGreaterThan(0);
    const proposalsBefore = count(db, 'Progression_Proposal');
    expect(proposalsBefore).toBeGreaterThan(0);
    const historyBefore = {
      workoutLog: count(db, 'Workout_Log'),
      logged: count(db, 'Logged_Exercises'),
      weight: count(db, 'Weight_Log'),
    };

    const squat = base.sessions
      .find((s) => s.name === 'Squat Day')
      ?.exercises.find((e) => e.name === 'Barbell Full Squat');
    if (squat === undefined) {
      throw new Error('Fixture missing barbell full squat');
    }

    await saveRoutineEdit(executor, 1, {
      ...base,
      name: 'Renamed Mid-Cycle',
      sessions: base.sessions.map((s) =>
        s.name === 'Squat Day'
          ? {
              ...s,
              weekday: 3,
              exercises: s.exercises.map((e) =>
                e.name === squat.name ? { ...e, targetReps: 6 } : e,
              ),
            }
          : s,
      ),
    });

    const weekSessionIdsAfter = (db
      .prepare('SELECT week_session_id FROM WeekSessions ORDER BY week_session_id;')
      .all() as { week_session_id: number }[]).map((row) => row.week_session_id);
    expect(weekSessionIdsAfter).toEqual(weekSessionIdsBefore);
    expect(count(db, 'Progression_Proposal')).toBe(proposalsBefore);
    const danglingProposals = (db
      .prepare(
        `SELECT COUNT(*) AS n FROM Progression_Proposal p
         LEFT JOIN SessionExercises e ON e.session_exercise_id = p.session_exercise_id
         WHERE e.session_exercise_id IS NULL;`,
      )
      .get() as { n: number }).n;
    expect(danglingProposals).toBe(0);
    expect(count(db, 'Workout_Log')).toBe(historyBefore.workoutLog);
    expect(count(db, 'Logged_Exercises')).toBe(historyBefore.logged);
    expect(count(db, 'Weight_Log')).toBe(historyBefore.weight);

    const routine = db
      .prepare('SELECT name FROM Routines WHERE routine_id = 1;')
      .get() as { name: string };
    expect(routine.name).toBe('Renamed Mid-Cycle');

    const moved = db
      .prepare(
        `SELECT weekday FROM Sessions WHERE routine_id = 1 AND name = 'Squat Day';`,
      )
      .get() as { weekday: number };
    expect(moved.weekday).toBe(3);

    const squatReps = db
      .prepare(
        `SELECT e.target_reps FROM SessionExercises e
         JOIN Sessions s ON s.session_id = e.session_id
         WHERE s.routine_id = 1 AND e.exercise_name = 'Barbell Full Squat';`,
      )
      .get() as { target_reps: number };
    expect(squatReps.target_reps).toBe(6);
  });

  it('inserts a new day without touching the existing week session bookkeeping', async () => {
    const { db, executor } = connect();
    const base = await demoRoutineDraft(executor);

    const weekSessionIdsBefore = (db
      .prepare('SELECT week_session_id FROM WeekSessions ORDER BY week_session_id;')
      .all() as { week_session_id: number }[]).map((row) => row.week_session_id);
    const sessionsBefore = count(db, 'Sessions');
    const proposalsBefore = count(db, 'Progression_Proposal');

    await saveRoutineEdit(executor, 1, {
      ...base,
      sessions: [
        ...base.sessions,
        {
          sessionId: null,
          weekday: 6,
          name: 'Pullday',
          exercises: [
            {
              exerciseId: null,
              catalogExerciseId: null,
              name: 'Pull-Up',
              role: 'accessory',
              targetSets: 3,
              targetReps: 10,
              loadSource: 'bodyweight',
              trainingMaxPct: null,
              trainingMaxWeight: null,
              absoluteWeight: null,
              unitOverride: null,
              isAmrap: false,
            },
          ],
        },
      ],
    });

    expect(count(db, 'Sessions')).toBe(sessionsBefore + 1);
    const weekSessionIdsAfter = (db
      .prepare('SELECT week_session_id FROM WeekSessions ORDER BY week_session_id;')
      .all() as { week_session_id: number }[]).map((row) => row.week_session_id);
    expect(weekSessionIdsAfter).toEqual(weekSessionIdsBefore);
    expect(count(db, 'Progression_Proposal')).toBe(proposalsBefore);

    const newSession = db
      .prepare(
        `SELECT s.session_id, s.weekday, e.exercise_name
         FROM Sessions s JOIN SessionExercises e ON e.session_id = s.session_id
         WHERE s.routine_id = 1 AND s.weekday = 6;`,
      )
      .get() as { session_id: number; weekday: number; exercise_name: string };
    expect(newSession).toMatchObject({
      weekday: 6,
      exercise_name: 'Pull-Up',
    });
    const newWeekSessions = (db
      .prepare('SELECT COUNT(*) AS n FROM WeekSessions WHERE session_id = ?;')
      .get(newSession.session_id) as { n: number }).n;
    expect(newWeekSessions).toBe(0);
  });

  it('removing a day deletes only its own rows and its own bookkeeping', async () => {
    const { db, executor } = connect();
    const base = await demoRoutineDraft(executor);

    const weekSessionIdsBefore = (db
      .prepare('SELECT week_session_id FROM WeekSessions ORDER BY week_session_id;')
      .all() as { week_session_id: number }[]).map((row) => row.week_session_id);
    const deadliftWeekSessionIds = (db
      .prepare(
        `SELECT ws.week_session_id FROM WeekSessions ws
         JOIN Sessions s ON s.session_id = ws.session_id
         WHERE s.routine_id = 1 AND s.name = 'Deadlift Day';`,
      )
      .all() as { week_session_id: number }[]).map((row) => row.week_session_id);
    const sessionsBefore = count(db, 'Sessions');
    const proposalsBefore = count(db, 'Progression_Proposal');

    await saveRoutineEdit(executor, 1, {
      ...base,
      sessions: base.sessions.filter((s) => s.name !== 'Deadlift Day'),
    });

    expect(count(db, 'Sessions')).toBe(sessionsBefore - 1);
    const weekSessionIdsAfter = (db
      .prepare('SELECT week_session_id FROM WeekSessions ORDER BY week_session_id;')
      .all() as { week_session_id: number }[]).map((row) => row.week_session_id);
    expect(weekSessionIdsAfter).toEqual(
      weekSessionIdsBefore.filter((id) => !deadliftWeekSessionIds.includes(id)),
    );
    // The deadlift carries one resolved TM review row per complete cycle.
    expect(count(db, 'Progression_Proposal')).toBe(proposalsBefore - 5);
    const deadliftProposal = (db
      .prepare(
        `SELECT COUNT(*) AS n FROM Progression_Proposal p
         JOIN SessionExercises e ON e.session_exercise_id = p.session_exercise_id
         JOIN Sessions s ON s.session_id = e.session_id
         WHERE s.name = 'Deadlift Day';`,
      )
      .get() as { n: number }).n;
    expect(deadliftProposal).toBe(0);
  });

  it('a stale draft referencing a deleted session throws and changes nothing', async () => {
    const { db, executor } = connect();
    const base = await demoRoutineDraft(executor);

    const planBefore = {
      sessions: count(db, 'Sessions'),
      weekSessions: count(db, 'WeekSessions'),
      proposals: count(db, 'Progression_Proposal'),
    };

    await expect(
      saveRoutineEdit(executor, 1, {
        ...base,
        sessions: [
          { ...base.sessions[0], sessionId: 99999 },
          ...base.sessions.slice(1),
        ],
      }),
    ).rejects.toThrow('Draft references unknown session 99999');

    expect(count(db, 'Sessions')).toBe(planBefore.sessions);
    expect(count(db, 'WeekSessions')).toBe(planBefore.weekSessions);
    expect(count(db, 'Progression_Proposal')).toBe(planBefore.proposals);
    const routine = db
      .prepare('SELECT name FROM Routines WHERE routine_id = 1;')
      .get() as { name: string };
    expect(routine.name).toBe('Demo Routine');
  });

  it('a draft repeating a source id throws and changes nothing', async () => {
    const { db, executor } = connect();
    const base = await demoRoutineDraft(executor);

    const planBefore = {
      sessions: count(db, 'Sessions'),
      weekSessions: count(db, 'WeekSessions'),
      proposals: count(db, 'Progression_Proposal'),
    };
    const squatDay = base.sessions.find((s) => s.name === 'Squat Day');
    if (squatDay === undefined) {
      throw new Error('Fixture missing Squat Day');
    }
    const duplicated = {
      ...squatDay,
      weekday: squatDay.weekday + 1,
      exercises: [
        squatDay.exercises[0],
        { ...squatDay.exercises[0], name: 'Duplicated Squat' },
      ],
    };

    await expect(
      saveRoutineEdit(executor, 1, {
        ...base,
        sessions: [squatDay, duplicated],
      }),
    ).rejects.toThrow(`Draft repeats session id ${squatDay.sessionId}`);

    expect(count(db, 'Sessions')).toBe(planBefore.sessions);
    expect(count(db, 'WeekSessions')).toBe(planBefore.weekSessions);
    expect(count(db, 'Progression_Proposal')).toBe(planBefore.proposals);
  });
});

describe('R3 — the per-exercise warm-up answer survives an edit (§3.6)', () => {
  it('stores on, off and "never said" distinctly, and never rewrites history', async () => {
    const { db, executor } = connect();
    const base = await demoRoutineDraft(executor);
    const historyBefore = count(db, 'Weight_Log');

    const [first, ...rest] = base.sessions;
    const [main, second, ...others] = first.exercises;
    await saveRoutineEdit(executor, 1, {
      ...base,
      sessions: [
        {
          ...first,
          exercises: [
            { ...main, warmupsEnabled: false },
            { ...second, warmupsEnabled: true },
            ...others,
          ],
        },
        ...rest,
      ],
    });

    const reloaded = await loadRoutineSourceById(executor, 1);
    const stored = (name: string): boolean | null => {
      const exercise = reloaded.exercises.find((row) => row.name === name);
      if (exercise === undefined) {
        throw new Error(`Missing exercise ${name}`);
      }
      return exercise.warmupsEnabled;
    };
    expect(stored(main.name)).toBe(false);
    expect(stored(second.name)).toBe(true);
    expect(stored(others[0].name)).toBeNull();
    expect(count(db, 'Weight_Log')).toBe(historyBefore);
  });
});

describe('F8 — "Desde cero" does not persist a draft until saved', () => {
  it('discarding an unsaved draft leaves no Routines row at all', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    // The screen builds this draft entirely in memory (blankRoutineDraft) and
    // never calls createBlankRoutine unless/until the user actually saves.
    // Simulating "the user backed out" is simply: never call it.
    blankRoutineDraft('My Routine', 'kg');

    expect(count(db, 'Routines')).toBe(0);
    expect(count(db, 'Sessions')).toBe(0);
    expect(count(db, 'SessionExercises')).toBe(0);
  });

  it('the first explicit save creates exactly one Routines row and its plan', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    const draft = blankRoutineDraft('My Routine', 'kg');
    const routineId = await createBlankRoutine(executor, draft);
    expect(count(db, 'Routines')).toBe(1);

    await saveRoutineEdit(executor, routineId, {
      name: draft.name,
      unit: draft.unit,
      roundingIncrement: draft.roundingIncrement,
      restMainSeconds: draft.restMainSeconds,
      restAccessorySeconds: draft.restAccessorySeconds,
      sessions: [
        {
          sessionId: null,
          weekday: 1,
          name: 'Upper',
          exercises: [
            {
              exerciseId: null,
              catalogExerciseId: null,
              name: 'My custom lift',
              role: 'main',
              targetSets: 3,
              targetReps: 10,
              loadSource: 'absolute',
              trainingMaxPct: null,
              trainingMaxWeight: null,
              absoluteWeight: 60,
              unitOverride: null,
              isAmrap: false,
            },
          ],
        },
      ],
    });

    expect(count(db, 'Routines')).toBe(1);
    expect(count(db, 'Sessions')).toBe(1);
    expect(count(db, 'SessionExercises')).toBe(1);
    const reloaded = await loadRoutineSourceById(executor, routineId);
    expect(reloaded.routine.name).toBe('My Routine');
    expect(reloaded.sessions[0]?.name).toBe('Upper');
    expect(reloaded.exercises[0]?.name).toBe('My custom lift');
  });
});
