import {
  averageSessionDurationMinutes,
  buildInicioUpcoming,
  buildInicioWeek,
  computeInicioCycleStats,
  computeInicioStreak,
  computeMainLiftColours,
  truncateHeroExercises,
  type InicioInput,
} from './inicio';

const dayStamp = (ymd: string): number => {
  const [year, month, day] = ymd.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day, 12, 0, 0) / 1000);
};

const input = (weekSessions: InicioInput['weekSessions']): InicioInput => ({
  routine: { routineId: 1, name: 'Demo', unit: 'kg', roundingIncrement: 2.5 },
  cycles: [{ cycleId: 1, cycleNumber: 1, startedAt: dayStamp('2026-08-10'), currentWeek: 1, weeks: 4, status: 'active' }],
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
          resolvedOnDate: dayStamp('2026-08-10'), nominalDate: null
        },
        {
          weekSessionId: 2,
          cycleId: 1,
          weekNumber: 1,
          sessionId: 2,
          status: 'moved',
          resolvedOnDate: dayStamp('2026-08-14'), nominalDate: null
        },
        {
          weekSessionId: 3,
          cycleId: 1,
          weekNumber: 1,
          sessionId: 3,
          status: 'pending',
          resolvedOnDate: null, nominalDate: null
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
      nominalDate: null,
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
      cycles: [{ cycleId: 1, cycleNumber: 1, startedAt: dayStamp('2026-08-10'), currentWeek: 1, weeks: 4, status: 'active' }],
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
    ) => ({ weekSessionId, cycleId: 1, weekNumber, sessionId, status, resolvedOnDate, nominalDate: null });

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

describe('Inicio week — the tappable day target', () => {
  it('gives a resolved day the target its session sheet needs, and a pending/rest day null', () => {
    const week = buildInicioWeek(
      input([
        {
          weekSessionId: 1, cycleId: 1, weekNumber: 1, sessionId: 1,
          status: 'completed', resolvedOnDate: dayStamp('2026-08-10'), nominalDate: null,
        },
        {
          weekSessionId: 3, cycleId: 1, weekNumber: 1, sessionId: 3,
          status: 'pending', resolvedOnDate: null, nominalDate: null,
        },
      ]),
      dayStamp('2026-08-15'),
      'Monday',
    );

    expect(week.days[0].target).toEqual({
      routineId: 1,
      cycleId: 1,
      cycleNumber: 1,
      weekNumber: 1,
      sessionId: 1,
    });
    // Wednesday (index 2) has no row at all — pending by default, not tappable.
    expect(week.days[2].target).toBeNull();
    // Friday (index 4) is an explicit pending row — still not tappable.
    expect(week.days[4].target).toBeNull();
    // Rest days (Tuesday, index 1) never carry a target.
    expect(week.days[1].target).toBeNull();
  });
});

describe('computeInicioCycleStats', () => {
  it('is null/zero without a routine', () => {
    expect(computeInicioCycleStats({ ...input([]), routine: null, sessions: [], cycles: [] })).toEqual({
      adherencePercent: null,
      cyclesCompleted: 0,
    });
  });

  it('counts only the rows up to the active cycle\'s current week', () => {
    const stats = computeInicioCycleStats({
      ...input([
        { weekSessionId: 1, cycleId: 1, weekNumber: 1, sessionId: 1, status: 'completed', resolvedOnDate: null, nominalDate: null },
        { weekSessionId: 2, cycleId: 1, weekNumber: 1, sessionId: 2, status: 'completed', resolvedOnDate: null, nominalDate: null },
        { weekSessionId: 3, cycleId: 1, weekNumber: 2, sessionId: 1, status: 'completed', resolvedOnDate: null, nominalDate: null },
        { weekSessionId: 4, cycleId: 1, weekNumber: 2, sessionId: 2, status: 'pending', resolvedOnDate: null, nominalDate: null },
        // Week 3 hasn't started yet (currentWeek is 2) — excluded from the denominator entirely.
        { weekSessionId: 5, cycleId: 1, weekNumber: 3, sessionId: 1, status: 'pending', resolvedOnDate: null, nominalDate: null },
      ]),
      cycles: [{ cycleId: 1, cycleNumber: 1, startedAt: dayStamp('2026-08-10'), currentWeek: 2, weeks: 4, status: 'active' }],
    });
    expect(stats.adherencePercent).toBe(75);
  });

  it('counts complete cycles regardless of the active one', () => {
    const stats = computeInicioCycleStats({
      ...input([]),
      cycles: [
        { cycleId: 1, cycleNumber: 1, startedAt: dayStamp('2026-07-01'), currentWeek: 4, weeks: 4, status: 'complete' },
        { cycleId: 2, cycleNumber: 2, startedAt: dayStamp('2026-08-01'), currentWeek: 4, weeks: 4, status: 'complete' },
        { cycleId: 3, cycleNumber: 3, startedAt: dayStamp('2026-08-29'), currentWeek: 1, weeks: 4, status: 'active' },
      ],
    });
    expect(stats.cyclesCompleted).toBe(2);
  });

  it('is null when the active cycle has no rows yet (a fresh cycle not yet seeded)', () => {
    const stats = computeInicioCycleStats({
      ...input([]),
      cycles: [{ cycleId: 1, cycleNumber: 1, startedAt: dayStamp('2026-08-10'), currentWeek: 1, weeks: 4, status: 'active' }],
    });
    expect(stats.adherencePercent).toBeNull();
  });
});

describe('buildInicioUpcoming — the "PRÓXIMAS" next-two list', () => {
  it('excludes the head and returns the next two, in date order', () => {
    // Squat Day is due today (the head); Bench and Press are later this week.
    const upcoming = buildInicioUpcoming(
      input([
        { weekSessionId: 1, cycleId: 1, weekNumber: 1, sessionId: 1, status: 'pending', resolvedOnDate: null, nominalDate: dayStamp('2026-08-10') },
        { weekSessionId: 2, cycleId: 1, weekNumber: 1, sessionId: 2, status: 'pending', resolvedOnDate: null, nominalDate: dayStamp('2026-08-12') },
        { weekSessionId: 3, cycleId: 1, weekNumber: 1, sessionId: 3, status: 'pending', resolvedOnDate: null, nominalDate: dayStamp('2026-08-14') },
      ]),
      dayStamp('2026-08-10'),
      2,
    );
    expect(upcoming.map((session) => session.name)).toEqual(['Bench Day', 'Press Day']);
  });

  it('on a rest day (no head) starts from the first pending row', () => {
    const upcoming = buildInicioUpcoming(
      input([
        { weekSessionId: 2, cycleId: 1, weekNumber: 1, sessionId: 2, status: 'pending', resolvedOnDate: null, nominalDate: dayStamp('2026-08-19') },
        { weekSessionId: 3, cycleId: 1, weekNumber: 1, sessionId: 3, status: 'pending', resolvedOnDate: null, nominalDate: dayStamp('2026-08-21') },
      ]),
      dayStamp('2026-08-18'),
      2,
    );
    expect(upcoming.map((session) => session.name)).toEqual(['Bench Day', 'Press Day']);
  });

  it('falls back to the plan once the seeded cycle runs out', () => {
    const upcoming = buildInicioUpcoming(
      input([
        { weekSessionId: 3, cycleId: 1, weekNumber: 4, sessionId: 3, status: 'pending', resolvedOnDate: null, nominalDate: dayStamp('2026-09-04') },
      ]),
      dayStamp('2026-09-03'),
      2,
    );
    expect(upcoming).toHaveLength(2);
    expect(upcoming[0].name).toBe('Press Day');
    // The fallback entry is plan-based: no materialised week-session row behind it yet.
    expect(upcoming[1].weekSessionId).toBeNull();
  });

  it('is empty without a routine', () => {
    expect(buildInicioUpcoming({ ...input([]), routine: null, sessions: [], cycles: [] }, dayStamp('2026-08-15'), 2)).toEqual([]);
  });
});

describe('truncateHeroExercises', () => {
  it('cuts the hero exercise list at the limit and counts the rest', () => {
    expect(truncateHeroExercises(['a', 'b', 'c', 'd'])).toEqual({ shown: ['a', 'b', 'c'], remaining: 1 });
    expect(truncateHeroExercises(['a', 'b'])).toEqual({ shown: ['a', 'b'], remaining: 0 });
    expect(truncateHeroExercises(['a', 'b', 'c', 'd', 'e'], 2)).toEqual({ shown: ['a', 'b'], remaining: 3 });
  });
});

describe('computeMainLiftColours', () => {
  it('colours the routine\'s main lifts from its own sessions and exercises', () => {
    const colours = computeMainLiftColours({
      ...input([]),
      sessions: [
        { sessionId: 1, weekday: 1, name: 'Squat Day', sortOrder: 1 },
        { sessionId: 2, weekday: 3, name: 'Bench Day', sortOrder: 2 },
      ],
      exercises: [
        {
          sessionId: 1, name: 'Squat', targetSets: 5, targetReps: 5, loadSource: 'training_max_pct',
          absoluteWeight: null, trainingMaxWeight: 100, trainingMaxPct: 0.9, unitOverride: null,
          isAmrap: false, sortOrder: 1, role: 'main',
        },
        {
          sessionId: 1, name: 'Leg Curl', targetSets: 3, targetReps: 10, loadSource: 'absolute',
          absoluteWeight: 20, trainingMaxWeight: null, trainingMaxPct: null, unitOverride: null,
          isAmrap: false, sortOrder: 2, role: 'accessory',
        },
        {
          sessionId: 2, name: 'Bench', targetSets: 5, targetReps: 5, loadSource: 'training_max_pct',
          absoluteWeight: null, trainingMaxWeight: 80, trainingMaxPct: 0.9, unitOverride: null,
          isAmrap: false, sortOrder: 1, role: 'main',
        },
      ],
    });
    expect(colours.get('Squat')).toBe(0);
    expect(colours.get('Bench')).toBe(1);
    expect(colours.has('Leg Curl')).toBe(false);
  });
});
