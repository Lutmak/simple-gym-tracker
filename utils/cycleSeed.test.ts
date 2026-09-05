import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import { createCycle, ensureActiveCycle, DEFAULT_CYCLE_WEEKS } from './cycleSeed';
import {
  activatePresetRoutine,
  activateRoutineById,
  createBlankRoutine,
  duplicateRoutine,
  loadPresetRoutineSource,
  type RoutineDatabase,
} from './routineActions';
import { dayStampOfStamp, loadSessionQueue, nominalSessionStamp, weekdayOfStamp } from './today';
import { writeWaveRoutine, type WaveSetupDraft } from './waveSetup';

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

const count = (db: DatabaseSync, table: string, where = '1 = 1', ...params: SQLInputValue[]): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params) as { n: number }).n;

const cycleRows = (db: DatabaseSync, routineId: number): Record<string, unknown>[] =>
  db
    .prepare(
      `SELECT cycle_number, weeks, status, current_week, started_at
       FROM Cycles WHERE routine_id = ? ORDER BY cycle_number;`,
    )
    .all(routineId) as Record<string, unknown>[];

const startedAtOf = (db: DatabaseSync, routineId: number): number =>
  Number(
    (
      db
        .prepare(
          'SELECT started_at FROM Cycles WHERE routine_id = ? ORDER BY cycle_number DESC LIMIT 1;',
        )
        .get(routineId) as { started_at: number }
    ).started_at,
  );

const weekSessionsOf = (db: DatabaseSync, routineId: number): number =>
  count(
    db,
    `WeekSessions ws JOIN Sessions s ON s.session_id = ws.session_id`,
    's.routine_id = ?',
    routineId,
  );

/**
 * A routine training every weekday, so whatever day the test runs on is a
 * training day. Written straight to the tables and left inactive — the point
 * is what `activateRoutineById` does to it.
 */
const seedEveryDayRoutine = async (executor: TestExecutor, name: string): Promise<number> => {
  await executor.run(
    `INSERT INTO Routines
       (routine_key, name, origin, progression_rule, unit, rounding_increment,
        rest_main_seconds, rest_accessory_seconds, is_active, created_at, planned_jokers)
     VALUES (NULL, ?, 'user', 'linear', 'kg', 2.5, 180, 90, 0, 1, 0);`,
    [name],
  );
  const routineRow = await executor.get('SELECT last_insert_rowid() AS id;', []);
  if (!routineRow) {
    throw new Error('No routine id');
  }
  const routineId = Number(routineRow.id);

  for (let weekday = 0; weekday < 7; weekday += 1) {
    await executor.run(
      'INSERT INTO Sessions (routine_id, weekday, name, sort_order) VALUES (?, ?, ?, ?);',
      [routineId, weekday, `Day ${weekday}`, weekday + 1],
    );
    const sessionRow = await executor.get('SELECT last_insert_rowid() AS id;', []);
    if (!sessionRow) {
      throw new Error('No session id');
    }
    await executor.run(
      `INSERT INTO SessionExercises
         (session_id, catalog_exercise_id, exercise_name, role, target_sets, target_reps,
          load_source, training_max_pct, training_max_weight, absolute_weight,
          unit_override, is_amrap, sort_order, bar_profile, bar_weight)
       VALUES (?, NULL, 'Barbell Squat', 'main', 3, 5, 'absolute', NULL, NULL, 60,
               NULL, 0, 1, NULL, NULL);`,
      [Number(sessionRow.id)],
    );
  }
  return routineId;
};

