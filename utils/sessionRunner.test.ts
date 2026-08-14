import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import { loadDemoData } from './demoData';
import {
  belowTarget,
  buildLogRows,
  loadRunnerSession,
  runnerTargetWeight,
  saveSessionLog,
  sessionTotals,
  warmupSetsFor,
  type RunnerDraft,
  type RunnerSession,
} from './sessionRunner';
import type { RoutineDatabase } from './routineActions';

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

const TODAY = Math.floor(Date.UTC(2026, 7, 14, 12, 0, 0) / 1000);

const fixture = async (executor: TestExecutor): Promise<RunnerSession> => {
  await runSchema(executor);
  await loadDemoData(executor);
  const row = await executor.get(
    `SELECT ws.week_session_id FROM WeekSessions ws
     JOIN Sessions s ON s.session_id = ws.session_id
     JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
     JOIN Cycles c ON c.cycle_id = cw.cycle_id
     WHERE s.name = 'Squat Day' AND ws.status = 'pending'
     ORDER BY ws.week_session_id LIMIT 1;`,
    [],
  );
  if (!row) {
    throw new Error('Fixture has no pending Squat Day week session');
  }
  return loadRunnerSession(executor, Number(row.week_session_id), TODAY);
};

const planned = (session: RunnerSession): RunnerDraft =>
  session.exercises.map((exercise) =>
    Array.from({ length: exercise.targetSets }, () => ({
      reps: exercise.targetReps,
      weight: runnerTargetWeight(exercise, session.roundingIncrement),
    })),
  );

const squat = (session: RunnerSession): RunnerSession['exercises'][number] => {
  const exercise = session.exercises.find((e) => e.name === 'Barbell Full Squat');
  if (exercise === undefined) {
    throw new Error('Fixture missing Barbell Full Squat');
  }
  return exercise;
};

const row = (session: RunnerSession): RunnerSession['exercises'][number] => {
  const exercise = session.exercises.find(
    (e) => e.name === 'Bent Over Two-Dumbbell Row',
  );
  if (exercise === undefined) {
    throw new Error('Fixture missing Bent Over Two-Dumbbell Row');
  }
  return exercise;
};

describe('warmupSetsFor — the ramp is a UI affordance, never a work set', () => {
  it('derives the standard 40/50/60 x 5/5/3 ramp from the first work set, rounded', async () => {
    const { executor } = connect();
    const session = await fixture(executor);
    const warmups = warmupSetsFor(squat(session), session);
    expect(warmups).toEqual([
      { weight: 40, reps: 5 },
      { weight: 52.5, reps: 5 },
      { weight: 62.5, reps: 3 },
    ]);
  });

  it('returns no warm-ups for a bodyweight exercise', async () => {
    const { executor } = connect();
    const session = await fixture(executor);
    const bodyweight = {
      ...squat(session),
      loadSource: 'bodyweight' as const,
      absoluteWeight: null,
      trainingMaxWeight: null,
      trainingMaxPct: null,
    };
    expect(warmupSetsFor(bodyweight, session)).toEqual([]);
  });
});

describe('belowTarget — the soft inline note', () => {
  it('counts missing reps and missing weight separately', async () => {
    const { executor } = connect();
    const session = await fixture(executor);
    const exercise = squat(session);
    expect(belowTarget(exercise, { reps: 3, weight: 100 }, session.roundingIncrement)).toEqual({
      repsShort: 2,
      weightShort: 2.5,
    });
    expect(belowTarget(exercise, { reps: 5, weight: 102.5 }, session.roundingIncrement)).toEqual({
      repsShort: 0,
      weightShort: null,
    });
    expect(belowTarget(exercise, { reps: 6, weight: 102.5 }, session.roundingIncrement)).toEqual({
      repsShort: 0,
      weightShort: null,
    });
  });

  it('never flags weight for a bodyweight exercise', async () => {
    const { executor } = connect();
    const session = await fixture(executor);
    const bodyweight = {
      ...squat(session),
      loadSource: 'bodyweight' as const,
      absoluteWeight: null,
      trainingMaxWeight: null,
      trainingMaxPct: null,
    };
    expect(belowTarget(bodyweight, { reps: 2, weight: null }, session.roundingIncrement)).toEqual({
      repsShort: 3,
      weightShort: null,
    });
  });
});

