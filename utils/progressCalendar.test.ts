import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import { loadDemoData, type DemoDatabase } from './demoData';
import {
  PROGRESS_DAY_GLYPHS,
  PROGRESS_DAY_STATES,
  buildProgressCalendarDays,
  buildProgressMonth,
  dayStateOfStatus,
  loadProgressCalendar,
  sessionCalendarDate,
  type ProgressCalendarInput,
  type ProgressCalendarSessionRow,
} from './progressCalendar';
import type { RoutineDatabase } from './routineActions';

type TestExecutor = SchemaExecutor & { get: RoutineDatabase['get'] };

const epoch = (ymd: string): number => {
  const [year, month, day] = ymd.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day, 12, 0, 0) / 1000);
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

const session = (
  overrides: Partial<ProgressCalendarSessionRow> = {},
): ProgressCalendarSessionRow => ({
  weekSessionId: 1,
  cycleId: 1,
  cycleNumber: 1,
  cycleStartedAt: epoch('2026-03-02'),
  weekNumber: 1,
  sessionId: 1,
  sessionName: 'Squat Day',
  weekday: 1,
  status: 'pending',
  resolvedOnDate: null,
  ...overrides,
});

const input = (
  sessions: readonly ProgressCalendarSessionRow[],
  freeLogs: ProgressCalendarInput['freeLogs'] = [],
): ProgressCalendarInput => ({ routineId: 1, sessions, freeLogs });

describe('pure core', () => {
  it('maps every week-session status onto exactly one day state', () => {
    expect(dayStateOfStatus('pending')).toBe('planned');
    expect(dayStateOfStatus('completed')).toBe('done');
    expect(dayStateOfStatus('moved')).toBe('moved');
    expect(dayStateOfStatus('discarded')).toBe('discarded');
  });

  it('gives each of the five states its own glyph, so the legend needs no colour', () => {
    const glyphs = PROGRESS_DAY_STATES.map((state) => PROGRESS_DAY_GLYPHS[state]);
    expect(glyphs).toHaveLength(5);
    expect(new Set(glyphs).size).toBe(5);
    expect(glyphs.every((glyph) => glyph.trim() !== '')).toBe(true);
  });

  it('dates a session on its nominal cycle day while it is unresolved', () => {
    // Cycle starts Monday 2026-03-02; a Thursday session of week 2 is 2026-03-12.
    expect(sessionCalendarDate(session({ weekday: 4, weekNumber: 2 }))).toBe(
      epoch('2026-03-12'),
    );
  });

  it('dates a resolved session on the day it landed on, not on the plan', () => {
    expect(
      sessionCalendarDate(
        session({ weekday: 4, status: 'moved', resolvedOnDate: epoch('2026-03-07') }),
      ),
    ).toBe(epoch('2026-03-07'));
  });

  it('gives no day at all to a session whose cycle never started', () => {
    expect(sessionCalendarDate(session({ cycleStartedAt: null }))).toBeNull();
  });

  it('marks a month that holds a discard, a move and a free session', () => {
    const days = buildProgressCalendarDays(
      input(
        [
          session({ weekSessionId: 1, sessionId: 1, weekday: 1, status: 'completed', resolvedOnDate: epoch('2026-03-02') }),
          session({ weekSessionId: 2, sessionId: 2, weekday: 2, status: 'discarded', resolvedOnDate: epoch('2026-03-03') }),
          session({ weekSessionId: 3, sessionId: 3, weekday: 4, status: 'moved', resolvedOnDate: epoch('2026-03-07') }),
          session({ weekSessionId: 4, sessionId: 4, weekday: 5, status: 'pending' }),
        ],
        [{ workoutLogId: 9, workoutName: 'Free session', date: epoch('2026-03-08') }],
      ),
    );

    expect(days.get(epoch('2026-03-02'))?.state).toBe('done');
    expect(days.get(epoch('2026-03-03'))?.state).toBe('discarded');
    expect(days.get(epoch('2026-03-07'))?.state).toBe('moved');
    expect(days.get(epoch('2026-03-06'))?.state).toBe('planned');
    expect(days.get(epoch('2026-03-08'))?.state).toBe('free');
    // The Thursday it was moved away from is left blank: nothing happened there.
    expect(days.get(epoch('2026-03-05'))).toBeUndefined();
  });

  it('carries what tapping a marked day opens', () => {
    const days = buildProgressCalendarDays(
      input(
        [session({ status: 'completed', resolvedOnDate: epoch('2026-03-02'), cycleId: 7, cycleNumber: 2, weekNumber: 3, sessionId: 5 })],
        [{ workoutLogId: 9, workoutName: 'Free session', date: epoch('2026-03-08') }],
      ),
    );

    expect(days.get(epoch('2026-03-02'))?.target).toEqual({
      kind: 'session',
      routineId: 1,
      cycleId: 7,
      cycleNumber: 2,
      weekNumber: 3,
      sessionId: 5,
    });
    expect(days.get(epoch('2026-03-08'))?.target).toEqual({
      kind: 'freeLog',
      workoutLogId: 9,
      workoutName: 'Free session',
      date: epoch('2026-03-08'),
    });
  });

  it('lets the plan own a day a free log lands on, and a resolution own an unresolved plan', () => {
    const collision = epoch('2026-03-02');
    const planWins = buildProgressCalendarDays(
      input(
        [session({ status: 'completed', resolvedOnDate: collision })],
        [{ workoutLogId: 9, workoutName: 'Free session', date: collision }],
      ),
    );
    expect(planWins.get(collision)?.state).toBe('done');

    const resolvedWins = buildProgressCalendarDays(
      input([
        session({ weekSessionId: 1, status: 'pending', resolvedOnDate: collision }),
        session({ weekSessionId: 2, status: 'discarded', resolvedOnDate: collision }),
      ]),
    );
    expect(resolvedWins.get(collision)?.state).toBe('discarded');
  });

  it('starts the month on the weekday the setting asks for', () => {
    const days = buildProgressCalendarDays(input([]));
    const month = { year: 2026, month: 2 }; // March 2026 — the 1st is a Sunday.

    const sundayFirst = buildProgressMonth(month, 'Sunday', days);
    expect(sundayFirst[0]?.[0]?.day).toBe(1);

    const mondayFirst = buildProgressMonth(month, 'Monday', days);
    expect(mondayFirst[0]?.[0]).toBeNull();
    expect(mondayFirst[0]?.[6]?.day).toBe(1);

    for (const grid of [sundayFirst, mondayFirst]) {
      expect(grid.every((week) => week.length === 7)).toBe(true);
      const numbered = grid.flat().filter((cell) => cell !== null);
      expect(numbered).toHaveLength(31);
    }
  });

  it('hangs each month cell on its own day entry', () => {
    const days = buildProgressCalendarDays(
      input([session({ status: 'completed', resolvedOnDate: epoch('2026-03-02') })]),
    );
    const grid = buildProgressMonth({ year: 2026, month: 2 }, 'Monday', days);
    const marked = grid.flat().filter((cell) => cell !== null && cell.entry !== null);
    expect(marked).toHaveLength(1);
    expect(marked[0]?.day).toBe(2);
    expect(marked[0]?.entry?.name).toBe('Squat Day');
  });
});

