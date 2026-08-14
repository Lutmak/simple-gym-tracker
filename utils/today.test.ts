import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import { loadDemoData } from './demoData';
import type { RoutineDatabase } from './routineActions';
import {
  computeTodayState,
  dayStampOf,
  loadTodayState,
  nextOccurrenceStamp,
  nominalSessionStamp,
  resolveMissedSession,
  targetWeightFor,
  weekdayOfStamp,
  type TodayStateInput,
} from './today';

type TestExecutor = SchemaExecutor & {
  get: RoutineDatabase['get'];
  getAll: RoutineDatabase['getAll'];
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

const dayStampFromYmd = (ymd: string): number => {
  const [year, month, day] = ymd.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day, 12, 0, 0) / 1000);
};

const weekSessionRow = async (
  executor: TestExecutor,
  weekSessionId: number,
): Promise<Record<string, unknown> | undefined> =>
  executor.get('SELECT * FROM WeekSessions WHERE week_session_id = ?;', [weekSessionId]);

describe('date helpers', () => {
  test('day stamps land at UTC noon, day-aligned', () => {
    const stamp = dayStampOf(new Date(2026, 7, 14, 23, 59, 59));
    expect(stamp % 86400).toBe(43200);
    expect(stamp).toBe(dayStampFromYmd('2026-08-14'));
  });

  test('weekdayOfStamp uses the Date.getDay convention', () => {
    expect(weekdayOfStamp(dayStampFromYmd('2026-08-14'))).toBe(5);
    expect(weekdayOfStamp(dayStampFromYmd('2026-05-04'))).toBe(1);
    expect(weekdayOfStamp(dayStampFromYmd('2026-05-10'))).toBe(0);
  });

  test('nominalSessionStamp places a session in its cycle week', () => {
    const start = dayStampFromYmd('2026-05-04');
    expect(nominalSessionStamp(start, 1, 1)).toBe(dayStampFromYmd('2026-05-04'));
    expect(nominalSessionStamp(start, 1, 3)).toBe(dayStampFromYmd('2026-05-06'));
    expect(nominalSessionStamp(start, 4, 5)).toBe(dayStampFromYmd('2026-05-29'));
  });

  test('nextOccurrenceStamp finds the next weekday, inclusive', () => {
    const friday = dayStampFromYmd('2026-08-14');
    expect(nextOccurrenceStamp(friday, 5)).toBe(friday);
    expect(nextOccurrenceStamp(friday, 1)).toBe(dayStampFromYmd('2026-08-17'));
    expect(nextOccurrenceStamp(friday, 6)).toBe(dayStampFromYmd('2026-08-15'));
  });
});

describe('targetWeightFor', () => {
  test('absolute exercises resolve to their weight', () => {
    expect(
      targetWeightFor({ loadSource: 'absolute', absoluteWeight: 102.5, trainingMaxWeight: null, trainingMaxPct: null }, 2.5),
    ).toBe(102.5);
  });

  test('training_max_pct rounds to the routine increment', () => {
    expect(
      targetWeightFor({ loadSource: 'training_max_pct', absoluteWeight: null, trainingMaxWeight: 100, trainingMaxPct: 0.9 }, 2.5),
    ).toBe(90);
    expect(
      targetWeightFor({ loadSource: 'training_max_pct', absoluteWeight: null, trainingMaxWeight: 102.5, trainingMaxPct: 0.9 }, 2.5),
    ).toBe(92.5);
  });

  test('bodyweight has no weight', () => {
    expect(
      targetWeightFor({ loadSource: 'bodyweight', absoluteWeight: null, trainingMaxWeight: null, trainingMaxPct: null }, 2.5),
    ).toBeNull();
  });
});

