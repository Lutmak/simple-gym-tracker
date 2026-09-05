import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import { loadDemoData } from './demoData';
import type { RoutineDatabase } from './routineActions';
import {
  applyDiscard,
  applyDoToday,
  applyMove,
  applyPullForwardSession,
  applyUndoDiscard,
  buildMoveDayPlan,
  computeSessionQueue,
  dayStampOf,
  latestResolvedCycleWeek,
  loadSessionQueue,
  nextOccurrenceStamp,
  nominalSessionStamp,
  resolveDiscardSession,
  resolveDoTodaySession,
  resolveMoveSession,
  resolvePullForwardSession,
  undoDiscardSession,
  targetSetsFor,
  targetWeightFor,
  weekdayOfStamp,
  type QueuedSession,
  type QueueWeekSessionRow,
  type SessionQueueInput,
} from './today';
import { applyReview, generateReview, resolveProposal, startNextCycle } from './cycleReview';
import { buildPlannedDraft, loadRunnerSession, saveSessionLog } from './sessionRunner';
import { writeWaveRoutine, type WaveSetupDraft } from './waveSetup';

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

  test('wave targets use the cycle week table for every planned set', () => {
    const exercise = {
      loadSource: 'training_max_pct' as const,
      absoluteWeight: null,
      trainingMaxWeight: 100,
      trainingMaxPct: 0.9,
      targetSets: 3,
      targetReps: 5,
      isAmrap: true,
    };

    expect(
      ([1, 2, 3, 4] as const).map((week) =>
        targetSetsFor(exercise, 2.5, week).map((set) => ({
          weight: set.targetWeight,
          reps: set.targetReps,
          isAmrap: set.isAmrap,
        })),
      ),
    ).toEqual([
      [
        { weight: 65, reps: 5, isAmrap: false },
        { weight: 75, reps: 5, isAmrap: false },
        { weight: 85, reps: 5, isAmrap: true },
      ],
      [
        { weight: 70, reps: 3, isAmrap: false },
        { weight: 80, reps: 3, isAmrap: false },
        { weight: 90, reps: 3, isAmrap: true },
      ],
      [
        { weight: 75, reps: 5, isAmrap: false },
        { weight: 85, reps: 3, isAmrap: false },
        { weight: 95, reps: 1, isAmrap: true },
      ],
      [
        { weight: 40, reps: 5, isAmrap: false },
        { weight: 50, reps: 5, isAmrap: false },
        { weight: 60, reps: 5, isAmrap: false },
      ],
    ]);
  });
});

describe('computeSessionQueue against the demo data', () => {
  const demoDb = async (): Promise<TestExecutor> => {
    const { executor } = connect();
    await runSchema(executor);
    await loadDemoData(executor);
    return executor;
  };

  test('no active routine is the first-run state', async () => {
    const { executor } = connect();
    await runSchema(executor);
    const state = await loadSessionQueue(executor, dayStampFromYmd('2026-08-14'));
    expect(state.routine).toBeNull();
    expect(state.head).toBeNull();
    expect(state.resolution).toBeNull();
    expect(state.upcoming).toBeNull();
  });

  test('the single unresolved past session — Friday\'s press — is the head', async () => {
    const executor = await demoDb();
    const state = await loadSessionQueue(executor, dayStampFromYmd('2026-08-15'));
    expect(state.routine?.name).toBe('Demo Routine');
    expect(state.resolution).toBe('unresolved');
    expect(state.head).toMatchObject({
      name: 'Press Day',
      weekday: 5,
      originDate: dayStampFromYmd('2026-08-14'),
      date: dayStampFromYmd('2026-08-14'),
      doTodayAvailable: true,
    });
    expect(state.upcoming).toBeNull();
  });

  test('a session whose nominal date is today is due with concrete targets', async () => {
    const executor = await demoDb();
    const state = await loadSessionQueue(executor, dayStampFromYmd('2026-08-14'));
    expect(state.resolution).toBe('due');
    expect(state.head?.name).toBe('Press Day');
    expect(state.head?.date).toBe(dayStampFromYmd('2026-08-14'));
    expect(state.head?.exercises.map((exercise) => exercise.name)).toEqual([
      'Barbell Shoulder Press',
      'Wide-Grip Lat Pulldown',
      'Barbell Curl',
      'Cable Crunch',
    ]);
    expect(state.head?.exercises[0]).toMatchObject({
      targetSets: 3,
      targetReps: 5,
      isAmrap: false,
      targetWeight: 25,
      unit: 'kg',
    });
    expect(state.head?.exercises[1]).toMatchObject({ targetWeight: 120, unit: 'lb' });
    expect(state.upcoming).toBeNull();
  });

  test('mid-week, before the session passes, nothing is due and it is upcoming', async () => {
    const executor = await demoDb();
    const state = await loadSessionQueue(executor, dayStampFromYmd('2026-08-12'));
    expect(state.resolution).toBeNull();
    expect(state.head).toBeNull();
    expect(state.upcoming).toMatchObject({
      name: 'Press Day',
      date: dayStampFromYmd('2026-08-14'),
      weekSessionId: expect.any(Number) as number,
    });
  });

  test('a rest day with nothing due shows the next pending session as upcoming', async () => {
    const executor = await demoDb();
    const state = await loadSessionQueue(executor, dayStampFromYmd('2026-08-09'));
    expect(state.head).toBeNull();
    expect(state.resolution).toBeNull();
    expect(state.upcoming).toMatchObject({
      name: 'Press Day',
      date: dayStampFromYmd('2026-08-14'),
      weekSessionId: expect.any(Number) as number,
    });
  });

  test('resolving the last pending session leaves the plan preview as upcoming', async () => {
    const executor = await demoDb();
    const state = await loadSessionQueue(executor, dayStampFromYmd('2026-08-15'));
    const head = state.head as QueuedSession;
    await resolveDiscardSession(executor, head.weekSessionId);

    const after = await loadSessionQueue(executor, dayStampFromYmd('2026-08-15'));
    expect(after.head).toBeNull();
    expect(after.upcoming).toEqual({
      name: 'Squat Day',
      weekday: 1,
      date: dayStampFromYmd('2026-08-17'),
      weekSessionId: null,
      sessionId: null,
    });
  });
});