describe('demo data through the db edges', () => {
  it('reads a month of the demo routine with every state it contains', async () => {
    const executor = await setupDemo();
    const days = buildProgressCalendarDays(await loadProgressCalendar(executor, 1));

    // Cycle 2 week 1: the deadlift day moved from Thursday to Saturday.
    expect(days.get(epoch('2026-04-04'))?.state).toBe('moved');
    expect(days.get(epoch('2026-04-02'))).toBeUndefined();

    // The free-logging session of 20 June belongs to no routine plan.
    const free = days.get(epoch('2026-06-20'));
    expect(free?.state).toBe('free');
    expect(free?.target.kind).toBe('freeLog');

    // The one discarded session of the seed is on the calendar, not deleted.
    const discarded = [...days.values()].filter((day) => day.state === 'discarded');
    expect(discarded).toHaveLength(1);

    // And the queue's single unresolved head is still a planned day.
    const planned = [...days.values()].filter((day) => day.state === 'planned');
    expect(planned).toHaveLength(1);

    const done = [...days.values()].filter((day) => day.state === 'done');
    expect(done.length).toBeGreaterThan(90);
  });

  it('reads a month of April 2026 as a grid a reader can scan', async () => {
    const executor = await setupDemo();
    const days = buildProgressCalendarDays(await loadProgressCalendar(executor, 1));
    const grid = buildProgressMonth({ year: 2026, month: 3 }, 'Monday', days);

    const marked = grid
      .flat()
      .filter((cell) => cell !== null && cell.entry !== null);
    // Four training days a week across a full month, plus the moved Saturday.
    expect(marked.length).toBeGreaterThanOrEqual(16);
    expect(marked.every((cell) => cell?.entry?.name !== '')).toBe(true);
  });

  it('never marks a day of a routine the screen is not showing', async () => {
    const executor = await setupDemo();
    const linear = buildProgressCalendarDays(await loadProgressCalendar(executor, 2));
    const wave = buildProgressCalendarDays(await loadProgressCalendar(executor, 1));

    const linearSessionDays = [...linear.values()].filter(
      (day) => day.target.kind === 'session',
    );
    const waveSessionDays = [...wave.values()].filter(
      (day) => day.target.kind === 'session',
    );
    expect(linearSessionDays.length).toBeGreaterThan(0);
    expect(
      linearSessionDays.every((day) =>
        day.target.kind === 'session' ? day.target.routineId === 2 : false,
      ),
    ).toBe(true);
    expect(
      waveSessionDays.every((day) =>
        day.target.kind === 'session' ? day.target.routineId === 1 : false,
      ),
    ).toBe(true);

    // Free logging belongs to no routine, so it shows on either view.
    expect(linear.get(epoch('2026-06-20'))?.state).toBe('free');
  });
});
