import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
  buildDemoRows,
  loadDemoData,
  removeDemoData,
  demoLogDateRange,
  setTimestamps,
  DEMO_ROUTINE_KEY,
  DEMO_LINEAR_ROUTINE_KEY,
  DEMO_ROUTINE_NAME,
  DEMO_LINEAR_NAME,
  DEMO_FREE_LOG_NAME,
  type DemoDatabase,
  type DemoRoutineRows,
  type DemoSet,
} from './demoData';
import { runSchema, type SchemaExecutor } from './schema';
import { calcSetWeight, waveForWeek } from './fiveThreeOne';
import { barWeightFor, suggestPlates, STANDARD_PLATES } from './barProfiles';

const epoch = (ymd: string): number => {
  const [year, month, day] = ymd.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day, 12, 0, 0) / 1000);
};

const connect = (): { db: DatabaseSync; executor: SchemaExecutor } => {
  const db = new DatabaseSync(':memory:');
  const executor: SchemaExecutor = {
    exec: (sql) => db.exec(sql),
    run: (sql, params) => {
      db.prepare(sql).run(...(params as SQLInputValue[]));
    },
    getAll: <T>(sql: string, params: SQLInputValue[] = []) =>
      db.prepare(sql).all(...params) as T[],
  };
  return { db, executor };
};

const demoDb = (db: DatabaseSync): DemoDatabase => ({
  run: (sql: string, params: SQLInputValue[] = []) =>
    db.prepare(sql).run(...params),
  get: (sql: string, params: SQLInputValue[] = []) =>
    db.prepare(sql).get(...params) as Record<string, unknown> | undefined,
});