describe('resolution writers against the demo data', () => {
  const demoDb = async (): Promise<TestExecutor> => {
    const { executor } = connect();
    await runSchema(executor);
    await loadDemoData(executor);
    return executor;
  };

  test('do it today makes the session due and keeps it the only head', async () => {
    const executor = await demoDb();
    const today = dayStampFromYmd('2026-08-15');
    const before = await loadSessionQueue(executor, today);
    const press = before.head as QueuedSession;
    expect(press.name).toBe('Press Day');
    await resolveDoTodaySession(executor, press.weekSessionId, today);

    const row = await weekSessionRow(executor, press.weekSessionId);
    expect(row?.status).toBe('pending');
    expect(row?.resolved_on_date).toBe(today);

    const after = await loadSessionQueue(executor, today);
    expect(after.resolution).toBe('due');
    expect(after.head?.name).toBe('Press Day');
    expect(after.head?.date).toBe(today);
    expect(after.head?.originDate).toBe(dayStampFromYmd('2026-08-14'));
    expect(after.upcoming).toBeNull();
  });

  test('moving a session records the target day and leaves the plan preview', async () => {
    const executor = await demoDb();
    const today = dayStampFromYmd('2026-08-15');
    const before = await loadSessionQueue(executor, today);
    const press = before.head as QueuedSession;
    const target = dayStampFromYmd('2026-08-16');
    await resolveMoveSession(executor, press.weekSessionId, target);

    const row = await weekSessionRow(executor, press.weekSessionId);
    expect(row?.status).toBe('moved');
    expect(row?.resolved_on_date).toBe(target);

    const after = await loadSessionQueue(executor, today);
    expect(after.head).toBeNull();
    expect(after.upcoming).toMatchObject({
      name: 'Squat Day',
      date: dayStampFromYmd('2026-08-17'),
      weekSessionId: null,
    });
  });

  test('moving onto a day that already has a session is rejected', async () => {
    const executor = await demoDb();
    const today = dayStampFromYmd('2026-08-15');
    const before = await loadSessionQueue(executor, today);
    const press = before.head as QueuedSession;
    await expect(
      resolveMoveSession(executor, press.weekSessionId, dayStampFromYmd('2026-08-10')),
    ).rejects.toThrow('dayOccupied');
    const unchanged = await weekSessionRow(executor, press.weekSessionId);
    expect(unchanged?.status).toBe('pending');
    expect(unchanged?.resolved_on_date).toBeNull();
  });

  test('discarding a session records it on its nominal day and reveals the plan preview', async () => {
    const executor = await demoDb();
    const today = dayStampFromYmd('2026-08-15');
    const before = await loadSessionQueue(executor, today);
    const press = before.head as QueuedSession;
    await resolveDiscardSession(executor, press.weekSessionId);

    const row = await weekSessionRow(executor, press.weekSessionId);
    expect(row?.status).toBe('discarded');
    expect(row?.resolved_on_date).toBe(dayStampFromYmd('2026-08-14'));

    const after = await loadSessionQueue(executor, today);
    expect(after.head).toBeNull();
    expect(after.upcoming?.name).toBe('Squat Day');
  });

  test('a second resolution of the same session is a no-op, not a delete', async () => {
    const executor = await demoDb();
    const today = dayStampFromYmd('2026-08-15');
    const before = await loadSessionQueue(executor, today);
    const press = before.head as QueuedSession;
    await resolveDiscardSession(executor, press.weekSessionId);
    await expect(
      resolveDiscardSession(executor, press.weekSessionId),
    ).rejects.toThrow('notPending');
    const row = await weekSessionRow(executor, press.weekSessionId);
    expect(row?.status).toBe('discarded');
  });

  test('undoing a discard restores the row and preserves the queue record', async () => {
    const executor = await demoDb();
    const today = dayStampFromYmd('2026-08-15');
    const before = await loadSessionQueue(executor, today);
    const press = before.head as QueuedSession;
    await resolveDiscardSession(executor, press.weekSessionId);
    const countBeforeUndo = await executor.get(
      'SELECT COUNT(*) AS count FROM WeekSessions;',
    );

    await undoDiscardSession(executor, press.weekSessionId);

    const row = await weekSessionRow(executor, press.weekSessionId);
    const countAfterUndo = await executor.get(
      'SELECT COUNT(*) AS count FROM WeekSessions;',
    );
    expect(row?.status).toBe('pending');
    expect(row?.resolved_on_date).toBeNull();
    expect(countAfterUndo?.count).toBe(countBeforeUndo?.count);
  });
});