describe('buildLogRows — the §3.2 history rows', () => {
  it('copies the plan at log time and writes one Weight_Log row per planned set', async () => {
    const { executor } = connect();
    const session = await fixture(executor);
    const draft = planned(session);

    const rows = buildLogRows(session, draft);

    expect(rows.workoutLog).toEqual({
      workoutName: 'Demo Routine',
      dayName: 'Squat Day',
      workoutDate: TODAY,
    });
    expect(rows.loggedExercises).toEqual([
      { exerciseName: 'Barbell Full Squat', sets: 3, reps: 5 },
      { exerciseName: 'Bent Over Two-Dumbbell Row', sets: 3, reps: 10 },
    ]);
    expect(rows.weightLog).toHaveLength(6);
    const squatSets = rows.weightLog.filter((s) => s.loggedExerciseIndex === 0);
    expect(squatSets.map((s) => s.setNumber)).toEqual([1, 2, 3]);
    expect(squatSets.map((s) => s.weight)).toEqual([102.5, 102.5, 102.5]);
    expect(squatSets.every((s) => s.unit === 'kg')).toBe(true);
    const rowSets = rows.weightLog.filter((s) => s.loggedExerciseIndex === 1);
    expect(rowSets.map((s) => s.setNumber)).toEqual([1, 2, 3]);
  });

  it('produces no rows at all for an exercise with no logged set', async () => {
    const { executor } = connect();
    const session = await fixture(executor);
    const draft = planned(session);
    draft[1] = [null, null, null];

    const rows = buildLogRows(session, draft);

    expect(rows.loggedExercises).toHaveLength(1);
    expect(rows.loggedExercises[0].exerciseName).toBe('Barbell Full Squat');
    expect(rows.weightLog.every((s) => s.loggedExerciseIndex === 0)).toBe(true);
    expect(rows.weightLog).toHaveLength(3);
  });

  it('sequences only completed work sets, so a skipped middle set leaves a gapless 1..N', async () => {
    const { executor } = connect();
    const session = await fixture(executor);
    const draft: RunnerDraft = [[null, null, null], [null, null, null]];
    draft[0][0] = { reps: 5, weight: 100 };
    draft[0][2] = { reps: 3, weight: 100 };

    const rows = buildLogRows(session, draft);

    expect(rows.loggedExercises).toHaveLength(1);
    expect(rows.weightLog.map((s) => s.setNumber)).toEqual([1, 2]);
    expect(rows.weightLog.map((s) => s.reps)).toEqual([5, 3]);
  });

  it('never writes a warm-up weight — only work-set weights reach Weight_Log', async () => {
    const { executor } = connect();
    const session = await fixture(executor);
    const warmups = warmupSetsFor(squat(session), session);

    const rows = buildLogRows(session, planned(session));

    const weights = rows.weightLog.map((s) => s.weight);
    expect(weights).not.toContain(warmups[0].weight);
    expect(weights).not.toContain(warmups[1].weight);
    expect(weights).not.toContain(warmups[2].weight);
    expect(rows.weightLog).toHaveLength(6);
  });

  it('records the AMRAP reps the user entered while Logged_Exercises keeps the plan copy', async () => {
    const { executor } = connect();
    const session = await fixture(executor);
    const draft = planned(session);
    const amrapSet = draft[0][2];
    if (amrapSet === null) {
      throw new Error('Fixture draft missing the AMRAP set');
    }
    draft[0][2] = { ...amrapSet, reps: 8 };

    const rows = buildLogRows(session, draft);

    const amrapRow = rows.weightLog.filter(
      (s) => s.loggedExerciseIndex === 0 && s.setNumber === 3,
    )[0];
    expect(amrapRow.reps).toBe(8);
    const squatLog = rows.loggedExercises.find(
      (e) => e.exerciseName === 'Barbell Full Squat',
    );
    expect(squatLog).toEqual({ exerciseName: 'Barbell Full Squat', sets: 3, reps: 5 });
  });

  it('keeps edited reps and weight, and uses the exercise unit override', async () => {
    const { executor } = connect();
    const session = await fixture(executor);
    const edited = { ...row(session), unitOverride: 'lb' as const };
    const sessionWithOverride: RunnerSession = {
      ...session,
      exercises: session.exercises.map((e) => (e.name === edited.name ? edited : e)),
    };
    const draft = planned(sessionWithOverride);
    const editedSet = draft[1][1];
    if (editedSet === null) {
      throw new Error('Fixture draft missing the row set');
    }
    draft[1][1] = { reps: 9, weight: 20 };

    const rows = buildLogRows(sessionWithOverride, draft);

    const rowSets = rows.weightLog.filter((s) => s.loggedExerciseIndex === 1);
    expect(rowSets.map((s) => s.reps)).toEqual([10, 9, 10]);
    expect(rowSets.map((s) => s.unit)).toEqual(['lb', 'lb', 'lb']);
    expect(rows.loggedExercises[1].reps).toBe(10);
  });

  it('links sets to their Logged_Exercises row by index, even for duplicate names', async () => {
    const { executor } = connect();
    const session = await fixture(executor);
    const twin = { ...row(session), name: 'Barbell Full Squat' };
    const sessionWithTwin: RunnerSession = {
      ...session,
      exercises: [squat(session), twin],
    };
    const draft = planned(sessionWithTwin);

    const rows = buildLogRows(sessionWithTwin, draft);

    expect(rows.loggedExercises).toEqual([
      { exerciseName: 'Barbell Full Squat', sets: 3, reps: 5 },
      { exerciseName: 'Barbell Full Squat', sets: 3, reps: 10 },
    ]);
    const first = rows.weightLog.filter((s) => s.loggedExerciseIndex === 0);
    const second = rows.weightLog.filter((s) => s.loggedExerciseIndex === 1);
    expect(first.map((s) => s.setNumber)).toEqual([1, 2, 3]);
    expect(second.map((s) => s.setNumber)).toEqual([1, 2, 3]);
    expect(first[0].unit).toBe('kg');
    expect(second[0].unit).toBe('kg');
  });
});