/** Marks one pending week session of a routine as completed, with a real log behind it. */
const logOneSession = async (executor: TestExecutor, routineId: number): Promise<number> => {
  const weekSession = await executor.get(
    `SELECT ws.week_session_id, s.name FROM WeekSessions ws
     JOIN Sessions s ON s.session_id = ws.session_id
     JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
     WHERE s.routine_id = ? AND cw.week_number = 1 AND ws.status = 'pending'
     ORDER BY ws.week_session_id LIMIT 1;`,
    [routineId],
  );
  if (!weekSession) {
    throw new Error('No pending week session to log against');
  }

  await executor.run(
    `INSERT INTO Workout_Log (workout_name, day_name, workout_date)
     VALUES (?, ?, 1);`,
    [`Routine ${routineId}`, String(weekSession.name)],
  );
  const logRow = await executor.get('SELECT last_insert_rowid() AS id;', []);
  if (!logRow) {
    throw new Error('No workout log id');
  }
  const workoutLogId = Number(logRow.id);

  await executor.run(
    `INSERT INTO Logged_Exercises (workout_log_id, exercise_name, sets, reps)
     VALUES (?, 'Barbell Squat', 3, 5);`,
    [workoutLogId],
  );
  const loggedRow = await executor.get('SELECT last_insert_rowid() AS id;', []);
  if (!loggedRow) {
    throw new Error('No logged exercise id');
  }
  await executor.run(
    `INSERT INTO Weight_Log
       (workout_log_id, logged_exercise_id, exercise_name, set_number, weight_logged,
        reps_logged, unit)
     VALUES (?, ?, 'Barbell Squat', 1, 100, 5, 'kg');`,
    [workoutLogId, Number(loggedRow.id)],
  );
  await executor.run(
    `UPDATE WeekSessions SET status = 'completed', resolved_on_date = 1, completed_log_id = ?
     WHERE week_session_id = ?;`,
    [workoutLogId, Number(weekSession.week_session_id)],
  );

  return Number(weekSession.week_session_id);
};

const waveDraft = (): WaveSetupDraft => ({
  name: 'My 5/3/1',
  unit: 'kg',
  roundingIncrement: 2.5,
  roundingDirection: 'nearest',
  tmPercentage: 0.9,
  includeDeload: true,
  warmupsEnabled: true,
  upperTmIncrement: 2.5,
  lowerTmIncrement: 5,
  assistanceBias: 'hybrid',
  days: [
    {
      key: 'd1',
      weekday: 1,
      liftName: 'Squat',
      catalogExerciseId: null,
      category: 'lower',
      trainingMax: 100,
      assistanceStartWeight: null,
      assistance: [],
    },
    {
      key: 'd2',
      weekday: 4,
      liftName: 'Bench Press',
      catalogExerciseId: null,
      category: 'upper',
      trainingMax: 80,
      assistanceStartWeight: null,
      assistance: [],
    },
  ],
});