describe('computeSessionQueue pure, without a cycle', () => {
  const input: SessionQueueInput = {
    routine: { routineId: 1, name: 'Plain', unit: 'kg', roundingIncrement: 2.5 },
    cycles: [],
    sessions: [
      { sessionId: 1, weekday: 1, name: 'Monday Only', sortOrder: 1 },
      { sessionId: 2, weekday: 3, name: 'Wednesday', sortOrder: 2 },
    ],
    exercises: [],
    weekSessions: [],
  };

  test('nothing pending: the next session comes from the plan, never today itself', () => {
    const monday = dayStampFromYmd('2026-05-25');
    const state = computeSessionQueue(input, monday);
    expect(state.head).toBeNull();
    expect(state.resolution).toBeNull();
    expect(state.upcoming).toEqual({
      name: 'Wednesday',
      weekday: 3,
      date: dayStampFromYmd('2026-05-27'),
      weekSessionId: null,
      sessionId: null,
    });
  });

  test('next session by weekday order from today', () => {
    const friday = dayStampFromYmd('2026-08-14');
    const state = computeSessionQueue(input, friday);
    expect(state.upcoming).toEqual({
      name: 'Monday Only',
      weekday: 1,
      date: dayStampFromYmd('2026-08-17'),
      weekSessionId: null,
      sessionId: null,
    });
  });

  test('no sessions means no upcoming', () => {
    const state = computeSessionQueue({ ...input, sessions: [] }, dayStampFromYmd('2026-08-14'));
    expect(state.upcoming).toBeNull();
  });

  test('no routine is the invitation state', () => {
    const state = computeSessionQueue({ ...input, routine: null }, dayStampFromYmd('2026-08-14'));
    expect(state.routine).toBeNull();
    expect(state.head).toBeNull();
    expect(state.resolution).toBeNull();
    expect(state.upcoming).toBeNull();
  });
});

describe('computeSessionQueue with a cycle, pure', () => {
  const input = (weekSessions: SessionQueueInput['weekSessions']): SessionQueueInput => ({
    routine: { routineId: 1, name: 'Demo', unit: 'kg', roundingIncrement: 2.5 },
    cycles: [{ cycleId: 1, cycleNumber: 1, startedAt: dayStampFromYmd('2026-05-04'), currentWeek: 1, weeks: 4, status: 'active' }],
    sessions: [
      { sessionId: 1, weekday: 1, name: 'Squat Day', sortOrder: 1 },
      { sessionId: 2, weekday: 3, name: 'Bench Day', sortOrder: 2 },
    ],
    exercises: [],
    weekSessions,
  });

  const pending = (weekSessionId: number, weekNumber: number, resolvedOnDate: number | null = null) =>
    ({
      weekSessionId,
      cycleId: 1,
      weekNumber,
      sessionId: 1,
      status: 'pending',
      resolvedOnDate,
    }) as QueueWeekSessionRow;

  const resolved = (
    weekSessionId: number,
    weekNumber: number,
    status: 'completed' | 'moved' | 'discarded',
    resolvedOnDate: number,
  ): QueueWeekSessionRow => ({
    weekSessionId,
    cycleId: 1,
    weekNumber,
    sessionId: 1,
    status,
    resolvedOnDate,
    nominalDate: null,
  });

  test('nothing pending on a rest day: no head, the plan preview is upcoming', () => {
    const saturday = dayStampFromYmd('2026-05-16');
    const state = computeSessionQueue(
      input([resolved(1, 1, 'completed', dayStampFromYmd('2026-05-04'))]),
      saturday,
    );
    expect(state.head).toBeNull();
    expect(state.upcoming).toEqual({
      name: 'Squat Day',
      weekday: 1,
      date: dayStampFromYmd('2026-05-18'),
      weekSessionId: null,
      sessionId: null,
    });
  });

  test('nothing pending on a training day: no head, the nearest plan day is upcoming', () => {
    const monday = dayStampFromYmd('2026-05-11');
    const state = computeSessionQueue(
      input([resolved(1, 1, 'completed', dayStampFromYmd('2026-05-04'))]),
      monday,
    );
    expect(state.head).toBeNull();
    expect(state.upcoming).toEqual({
      name: 'Bench Day',
      weekday: 3,
      date: dayStampFromYmd('2026-05-13'),
      weekSessionId: null,
      sessionId: null,
    });
  });

  test('a pending session in a past week is the unresolved head', () => {
    const state = computeSessionQueue(input([pending(1, 1)]), dayStampFromYmd('2026-08-14'));
    expect(state.resolution).toBe('unresolved');
    expect(state.head).toMatchObject({
      weekSessionId: 1,
      name: 'Squat Day',
      originDate: dayStampFromYmd('2026-05-04'),
    });
  });

  test('a do-it-today intent is due and suppresses the other past sessions', () => {
    const today = dayStampFromYmd('2026-08-14');
    const state = computeSessionQueue(
      input([pending(1, 4, today), pending(2, 3)]),
      today,
    );
    expect(state.resolution).toBe('due');
    expect(state.head?.weekSessionId).toBe(1);
    expect(state.head?.date).toBe(today);
    expect(state.head?.originDate).toBe(dayStampFromYmd('2026-05-25'));
    expect(state.upcoming?.weekSessionId).toBe(2);
  });

  test('a session whose nominal is today is due and nothing follows', () => {
    const today = dayStampFromYmd('2026-05-25');
    const state = computeSessionQueue(input([pending(1, 4)]), today);
    expect(state.resolution).toBe('due');
    expect(state.head?.weekSessionId).toBe(1);
    expect(state.upcoming).toBeNull();
  });

  test('the queue passes the cycle week to a wave exercise target', () => {
    const today = dayStampFromYmd('2026-05-11');
    const state = computeSessionQueue(
      {
        ...input([pending(1, 2)]),
        exercises: [
          {
            sessionId: 1,
            name: 'Squat',
            targetSets: 3,
            targetReps: 5,
            loadSource: 'training_max_pct',
            absoluteWeight: null,
            trainingMaxWeight: 100,
            trainingMaxPct: 0.9,
            unitOverride: null,
            isAmrap: true,
            sortOrder: 1,
            role: 'main',
          },
        ],
      },
      today,
    );

    expect(state.head?.exercises[0]).toMatchObject({
      targetWeight: 70,
      targetReps: 3,
      isAmrap: true,
    });
  });

  test('do it today is unavailable while another session occupies today', () => {
    const today = dayStampFromYmd('2026-05-06');
    const state = computeSessionQueue(
      input([
        { weekSessionId: 1, cycleId: 1, weekNumber: 1, sessionId: 1, status: 'pending', resolvedOnDate: null , nominalDate: null},
        { weekSessionId: 2, cycleId: 1, weekNumber: 1, sessionId: 2, status: 'pending', resolvedOnDate: null , nominalDate: null},
      ]),
      today,
    );
    expect(state.resolution).toBe('unresolved');
    expect(state.head?.doTodayAvailable).toBe(false);
    expect(state.head?.todayOccupiedBy).toBe('Bench Day');
  });

  test('week sessions without a session or cycle row are ignored', () => {
    const state = computeSessionQueue(
      { ...input([pending(1, 4)]), sessions: [], cycles: [] },
      dayStampFromYmd('2026-05-26'),
    );
    expect(state.head).toBeNull();
    expect(state.upcoming).toBeNull();
  });
});