describe('sessionTotals', () => {
  it('counts logged and total sets and the exercises that have any log', async () => {
    const { executor } = connect();
    const session = await fixture(executor);
    const draft: RunnerDraft = [[null, null, null], [null, null, null]];
    draft[0][0] = { reps: 5, weight: 100 };
    draft[0][1] = { reps: 5, weight: 100 };
    draft[1][0] = { reps: 10, weight: 20 };

    expect(sessionTotals(session, draft)).toEqual({
      loggedSets: 3,
      totalSets: 6,
      loggedExercises: 2,
    });
  });
});

describe('loadRunnerSession', () => {
  it('loads the plan, routine context and resolved log date in exercise order', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(executor);
    const moved = await executor.get(
      `SELECT ws.week_session_id FROM WeekSessions ws
       JOIN Sessions s ON s.session_id = ws.session_id
       JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
       JOIN Cycles c ON c.cycle_id = cw.cycle_id
       WHERE s.name = 'Squat Day' AND ws.status = 'pending'
       ORDER BY ws.week_session_id LIMIT 1;`,
      [],
    );
    if (!moved) {
      throw new Error('Fixture has no pending Squat Day week session');
    }
    const weekSessionId = Number(moved.week_session_id);
    const resolved = Math.floor(Date.UTC(2026, 7, 10, 12, 0, 0) / 1000);
    db.prepare('UPDATE WeekSessions SET resolved_on_date = ? WHERE week_session_id = ?;')
      .run(resolved, weekSessionId);

    const session = await loadRunnerSession(executor, weekSessionId, TODAY);

    expect(session.workoutName).toBe('Demo Routine');
    expect(session.sessionName).toBe('Squat Day');
    expect(session.workoutDate).toBe(resolved);
    expect(session.unit).toBe('kg');
    expect(session.roundingIncrement).toBe(2.5);
    expect(session.restMainSeconds).toBe(180);
    expect(session.restAccessorySeconds).toBe(90);
    expect(session.exercises.map((e) => e.name)).toEqual([
      'Barbell Full Squat',
      'Bent Over Two-Dumbbell Row',
    ]);
    expect(session.exercises[0].isAmrap).toBe(true);
    expect(session.exercises[0].role).toBe('main');
    expect(session.exercises[1].role).toBe('accessory');
  });

  it('refuses a session that is not pending', async () => {
    const { executor } = connect();
    await runSchema(executor);
    await loadDemoData(executor);
    const completed = await executor.get(
      `SELECT ws.week_session_id FROM WeekSessions ws
       JOIN Sessions s ON s.session_id = ws.session_id
       WHERE s.name = 'Squat Day' AND ws.status = 'completed'
       ORDER BY ws.week_session_id LIMIT 1;`,
      [],
    );
    if (!completed) {
      throw new Error('Fixture has no completed Squat Day week session');
    }
    await expect(loadRunnerSession(executor, Number(completed.week_session_id), TODAY)).rejects.toThrow(
      'is not pending',
    );
  });
});