describe('loadTodayState and computeTodayState against the demo data', () => {
  const demoDb = async (): Promise<{ executor: TestExecutor; db: RoutineDatabase }> => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(executor);
    return { executor, db: executor };
  };

  test('no active routine is the first-run state', async () => {
    const { executor } = connect();
    await runSchema(executor);
    const state = await loadTodayState(executor, dayStampFromYmd('2026-08-14'));
    expect(state.routine).toBeNull();
    expect(state.dueToday).toEqual([]);
    expect(state.missed).toEqual([]);
    expect(state.nextSession).toBeNull();
  });

  test('demo week-4 sessions are all missed on a date after the cycle', async () => {
    const { executor } = await demoDb();
    const state = await loadTodayState(executor, dayStampFromYmd('2026-08-14'));
    expect(state.routine?.name).toBe('Demo Routine');
    expect(state.dueToday).toEqual([]);
    expect(state.nextSession).toBeNull();
    expect(state.missed.map((session) => session.name)).toEqual([
      'Squat Day',
      'Bench Day',
      'Deadlift Day',
    ]);
    expect(state.missed.map((session) => session.date)).toEqual([
      dayStampFromYmd('2026-05-25'),
      dayStampFromYmd('2026-05-27'),
      dayStampFromYmd('2026-05-29'),
    ]);
  });

  test('a session whose nominal date is today is due with concrete targets', async () => {
    const { executor } = await demoDb();
    const state = await loadTodayState(executor, dayStampFromYmd('2026-05-25'));
    expect(state.missed).toEqual([]);
    expect(state.nextSession).toEqual({
      name: 'Bench Day',
      weekday: 3,
      date: dayStampFromYmd('2026-05-27'),
      weekSessionId: expect.any(Number) as number,
    });
    expect(state.dueToday).toHaveLength(1);
    const session = state.dueToday[0];
    expect(session?.name).toBe('Squat Day');
    expect(session?.weekday).toBe(1);
    expect(session?.exercises.map((exercise) => exercise.name)).toEqual([
      'Barbell Full Squat',
      'Bent Over Two-Dumbbell Row',
    ]);
    expect(session?.exercises[0]).toMatchObject({
      targetSets: 3,
      targetReps: 5,
      isAmrap: true,
      targetWeight: 102.5,
      unit: 'kg',
    });
    expect(session?.exercises[1]).toMatchObject({ targetWeight: 22.5, unit: 'kg' });
  });

  test('mid-week: the passed session is missed, the next one is upcoming', async () => {
    const { executor } = await demoDb();
    const state = await loadTodayState(executor, dayStampFromYmd('2026-05-26'));
    expect(state.dueToday).toEqual([]);
    expect(state.missed.map((session) => session.name)).toEqual(['Squat Day']);
    expect(state.nextSession).toEqual({
      name: 'Bench Day',
      weekday: 3,
      date: dayStampFromYmd('2026-05-27'),
      weekSessionId: expect.any(Number) as number,
    });
  });

  test('a do-it-today session becomes due today and stops prompting', async () => {
    const { executor } = await demoDb();
    const before = await loadTodayState(executor, dayStampFromYmd('2026-08-14'));
    const squat = before.missed.find((session) => session.name === 'Squat Day');
    expect(squat).toBeDefined();
    const today = dayStampFromYmd('2026-08-14');
    await resolveMissedSession(executor, (squat as { weekSessionId: number }).weekSessionId, 'doToday', {
      todayStamp: today,
    });

    const row = await weekSessionRow(executor, (squat as { weekSessionId: number }).weekSessionId);
    expect(row?.status).toBe('pending');
    expect(row?.resolved_on_date).toBe(today);

    const after = await loadTodayState(executor, today);
    expect(after.missed.map((session) => session.name)).toEqual(['Bench Day', 'Deadlift Day']);
    expect(after.dueToday.map((session) => session.name)).toEqual(['Squat Day']);
    expect(after.dueToday[0]?.date).toBe(today);
    expect(after.dueToday[0]?.exercises.length).toBe(2);
  });

  test('moving a session records the target day and never prompts again', async () => {
    const { executor } = await demoDb();
    const before = await loadTodayState(executor, dayStampFromYmd('2026-08-14'));
    const squat = before.missed.find((session) => session.name === 'Squat Day');
    expect(squat).toBeDefined();
    const today = dayStampFromYmd('2026-08-14');
    const target = dayStampFromYmd('2026-08-17');
    await resolveMissedSession(
      executor,
      (squat as { weekSessionId: number }).weekSessionId,
      'moved',
      { todayStamp: today, targetStamp: target },
    );

    const row = await weekSessionRow(executor, (squat as { weekSessionId: number }).weekSessionId);
    expect(row?.status).toBe('moved');
    expect(row?.resolved_on_date).toBe(target);

    const after = await loadTodayState(executor, today);
    expect(after.missed.map((session) => session.name)).toEqual(['Bench Day', 'Deadlift Day']);
    expect(after.dueToday).toEqual([]);

    await resolveMissedSession(
      executor,
      (squat as { weekSessionId: number }).weekSessionId,
      'discarded',
      { todayStamp: today },
    );
    const unchanged = await weekSessionRow(
      executor,
      (squat as { weekSessionId: number }).weekSessionId,
    );
    expect(unchanged?.status).toBe('moved');
    expect(unchanged?.resolved_on_date).toBe(target);
  });

  test('discarding a session resolves it', async () => {
    const { executor } = await demoDb();
    const before = await loadTodayState(executor, dayStampFromYmd('2026-08-14'));
    const squat = before.missed.find((session) => session.name === 'Squat Day');
    expect(squat).toBeDefined();
    const today = dayStampFromYmd('2026-08-14');
    await resolveMissedSession(executor, (squat as { weekSessionId: number }).weekSessionId, 'discarded', {
      todayStamp: today,
    });

    const row = await weekSessionRow(executor, (squat as { weekSessionId: number }).weekSessionId);
    expect(row?.status).toBe('discarded');
    expect(row?.resolved_on_date).toBe(today);

    const after = await loadTodayState(executor, today);
    expect(after.missed.map((session) => session.name)).toEqual(['Bench Day', 'Deadlift Day']);
  });

  test('move without a target day throws', async () => {
    const { executor } = await demoDb();
    const before = await loadTodayState(executor, dayStampFromYmd('2026-08-14'));
    const squat = before.missed[0];
    expect(squat).toBeDefined();
    await expect(
      resolveMissedSession(executor, (squat as { weekSessionId: number }).weekSessionId, 'moved', {
        todayStamp: dayStampFromYmd('2026-08-14'),
      }),
    ).rejects.toThrow('targetStamp is required');
  });

  test('a resolved week shows no session state at all', async () => {
    const { executor } = await demoDb();
    const state = await loadTodayState(executor, dayStampFromYmd('2026-05-18'));
    expect(state.dueToday).toEqual([]);
    expect(state.missed).toEqual([]);
    expect(state.nextSession).toEqual({
      name: 'Squat Day',
      weekday: 1,
      date: dayStampFromYmd('2026-05-25'),
      weekSessionId: expect.any(Number) as number,
    });
  });
});