describe('resolution transformations, pure', () => {
  const input = (weekSessions: SessionQueueInput['weekSessions']): SessionQueueInput => ({
    routine: { routineId: 1, name: 'Demo', unit: 'kg', roundingIncrement: 2.5 },
    cycles: [{ cycleId: 1, cycleNumber: 1, startedAt: dayStampFromYmd('2026-05-04'), currentWeek: 1, weeks: 4, status: 'active' }],
    sessions: [
      { sessionId: 1, weekday: 1, name: 'Squat Day', sortOrder: 1 },
      { sessionId: 2, weekday: 3, name: 'Bench Day', sortOrder: 2 },
    ],
    exercises: [],
    weekSessions,
  });

  const baseRows: QueueWeekSessionRow[] = [
    { weekSessionId: 1, cycleId: 1, weekNumber: 1, sessionId: 1, status: 'pending', resolvedOnDate: null , nominalDate: null},
    { weekSessionId: 2, cycleId: 1, weekNumber: 1, sessionId: 2, status: 'pending', resolvedOnDate: null , nominalDate: null},
  ];

  test('a moved session landing on a day that already has one is rejected', () => {
    const outcome = applyMove(input(baseRows), 1, dayStampFromYmd('2026-05-06'));
    expect(outcome).toEqual({ ok: false, reason: 'dayOccupied' });
  });

  test('a move onto a resolved session\'s day is also rejected', () => {
    const rows: QueueWeekSessionRow[] = [
      { ...baseRows[0] },
      { ...baseRows[1], status: 'completed', resolvedOnDate: dayStampFromYmd('2026-05-06') , nominalDate: null},
    ];
    const outcome = applyMove(input(rows), 1, dayStampFromYmd('2026-05-06'));
    expect(outcome).toEqual({ ok: false, reason: 'dayOccupied' });
  });

  test('a move to a free day changes only the date and the status', () => {
    const target = dayStampFromYmd('2026-05-07');
    const outcome = applyMove(input(baseRows), 1, target);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.weekSessions[0]).toEqual({
        weekSessionId: 1,
        cycleId: 1,
        weekNumber: 1,
        sessionId: 1,
        status: 'moved',
        resolvedOnDate: target, nominalDate: null
      });
      expect(outcome.weekSessions[1]).toEqual(baseRows[1]);
    }
  });

  test('do it today is rejected while another session occupies today', () => {
    const rows: QueueWeekSessionRow[] = [
      { ...baseRows[0] },
      { ...baseRows[1], status: 'completed', resolvedOnDate: dayStampFromYmd('2026-05-06') , nominalDate: null},
    ];
    const outcome = applyDoToday(input(rows), 1, dayStampFromYmd('2026-05-06'));
    expect(outcome).toEqual({ ok: false, reason: 'dayOccupied' });
  });

  test('do it today onto a free day keeps the session pending and due today', () => {
    const today = dayStampFromYmd('2026-05-06');
    const rows: QueueWeekSessionRow[] = [
      { ...baseRows[0], resolvedOnDate: null , nominalDate: null},
      { ...baseRows[1], weekNumber: 1, status: 'completed', resolvedOnDate: dayStampFromYmd('2026-05-04') , nominalDate: null},
    ];
    const outcome = applyDoToday(input(rows), 1, today);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.weekSessions[0]).toEqual({
        weekSessionId: 1,
        cycleId: 1,
        weekNumber: 1,
        sessionId: 1,
        status: 'pending',
        resolvedOnDate: today, nominalDate: null
      });
      const state = computeSessionQueue(input(outcome.weekSessions), today);
      expect(state.resolution).toBe('due');
      expect(state.head?.weekSessionId).toBe(1);
    }
  });

  test('discarding records the nominal day and never deletes the row', () => {
    const outcome = applyDiscard(input(baseRows), 1);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.weekSessions[0]).toEqual({
        weekSessionId: 1,
        cycleId: 1,
        weekNumber: 1,
        sessionId: 1,
        status: 'discarded',
        resolvedOnDate: dayStampFromYmd('2026-05-04'), nominalDate: null
      });
      const state = computeSessionQueue(input(outcome.weekSessions), dayStampFromYmd('2026-05-06'));
      expect(state.head?.weekSessionId).toBe(2);
      expect(state.head?.name).toBe('Bench Day');
    }
  });

  test('resolving a session that is not pending is rejected', () => {
    const rows: QueueWeekSessionRow[] = [
      { ...baseRows[0], status: 'moved', resolvedOnDate: dayStampFromYmd('2026-05-06') , nominalDate: null},
      { ...baseRows[1] },
    ];
    expect(applyMove(input(rows), 1, dayStampFromYmd('2026-05-07'))).toEqual({
      ok: false,
      reason: 'notPending',
    });
    expect(applyDoToday(input(rows), 1, dayStampFromYmd('2026-05-07'))).toEqual({
      ok: false,
      reason: 'notPending',
    });
    expect(applyDiscard(input(rows), 1)).toEqual({ ok: false, reason: 'notPending' });
  });

  test('discarding an undatable session is rejected', () => {
    const rows: QueueWeekSessionRow[] = [
      { ...baseRows[0], cycleId: 9 },
      { ...baseRows[1] },
    ];
    expect(applyDiscard(input(rows), 1)).toEqual({ ok: false, reason: 'undatable' });
  });

  test('move day choices start tomorrow and identify an occupied day', () => {
    const today = dayStampFromYmd('2026-05-05');
    const plan = buildMoveDayPlan(input(baseRows), 1, today);

    expect(plan.choices.map((choice) => choice.stamp)).toEqual([
      dayStampFromYmd('2026-05-06'),
      dayStampFromYmd('2026-05-07'),
      dayStampFromYmd('2026-05-08'),
    ]);
    expect(plan.choices[0]?.occupiedBy).toBe('Bench Day');
    expect(plan.choices[1]?.occupiedBy).toBeNull();
    expect(plan.minStamp).toBe(dayStampFromYmd('2026-05-06'));
    expect(plan.maxStamp).toBe(dayStampFromYmd('2026-06-02'));
  });

  test('undo discard restores the pending row without removing it', () => {
    const discarded = applyDiscard(input(baseRows), 1);
    expect(discarded.ok).toBe(true);
    if (!discarded.ok) {
      return;
    }

    const undone = applyUndoDiscard(input(discarded.weekSessions), 1);
    expect(undone).toEqual({
      ok: true,
      weekSessions: [
        { ...baseRows[0], status: 'pending', resolvedOnDate: null , nominalDate: null},
        baseRows[1],
      ],
    });
    expect(applyUndoDiscard(input(baseRows), 1)).toEqual({
      ok: false,
      reason: 'notDiscarded',
    });
  });
});