const count = (db: DatabaseSync, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

const waveRows = (): DemoRoutineRows => {
  const rows = buildDemoRows();
  const wave = rows.routines.find((routine) => routine.routine.routineKey === DEMO_ROUTINE_KEY);
  if (wave === undefined) {
    throw new Error('Demo rows missing the wave routine');
  }
  return wave;
};

const linearRows = (): DemoRoutineRows => {
  const rows = buildDemoRows();
  const linear = rows.routines.find(
    (routine) => routine.routine.routineKey === DEMO_LINEAR_ROUTINE_KEY,
  );
  if (linear === undefined) {
    throw new Error('Demo rows missing the linear routine');
  }
  return linear;
};

describe('buildDemoRows — shape', () => {
  it('is deterministic: repeated builds produce identical rows', () => {
    expect(buildDemoRows()).toEqual(buildDemoRows());
  });

  it('declares a wave routine as the single active one and a linear one inactive', () => {
    const wave = waveRows();
    const linear = linearRows();
    expect(wave.routine).toMatchObject({
      routineKey: DEMO_ROUTINE_KEY,
      name: DEMO_ROUTINE_NAME,
      origin: 'user',
      progressionRule: 'wave',
      unit: 'kg',
      roundingIncrement: 2.5,
      isActive: true,
    });
    expect(linear.routine).toMatchObject({
      routineKey: DEMO_LINEAR_ROUTINE_KEY,
      name: DEMO_LINEAR_NAME,
      progressionRule: 'linear',
      isActive: false,
    });
  });

  it('plans four training days, each with a main lift and three or four accessories', () => {
    const wave = waveRows();
    expect(wave.sessions).toHaveLength(4);
    expect(wave.sessions.map((s) => s.weekday)).toEqual([1, 2, 4, 5]);

    const counts = wave.sessions.map(
      (session) => wave.exercises.filter((e) => e.sessionKey === session.sessionKey).length,
    );
    expect(counts).toEqual([4, 5, 4, 4]);
    for (const session of wave.sessions) {
      const exercises = wave.exercises.filter((e) => e.sessionKey === session.sessionKey);
      expect(exercises.filter((e) => e.role === 'main')).toHaveLength(1);
      const accessories = exercises.filter((e) => e.role === 'accessory');
      expect(accessories.length).toBeGreaterThanOrEqual(3);
      expect(accessories.length).toBeLessThanOrEqual(4);
    }
  });

  it('has exactly four wave main lifts with training-max loads and AMRAPs', () => {
    const wave = waveRows();
    const mains = wave.exercises.filter((e) => e.role === 'main');
    expect(mains.map((e) => e.name)).toEqual([
      'Barbell Full Squat',
      'Barbell Bench Press - Medium Grip',
      'Barbell Deadlift',
      'Barbell Shoulder Press',
    ]);
    expect(mains.every((e) => e.loadSource === 'training_max_pct')).toBe(true);
    expect(mains.every((e) => e.trainingMaxPct === 0.9)).toBe(true);
    expect(mains.every((e) => e.isAmrap)).toBe(true);
    expect(mains.every((e) => e.trainingMaxWeight !== null)).toBe(true);
    expect(mains.every((e) => e.barProfile === 'olympic')).toBe(true);
  });

  it('covers six months: six four-week cycles from 2026-03-02 to mid-August', () => {
    const wave = waveRows();
    expect(wave.cycles).toHaveLength(6);
    expect(wave.cycleWeeks).toHaveLength(24);
    expect(wave.weekSessions).toHaveLength(96);

    const first = wave.cycles[0];
    const last = wave.cycles[5];
    expect(first).toMatchObject({
      cycleKey: 'wave-c1',
      cycleNumber: 1,
      weeks: 4,
      status: 'complete',
      currentWeek: 4,
      startedAt: epoch('2026-03-02'),
    });
    expect(last).toMatchObject({
      cycleKey: 'wave-c6',
      cycleNumber: 6,
      status: 'active',
      currentWeek: 4,
      startedAt: epoch('2026-07-20'),
      completedAt: null,
    });

    const logged = wave.weekSessions.filter((w) => w.status !== 'pending');
    const dates = logged.map((w) => w.date);
    const spanDays = (Math.max(...dates) - Math.min(...dates)) / 86400;
    expect(spanDays).toBeGreaterThan(150);
    expect(spanDays).toBeLessThan(190);
  });

  it('leaves exactly one unresolved session — the most recent one — as the queue head', () => {
    const wave = waveRows();
    const pending = wave.weekSessions.filter((w) => w.status === 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      cycleKey: 'wave-c6',
      weekNumber: 4,
      sessionKey: 'press-day',
    });
    expect(pending[0].date).toBe(epoch('2026-08-14'));
    expect(pending[0].results).toEqual({});
  });

  it('moves exactly one session (same cycle position, new date) and discards exactly one', () => {
    const wave = waveRows();
    const moved = wave.weekSessions.filter((w) => w.status === 'moved');
    const discarded = wave.weekSessions.filter((w) => w.status === 'discarded');

    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({
      cycleKey: 'wave-c2',
      weekNumber: 1,
      sessionKey: 'deadlift-day',
    });
    // The deadlift kept its cycle position; only the day moved (Thursday → Saturday).
    expect(moved[0].date).toBe(epoch('2026-04-04'));
    expect(Object.keys(moved[0].results).length).toBeGreaterThan(0);

    expect(discarded).toHaveLength(1);
    expect(discarded[0]).toMatchObject({
      cycleKey: 'wave-c2',
      weekNumber: 2,
      sessionKey: 'bench-day',
      date: epoch('2026-04-07'),
    });
    expect(discarded[0].results).toEqual({});
  });

  it('logs ~six months of sessions: nearly every wave session plus the linear ones', () => {
    const wave = waveRows();
    const linear = linearRows();
    const logged = wave.weekSessions.filter((w) => w.status === 'completed' || w.status === 'moved');
    expect(logged).toHaveLength(94);
    expect(linear.weekSessions).toHaveLength(24);
    expect(linear.weekSessions.every((w) => w.status === 'completed')).toBe(true);
  });

  it('shapes the squat as a novice curve: rising cycle tops with a held plateau', () => {
    const wave = waveRows();
    const squatSessions = wave.weekSessions
      .filter((w) => w.sessionKey === 'squat-day' && w.status !== 'pending')
      .sort((a, b) => a.date - b.date);

    // One squat session per week for 24 weeks.
    expect(squatSessions).toHaveLength(24);

    const tops = (sets: DemoSet[] | undefined): number => {
      const list = sets ?? [];
      return Math.max(...list.map((set) => set.weight));
    };
    const cycleTops = [0, 1, 2, 3, 4, 5].map((cycleIndex) =>
      tops(
        squatSessions
          .filter((w) => w.cycleKey === `wave-c${cycleIndex + 1}` && w.weekNumber === 3)[0]
          ?.results['squat'],
      ),
    );
    // 5/3/1 week-3 top set: 95% of the cycle's training max.
    expect(cycleTops).toEqual([95, 100, 105, 105, 110, 115]);

    // Monotonic early, flat through the held cycle, rising again after.
    for (let index = 1; index < cycleTops.length; index += 1) {
      expect(cycleTops[index]).toBeGreaterThanOrEqual(cycleTops[index - 1]);
    }
    expect(cycleTops[2]).toBe(cycleTops[3]);
    expect(cycleTops[1]).toBeLessThan(cycleTops[2]);
    expect(cycleTops[3]).toBeLessThan(cycleTops[4]);
  });

  it('marks every week 4 as a deload: fixed 40/50/60% targets, no AMRAP', () => {
    const wave = waveRows();
    // Each cycle's own training max: the stored review row's current target,
    // or the current plan TM for the active cycle.
    const tmOf = (lift: string, cycle: number): number => {
      const proposal = wave.proposals.find(
        (p) => p.cycleKey === `wave-c${cycle}` && p.sessionExerciseKey === lift,
      );
      if (proposal !== undefined) {
        return proposal.currentTarget;
      }
      const exercise = wave.exercises.find((e) => e.exerciseKey === lift);
      if (exercise?.trainingMaxWeight === null || exercise?.trainingMaxWeight === undefined) {
        throw new Error(`No training max for ${lift}`);
      }
      return exercise.trainingMaxWeight;
    };
    for (const cycle of wave.cycles) {
      for (const session of wave.weekSessions.filter(
        (w) => w.cycleKey === cycle.cycleKey && w.weekNumber === 4 && w.status !== 'pending',
      )) {
        for (const exercise of wave.exercises.filter(
          (e) => e.sessionKey === session.sessionKey && e.role === 'main',
        )) {
          const sets = session.results[exercise.exerciseKey];
          expect(sets).toHaveLength(3);
          const tm = tmOf(exercise.exerciseKey, cycle.cycleNumber);
          const wave = waveForWeek(4);
          for (const [index, set] of sets.entries()) {
            expect(set.weight).toBe(calcSetWeight(tm, wave.sets[index].percent, 2.5, 'nearest'));
            expect(set.reps).toBe(5);
          }
        }
      }
    }
  });

  it('sits a bad week in cycle 3: three lifts miss the week-2 AMRAP, bench misses twice', () => {
    const wave = waveRows();
    const week2 = wave.weekSessions.filter(
      (w) => w.cycleKey === 'wave-c3' && w.weekNumber === 2,
    );
    const amrapReps = (sessionKey: string, lift: string): number => {
      const session = week2.find((w) => w.sessionKey === sessionKey);
      const sets = session?.results[lift] ?? [];
      return sets[sets.length - 1]?.reps ?? -1;
    };
    // Week-2 AMRAP target is 3 reps; the miss must be below it.
    expect(amrapReps('squat-day', 'squat')).toBeLessThan(3);
    expect(amrapReps('bench-day', 'bench')).toBeLessThan(3);
    expect(amrapReps('deadlift-day', 'deadlift')).toBeLessThan(3);
    expect(amrapReps('press-day', 'ohp')).toBe(3);

    const week1Bench = wave.weekSessions.find(
      (w) => w.cycleKey === 'wave-c3' && w.weekNumber === 1 && w.sessionKey === 'bench-day',
    );
    const benchSets = week1Bench?.results['bench'] ?? [];
    expect(benchSets[benchSets.length - 1]?.reps).toBeLessThan(5);
  });

  it('carries AMRAP results across every wave cycle: met except the scripted cycle-3 misses', () => {
    const wave = waveRows();
    for (const cycle of wave.cycles) {
      for (const week of [1, 2, 3]) {
        for (const session of wave.weekSessions.filter(
          (w) =>
            w.cycleKey === cycle.cycleKey &&
            w.weekNumber === week &&
            (w.status === 'completed' || w.status === 'moved'),
        )) {
          for (const exercise of wave.exercises.filter(
            (e) => e.sessionKey === session.sessionKey && e.role === 'main',
          )) {
            const sets = session.results[exercise.exerciseKey];
            expect(sets).toHaveLength(3);
            const reps = sets[sets.length - 1]?.reps as number;
            const target = waveForWeek(week).sets[2].targetReps;
            const cycleMisses =
              cycle.cycleNumber === 3 &&
              ((week === 1 && exercise.exerciseKey === 'bench') ||
                (week === 2 &&
                  ['squat', 'bench', 'deadlift'].includes(exercise.exerciseKey)));
            if (cycleMisses) {
              expect(reps).toBeLessThan(target);
            } else {
              expect(reps).toBeGreaterThanOrEqual(target);
            }
          }
        }
      }
    }
  });

  it('holds the linear bench twice across its two cycles — the advisory source', () => {
    const linear = linearRows();
    const benchRows = linear.proposals.filter((p) => p.sessionExerciseKey === 'lin-bench');
    expect(benchRows).toHaveLength(2);
    for (const row of benchRows) {
      expect(row).toMatchObject({
        cycleKey: row.cycleKey === 'linear-c1' ? 'linear-c1' : 'linear-c2',
        currentTarget: 60,
        proposedTarget: 60,
        status: 'held',
        unit: 'kg',
      });
      expect(row.reason.length).toBeGreaterThan(0);
    }
    expect(new Set(benchRows.map((r) => r.cycleKey))).toEqual(
      new Set(['linear-c1', 'linear-c2']),
    );
  });

  it('resolves reviews across every cycle: accepted, held, edited and declined all appear', () => {
    const wave = waveRows();
    const linear = linearRows();
    const statuses = new Set([...wave.proposals, ...linear.proposals].map((p) => p.status));
    expect(statuses).toEqual(new Set(['accepted', 'held', 'edited', 'declined']));
    expect(wave.proposals).toHaveLength(20);
    expect(linear.proposals).toHaveLength(16);
  });

  it('logs every bar exercise on real plate combinations for its bar', () => {
    const wave = waveRows();
    const linear = linearRows();
    const exercises = new Map(
      [...wave.exercises, ...linear.exercises].map((e) => [e.exerciseKey, e]),
    );
    for (const routine of [wave, linear]) {
      for (const weekSession of routine.weekSessions) {
        for (const [exerciseKey, sets] of Object.entries(weekSession.results)) {
          const exercise = exercises.get(exerciseKey);
          if (exercise === undefined || exercise.barProfile === null) {
            continue;
          }
          for (const set of sets) {
            const unit = exercise.unitOverride ?? routine.routine.unit;
            const bar = barWeightFor(exercise.barProfile, exercise.barWeight, unit);
            const plates = suggestPlates(set.weight, bar as number, STANDARD_PLATES[unit]);
            expect(plates).not.toBeNull();
          }
        }
      }
    }
  });

  it('produces per-set timing for every logged set (§3.9)', () => {
    const timing = setTimestamps(epoch('2026-08-10'), 3);
    expect(timing.startedAt).not.toBeNull();
    expect(timing.completedAt).not.toBeNull();
    expect((timing.startedAt as number) % 1000).toBe(0);
    expect(timing.completedAt as number).toBeGreaterThan(timing.startedAt as number);
  });

  it('anchors every log date inside the demo range, free log included', () => {
    const rows = buildDemoRows();
    const [min, max] = demoLogDateRange();
    expect(min).toBe(epoch('2025-12-01'));
    expect(max).toBe(epoch('2026-08-13'));
    for (const routine of rows.routines) {
      for (const session of routine.weekSessions) {
        if (session.status !== 'pending') {
          expect(session.date).toBeGreaterThanOrEqual(min);
          expect(session.date).toBeLessThanOrEqual(max);
        }
      }
    }
    expect(rows.freeLog?.workoutDate).toBeGreaterThanOrEqual(min);
    expect(rows.freeLog?.workoutDate).toBeLessThanOrEqual(max);
  });

  it('sits the free-logging session on a Saturday, tied to no routine', () => {
    const rows = buildDemoRows();
    expect(rows.freeLog).toMatchObject({
      workoutName: DEMO_FREE_LOG_NAME,
      workoutDate: epoch('2026-06-20'),
    });
    expect(new Date(rows.freeLog?.workoutDate as number * 1000).getUTCDay()).toBe(6);
    for (const routine of rows.routines) {
      expect(
        routine.weekSessions.some((w) => w.date === rows.freeLog?.workoutDate),
      ).toBe(false);
    }
  });
});