describe('saveSessionLog — one atomic transaction', () => {
  it('writes the history rows and completes the week session with the log id', async () => {
    const { db, executor } = connect();
    const session = await fixture(executor);
    const historyBefore = {
      workoutLog: count(db, 'Workout_Log'),
      logged: count(db, 'Logged_Exercises'),
      weight: count(db, 'Weight_Log'),
    };

    const saved = await saveSessionLog(executor, session.weekSessionId, session, planned(session));

    expect(saved).toEqual({ workoutLogId: expect.any(Number), loggedSets: 6, loggedExercises: 2 });
    expect(count(db, 'Workout_Log')).toBe(historyBefore.workoutLog + 1);
    expect(count(db, 'Logged_Exercises')).toBe(historyBefore.logged + 2);
    expect(count(db, 'Weight_Log')).toBe(historyBefore.weight + 6);

    const weekSession = db
      .prepare(
        'SELECT status, resolved_on_date, completed_log_id FROM WeekSessions WHERE week_session_id = ?;',
      )
      .get(session.weekSessionId) as {
      status: string;
      resolved_on_date: number;
      completed_log_id: number;
    };
    expect(weekSession.status).toBe('completed');
    expect(weekSession.resolved_on_date).toBe(TODAY);
    expect(weekSession.completed_log_id).toBe(saved.workoutLogId);

    const log = db
      .prepare('SELECT * FROM Workout_Log WHERE workout_log_id = ?;')
      .get(saved.workoutLogId) as Record<string, unknown>;
    expect(log.workout_name).toBe('Demo Routine');
    expect(log.day_name).toBe('Squat Day');
    expect(log.workout_date).toBe(TODAY);
  });

  it('an abandoned session writes nothing and stays pending', async () => {
    const { db, executor } = connect();
    const session = await fixture(executor);
    const before = {
      workoutLog: count(db, 'Workout_Log'),
      logged: count(db, 'Logged_Exercises'),
      weight: count(db, 'Weight_Log'),
    };
    const empty: RunnerDraft = session.exercises.map(() =>
      Array.from({ length: 0 }, () => null),
    );

    expect(buildLogRows(session, empty).weightLog).toHaveLength(0);
    expect(buildLogRows(session, empty).loggedExercises).toHaveLength(0);
    await expect(saveSessionLog(executor, session.weekSessionId, session, empty)).rejects.toThrow(
      'nothing logged',
    );

    expect(count(db, 'Workout_Log')).toBe(before.workoutLog);
    expect(count(db, 'Logged_Exercises')).toBe(before.logged);
    expect(count(db, 'Weight_Log')).toBe(before.weight);
    const weekSession = db
      .prepare('SELECT status FROM WeekSessions WHERE week_session_id = ?;')
      .get(session.weekSessionId) as { status: string };
    expect(weekSession.status).toBe('pending');
  });

  it('refuses to log a session that is no longer pending', async () => {
    const { db, executor } = connect();
    const session = await fixture(executor);
    await saveSessionLog(executor, session.weekSessionId, session, planned(session));
    const before = count(db, 'Workout_Log');

    await expect(
      saveSessionLog(executor, session.weekSessionId, session, planned(session)),
    ).rejects.toThrow();

    expect(count(db, 'Workout_Log')).toBe(before);
  });

  it('rolls back the whole write when any statement fails', async () => {
    const { db, executor } = connect();
    const session = await fixture(executor);
    const historyBefore = {
      workoutLog: count(db, 'Workout_Log'),
      logged: count(db, 'Logged_Exercises'),
      weight: count(db, 'Weight_Log'),
    };
    const failing: TestExecutor = {
      ...executor,
      run: async (sql, params) => {
        if (sql.includes('UPDATE WeekSessions')) {
          throw new Error('boom');
        }
        return executor.run(sql, params);
      },
    };

    await expect(
      saveSessionLog(failing, session.weekSessionId, session, planned(session)),
    ).rejects.toThrow('boom');

    expect(count(db, 'Workout_Log')).toBe(historyBefore.workoutLog);
    expect(count(db, 'Logged_Exercises')).toBe(historyBefore.logged);
    expect(count(db, 'Weight_Log')).toBe(historyBefore.weight);
    const weekSession = db
      .prepare('SELECT status FROM WeekSessions WHERE week_session_id = ?;')
      .get(session.weekSessionId) as { status: string };
    expect(weekSession.status).toBe('pending');
  });
});