describe('applyPullForwardSession ("adelantar"), pure', () => {
  const input = (weekSessions: SessionQueueInput['weekSessions']): SessionQueueInput => ({
    routine: { routineId: 1, name: 'Demo', unit: 'kg', roundingIncrement: 2.5 },
    cycles: [
      {
        cycleId: 1,
        cycleNumber: 1,
        startedAt: dayStampFromYmd('2026-05-04'),
        currentWeek: 1,
        weeks: 4,
        status: 'active',
      },
    ],
    sessions: [
      { sessionId: 1, weekday: 1, name: 'Squat Day', sortOrder: 1 },
      { sessionId: 2, weekday: 3, name: 'Bench Day', sortOrder: 2 },
    ],
    exercises: [],
    weekSessions,
  });

  const baseRows: QueueWeekSessionRow[] = [
    { weekSessionId: 1, cycleId: 1, weekNumber: 1, sessionId: 1, status: 'pending', resolvedOnDate: null, nominalDate: null },
    { weekSessionId: 2, cycleId: 1, weekNumber: 1, sessionId: 2, status: 'pending', resolvedOnDate: null, nominalDate: null },
  ];

  test('on a rest day, pulls the next upcoming session onto today', () => {
    const restDay = dayStampFromYmd('2026-05-01');
    const outcome = applyPullForwardSession(input(baseRows), restDay);
    expect(outcome).toEqual({
      ok: true,
      weekSessionId: 1,
      weekSessions: [
        { ...baseRows[0], resolvedOnDate: restDay },
        baseRows[1],
      ],
    });
    if (outcome.ok) {
      const state = computeSessionQueue(input(outcome.weekSessions), restDay);
      expect(state.resolution).toBe('due');
      expect(state.head?.weekSessionId).toBe(1);
      expect(state.head?.name).toBe('Squat Day');
    }
  });

  test('stacking stays impossible: a second pull-forward the same day is rejected', () => {
    const restDay = dayStampFromYmd('2026-05-01');
    const first = applyPullForwardSession(input(baseRows), restDay);
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const second = applyPullForwardSession(input(first.weekSessions), restDay);
    expect(second).toEqual({ ok: false, reason: 'notRestDay' });
  });

  test('rejected when a session is already due today', () => {
    const dueToday = dayStampFromYmd('2026-05-04');
    expect(applyPullForwardSession(input(baseRows), dueToday)).toEqual({
      ok: false,
      reason: 'notRestDay',
    });
  });

  test('rejected when a past session is unresolved (not a rest day either)', () => {
    const outcome = applyPullForwardSession(input(baseRows), dayStampFromYmd('2026-05-10'));
    expect(outcome).toEqual({ ok: false, reason: 'notRestDay' });
  });

  test('rejected when there is nothing to pull forward: no cycle seeded yet', () => {
    const noCycleInput: SessionQueueInput = {
      routine: { routineId: 1, name: 'Demo', unit: 'kg', roundingIncrement: 2.5 },
      cycles: [],
      sessions: [
        { sessionId: 1, weekday: 1, name: 'Squat Day', sortOrder: 1 },
        { sessionId: 2, weekday: 3, name: 'Bench Day', sortOrder: 2 },
      ],
      exercises: [],
      weekSessions: [],
    };
    expect(applyPullForwardSession(noCycleInput, dayStampFromYmd('2026-05-01'))).toEqual({
      ok: false,
      reason: 'noUpcoming',
    });
  });
});