describe('loadDemoData / removeDemoData', () => {
  it('loads the demo into a fresh database with both routines and the free log', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(demoDb(db));

    expect(count(db, 'Routines')).toBe(2);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM Routines WHERE is_active = 1').get() as { n: number }).n,
    ).toBe(1);
    expect(count(db, 'Sessions')).toBe(7);
    expect(count(db, 'SessionExercises')).toBe(25);
    expect(count(db, 'Cycles')).toBe(8);
    expect(count(db, 'CycleWeeks')).toBe(32);
    expect(count(db, 'WeekSessions')).toBe(120);
    expect(count(db, 'Progression_Proposal')).toBe(36);

    const logs = db
      .prepare(
        `SELECT workout_name, COUNT(*) AS n FROM Workout_Log GROUP BY workout_name
         ORDER BY workout_name;`,
      )
      .all() as { workout_name: string; n: number }[];
    expect(logs).toEqual([
      { workout_name: DEMO_LINEAR_NAME, n: 24 },
      { workout_name: DEMO_ROUTINE_NAME, n: 94 },
      { workout_name: DEMO_FREE_LOG_NAME, n: 1 },
    ]);
    expect(count(db, 'Weight_Log')).toBeGreaterThan(1200);

    const freeLog = db
      .prepare('SELECT workout_log_id FROM Workout_Log WHERE workout_name = ?;')
      .get(DEMO_FREE_LOG_NAME) as { workout_log_id: number };
    expect(freeLog).toBeDefined();
    const linked = db
      .prepare('SELECT COUNT(*) AS n FROM WeekSessions WHERE completed_log_id = ?;')
      .get(freeLog.workout_log_id) as { n: number };
    expect(linked.n).toBe(0);
  });

  it('leaves exactly one pending week session with no resolved date — the queue head', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(demoDb(db));

    const pending = db
      .prepare(
        `SELECT s.name, ws.resolved_on_date FROM WeekSessions ws
         JOIN Sessions s ON s.session_id = ws.session_id
         WHERE ws.status = 'pending';`,
      )
      .all() as { name: string; resolved_on_date: number | null }[];
    expect(pending).toEqual([{ name: 'Press Day', resolved_on_date: null }]);
  });

  it('is idempotent: loading twice changes nothing', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(demoDb(db));

    const before = count(db, 'Workout_Log');
    const weightBefore = count(db, 'Weight_Log');
    await loadDemoData(demoDb(db));

    expect(count(db, 'Routines')).toBe(2);
    expect(count(db, 'Workout_Log')).toBe(before);
    expect(count(db, 'Weight_Log')).toBe(weightBefore);
  });

  it('stores the unit override with the logged rows and mixes nothing else', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(demoDb(db));

    const lbRows = db
      .prepare(
        `SELECT COUNT(*) AS n FROM Weight_Log
         WHERE exercise_name = 'Wide-Grip Lat Pulldown' AND unit = 'lb'`,
      )
      .get() as { n: number };
    const kgRows = db
      .prepare(
        `SELECT COUNT(*) AS n FROM Weight_Log
         WHERE exercise_name = 'Barbell Full Squat' AND unit = 'kg'`,
      )
      .get() as { n: number };
    expect(lbRows.n).toBeGreaterThan(0);
    expect(kgRows.n).toBeGreaterThan(0);
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM Weight_Log WHERE unit NOT IN ('kg', 'lb')`).get() as {
        n: number;
      },
    ).toEqual({ n: 0 });
  });

  it('records the AMRAP and the missed sets as logged rows', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(demoDb(db));

    const maxReps = db
      .prepare(
        `SELECT MAX(reps_logged) AS n FROM Weight_Log WHERE exercise_name = 'Barbell Full Squat'`,
      )
      .get() as { n: number };
    expect(maxReps.n).toBe(7);

    const missed = db
      .prepare(
        `SELECT COUNT(*) AS n FROM Weight_Log
         WHERE exercise_name = 'Barbell Bench Press - Medium Grip' AND reps_logged = 2`,
      )
      .get() as { n: number };
    expect(missed.n).toBeGreaterThanOrEqual(1);
  });

  it('writes plausible per-set timing on every logged row', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(demoDb(db));

    const rows = db
      .prepare(
        `SELECT wl.started_at, wl.completed_at, wol.workout_log_id
         FROM Weight_Log wl JOIN Workout_Log wol ON wol.workout_log_id = wl.workout_log_id
         ORDER BY wol.workout_log_id, wl.weight_log_id;`,
      )
      .all() as { started_at: number | null; completed_at: number | null; workout_log_id: number }[];
    expect(rows.length).toBeGreaterThan(1200);
    let previous: { log: number; started: number } | null = null;
    for (const row of rows) {
      expect(row.started_at).not.toBeNull();
      expect(row.completed_at).not.toBeNull();
      expect(row.completed_at as number).toBeGreaterThan(row.started_at as number);
      if (previous !== null && previous.log === row.workout_log_id) {
        expect(row.started_at as number).toBeGreaterThan(previous.started);
      }
      previous = { log: row.workout_log_id, started: row.started_at as number };
    }
  });

  it('stores the resolved proposals for both routines', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(demoDb(db));

    const statuses = (
      db.prepare(`SELECT status FROM Progression_Proposal`).all() as { status: string }[]
    ).map((r) => r.status);
    expect(statuses.every((s) => s !== 'pending')).toBe(true);

    const deadlift = db
      .prepare(
        `SELECT current_target AS current, proposed_target AS proposed, status
         FROM Progression_Proposal
         WHERE exercise_name = 'Barbell Deadlift' AND status = 'declined'`,
      )
      .get() as { current: number; proposed: number; status: string };
    expect(deadlift).toEqual({ current: 135, proposed: 140, status: 'declined' });
  });

  it('removes cleanly and leaves the database as it was', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(demoDb(db));

    await removeDemoData(demoDb(db));

    for (const table of [
      'Routines',
      'Sessions',
      'SessionExercises',
      'Cycles',
      'CycleWeeks',
      'WeekSessions',
      'Workout_Log',
      'Logged_Exercises',
      'Weight_Log',
      'Progression_Proposal',
    ]) {
      expect(count(db, table)).toBe(0);
    }

    await removeDemoData(demoDb(db));
    expect(count(db, 'Routines')).toBe(0);
  });

  it('leaves user data untouched on load and on removal', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    await executor.run(
      `INSERT INTO Routines
         (routine_key, name, origin, progression_rule, unit, rounding_increment,
          rest_main_seconds, rest_accessory_seconds, is_active, created_at)
       VALUES (NULL, 'My Routine', 'user', 'none', 'kg', 2.5, 180, 90, 1, 1);`,
      [],
    );
    const routineId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
    await executor.run(
      `INSERT INTO Workout_Log (workout_name, day_name, workout_date)
       VALUES ('My Routine', 'My Day', ?);`,
      [epoch('2026-01-15')],
    );
    const userLogId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;

    await loadDemoData(demoDb(db));
    expect(count(db, 'Workout_Log')).toBe(120);

    await removeDemoData(demoDb(db));

    expect(count(db, 'Routines')).toBe(1);
    expect(
      (db.prepare('SELECT name FROM Routines WHERE routine_id = ?;').get(routineId) as { name: string }).name,
    ).toBe('My Routine');
    const userLog = db
      .prepare('SELECT workout_name FROM Workout_Log WHERE workout_log_id = ?;')
      .get(userLogId) as { workout_name: string };
    expect(userLog.workout_name).toBe('My Routine');
  });

  it('reloads after removal', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(demoDb(db));
    await removeDemoData(demoDb(db));
    await loadDemoData(demoDb(db));

    expect(count(db, 'Routines')).toBe(2);
    expect(count(db, 'Workout_Log')).toBe(119);
  });
});