describe('activation seeds the first cycle', () => {
  it('creates cycle 1, its weeks, and one pending week session per session per week', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    const source = await loadPresetRoutineSource(executor, 'newbie-gains');
    const { routineId } = await activatePresetRoutine(executor, 'newbie-gains', 'kg', new Map());

    const cycles = cycleRows(db, routineId);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toMatchObject({
      cycle_number: 1,
      weeks: DEFAULT_CYCLE_WEEKS,
      status: 'active',
      current_week: 1,
    });
    expect(Number(cycles[0].started_at)).toBeGreaterThan(0);

    expect(count(db, 'CycleWeeks')).toBe(DEFAULT_CYCLE_WEEKS);
    expect(weekSessionsOf(db, routineId)).toBe(source.sessions.length * DEFAULT_CYCLE_WEEKS);
    expect(count(db, 'WeekSessions', "status <> 'pending'")).toBe(0);
  });

  it('offers a queue head on the activation day itself when today is a training day', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    const routineId = await seedEveryDayRoutine(executor, 'Every Day');

    await activateRoutineById(executor, routineId);

    const todayStamp = dayStampOfStamp(startedAtOf(db, routineId));
    const queue = await loadSessionQueue(executor, todayStamp);

    expect(queue.head).not.toBeNull();
    expect(queue.resolution).toBe('due');
    expect(queue.head?.name).toBe(`Day ${weekdayOfStamp(todayStamp)}`);
    expect(queue.head?.date).toBe(todayStamp);
    expect(queue.head?.exercises).toHaveLength(1);
    expect(queue.head?.exercises[0]).toMatchObject({ name: 'Barbell Squat', targetWeight: 60 });
  });

  it('makes a preset trainable: the head is week 1 of the new cycle, on its own day', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    // Pinned: activation lands on Sunday 2026-08-16 UTC (weekday 0), so newbie-gains'
    // Mon/Wed/Fri (1/3/5) sessions are genuinely nearest-first in that order. Activation
    // reads the real clock (`Date.now()` in `routineActions.ts`) and `nominalSessionStamp`'s
    // offset is forward-only from whatever weekday that real clock lands on — on a day (or,
    // near midnight UTC, a time of day) where Monday isn't the nearest training day, this
    // test's premise "sort-order-first == chronologically-first" does not hold. Pin the clock
    // instead of relying on whichever day/hour the suite happens to run at (SPEC.md Phase F, F0).
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(Date.UTC(2026, 7, 16, 9, 0, 0));
    try {
      await activatePresetRoutine(executor, 'newbie-gains', 'kg', new Map());
    } finally {
      jest.useRealTimers();
    }
    const routineId = Number(
      (db.prepare('SELECT routine_id FROM Routines WHERE is_active = 1;').get() as {
        routine_id: number;
      }).routine_id,
    );

    const startedAt = startedAtOf(db, routineId);
    const firstSession = db
      .prepare('SELECT name, weekday FROM Sessions WHERE routine_id = ? ORDER BY sort_order LIMIT 1;')
      .get(routineId) as { name: string; weekday: number };

    const queue = await loadSessionQueue(
      executor,
      nominalSessionStamp(startedAt, 1, firstSession.weekday),
    );
    expect(queue.resolution).toBe('due');
    expect(queue.head?.name).toBe(firstSession.name);
    expect(queue.head?.exercises.length).toBeGreaterThan(0);

    // On the activation day the next session is a scheduled cycle row, not the
    // plan-only fallback `nextPlanSession` returns when no cycle exists.
    const onActivationDay = await loadSessionQueue(executor, dayStampOfStamp(startedAt));
    expect(onActivationDay.upcoming).not.toBeNull();
    expect(onActivationDay.upcoming?.weekSessionId).not.toBeNull();
  });

  it('seeds the cycle of a 5/3/1 routine written by the setup screen', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    const routineId = await writeWaveRoutine(executor, waveDraft());

    expect(cycleRows(db, routineId)).toHaveLength(1);
    expect(cycleRows(db, routineId)[0]).toMatchObject({ cycle_number: 1, weeks: DEFAULT_CYCLE_WEEKS });
    expect(weekSessionsOf(db, routineId)).toBe(2 * DEFAULT_CYCLE_WEEKS);
  });
});