describe('resolvePullForwardSession, against the demo data', () => {
  test('writes resolved_on_date for the pulled-forward session and returns its id', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(executor);

    const restDay = dayStampFromYmd('2026-08-09');
    const before = await loadSessionQueue(executor, restDay);
    expect(before.head).toBeNull();
    const upcomingId = before.upcoming?.weekSessionId;
    expect(upcomingId).not.toBeNull();

    const weekSessionId = await resolvePullForwardSession(executor, restDay);
    expect(weekSessionId).toBe(upcomingId);

    const row = await weekSessionRow(executor, weekSessionId);
    expect(row?.resolved_on_date).toBe(restDay);
    expect(row?.status).toBe('pending');

    const after = await loadSessionQueue(executor, restDay);
    expect(after.resolution).toBe('due');
    expect(after.head?.weekSessionId).toBe(weekSessionId);

    db.close();
  });

  test('rejects when called again the same day (already pulled forward)', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    await loadDemoData(executor);

    const restDay = dayStampFromYmd('2026-08-09');
    await resolvePullForwardSession(executor, restDay);

    await expect(resolvePullForwardSession(executor, restDay)).rejects.toThrow('notRestDay');

    db.close();
  });
});

describe('queue boundaries', () => {
  test('a session unresolved across a week boundary stays the head', () => {
    const input: SessionQueueInput = {
      routine: { routineId: 1, name: 'Demo', unit: 'kg', roundingIncrement: 2.5 },
      cycles: [{ cycleId: 1, cycleNumber: 1, startedAt: dayStampFromYmd('2026-05-04'), currentWeek: 1, weeks: 4, status: 'active' }],
      sessions: [
        { sessionId: 1, weekday: 1, name: 'Squat Day', sortOrder: 1 },
        { sessionId: 2, weekday: 3, name: 'Bench Day', sortOrder: 2 },
      ],
      exercises: [],
      weekSessions: [
        { weekSessionId: 1, cycleId: 1, weekNumber: 1, sessionId: 1, status: 'pending', resolvedOnDate: null , nominalDate: null},
        { weekSessionId: 2, cycleId: 1, weekNumber: 4, sessionId: 2, status: 'pending', resolvedOnDate: null , nominalDate: null},
      ],
    };
    const state = computeSessionQueue(input, dayStampFromYmd('2026-06-08'));
    expect(state.resolution).toBe('unresolved');
    expect(state.head?.name).toBe('Squat Day');
    expect(state.head?.originDate).toBe(dayStampFromYmd('2026-05-04'));
    expect(state.upcoming?.name).toBe('Bench Day');
  });

  test('the head crosses a cycle boundary: an older cycle\'s unresolved session leads', () => {
    const input: SessionQueueInput = {
      routine: { routineId: 1, name: 'Demo', unit: 'kg', roundingIncrement: 2.5 },
      cycles: [
        { cycleId: 1, cycleNumber: 1, startedAt: dayStampFromYmd('2026-04-06'), currentWeek: 1, weeks: 4, status: 'active' },
        { cycleId: 2, cycleNumber: 2, startedAt: dayStampFromYmd('2026-05-04'), currentWeek: 1, weeks: 4, status: 'active' },
      ],
      sessions: [
        { sessionId: 1, weekday: 1, name: 'Squat Day', sortOrder: 1 },
        { sessionId: 2, weekday: 3, name: 'Bench Day', sortOrder: 2 },
      ],
      exercises: [],
      weekSessions: [
        { weekSessionId: 1, cycleId: 1, weekNumber: 1, sessionId: 1, status: 'pending', resolvedOnDate: null , nominalDate: null},
        { weekSessionId: 2, cycleId: 2, weekNumber: 1, sessionId: 1, status: 'pending', resolvedOnDate: null , nominalDate: null},
        { weekSessionId: 3, cycleId: 2, weekNumber: 1, sessionId: 2, status: 'pending', resolvedOnDate: null , nominalDate: null},
      ],
    };
    const state = computeSessionQueue(input, dayStampFromYmd('2026-05-18'));
    expect(state.resolution).toBe('unresolved');
    expect(state.head?.weekSessionId).toBe(1);
    expect(state.head?.originDate).toBe(dayStampFromYmd('2026-04-06'));
    expect(state.upcoming?.weekSessionId).toBe(2);
  });
});

