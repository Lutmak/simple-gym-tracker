import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import { loadDemoData } from './demoData';
import { buildExerciseSeries } from './exerciseHistory';
import { buildFreeRunnerExercise } from './freeLogging';
import {
  belowTarget,
  buildPlannedDraft,
  buildLogRows,
  formatRunnerPlanLine,
  loadRunnerSession,
  nextExtraSet,
  runnerTargetsFor,
  saveRunnerBarProfile,
  saveSessionLog,
  sessionTotals,
  warmupSetsFor,
  type RunnerDraft,
  type RunnerSession,
} from './sessionRunner';
import {
  estimateTrainingMax,
  warmupRampFor,
  writeWaveRoutine,
  type WaveDayDraft,
  type WaveSetupDraft,
} from './waveSetup';
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
     WHERE s.name = 'Squat Day' AND ws.status = 'completed'
     ORDER BY ws.week_session_id DESC LIMIT 1;`,
    [],
  );
  if (!row) {
    throw new Error('Fixture has no completed Squat Day week session');
  }
  // The demo leaves exactly one pending session (Friday's press); the runner
  // fixture re-opens the latest squat day as pending.
  await executor.run(
    `UPDATE WeekSessions SET status = 'pending', resolved_on_date = NULL, completed_log_id = NULL
     WHERE week_session_id = ?;`,
    [Number(row.week_session_id)],
  );
  return loadRunnerSession(executor, Number(row.week_session_id), TODAY);
};

const planned = (session: RunnerSession): RunnerDraft => buildPlannedDraft(session);

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
  it(
    'derives the standard 40/50/60 x 5/5/3 ramp from the TRAINING MAX itself (F6) — ' +
      'never the week\'s own first work set, which is a different number every week',
    async () => {
      const { executor } = connect();
      const session = await fixture(executor);
      // The fixture's squat has a 120 kg training max; 40/50/60% of THAT —
      // not of whatever this week's (here, the deload week's) first work
      // set happens to be — is 48/60/72, rounded to the 2.5 kg increment.
      expect(squat(session).trainingMaxWeight).toBe(120);
      const warmups = warmupSetsFor(squat(session), session);
      expect(warmups).toEqual([
        { weight: 47.5, reps: 5 },
        { weight: 60, reps: 5 },
        { weight: 72.5, reps: 3 },
      ]);
    },
  );

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

  it(
    'produces the identical ramp the setup screen previews, in every week of the cycle (F6) — ' +
      'the ramp seen at setup is the ramp seen in the gym, unchanged by the week',
    async () => {
      const { executor } = connect();
      const session = await fixture(executor);
      const trainingMax = squat(session).trainingMaxWeight;
      if (trainingMax === null) {
        throw new Error('Fixture squat has no training max');
      }
      const previewDay: WaveDayDraft = {
        key: 'd1',
        weekday: 1,
        liftName: 'Squat',
        catalogExerciseId: null,
        category: 'lower',
        trainingMax,
        assistanceStartWeight: null,
        assistance: [],
      };
      const previewRamp = warmupRampFor(previewDay, session.unit, session.roundingIncrement, 'nearest');
      expect(previewRamp).not.toBeNull();
      const previewShape = previewRamp?.map((set) => ({ weight: set.weight, reps: set.reps }));

      for (let weekNumber = 1; weekNumber <= 4; weekNumber += 1) {
        const runnerRamp = warmupSetsFor(squat(session), { ...session, weekNumber });
        expect(runnerRamp).toEqual(previewShape);
      }
    },
  );
});

describe('runnerTargetsFor — the runner receives the cycle week', () => {
  const exercise: RunnerSession['exercises'][number] = {
    sessionExerciseId: 1,
    name: 'Squat',
    role: 'main',
    targetSets: 3,
    targetReps: 5,
    loadSource: 'training_max_pct',
    absoluteWeight: null,
    trainingMaxWeight: 100,
    trainingMaxPct: 0.9,
    unitOverride: null,
    isAmrap: true,
    barProfile: 'olympic',
    barWeight: null,
  };

  const sessionForWeek = (weekNumber: number): RunnerSession => ({
    weekSessionId: 1,
    sessionId: 1,
    sessionName: 'Squat Day',
    workoutName: 'Wave',
    workoutDate: TODAY,
    weekNumber,
    unit: 'kg',
    progressionRule: 'wave',
    roundingIncrement: 2.5,
    restMainSeconds: 180,
    restAccessorySeconds: 90,
    exercises: [exercise],
    mainLiftNames: [],
  });

  it.each([
    [1, [65, 75, 85], [5, 5, 5], [false, false, true]],
    [2, [70, 80, 90], [3, 3, 3], [false, false, true]],
    [3, [75, 85, 95], [5, 3, 1], [false, false, true]],
    [4, [40, 50, 60], [5, 5, 5], [false, false, false]],
  ] as const)('returns concrete week %i work targets', (week, weights, reps, amrap) => {
    expect(
      runnerTargetsFor(exercise, sessionForWeek(week)).map((set) => ({
        weight: set.targetWeight,
        reps: set.targetReps,
        isAmrap: set.isAmrap,
      })),
    ).toEqual(
      weights.map((weight, index) => ({
        weight,
        reps: reps[index],
        isAmrap: amrap[index],
      })),
    );
  });

  it('builds the as-planned draft with every work set already complete', () => {
    const draft = buildPlannedDraft(sessionForWeek(1));

    expect(draft).toEqual([
      [
        { reps: 5, weight: 65 },
        { reps: 5, weight: 75 },
        { reps: 5, weight: 85 },
      ],
    ]);
  });

  it('uses the existing joker seam for a wave extra set', () => {
    const session = sessionForWeek(1);
    const current = buildPlannedDraft(session)[0];

    expect(nextExtraSet(exercise, session, current)).toEqual({ reps: 5, weight: 87.5 });
  });
});

describe('formatRunnerPlanLine — compact header plan', () => {
  it('collapses identical reps and loads', () => {
    expect(
      formatRunnerPlanLine(
        [
          { targetReps: 10, targetWeight: 120, isAmrap: false },
          { targetReps: 10, targetWeight: 120, isAmrap: false },
          { targetReps: 10, targetWeight: 120, isAmrap: false },
        ],
        {
          role: 'Accesorio',
          setsOf: 'series de',
          maxReps: 'máximas reps',
          unit: 'lb',
          missingWeight: 'peso por aprender',
        },
      ),
    ).toBe('Accesorio · 3 series de 10 · 120 lb');
  });

  it('uses slash reps and a concrete range when wave targets differ', () => {
    expect(
      formatRunnerPlanLine(
        [
          { targetReps: 5, targetWeight: 75, isAmrap: false },
          { targetReps: 3, targetWeight: 85, isAmrap: false },
          { targetReps: 1, targetWeight: 95, isAmrap: true },
        ],
        {
          role: 'Principal',
          setsOf: 'series de',
          maxReps: 'máximas reps',
          unit: 'kg',
          missingWeight: 'peso por aprender',
        },
      ),
    ).toBe('Principal · 3 series de 5/3/máximas reps · 75-95 kg');
  });

  it('keeps the AMRAP meaning when all base reps are identical', () => {
    expect(
      formatRunnerPlanLine(
        [
          { targetReps: 5, targetWeight: 65, isAmrap: false },
          { targetReps: 5, targetWeight: 75, isAmrap: false },
          { targetReps: 5, targetWeight: 85, isAmrap: true },
        ],
        {
          role: 'Principal',
          setsOf: 'series de',
          maxReps: 'máximas reps',
          unit: 'kg',
          missingWeight: 'peso por aprender',
        },
      ),
    ).toBe('Principal · 3 series de 5 + máximas reps · 65-85 kg');
  });
});

describe('belowTarget — the soft inline note', () => {
  it('counts missing reps and missing weight separately', async () => {
    const { executor } = connect();
    const session = await fixture(executor);
    const exercise = squat(session);
    expect(belowTarget(exercise, { reps: 3, weight: 100 }, session.roundingIncrement)).toEqual({
      repsShort: 2,
      weightShort: 7.5,
    });
    expect(belowTarget(exercise, { reps: 5, weight: 107.5 }, session.roundingIncrement)).toEqual({
      repsShort: 0,
      weightShort: null,
    });
    expect(belowTarget(exercise, { reps: 6, weight: 107.5 }, session.roundingIncrement)).toEqual({
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

  it('uses the selected wave set target rather than the flat training-max percentage', async () => {
    const { executor } = connect();
    const session = await fixture(executor);

    expect(
      belowTarget(squat(session), { reps: 3, weight: 45 }, session.roundingIncrement, 4, 0),
    ).toEqual({ repsShort: 2, weightShort: 2.5 });
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
      { exerciseName: 'Barbell Full Squat', sets: 3, reps: 5, role: 'main' },
      { exerciseName: 'Bent Over Two-Dumbbell Row', sets: 3, reps: 10, role: 'accessory' },
      { exerciseName: 'Lying Leg Curls', sets: 3, reps: 10, role: 'accessory' },
      { exerciseName: 'Standing Calf Raises', sets: 3, reps: 12, role: 'accessory' },
    ]);
    expect(rows.weightLog).toHaveLength(12);
    const squatSets = rows.weightLog.filter((s) => s.loggedExerciseIndex === 0);
    expect(squatSets.map((s) => s.setNumber)).toEqual([1, 2, 3]);
    expect(squatSets.map((s) => s.weight)).toEqual([47.5, 60, 72.5]);
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

    expect(rows.loggedExercises).toHaveLength(3);
    expect(rows.loggedExercises[0].exerciseName).toBe('Barbell Full Squat');
    const squatSets = rows.weightLog.filter((s) => s.loggedExerciseIndex === 0);
    expect(squatSets).toHaveLength(3);
    expect(rows.weightLog).toHaveLength(9);
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
    const original = await fixture(executor);
    // Warm-ups are a flat 40/50/60% of the training max (F6), unchanged by
    // week; the fixture's own week happens to be the deload week, whose OWN
    // work sets are also 40/50/60% of the TM — the same numbers by pure
    // coincidence of that one week, not an overlap bug. Week 1's work sets
    // (65/75/85% of TM) keep the two clearly distinct, which is what this
    // test is actually about.
    const session: RunnerSession = { ...original, weekNumber: 1 };
    const warmups = warmupSetsFor(squat(session), session);

    const rows = buildLogRows(session, planned(session));

    const weights = rows.weightLog
      .filter((s) => s.loggedExerciseIndex === 0)
      .map((s) => s.weight);
    expect(weights).not.toContain(warmups[0].weight);
    expect(weights).not.toContain(warmups[1].weight);
    expect(weights).not.toContain(warmups[2].weight);
    expect(rows.weightLog).toHaveLength(12);
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
    expect(squatLog).toEqual({ exerciseName: 'Barbell Full Squat', sets: 3, reps: 5, role: 'main' });
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
      { exerciseName: 'Barbell Full Squat', sets: 3, reps: 5, role: 'main' },
      { exerciseName: 'Barbell Full Squat', sets: 3, reps: 10, role: 'accessory' },
    ]);
    const first = rows.weightLog.filter((s) => s.loggedExerciseIndex === 0);
    const second = rows.weightLog.filter((s) => s.loggedExerciseIndex === 1);
    expect(first.map((s) => s.setNumber)).toEqual([1, 2, 3]);
    expect(second.map((s) => s.setNumber)).toEqual([1, 2, 3]);
    expect(first[0].unit).toBe('kg');
    expect(second[0].unit).toBe('kg');
  });

  it('stores the per-set unit override on the row — an lb set inside a kg session stays lb', async () => {
    const { executor } = connect();
    const session = await fixture(executor);
    const draft = planned(session);
    const firstSquatSet = draft[0][0];
    if (firstSquatSet === null) {
      throw new Error('Fixture draft missing the squat set');
    }
    draft[0][0] = { ...firstSquatSet, weight: 225, unit: 'lb' };

    const rows = buildLogRows(session, draft);

    const squatSets = rows.weightLog.filter((s) => s.loggedExerciseIndex === 0);
    expect(squatSets.map((s) => s.unit)).toEqual(['lb', 'kg', 'kg']);
    expect(squatSets[0].weight).toBe(225);
    // The other sets and the other exercise keep the session unit.
    const rowSets = rows.weightLog.filter((s) => s.loggedExerciseIndex === 1);
    expect(rowSets.every((s) => s.unit === 'kg')).toBe(true);
  });

  it('carries extra sets (§3.4) through the log path — appended, sequenced, with their own unit', async () => {
    const { executor } = connect();
    const session = await fixture(executor);
    const draft = planned(session);
    draft[0].push({ reps: 3, weight: 105, unit: 'lb' }, { reps: 1, weight: 107.5 });

    const rows = buildLogRows(session, draft);

    const squatSets = rows.weightLog.filter((s) => s.loggedExerciseIndex === 0);
    expect(squatSets.map((s) => s.setNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(squatSets.map((s) => s.unit)).toEqual(['kg', 'kg', 'kg', 'lb', 'kg']);
    // The extras are ordinary history rows: volume counts them like any set.
    const historyRows = squatSets.map((s) => ({
      date: rows.workoutLog.workoutDate,
      setNumber: s.setNumber,
      weight: s.weight,
      reps: s.reps,
      unit: s.unit,
    }));
    const series = buildExerciseSeries(historyRows);
    expect(series.points[0].volume).toBe(47.5 * 5 + 60 * 5 + 72.5 * 5 + 105 * 3 + 107.5);
    expect(series.points[0].volume).toBeGreaterThan(47.5 * 5 + 60 * 5 + 72.5 * 5);
  });

  it('keeps an exercise added during a planned session in that session log', async () => {
    const { db, executor } = connect();
    const session = await fixture(executor);
    const added = buildFreeRunnerExercise(-1, 'Cable Chest Press', 'kg');
    const sessionWithAdded: RunnerSession = {
      ...session,
      exercises: [...session.exercises, added],
    };
    const draft = [...planned(session), [{ reps: 12, weight: 30 }]];

    const rows = buildLogRows(sessionWithAdded, draft);

    expect(rows.workoutLog).toEqual({
      workoutName: 'Demo Routine',
      dayName: 'Squat Day',
      workoutDate: TODAY,
    });
    expect(rows.loggedExercises.at(-1)).toEqual({
      exerciseName: 'Cable Chest Press',
      sets: 1,
      reps: 12,
      role: null,
    });
    expect(rows.weightLog.at(-1)).toMatchObject({
      loggedExerciseIndex: 4,
      setNumber: 1,
      weight: 30,
      reps: 12,
      unit: 'kg',
    });

    const saved = await saveSessionLog(
      executor,
      session.weekSessionId,
      sessionWithAdded,
      draft,
    );
    const addedRows = db
      .prepare(
        `SELECT le.exercise_name, le.sets, le.reps, wl.weight_logged, wl.reps_logged, wl.unit
         FROM Logged_Exercises le
         JOIN Weight_Log wl ON wl.logged_exercise_id = le.logged_exercise_id
         WHERE le.workout_log_id = ? AND le.exercise_name = ?;`,
      )
      .all(saved.workoutLogId, 'Cable Chest Press') as {
      exercise_name: string;
      sets: number;
      reps: number;
      weight_logged: number;
      reps_logged: number;
      unit: string;
    }[];
    expect(addedRows).toEqual([
      {
        exercise_name: 'Cable Chest Press',
        sets: 1,
        reps: 12,
        weight_logged: 30,
        reps_logged: 12,
        unit: 'kg',
      },
    ]);
  });

  it('writes the per-set timing columns from the draft (§3.9)', async () => {
    const { executor } = connect();
    const session = await fixture(executor);
    const draft = planned(session);
    const started = 1780000000000;
    const completed = 1780000035000;
    for (const exerciseSets of draft) {
      for (const set of exerciseSets) {
        if (set !== null) {
          set.startedAt = started;
          set.completedAt = completed;
        }
      }
    }

    const rows = buildLogRows(session, draft);

    expect(rows.weightLog[0]).toMatchObject({ startedAt: started, completedAt: completed });
    expect(rows.weightLog.every((s) => s.startedAt === started)).toBe(true);
    expect(rows.weightLog.every((s) => s.completedAt === completed)).toBe(true);
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
      totalSets: 12,
      loggedExercises: 2,
    });
  });
});

describe('loadRunnerSession', () => {
  it('loads the plan, routine context and resolved log date in exercise order', async () => {
    const { db, executor } = connect();
    const session = await fixture(executor);
    const resolved = Math.floor(Date.UTC(2026, 7, 10, 12, 0, 0) / 1000);
    db.prepare('UPDATE WeekSessions SET resolved_on_date = ? WHERE week_session_id = ?;')
      .run(resolved, session.weekSessionId);

    const loaded = await loadRunnerSession(executor, session.weekSessionId, TODAY);

    expect(loaded.workoutName).toBe('Demo Routine');
    expect(loaded.sessionName).toBe('Squat Day');
    expect(loaded.workoutDate).toBe(resolved);
    expect(loaded.weekNumber).toBe(4);
    expect(loaded.unit).toBe('kg');
    expect(loaded.roundingIncrement).toBe(2.5);
    expect(loaded.restMainSeconds).toBe(180);
    expect(loaded.restAccessorySeconds).toBe(90);
    expect(loaded.exercises.map((e) => e.name)).toEqual([
      'Barbell Full Squat',
      'Bent Over Two-Dumbbell Row',
      'Lying Leg Curls',
      'Standing Calf Raises',
    ]);
    expect(loaded.exercises[0].isAmrap).toBe(true);
    expect(loaded.exercises[0].role).toBe('main');
    expect(loaded.exercises[0].barProfile).toBe('olympic');
    expect(loaded.exercises[0].barWeight).toBeNull();
    expect(loaded.exercises[1].role).toBe('accessory');
    expect(loaded.exercises[1].barProfile).toBeNull();
  });

  it(
    "carries every main lift of the ROUTINE, not just today's session — U5's " +
      "mainLiftColours needs the routine-wide rank so the same lift keeps the same series " +
      'colour on every screen, and this session is Squat Day, which has only one main lift of its own',
    async () => {
      const { executor } = connect();
      const session = await fixture(executor);

      const loaded = await loadRunnerSession(executor, session.weekSessionId, TODAY);

      expect(loaded.mainLiftNames).toEqual([
        'Barbell Full Squat',
        'Barbell Bench Press - Medium Grip',
        'Barbell Deadlift',
        'Barbell Shoulder Press',
      ]);
    },
  );

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

  it('persists a changed bar profile for the exercise in future runner loads', async () => {
    const { executor } = connect();
    const session = await fixture(executor);
    const exercise = squat(session);

    await saveRunnerBarProfile(executor, exercise.sessionExerciseId, 'custom', 27.5);

    const loaded = await loadRunnerSession(executor, session.weekSessionId, TODAY);
    const persisted = loaded.exercises.find(
      (candidate) => candidate.sessionExerciseId === exercise.sessionExerciseId,
    );

    expect(persisted).toMatchObject({ barProfile: 'custom', barWeight: 27.5 });
  });

  it('does not persist a custom bar profile without a positive weight', async () => {
    const { executor } = connect();
    const session = await fixture(executor);
    const exercise = squat(session);

    await expect(
      saveRunnerBarProfile(executor, exercise.sessionExerciseId, 'custom', 0),
    ).rejects.toThrow('positive');
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

    expect(saved).toEqual({
      workoutLogId: expect.any(Number),
      loggedSets: 12,
      loggedExercises: 4,
      finishContext: {
        routineId: 1,
        cycleId: 6,
        cycleNumber: 6,
        weekNumber: 4,
        reviewAvailable: false,
      },
    });
    expect(count(db, 'Workout_Log')).toBe(historyBefore.workoutLog + 1);
    expect(count(db, 'Logged_Exercises')).toBe(historyBefore.logged + 4);
    expect(count(db, 'Weight_Log')).toBe(historyBefore.weight + 12);

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

describe('saveSessionLog — learned baselines (§3.2)', () => {
  const waveDraft = (overrides: Record<string, unknown> = {}): WaveSetupDraft => ({
    name: 'Wave Test',
    unit: 'kg',
    roundingIncrement: 2.5,
    roundingDirection: 'nearest',
    tmPercentage: 0.9,
    includeDeload: true,
    warmupsEnabled: true,
    upperTmIncrement: 2.5,
    lowerTmIncrement: 5,
    assistanceBias: 'hybrid',
    days: [],
    ...(overrides as Partial<WaveSetupDraft>),
  });

  const waveDay = (overrides: Record<string, unknown> = {}): WaveDayDraft => ({
    key: 'd1',
    weekday: 1,
    liftName: 'Squat',
    catalogExerciseId: null,
    category: 'lower',
    trainingMax: null,
    assistanceStartWeight: null,
    assistance: [],
    ...(overrides as Partial<WaveDayDraft>),
  });

  /**
   * Week 1's first pending session of a freshly written wave routine —
   * `writeWaveRoutine` seeds the cycle itself (utils/cycleSeed.ts).
   */
  const pendingWaveWeekSession = async (
    executor: TestExecutor,
    routineId: number,
  ): Promise<number> => {
    const weekSession = await executor.get(
      `SELECT ws.week_session_id FROM WeekSessions ws
       JOIN Sessions s ON s.session_id = ws.session_id
       JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
       WHERE s.routine_id = ? AND cw.week_number = 1 AND ws.status = 'pending'
       ORDER BY ws.week_session_id LIMIT 1;`,
      [routineId],
    );
    if (!weekSession) {
      throw new Error('No pending wave week session');
    }
    return Number(weekSession.week_session_id);
  };

  const withSquatWeight = (session: RunnerSession, weight: number): RunnerDraft => {
    const draft: RunnerDraft = [[], []];
    for (let index = 0; index < squat(session).targetSets; index += 1) {
      draft[0].push({ reps: 5, weight });
    }
    for (let index = 0; index < row(session).targetSets; index += 1) {
      draft[1].push({ reps: 10, weight: 22.5 });
    }
    return draft;
  };

  it('writes the linear starting load from the first logged set when the plan value is NULL', async () => {
    const { db, executor } = connect();
    const session = await fixture(executor);
    db.prepare('UPDATE SessionExercises SET absolute_weight = NULL WHERE session_exercise_id = ?;')
      .run(row(session).sessionExerciseId);

    await saveSessionLog(executor, session.weekSessionId, session, withSquatWeight(session, 100));

    const loaded = db
      .prepare('SELECT absolute_weight FROM SessionExercises WHERE session_exercise_id = ?;')
      .get(row(session).sessionExerciseId) as { absolute_weight: number | null };
    expect(loaded.absolute_weight).toBe(22.5);
  });

  it('derives the wave training max from the first logged set (Epley x TM pct)', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    const routineId = await writeWaveRoutine(
      executor,
      waveDraft({ days: [waveDay({ key: 'd1', liftName: 'Squat', trainingMax: null })] }),
    );
    const weekSessionId = await pendingWaveWeekSession(executor, routineId);
    const session = await loadRunnerSession(executor, weekSessionId, TODAY);

    const draft: RunnerDraft = [[{ reps: 5, weight: 100 }], []];
    await saveSessionLog(executor, weekSessionId, session, draft);

    const row = db
      .prepare(
        `SELECT e.training_max_weight FROM SessionExercises e
         JOIN Sessions s ON s.session_id = e.session_id
         WHERE s.routine_id = ? AND e.role = 'main';`,
      )
      .get(routineId) as { training_max_weight: number | null };
    // Epley 100 x (1 + 5/30) = 116.67; x 0.9 = 105.
    expect(row.training_max_weight).toBe(105);
  });

  it(
    'finishing a first-ever exercise with all sets untouched writes no Weight_Log rows ' +
      'and no baseline (F1) — a real, still-blank exercise alongside one that already has one',
    async () => {
      const { db, executor } = connect();
      await runSchema(executor);
      const routineId = await writeWaveRoutine(
        executor,
        waveDraft({
          days: [
            waveDay({
              key: 'd1',
              liftName: 'Squat',
              trainingMax: null,
              assistance: [
                { key: 'a1', catalogExerciseId: null, name: 'Leg Press', sets: 3, reps: 10 },
              ],
            }),
          ],
        }),
      );
      // The assistance row already has a learned starting weight, so the
      // session has something real to save alongside squat's untouched blanks.
      db.prepare(
        `UPDATE SessionExercises SET absolute_weight = 80
           WHERE session_id = (SELECT session_id FROM Sessions WHERE routine_id = ?)
             AND exercise_name = 'Leg Press';`,
      ).run(routineId);

      const weekSessionId = await pendingWaveWeekSession(executor, routineId);
      const session = await loadRunnerSession(executor, weekSessionId, TODAY);
      // Zero taps: exactly the plan the runner pre-fills, untouched.
      const draft = buildPlannedDraft(session);

      await saveSessionLog(executor, weekSessionId, session, draft);

      const squatSets = db
        .prepare(`SELECT COUNT(*) AS n FROM Weight_Log WHERE exercise_name = 'Squat';`)
        .get() as { n: number };
      expect(squatSets.n).toBe(0);

      const legPressSets = db
        .prepare(`SELECT COUNT(*) AS n FROM Weight_Log WHERE exercise_name = 'Leg Press';`)
        .get() as { n: number };
      expect(legPressSets.n).toBe(3);

      const squatTm = db
        .prepare(
          `SELECT training_max_weight FROM SessionExercises
           WHERE session_id = (SELECT session_id FROM Sessions WHERE routine_id = ?)
             AND exercise_name = 'Squat';`,
        )
        .get(routineId) as { training_max_weight: number | null };
      expect(squatTm.training_max_weight).toBeNull();
    },
  );

  it('derives the wave training max from one logged set at 80 kg x 5 (Epley x TM pct)', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    const routineId = await writeWaveRoutine(
      executor,
      waveDraft({ days: [waveDay({ key: 'd1', liftName: 'Squat', trainingMax: null })] }),
    );
    const weekSessionId = await pendingWaveWeekSession(executor, routineId);
    const session = await loadRunnerSession(executor, weekSessionId, TODAY);

    const draft: RunnerDraft = [[{ reps: 5, weight: 80 }], []];
    await saveSessionLog(executor, weekSessionId, session, draft);

    const row = db
      .prepare(
        `SELECT e.training_max_weight FROM SessionExercises e
         JOIN Sessions s ON s.session_id = e.session_id
         WHERE s.routine_id = ? AND e.role = 'main';`,
      )
      .get(routineId) as { training_max_weight: number | null };
    expect(row.training_max_weight).toBe(estimateTrainingMax(80, 5, 0.9, 2.5, 'nearest'));
  });

  it('derives the wave training max from the HEAVIEST logged set, not the first (F1)', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    const routineId = await writeWaveRoutine(
      executor,
      waveDraft({ days: [waveDay({ key: 'd1', liftName: 'Squat', trainingMax: null })] }),
    );
    const weekSessionId = await pendingWaveWeekSession(executor, routineId);
    const session = await loadRunnerSession(executor, weekSessionId, TODAY);

    // A natural ramp across the three work sets: 60, 70, 80. The heaviest —
    // the last one — must set the baseline, not the first (60).
    const draft: RunnerDraft = [
      [
        { reps: 5, weight: 60 },
        { reps: 5, weight: 70 },
        { reps: 5, weight: 80 },
      ],
      [],
    ];
    await saveSessionLog(executor, weekSessionId, session, draft);

    const row = db
      .prepare(
        `SELECT e.training_max_weight FROM SessionExercises e
         JOIN Sessions s ON s.session_id = e.session_id
         WHERE s.routine_id = ? AND e.role = 'main';`,
      )
      .get(routineId) as { training_max_weight: number | null };
    const fromHeaviest = estimateTrainingMax(80, 5, 0.9, 2.5, 'nearest');
    const fromFirst = estimateTrainingMax(60, 5, 0.9, 2.5, 'nearest');
    expect(row.training_max_weight).toBe(fromHeaviest);
    expect(row.training_max_weight).not.toBe(fromFirst);
  });

  it('never overwrites a baseline the user set by hand', async () => {
    const { db, executor } = connect();
    const session = await fixture(executor);
    db.prepare('UPDATE SessionExercises SET absolute_weight = 50 WHERE session_exercise_id = ?;')
      .run(row(session).sessionExerciseId);

    await saveSessionLog(executor, session.weekSessionId, session, withSquatWeight(session, 120));

    const loaded = db
      .prepare('SELECT absolute_weight FROM SessionExercises WHERE session_exercise_id = ?;')
      .get(row(session).sessionExerciseId) as { absolute_weight: number | null };
    expect(loaded.absolute_weight).toBe(50);
  });

  it('converts a set logged in the other unit once, for the plan — the log row keeps its unit', async () => {
    const { db, executor } = connect();
    const session = await fixture(executor);
    db.prepare('UPDATE SessionExercises SET absolute_weight = NULL WHERE session_exercise_id = ?;')
      .run(row(session).sessionExerciseId);

    const draft = withSquatWeight(session, 100);
    draft[1][0] = { reps: 10, weight: 100, unit: 'lb' };
    await saveSessionLog(executor, session.weekSessionId, session, draft);

    const plan = db
      .prepare('SELECT absolute_weight FROM SessionExercises WHERE session_exercise_id = ?;')
      .get(row(session).sessionExerciseId) as { absolute_weight: number | null };
    expect(plan.absolute_weight).toBeCloseTo(45.36, 1);

    // The history row keeps the lb value and unit — nothing was converted there.
    const logged = db
      .prepare(
        `SELECT wl.weight_logged, wl.unit FROM Weight_Log wl
         JOIN Logged_Exercises le ON le.logged_exercise_id = wl.logged_exercise_id
         WHERE le.exercise_name = 'Bent Over Two-Dumbbell Row' AND wl.set_number = 1
         ORDER BY wl.weight_log_id DESC LIMIT 1;`,
      )
      .get() as { weight_logged: number; unit: string };
    expect(logged.weight_logged).toBe(100);
    expect(logged.unit).toBe('lb');
  });

  it('reads back exactly what was stored — the lb set is never converted anywhere', async () => {
    const { db, executor } = connect();
    const session = await fixture(executor);
    const draft = planned(session);
    const firstSquatSet = draft[0][0];
    if (firstSquatSet === null) {
      throw new Error('Fixture draft missing the squat set');
    }
    draft[0][0] = { ...firstSquatSet, weight: 225, unit: 'lb' };
    await saveSessionLog(executor, session.weekSessionId, session, draft);

    const rows = await loadExerciseRows(db);
    const squatSets = rows.filter((row) => row.exercise_name === 'Barbell Full Squat');
    const first = [...squatSets].reverse().find((row) => row.set_number === 1);
    expect(first).toMatchObject({ weight_logged: 225, unit: 'lb' });
    expect(squatSets.filter((row) => row.set_number > 1).every((row) => row.unit === 'kg')).toBe(
      true,
    );
  });
});

type WeightLogRow = {
  exercise_name: string;
  set_number: number;
  weight_logged: number;
  unit: string;
};

const loadExerciseRows = async (
  db: DatabaseSync,
): Promise<WeightLogRow[]> =>
  db
    .prepare(
      `SELECT le.exercise_name, wl.set_number, wl.weight_logged, wl.unit
       FROM Weight_Log wl JOIN Logged_Exercises le ON le.logged_exercise_id = wl.logged_exercise_id
       ORDER BY wl.weight_log_id;`,
    )
    .all() as WeightLogRow[];