describe('activation is idempotent and never rewrites history', () => {
  it('re-activating an active routine adds no cycle and keeps every logged set', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    const { routineId } = await activatePresetRoutine(executor, 'newbie-gains', 'kg', new Map());
    const weekSessionId = await logOneSession(executor, routineId);
    const weekSessionsBefore = weekSessionsOf(db, routineId);

    await activateRoutineById(executor, routineId);

    expect(cycleRows(db, routineId)).toHaveLength(1);
    expect(weekSessionsOf(db, routineId)).toBe(weekSessionsBefore);
    expect(count(db, 'Weight_Log')).toBe(1);
    const logged = db
      .prepare('SELECT status, completed_log_id FROM WeekSessions WHERE week_session_id = ?;')
      .get(weekSessionId) as { status: string; completed_log_id: number | null };
    expect(logged.status).toBe('completed');
    expect(logged.completed_log_id).not.toBeNull();
  });

  it('activating another routine leaves the first one’s cycle and history intact', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    const first = await activatePresetRoutine(executor, 'newbie-gains', 'kg', new Map());
    const weekSessionId = await logOneSession(executor, first.routineId);
    const firstWeekSessions = weekSessionsOf(db, first.routineId);

    const second = await activatePresetRoutine(executor, 'split-it', 'kg', new Map());

    expect(cycleRows(db, first.routineId)).toHaveLength(1);
    expect(weekSessionsOf(db, first.routineId)).toBe(firstWeekSessions);
    const logged = db
      .prepare('SELECT status, completed_log_id FROM WeekSessions WHERE week_session_id = ?;')
      .get(weekSessionId) as { status: string; completed_log_id: number | null };
    expect(logged.status).toBe('completed');
    expect(logged.completed_log_id).not.toBeNull();
    expect(count(db, 'Weight_Log')).toBe(1);

    expect(cycleRows(db, second.routineId)).toHaveLength(1);

    // Switching back resumes the first routine's own cycle rather than starting one.
    await activateRoutineById(executor, first.routineId);
    expect(cycleRows(db, first.routineId)).toHaveLength(1);
    expect(weekSessionsOf(db, first.routineId)).toBe(firstWeekSessions);
  });

  it('starts the next cycle when every cycle of the routine is complete, keeping the old one', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    const { routineId } = await activatePresetRoutine(executor, 'newbie-gains', 'kg', new Map());
    const weekSessionId = await logOneSession(executor, routineId);
    const firstCycleWeekSessions = weekSessionsOf(db, routineId);
    // A three-week cycle proves the next one inherits the week count rather
    // than falling back to the default.
    db.prepare("UPDATE Cycles SET status = 'complete', weeks = 3 WHERE routine_id = ?;").run(
      routineId,
    );

    await activateRoutineById(executor, routineId);

    const cycles = cycleRows(db, routineId);
    expect(cycles).toHaveLength(2);
    expect(cycles[0]).toMatchObject({ cycle_number: 1, status: 'complete', weeks: 3 });
    expect(cycles[1]).toMatchObject({ cycle_number: 2, status: 'active', weeks: 3, current_week: 1 });

    const sessionCount = count(db, 'Sessions', 'routine_id = ?', routineId);
    expect(weekSessionsOf(db, routineId)).toBe(firstCycleWeekSessions + sessionCount * 3);
    const logged = db
      .prepare('SELECT status FROM WeekSessions WHERE week_session_id = ?;')
      .get(weekSessionId) as { status: string };
    expect(logged.status).toBe('completed');
  });
});

describe('what does not get a cycle', () => {
  it('gives a duplicate none — it is a plan the user has not started', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    const { routineId } = await activatePresetRoutine(executor, 'split-it', 'kg', new Map());

    const copyId = await duplicateRoutine(executor, routineId);

    expect(cycleRows(db, copyId)).toHaveLength(0);
    expect(cycleRows(db, routineId)).toHaveLength(1);
  });

  it('gives a routine with no training days none, and the queue stays empty', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    const routineId = await createBlankRoutine(executor, {
      name: 'Empty',
      unit: 'kg',
      roundingIncrement: 2.5,
      restMainSeconds: 180,
      restAccessorySeconds: 90,
      progressionRule: 'linear',
    });

    await activateRoutineById(executor, routineId);

    expect(cycleRows(db, routineId)).toHaveLength(0);
    const queue = await loadSessionQueue(executor, dayStampOfStamp(Math.floor(Date.now() / 1000)));
    expect(queue.head).toBeNull();
    expect(queue.upcoming).toBeNull();
  });
});

describe('createCycle / ensureActiveCycle — the shared structure', () => {
  it('numbers a new cycle after the routine’s highest and writes every week session', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    const routineId = await seedEveryDayRoutine(executor, 'Every Day');

    const first = await createCycle(executor, routineId, 2, 1000);
    const second = await createCycle(executor, routineId, 2, 2000);

    expect(second).not.toBe(first);
    expect(cycleRows(db, routineId).map((row) => row.cycle_number)).toEqual([1, 2]);
    expect(count(db, 'CycleWeeks', 'cycle_id = ?', second)).toBe(2);
    expect(weekSessionsOf(db, routineId)).toBe(7 * 2 * 2);
  });

  it('returns the routine’s open cycle instead of creating a second one', async () => {
    const { executor } = connect();
    await runSchema(executor);
    const routineId = await seedEveryDayRoutine(executor, 'Every Day');

    const created = await ensureActiveCycle(executor, routineId, 1000);
    const again = await ensureActiveCycle(executor, routineId, 2000);

    expect(created).not.toBeNull();
    expect(again).toBe(created);
  });
});