describe('F4 — the queue reports a pending cycle review (§3.4)', () => {
  const singleLiftDraft = (overrides: Partial<WaveSetupDraft> = {}): WaveSetupDraft => ({
    name: 'F4 Test',
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
    ],
    ...overrides,
  });

  it(
    'reports the review as its head once week 4 resolves with no review ever opened, and ' +
      'cycle 2 week 1 once the review is applied and the next cycle started',
    async () => {
      const { executor } = connect();
      await runSchema(executor);
      const routineId = await writeWaveRoutine(executor, singleLiftDraft());
      const cycle1Row = await executor.get(
        `SELECT cycle_id FROM Cycles WHERE routine_id = ? AND status = 'active';`,
        [routineId],
      );
      if (cycle1Row === undefined) {
        throw new Error('Routine did not seed a cycle');
      }
      const cycle1Id = Number((cycle1Row as { cycle_id: number }).cycle_id);

      const day = Math.floor(Date.UTC(2026, 7, 14, 12, 0, 0) / 1000);
      // Weeks 1-4, logged through the real saveSessionLog path. No week's
      // review is ever opened along the way — the whole point of the test.
      for (let weekNumber = 1; weekNumber <= 4; weekNumber += 1) {
        const weekSessionRow = await executor.get(
          `SELECT ws.week_session_id FROM WeekSessions ws
           JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
           WHERE cw.cycle_id = ? AND cw.week_number = ? AND ws.status = 'pending'
           ORDER BY ws.week_session_id LIMIT 1;`,
          [cycle1Id, weekNumber],
        );
        if (weekSessionRow === undefined) {
          throw new Error(`No pending week ${weekNumber} session`);
        }
        const weekSessionId = Number((weekSessionRow as { week_session_id: number }).week_session_id);
        const stamp = day + (weekNumber - 1) * 7 * 86400;
        const session = await loadRunnerSession(executor, weekSessionId, stamp);
        await saveSessionLog(executor, weekSessionId, session, [
          [
            { reps: 5, weight: 100 },
            { reps: 5, weight: 100 },
            { reps: 5, weight: 100 },
          ],
        ]);
      }

      // current_week reached the cycle's own last week on its own (F4) —
      // nothing here ever called generateReview/applyReview.
      const cycleAfterWeek4 = await executor.get(
        `SELECT current_week, weeks, status FROM Cycles WHERE cycle_id = ?;`,
        [cycle1Id],
      );
      expect(cycleAfterWeek4).toMatchObject({ current_week: 4, weeks: 4, status: 'active' });

      const laterStamp = day + 60 * 86400;
      const queueBefore = await loadSessionQueue(executor, laterStamp);
      expect(queueBefore.head).toBeNull();
      expect(queueBefore.review).toEqual({
        cycleId: cycle1Id,
        cycleNumber: 1,
        completedSessions: 4,
        totalSessions: 4,
      });

      // Now actually apply the review and start the next cycle.
      await generateReview(executor, routineId, cycle1Id);
      const pending = await executor.getAll<{ proposal_id: number }>(
        `SELECT proposal_id FROM Progression_Proposal WHERE cycle_id = ? AND status = 'pending';`,
        [cycle1Id],
      );
      expect(pending.length).toBeGreaterThan(0);
      for (const { proposal_id: proposalId } of pending) {
        await resolveProposal(executor, proposalId, 'accepted');
      }
      const result = await applyReview(executor, routineId, cycle1Id);
      expect(result.completed).toBe(true);
      const cycle2Id = await startNextCycle(executor, routineId, cycle1Id);

      const cycle2Week1 = await executor.get(
        `SELECT ws.week_session_id FROM WeekSessions ws
         JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
         WHERE cw.cycle_id = ? AND cw.week_number = 1;`,
        [cycle2Id],
      );
      if (cycle2Week1 === undefined) {
        throw new Error('Cycle 2 was not seeded');
      }

      const queueAfter = await loadSessionQueue(executor, laterStamp);
      expect(queueAfter.review).toBeNull();
      expect(queueAfter.head?.weekSessionId).toBe(
        Number((cycle2Week1 as { week_session_id: number }).week_session_id),
      );
    },
  );
});