describe('computeTodayState without a cycle', () => {
  const input: TodayStateInput = {
    routine: { routineId: 1, name: 'Plain', unit: 'kg', roundingIncrement: 2.5 },
    cycle: null,
    sessions: [
      { sessionId: 1, weekday: 1, name: 'Monday Only', sortOrder: 1 },
      { sessionId: 2, weekday: 3, name: 'Wednesday', sortOrder: 2 },
    ],
    exercises: [],
    weekSessions: [],
  };

  test('next session comes from the plan, never today itself', () => {
    const monday = dayStampFromYmd('2026-05-25');
    const state = computeTodayState(input, monday);
    expect(state.dueToday).toEqual([]);
    expect(state.missed).toEqual([]);
    expect(state.nextSession).toEqual({
      name: 'Wednesday',
      weekday: 3,
      date: dayStampFromYmd('2026-05-27'),
      weekSessionId: null,
    });
  });

  test('next session by weekday order from today', () => {
    const friday = dayStampFromYmd('2026-08-14');
    const state = computeTodayState(input, friday);
    expect(state.nextSession).toEqual({
      name: 'Monday Only',
      weekday: 1,
      date: dayStampFromYmd('2026-08-17'),
      weekSessionId: null,
    });
  });

  test('no sessions means no next session', () => {
    const state = computeTodayState({ ...input, sessions: [] }, dayStampFromYmd('2026-08-14'));
    expect(state.nextSession).toBeNull();
  });

  test('no routine is the invitation state', () => {
    const state = computeTodayState({ ...input, routine: null }, dayStampFromYmd('2026-08-14'));
    expect(state.routine).toBeNull();
    expect(state.dueToday).toEqual([]);
    expect(state.missed).toEqual([]);
    expect(state.nextSession).toBeNull();
  });
});

describe('computeTodayState with a cycle, pure', () => {
  const input = (weekSessions: TodayStateInput['weekSessions']): TodayStateInput => ({
    routine: { routineId: 1, name: 'Demo', unit: 'kg', roundingIncrement: 2.5 },
    cycle: { startedAt: dayStampFromYmd('2026-05-04'), currentWeek: 4, weeks: 4 },
    sessions: [{ sessionId: 1, weekday: 1, name: 'Squat Day', sortOrder: 1 }],
    exercises: [],
    weekSessions,
  });

  const pending = (
    weekSessionId: number,
    weekNumber: number,
    resolvedOnDate: number | null = null,
  ) => ({
    weekSessionId,
    weekNumber,
    sessionId: 1,
    status: 'pending' as const,
    resolvedOnDate,
  });

  test('a pending session in a past week is missed', () => {
    const state = computeTodayState(
      input([pending(1, 3)]),
      dayStampFromYmd('2026-08-14'),
    );
    expect(state.missed).toEqual([
      {
        weekSessionId: 1,
        sessionId: 1,
        name: 'Squat Day',
        weekday: 1,
        date: dayStampFromYmd('2026-05-18'),
      },
    ]);
  });

  test('a do-it-today intent suppresses the prompt', () => {
    const today = dayStampFromYmd('2026-08-14');
    const state = computeTodayState(input([pending(1, 4, today)]), today);
    expect(state.missed).toEqual([]);
    expect(state.dueToday).toEqual([
      {
        weekSessionId: 1,
        sessionId: 1,
        name: 'Squat Day',
        weekday: 1,
        date: today,
        exercises: [],
      },
    ]);
  });

  test('an unmarked future weekday is neither missed nor due', () => {
    const today = dayStampFromYmd('2026-05-25');
    const state = computeTodayState(
      input([pending(1, 4)]),
      today,
    );
    expect(state.dueToday.map((session) => session.weekSessionId)).toEqual([1]);
    expect(state.missed).toEqual([]);
  });

  test('week sessions without a session row are ignored', () => {
    const state = computeTodayState(
      { ...input([pending(1, 4)]), sessions: [] },
      dayStampFromYmd('2026-05-26'),
    );
    expect(state.missed).toHaveLength(0);
    expect(state.dueToday).toHaveLength(0);
    expect(state.nextSession).toBeNull();
  });
});
