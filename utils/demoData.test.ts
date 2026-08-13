import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
  buildDemoRows,
  loadDemoData,
  removeDemoData,
  demoLogDateRange,
  DEMO_ROUTINE_KEY,
  type DemoDatabase,
} from './demoData';
import { runSchema, type SchemaExecutor } from './schema';

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

describe('buildDemoRows', () => {
  it('is deterministic: repeated builds produce identical rows', () => {
    expect(buildDemoRows()).toEqual(buildDemoRows());
  });

  it('declares one active linear routine', () => {
    const rows = buildDemoRows();
    expect(rows.routine).toMatchObject({
      routineKey: DEMO_ROUTINE_KEY,
      origin: 'user',
      progressionRule: 'linear',
      unit: 'kg',
      roundingIncrement: 2.5,
      isActive: true,
    });
  });

  it('plans three sessions on Monday, Wednesday and Friday', () => {
    const rows = buildDemoRows();
    expect(rows.sessions).toHaveLength(3);
    expect(rows.sessions.map((s) => s.weekday)).toEqual([1, 3, 5]);
    expect(rows.sessions.map((s) => s.sortOrder)).toEqual([1, 2, 3]);
  });

  it('has seven exercises with one unit override and one AMRAP', () => {
    const rows = buildDemoRows();
    expect(rows.exercises).toHaveLength(7);

    const overridden = rows.exercises.filter((e) => e.unitOverride !== null);
    expect(overridden).toHaveLength(1);
    expect(overridden[0]).toMatchObject({
      exerciseKey: 'lat-pulldown',
      unitOverride: 'lb',
      role: 'accessory',
    });

    const amrap = rows.exercises.filter((e) => e.isAmrap);
    expect(amrap).toHaveLength(1);
    expect(amrap[0]).toMatchObject({ exerciseKey: 'squat', targetSets: 3, targetReps: 5 });
  });

  it('has two cycles: the first complete, the second active', () => {
    const rows = buildDemoRows();
    expect(rows.cycles).toHaveLength(2);
    expect(rows.cycles[0]).toMatchObject({
      cycleKey: 'cycle-1',
      cycleNumber: 1,
      weeks: 4,
      status: 'complete',
    });
    expect(rows.cycles[1]).toMatchObject({
      cycleKey: 'cycle-2',
      cycleNumber: 2,
      weeks: 4,
      status: 'active',
      currentWeek: 4,
    });
  });

  it('has one week of rows per cycle week and exactly 24 week sessions', () => {
    const rows = buildDemoRows();
    expect(rows.cycleWeeks).toHaveLength(8);
    expect(rows.weekSessions).toHaveLength(24);
  });

  it('logs three full weeks of history in cycle 2 and leaves week 4 pending', () => {
    const rows = buildDemoRows();
    const cycle2 = rows.weekSessions.filter((w) => w.cycleKey === 'cycle-2');

    for (const week of [1, 2, 3]) {
      const sessions = cycle2.filter((w) => w.weekNumber === week);
      expect(sessions).toHaveLength(3);
      expect(sessions.every((s) => s.status !== 'pending')).toBe(true);
    }

    const week4 = cycle2.filter((w) => w.weekNumber === 4);
    expect(week4).toHaveLength(3);
    expect(week4.every((s) => s.status === 'pending')).toBe(true);
  });

  it('moves exactly one session and discards exactly one', () => {
    const rows = buildDemoRows();
    const moved = rows.weekSessions.filter((w) => w.status === 'moved');
    const discarded = rows.weekSessions.filter((w) => w.status === 'discarded');

    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ cycleKey: 'cycle-2', weekNumber: 1, sessionKey: 'deadlift-day' });
    expect(moved[0].date).toBe(epoch('2026-05-09'));

    expect(discarded).toHaveLength(1);
    expect(discarded[0]).toMatchObject({ cycleKey: 'cycle-2', weekNumber: 2, sessionKey: 'bench-day' });
    expect(discarded[0].date).toBe(epoch('2026-05-13'));
    expect(discarded[0].results).toEqual({});
  });

  it('logs twenty sessions in total across both cycles', () => {
    const rows = buildDemoRows();
    const logged = rows.weekSessions.filter(
      (w) => w.status === 'completed' || w.status === 'moved',
    );
    expect(logged).toHaveLength(20);
  });

  it('records an AMRAP result beyond the target on the squat', () => {
    const rows = buildDemoRows();
    const squat = rows.exercises.find((e) => e.exerciseKey === 'squat');
    const amrapWeek = rows.weekSessions.find(
      (w) => w.cycleKey === 'cycle-2' && w.weekNumber === 3 && w.sessionKey === 'squat-day',
    );

    expect(squat?.isAmrap).toBe(true);
    const finalSet = amrapWeek?.results['squat'][2];
    expect(finalSet?.reps).toBe(8);
    expect(finalSet?.reps).toBeGreaterThan(squat!.targetReps);
  });

  it('contains sets that hit target and sets that missed', () => {
    const rows = buildDemoRows();
    const cycle1BenchMiss = rows.weekSessions.find(
      (w) => w.cycleKey === 'cycle-1' && w.weekNumber === 2 && w.sessionKey === 'bench-day',
    );
    const cycle2BenchMiss = rows.weekSessions.find(
      (w) => w.cycleKey === 'cycle-2' && w.weekNumber === 1 && w.sessionKey === 'bench-day',
    );

    expect(cycle1BenchMiss?.results['bench'][2].reps).toBe(4);
    expect(cycle2BenchMiss?.results['bench'][2].reps).toBe(4);
    expect(cycle1BenchMiss?.results['bench'][0].reps).toBe(5);
  });

  it('carries the accepted and edited cycle-1 values into cycle 2', () => {
    const rows = buildDemoRows();
    const squat = rows.exercises.find((e) => e.exerciseKey === 'squat');
    const deadlift = rows.exercises.find((e) => e.exerciseKey === 'deadlift');

    expect(squat?.absoluteWeight).toBe(102.5);
    expect(deadlift?.absoluteWeight).toBe(142.5);
  });

  it('produces four resolved proposals covering every resolved status', () => {
    const rows = buildDemoRows();
    expect(rows.proposals).toHaveLength(4);
    expect(new Set(rows.proposals.map((p) => p.status))).toEqual(
      new Set(['accepted', 'held', 'edited', 'declined']),
    );

    const squat = rows.proposals.find((p) => p.sessionExerciseKey === 'squat');
    expect(squat).toMatchObject({
      currentTarget: 100,
      proposedTarget: 102.5,
      unit: 'kg',
      status: 'accepted',
    });

    const deadlift = rows.proposals.find((p) => p.sessionExerciseKey === 'deadlift');
    expect(deadlift).toMatchObject({ currentTarget: 140, proposedTarget: 142.5, status: 'edited' });

    const bench = rows.proposals.find((p) => p.sessionExerciseKey === 'bench');
    expect(bench).toMatchObject({
      currentTarget: 70,
      proposedTarget: 70,
      status: 'held',
    });
    expect(bench?.reason.length).toBeGreaterThan(0);
  });

  it('anchors all logs inside the demo date range', () => {
    const rows = buildDemoRows();
    const [min, max] = demoLogDateRange();
    const logged = rows.weekSessions.filter((w) => w.status !== 'pending');

    expect(min).toBe(epoch('2026-04-06'));
    expect(max).toBe(epoch('2026-05-22'));
    for (const session of logged) {
      expect(session.date).toBeGreaterThanOrEqual(min);
      expect(session.date).toBeLessThanOrEqual(max);
    }
  });
});