describe('latestResolvedCycleWeek — the pure calculation behind advance and undo', () => {
  it('is 0 when nothing is resolved', () => {
    expect(
      latestResolvedCycleWeek(
        [
          { weekNumber: 1, status: 'pending' },
          { weekNumber: 2, status: 'pending' },
        ],
        4,
      ),
    ).toBe(0);
  });

  it('is the latest week with zero pending rows, ignoring a later resolved week with a pending row', () => {
    expect(
      latestResolvedCycleWeek(
        [
          { weekNumber: 1, status: 'completed' },
          { weekNumber: 2, status: 'completed' },
          { weekNumber: 3, status: 'discarded' },
          { weekNumber: 4, status: 'pending' },
        ],
        4,
      ),
    ).toBe(3);
  });

  it('never exceeds the cycle length even if every week resolved', () => {
    expect(
      latestResolvedCycleWeek(
        [
          { weekNumber: 1, status: 'completed' },
          { weekNumber: 2, status: 'completed' },
        ],
        1,
      ),
    ).toBe(1);
  });

  it('treats a week as unresolved if ANY of its sessions is still pending', () => {
    expect(
      latestResolvedCycleWeek(
        [
          { weekNumber: 1, status: 'completed' },
          { weekNumber: 1, status: 'pending' },
        ],
        4,
      ),
    ).toBe(0);
  });
});

describe('U5 — undoDiscardSession reverses the current_week advance it undid (Phase F owed item)', () => {
  const singleLiftDraft = (overrides: Partial<WaveSetupDraft> = {}): WaveSetupDraft => ({
    name: 'Undo Test',
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
    ],
    ...overrides,
  });

  const weekSessionIdFor = async (
    executor: TestExecutor,
    cycleId: number,
    weekNumber: number,
  ): Promise<number> => {
    const row = await executor.get(
      `SELECT ws.week_session_id FROM WeekSessions ws
       JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
       WHERE cw.cycle_id = ? AND cw.week_number = ? AND ws.status = 'pending'
       ORDER BY ws.week_session_id LIMIT 1;`,
      [cycleId, weekNumber],
    );
    if (row === undefined) {
      throw new Error(`No pending week ${weekNumber} session`);
    }
    return Number((row as { week_session_id: number }).week_session_id);
  };

  it('un-discarding week 3 drops current_week from 3 back to 2, matching what actually resolved', async () => {
    const { executor } = connect();
    await runSchema(executor);
    const routineId = await writeWaveRoutine(executor, singleLiftDraft());
    const cycleRow = await executor.get(
      `SELECT cycle_id FROM Cycles WHERE routine_id = ? AND status = 'active';`,
      [routineId],
    );
    if (cycleRow === undefined) {
      throw new Error('Routine did not seed a cycle');
    }
    const cycleId = Number((cycleRow as { cycle_id: number }).cycle_id);
    const day = Math.floor(Date.UTC(2026, 7, 14, 12, 0, 0) / 1000);

    // Weeks 1 and 2 logged for real, advancing current_week to 2 (F4).
    for (let weekNumber = 1; weekNumber <= 2; weekNumber += 1) {
      const weekSessionId = await weekSessionIdFor(executor, cycleId, weekNumber);
      const stamp = day + (weekNumber - 1) * 7 * 86400;
      const session = await loadRunnerSession(executor, weekSessionId, stamp);
      await saveSessionLog(executor, weekSessionId, session, [
        [{ reps: 5, weight: 100 }],
      ]);
    }
    const cycleAfterWeek2 = await executor.get(
      `SELECT current_week FROM Cycles WHERE cycle_id = ?;`,
      [cycleId],
    );
    expect(cycleAfterWeek2).toMatchObject({ current_week: 2 });

    // Discarding week 3's only session resolves week 3 with no pending rows,
    // so current_week advances to 3 even though nothing was logged for it.
    const week3SessionId = await weekSessionIdFor(executor, cycleId, 3);
    await resolveDiscardSession(executor, week3SessionId);
    const cycleAfterDiscard = await executor.get(
      `SELECT current_week FROM Cycles WHERE cycle_id = ?;`,
      [cycleId],
    );
    expect(cycleAfterDiscard).toMatchObject({ current_week: 3 });

    // Undoing the discard makes week 3 pending again — current_week must
    // fall back to 2, the actual latest fully-resolved week.
    await undoDiscardSession(executor, week3SessionId);
    const cycleAfterUndo = await executor.get(
      `SELECT current_week FROM Cycles WHERE cycle_id = ?;`,
      [cycleId],
    );
    expect(cycleAfterUndo).toMatchObject({ current_week: 2 });

    const week3Row = await executor.get(
      `SELECT status, resolved_on_date FROM WeekSessions WHERE week_session_id = ?;`,
      [week3SessionId],
    );
    expect(week3Row).toMatchObject({ status: 'pending', resolved_on_date: null });
  });
});
