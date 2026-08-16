import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import { loadDemoData, type DemoDatabase } from './demoData';
import {
  applyLoggedSetEdit,
  updateLoggedSet,
  validateLoggedSetEdit,
} from './sessionLogEdit';
import { loadWeekDetail } from './routineProgress';
import type { LoggedSet } from './routineProgress';
import type { RoutineDatabase } from './routineActions';

type TestExecutor = SchemaExecutor & Pick<RoutineDatabase, 'get' | 'run'>;

const connect = (): { db: DatabaseSync; executor: TestExecutor } => {
  const db = new DatabaseSync(':memory:');
  const executor: TestExecutor = {
    exec: (sql) => db.exec(sql),
    run: (sql: string, params?: readonly unknown[]) => {
      db.prepare(sql).run(...((params ?? []) as SQLInputValue[]));
      return Promise.resolve(undefined);
    },
    getAll: <T>(sql: string, params: SQLInputValue[] = []) =>
      Promise.resolve(db.prepare(sql).all(...params) as T[]),
    get: <T>(sql: string, params: SQLInputValue[] = []) =>
      Promise.resolve(db.prepare(sql).get(...params) as T | undefined),
  };
  return { db, executor };
};

const demoDb = (db: DatabaseSync): DemoDatabase => ({
  run: (sql: string, params: SQLInputValue[] = []) => db.prepare(sql).run(...params),
  get: (sql: string, params: SQLInputValue[] = []) =>
    db.prepare(sql).get(...params) as Record<string, unknown> | undefined,
});

const setupDemo = async (): Promise<TestExecutor> => {
  const { db, executor } = connect();
  await runSchema(executor);
  await loadDemoData(demoDb(db));
  return executor;
};

const sets: LoggedSet[] = [
  { weightLogId: 11, setNumber: 1, weight: 100, reps: 5, unit: 'kg' },
  { weightLogId: 12, setNumber: 2, weight: 100, reps: 5, unit: 'kg' },
];

describe('validation', () => {
  it('accepts a whole rep count and a weight that is not negative', () => {
    expect(validateLoggedSetEdit({ reps: 5, weight: 100, unit: 'kg' })).toBeNull();
    expect(validateLoggedSetEdit({ reps: 1, weight: 0, unit: 'kg' })).toBeNull();
  });

  it('rejects a set nobody did, a fraction of a rep and a negative weight', () => {
    expect(validateLoggedSetEdit({ reps: 0, weight: 100, unit: 'kg' })).toBe('reps');
    expect(validateLoggedSetEdit({ reps: 2.5, weight: 100, unit: 'kg' })).toBe('reps');
    expect(validateLoggedSetEdit({ reps: 5, weight: -1, unit: 'kg' })).toBe('weight');
    expect(validateLoggedSetEdit({ reps: 5, weight: Number.NaN, unit: 'kg' })).toBe('weight');
  });
});

describe('applyLoggedSetEdit', () => {
  it('corrects one set and leaves its siblings alone', () => {
    const outcome = applyLoggedSetEdit(sets, 12, { reps: 4, weight: 97.5, unit: 'kg' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.sets[0]).toEqual(sets[0]);
    expect(outcome.sets[1]).toEqual({
      weightLogId: 12,
      setNumber: 2,
      weight: 97.5,
      reps: 4,
      unit: 'kg',
    });
  });

  it('never converts a unit — the row keeps the number that was typed', () => {
    const outcome = applyLoggedSetEdit(sets, 11, { reps: 5, weight: 225, unit: 'lb' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.sets[0]).toMatchObject({ weight: 225, unit: 'lb' });
    expect(outcome.sets[1]).toMatchObject({ weight: 100, unit: 'kg' });
  });

  it('rejects an unknown set and an impossible edit without touching the list', () => {
    expect(applyLoggedSetEdit(sets, 99, { reps: 5, weight: 100, unit: 'kg' })).toEqual({
      ok: false,
      reason: 'unknownSet',
    });
    expect(applyLoggedSetEdit(sets, 11, { reps: 0, weight: 100, unit: 'kg' })).toEqual({
      ok: false,
      reason: 'reps',
    });
  });
});

describe('the writer', () => {
  it('writes one corrected set back into a week the sheet can reopen', async () => {
    const executor = await setupDemo();
    const before = await loadWeekDetail(executor, 1, 2, 1);
    const target = before.logged[0]?.exercises[0]?.sets[0];
    expect(target).toBeDefined();

    await updateLoggedSet(executor, Number(target?.weightLogId), {
      reps: 3,
      weight: 92.5,
      unit: 'kg',
    });

    const after = await loadWeekDetail(executor, 1, 2, 1);
    expect(after.logged[0]?.exercises[0]?.sets[0]).toMatchObject({
      weightLogId: target?.weightLogId,
      reps: 3,
      weight: 92.5,
      unit: 'kg',
    });
    expect(after.logged[0]?.exercises[0]?.sets[1]).toMatchObject({
      weight: before.logged[0]?.exercises[0]?.sets[1]?.weight,
    });
  });

  it('keeps the exercise summary row in step with the sets it summarises', async () => {
    const executor = await setupDemo();
    const week = await loadWeekDetail(executor, 1, 2, 1);
    const exercise = week.logged[0]?.exercises[0];
    const last = exercise?.sets[(exercise?.sets.length ?? 1) - 1];

    await updateLoggedSet(executor, Number(last?.weightLogId), {
      reps: 7,
      weight: 90,
      unit: 'kg',
    });

    const summary = await executor.get(
      `SELECT le.reps FROM Logged_Exercises le
       JOIN Weight_Log wl ON wl.logged_exercise_id = le.logged_exercise_id
       WHERE wl.weight_log_id = ?;`,
      [Number(last?.weightLogId)],
    );
    expect(Number(summary?.reps)).toBe(7);
  });

  it('refuses to write an edit the pure layer rejects', async () => {
    const executor = await setupDemo();
    await expect(
      updateLoggedSet(executor, 1, { reps: 0, weight: 100, unit: 'kg' }),
    ).rejects.toThrow('reps');
  });
});
