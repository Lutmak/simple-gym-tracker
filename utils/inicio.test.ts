import {
  averageSessionDurationMinutes,
  buildInicioWeek,
  computeInicioStreak,
  type InicioInput,
} from './inicio';

const dayStamp = (ymd: string): number => {
  const [year, month, day] = ymd.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day, 12, 0, 0) / 1000);
};

const input = (weekSessions: InicioInput['weekSessions']): InicioInput => ({
  routine: { routineId: 1, name: 'Demo', unit: 'kg', roundingIncrement: 2.5 },
  cycles: [{ cycleId: 1, cycleNumber: 1, startedAt: dayStamp('2026-08-10') }],
  sessions: [
    { sessionId: 1, weekday: 1, name: 'Squat Day', sortOrder: 1 },
    { sessionId: 2, weekday: 3, name: 'Bench Day', sortOrder: 2 },
    { sessionId: 3, weekday: 5, name: 'Press Day', sortOrder: 3 },
  ],
  exercises: [],
  weekSessions,
});

describe('Inicio week', () => {
  it('uses the routine queue rows to show training and rest days in order', () => {
    const week = buildInicioWeek(
      input([
        {
          weekSessionId: 1,
          cycleId: 1,
          weekNumber: 1,
          sessionId: 1,
          status: 'completed',
          resolvedOnDate: dayStamp('2026-08-10'),
        },
        {
          weekSessionId: 2,
          cycleId: 1,
          weekNumber: 1,
          sessionId: 2,
          status: 'moved',
          resolvedOnDate: dayStamp('2026-08-14'),
        },
        {
          weekSessionId: 3,
          cycleId: 1,
          weekNumber: 1,
          sessionId: 3,
          status: 'pending',
          resolvedOnDate: null,
        },
      ]),
      dayStamp('2026-08-15'),
      'Monday',
    );

    expect(week.days.map((day) => day.status)).toEqual([
      'completed',
      'rest',
      'moved',
      'rest',
      'pending',
      'rest',
      'rest',
    ]);
    expect(week.days.map((day) => day.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(week.planned).toBe(3);
    expect(week.completed).toBe(2);
  });

  it('renders a routine with no cycle rows as planned pending days', () => {
    const week = buildInicioWeek(
      { ...input([]), weekSessions: [] },
      dayStamp('2026-08-15'),
      'Monday',
    );

    expect(week.days.map((day) => day.status)).toEqual([
      'pending',
      'rest',
      'pending',
      'rest',
      'pending',
      'rest',
      'rest',
    ]);
    expect(week.planned).toBe(3);
    expect(week.completed).toBe(0);
  });

  it('shows no planned days without an active routine', () => {
    const week = buildInicioWeek(
      { ...input([]), routine: null, sessions: [], cycles: [], weekSessions: [] },
      dayStamp('2026-08-15'),
      'Monday',
    );

    expect(week.days.every((day) => day.status === 'rest')).toBe(true);
    expect(week.planned).toBe(0);
    expect(week.completed).toBe(0);
  });
});

describe('Inicio streak', () => {
  it('counts moved sessions as done and stops at a discarded week', () => {
    const makeRow = (
      weekSessionId: number,
      weekNumber: number,
      sessionId: number,
      status: 'completed' | 'moved' | 'discarded' | 'pending',
      resolvedOnDate: number | null,
    ) => ({
      weekSessionId,
      cycleId: 1,
      weekNumber,
      sessionId,
      status,
      resolvedOnDate,
    });

    const streak = computeInicioStreak(
      input([
        makeRow(1, 1, 1, 'completed', dayStamp('2026-08-10')),
        makeRow(2, 1, 2, 'completed', dayStamp('2026-08-12')),
        makeRow(9, 1, 3, 'completed', dayStamp('2026-08-14')),
        makeRow(3, 2, 1, 'discarded', dayStamp('2026-08-17')),
        makeRow(4, 2, 2, 'completed', dayStamp('2026-08-19')),
        makeRow(10, 2, 3, 'completed', dayStamp('2026-08-21')),
        makeRow(5, 3, 1, 'moved', dayStamp('2026-08-28')),
        makeRow(6, 3, 2, 'completed', dayStamp('2026-08-26')),
        makeRow(11, 3, 3, 'completed', dayStamp('2026-08-28')),
        makeRow(7, 4, 1, 'completed', dayStamp('2026-08-31')),
        makeRow(8, 4, 2, 'pending', null),
      ]),
      dayStamp('2026-09-05'),
      'Monday',
    );

    expect(streak).toEqual({ weeks: 1, current: { planned: 3, completed: 1 } });
  });

  /**
   * P2 shows this same streak on Progreso, so the rule is pinned here once: a
   * week counts when every session **the routine planned** was done. A two-day
   * routine that trains twice a week is a complete week, not a 2/7 failure.
   */
  it('measures a two-day routine against its own two planned days', () => {
    const twoDayInput = (
      weekSessions: InicioInput['weekSessions'],
    ): InicioInput => ({
      routine: { routineId: 1, name: 'Two days', unit: 'kg', roundingIncrement: 2.5 },
      cycles: [{ cycleId: 1, cycleNumber: 1, startedAt: dayStamp('2026-08-10') }],
      sessions: [
        { sessionId: 1, weekday: 1, name: 'Upper', sortOrder: 1 },
        { sessionId: 2, weekday: 4, name: 'Lower', sortOrder: 2 },
      ],
      exercises: [],
      weekSessions,
    });
    const row = (
      weekSessionId: number,
      weekNumber: number,
      sessionId: number,
      status: 'completed' | 'moved' | 'discarded' | 'pending',
      resolvedOnDate: number | null,
    ) => ({ weekSessionId, cycleId: 1, weekNumber, sessionId, status, resolvedOnDate });

    // Week 1 done as planned; week 2 done with one session moved inside the week;
    // week 3 done as planned. Three complete weeks, no discard anywhere.
    const unbroken = computeInicioStreak(
      twoDayInput([
        row(1, 1, 1, 'completed', dayStamp('2026-08-10')),
        row(2, 1, 2, 'completed', dayStamp('2026-08-13')),
        row(3, 2, 1, 'completed', dayStamp('2026-08-17')),
        row(4, 2, 2, 'moved', dayStamp('2026-08-22')),
        row(5, 3, 1, 'completed', dayStamp('2026-08-24')),
        row(6, 3, 2, 'completed', dayStamp('2026-08-27')),
      ]),
      dayStamp('2026-08-31'),
      'Monday',
    );
    expect(unbroken.weeks).toBe(3);
    expect(unbroken.current.planned).toBe(2);

    // The same history with week 2's second session discarded instead of moved.
    const broken = computeInicioStreak(
      twoDayInput([
        row(1, 1, 1, 'completed', dayStamp('2026-08-10')),
        row(2, 1, 2, 'completed', dayStamp('2026-08-13')),
        row(3, 2, 1, 'completed', dayStamp('2026-08-17')),
        row(4, 2, 2, 'discarded', dayStamp('2026-08-20')),
        row(5, 3, 1, 'completed', dayStamp('2026-08-24')),
        row(6, 3, 2, 'completed', dayStamp('2026-08-27')),
      ]),
      dayStamp('2026-08-31'),
      'Monday',
    );
    expect(broken.weeks).toBe(1);
  });
});

describe('Inicio session estimate', () => {
  it('averages complete session timings and ignores incomplete history', () => {
    expect(
      averageSessionDurationMinutes([
        { startedAt: 0, completedAt: 50 * 60 * 1000 },
        { startedAt: 60 * 1000, completedAt: (70 * 60 + 60) * 1000 },
        { startedAt: 100 * 1000, completedAt: null },
      ]),
    ).toBe(60);
    expect(averageSessionDurationMinutes([])).toBeNull();
  });
});