describe('loadDemoData / removeDemoData', () => {
  it('loads the demo into a fresh database', async () => {
    const { db, executor } = connect();
    await runSchema(executor);

    await loadDemoData(demoDb(db));

    expect(count(db, 'Routines')).toBe(1);
    expect(count(db, 'Routines') > 0 && (db.prepare(
      `SELECT COUNT(*) AS n FROM Routines WHERE is_active = 1`,
    ).get() as { n: number }).n).toBe(1);
    expect(count(db, 'Sessions')).toBe(3);
    expect(count(db, 'SessionExercises')).toBe(7);
    expect(count(db, 'Cycles')).toBe(2);
    expect(count(db, 'CycleWeeks')).toBe(8);
    expect(count(db, 'WeekSessions')).toBe(24);
    expect(count(db, 'Workout_Log')).toBe(20);
    expect(count(db, 'Logged_Exercises')).toBe(46);
    expect(count(db, 'Weight_Log')).toBe(124);
    expect(count(db, 'Progression_Proposal')).toBe(4);
  });

  it('is idempotent: loading twice changes nothing', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(demoDb(db));

    const before = count(db, 'Workout_Log');
    await loadDemoData(demoDb(db));

    expect(count(db, 'Routines')).toBe(1);
    expect(count(db, 'Workout_Log')).toBe(before);
    expect(count(db, 'Weight_Log')).toBe(124);
  });

  it('stores the unit override with the logged rows', async () => {
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

    expect(lbRows.n).toBe(18);
    expect(kgRows.n).toBeGreaterThan(0);
    expect(db.prepare(
      `SELECT COUNT(*) AS n FROM Weight_Log WHERE unit NOT IN ('kg', 'lb')`,
    ).get() as { n: number }).toEqual({ n: 0 });
  });

  it('records the AMRAP and the missed sets as logged rows', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(demoDb(db));

    const maxReps = db
      .prepare(`SELECT MAX(reps_logged) AS n FROM Weight_Log WHERE exercise_name = 'Barbell Full Squat'`)
      .get() as { n: number };
    expect(maxReps.n).toBe(8);

    const missed = db
      .prepare(
        `SELECT COUNT(*) AS n FROM Weight_Log WHERE exercise_name = 'Barbell Bench Press - Medium Grip' AND reps_logged = 4`,
      )
      .get() as { n: number };
    expect(missed.n).toBe(2);
  });

  it('stores the resolved proposals', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(demoDb(db));

    const deadlift = db
      .prepare(
        `SELECT proposed_target AS proposed, status FROM Progression_Proposal
         WHERE exercise_name = 'Barbell Deadlift'`,
      )
      .get() as { proposed: number; status: string };
    expect(deadlift.proposed).toBe(142.5);
    expect(deadlift.status).toBe('edited');

    const statuses = (
      db.prepare(`SELECT status FROM Progression_Proposal`).all() as { status: string }[]
    ).map((r) => r.status);
    expect(statuses.every((s) => s !== 'pending')).toBe(true);
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

  it('reloads after removal', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(demoDb(db));
    await removeDemoData(demoDb(db));
    await loadDemoData(demoDb(db));

    expect(count(db, 'Routines')).toBe(1);
    expect(count(db, 'Workout_Log')).toBe(20);
  });
});
