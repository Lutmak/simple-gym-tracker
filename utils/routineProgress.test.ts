import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import { loadDemoData, type DemoDatabase } from './demoData';
import {
  buildCalendarMarkers,
  buildCycleWeeks,
  buildLiftSeries,
  computeWeekAdherence,
  hasChartableSeries,
  hasProgressFocus,
  loadCalendarLogs,
  loadMainLiftSeries,
  loadProgressRoutines,
  loadRoutineProgress,
  loadWeekDetail,
  logsOnDate,
} from './routineProgress';
import type { RoutineDatabase } from './routineActions';

type TestExecutor = SchemaExecutor & {
  get: RoutineDatabase['get'];
};

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
  run: (sql: string, params: SQLInputValue[] = []) =>
    db.prepare(sql).run(...params),
  get: (sql: string, params: SQLInputValue[] = []) =>
    db.prepare(sql).get(...params) as Record<string, unknown> | undefined,
});

const setupDemo = async (): Promise<{ db: DatabaseSync; executor: TestExecutor }> => {
  const { db, executor } = connect();
  await runSchema(executor);
  await loadDemoData(demoDb(db));
  return { db, executor };
};

describe('pure core', () => {
  it('recognizes an exact saved routine week for a progress deep link', () => {
    const data = {
      routine: {
        routineId: 4,
        name: 'Demo Routine',
        isActive: true,
        unit: 'kg' as const,
        roundingIncrement: 2.5,
      },
      cycles: [
        {
          cycle: {
            cycleId: 9,
            cycleNumber: 2,
            weeks: 4,
            status: 'active' as const,
            currentWeek: 3,
          },
          weeks: [
            {
              weekNumber: 3,
              adherence: {
                planned: 1,
                completed: 1,
                moved: 0,
                discarded: 0,
                pending: 0,
              },
              resolved: true,
              isCurrent: true,
            },
          ],
        },
      ],
    };

    expect(hasProgressFocus(data, { routineId: 4, cycleId: 9, weekNumber: 3 })).toBe(true);
    expect(hasProgressFocus(data, { routineId: 4, cycleId: 9, weekNumber: 2 })).toBe(false);
    expect(hasProgressFocus(data, { routineId: 5, cycleId: 9, weekNumber: 3 })).toBe(false);
  });

  it('computes adherence from WeekSessions statuses', () => {
    expect(
      computeWeekAdherence([
        { status: 'completed' },
        { status: 'moved' },
        { status: 'discarded' },
        { status: 'pending' },
      ]),
    ).toEqual({ planned: 4, completed: 1, moved: 1, discarded: 1, pending: 1 });
    expect(computeWeekAdherence([])).toEqual({
      planned: 0,
      completed: 0,
      moved: 0,
      discarded: 0,
      pending: 0,
    });
  });

  it('builds weeks 1..N in order and marks the active cycle current week', () => {
    const weeks = buildCycleWeeks(
      { status: 'active', currentWeek: 3 },
      4,
      [
        { weekNumber: 1, status: 'completed' },
        { weekNumber: 1, status: 'completed' },
        { weekNumber: 2, status: 'completed' },
        { weekNumber: 2, status: 'discarded' },
        { weekNumber: 3, status: 'pending' },
        { weekNumber: 3, status: 'pending' },
      ],
    );
    expect(weeks.map((week) => week.weekNumber)).toEqual([1, 2, 3, 4]);
    expect(weeks[0]).toMatchObject({ resolved: true, isCurrent: false });
    expect(weeks[0]?.adherence).toEqual({
      planned: 2,
      completed: 2,
      moved: 0,
      discarded: 0,
      pending: 0,
    });
    expect(weeks[1]?.adherence).toEqual({
      planned: 2,
      completed: 1,
      moved: 0,
      discarded: 1,
      pending: 0,
    });
    expect(weeks[2]).toMatchObject({ resolved: false, isCurrent: true });
    expect(weeks[3]).toMatchObject({ resolved: true, isCurrent: false });
  });

  it('never marks weeks of a complete cycle as current', () => {
    const weeks = buildCycleWeeks({ status: 'complete', currentWeek: 4 }, 4, []);
    expect(weeks.every((week) => !week.isCurrent)).toBe(true);
  });

  it('builds the top weight per session day, ascending by date', () => {
    const series = buildLiftSeries([
      { date: epoch('2026-04-13'), weight: 100, reps: 5, unit: 'kg' },
      { date: epoch('2026-04-06'), weight: 100, reps: 6, unit: 'kg' },
      { date: epoch('2026-04-06'), weight: 95, reps: 5, unit: 'kg' },
      { date: epoch('2026-04-06'), weight: 100, reps: 4, unit: 'kg' },
    ]);
    expect(series).toEqual([
      { date: epoch('2026-04-06'), weight: 100, reps: 6 },
      { date: epoch('2026-04-13'), weight: 100, reps: 5 },
    ]);
  });

  it('keeps the logged unit untouched', () => {
    const series = buildLiftSeries([
      { date: 1, weight: 110, reps: 10, unit: 'lb' },
      { date: 2, weight: 110, reps: 12, unit: 'lb' },
    ]);
    expect(series.map((point) => point.weight)).toEqual([110, 110]);
  });

  it('handles empty and single-point series explicitly', () => {
    expect(buildLiftSeries([])).toEqual([]);
    expect(buildLiftSeries([{ date: 1, weight: 100, reps: 5, unit: 'kg' }])).toHaveLength(1);
    expect(hasChartableSeries([])).toBe(false);
    expect(
      hasChartableSeries([{ date: 1, weight: 100, reps: 5 }]),
    ).toBe(false);
    expect(
      hasChartableSeries([
        { date: 1, weight: 100, reps: 5 },
        { date: 2, weight: 102.5, reps: 5 },
      ]),
    ).toBe(true);
  });

  it('builds calendar markers and lists the logs of one day', () => {
    const rows = [
      { workoutLogId: 1, workoutName: 'Demo Routine', dayName: 'Squat Day', date: 10 },
      { workoutLogId: 2, workoutName: 'Free', dayName: 'Free session', date: 10 },
      { workoutLogId: 3, workoutName: 'Demo Routine', dayName: 'Bench Day', date: 12 },
    ];
    const markers = buildCalendarMarkers(rows);
    expect(markers.get(10)).toBe(2);
    expect(markers.get(12)).toBe(1);
    expect(logsOnDate(rows, 10).map((row) => row.workoutLogId)).toEqual([1, 2]);
    expect(logsOnDate(rows, 99)).toEqual([]);
  });
});

describe('demo data through the db edges', () => {
  it('lists routines with the active wave one first and the linear one behind', async () => {
    const { executor } = await setupDemo();
    const routines = await loadProgressRoutines(executor);
    expect(routines).toHaveLength(2);
    expect(routines[0]).toMatchObject({
      name: 'Demo Routine',
      isActive: true,
      unit: 'kg',
      roundingIncrement: 2.5,
    });
    expect(routines[1]).toMatchObject({ name: 'Demo Linear', isActive: false });
  });

  it('returns six cycles in ascending order with the current week marked', async () => {
    const { executor } = await setupDemo();
    const { routine, cycles } = await loadRoutineProgress(executor, 1);

    expect(routine.name).toBe('Demo Routine');
    expect(cycles).toHaveLength(6);
    expect(cycles.map((view) => view.cycle.cycleNumber)).toEqual([1, 2, 3, 4, 5, 6]);

    for (const view of [cycles[0], cycles[2], cycles[3], cycles[4]]) {
      expect(view?.cycle.status).toBe('complete');
      expect(view?.weeks).toHaveLength(4);
      expect(view?.weeks.every((week) => week.resolved && !week.isCurrent)).toBe(true);
      for (const week of view?.weeks ?? []) {
        expect(week.adherence).toEqual({
          planned: 4,
          completed: 4,
          moved: 0,
          discarded: 0,
          pending: 0,
        });
      }
    }

    const cycle2 = cycles[1];
    expect(cycle2?.weeks[0]?.adherence).toEqual({
      planned: 4,
      completed: 3,
      moved: 1,
      discarded: 0,
      pending: 0,
    });
    expect(cycle2?.weeks[1]?.adherence).toEqual({
      planned: 4,
      completed: 3,
      moved: 0,
      discarded: 1,
      pending: 0,
    });
    expect(cycle2?.weeks[2]?.adherence).toEqual({
      planned: 4,
      completed: 4,
      moved: 0,
      discarded: 0,
      pending: 0,
    });

    const cycle6 = cycles[5];
    expect(cycle6?.cycle).toMatchObject({
      status: 'active',
      weeks: 4,
      currentWeek: 4,
    });
    expect(cycle6?.weeks[3]?.adherence).toEqual({
      planned: 4,
      completed: 3,
      moved: 0,
      discarded: 0,
      pending: 1,
    });
    expect(cycle6?.weeks[3]).toMatchObject({ resolved: false, isCurrent: true });
  });

  it('builds one series per main-role exercise with top weight per session', async () => {
    const { executor } = await setupDemo();
    const series = await loadMainLiftSeries(executor, 1);

    expect(series.map((entry) => entry.exerciseName)).toEqual([
      'Barbell Full Squat',
      'Barbell Bench Press - Medium Grip',
      'Barbell Deadlift',
      'Barbell Shoulder Press',
    ]);
    expect(series.every((entry) => entry.unit === 'kg')).toBe(true);

    // One point per logged session: 24 weeks per lift, minus the discarded
    // bench day and the unresolved press day.
    expect(series.map((entry) => entry.points.length)).toEqual([24, 23, 24, 23]);
    expect(series.every((entry) => hasChartableSeries(entry.points))).toBe(true);

    const squat = series[0];
    expect(squat?.points[0]).toMatchObject({
      date: epoch('2026-03-02'),
      weight: 85,
      reps: 5,
    });
    const last = squat?.points[squat.points.length - 1];
    expect(last?.date).toBe(epoch('2026-08-10'));

    // The lb accessory stays out of the main-lift view; its unit lives in the logs.
    expect(series.some((entry) => entry.exerciseName.includes('Lat'))).toBe(false);
  });

  it('returns every demo log date as a calendar marker', async () => {
    const { executor } = await setupDemo();
    const rows = await loadCalendarLogs(executor);
    expect(rows).toHaveLength(119);
    const markers = buildCalendarMarkers(rows);
    expect(markers.size).toBe(119);
    for (const count of markers.values()) {
      expect(count).toBe(1);
    }
    expect(markers.get(epoch('2026-04-04'))).toBe(1);
    expect(markers.get(epoch('2026-06-20'))).toBe(1);
    expect(logsOnDate(rows, epoch('2026-04-04'))).toHaveLength(1);
  });

  it('opens a resolved week with planned targets and logged sets side by side', async () => {
    const { executor } = await setupDemo();

    const week = await loadWeekDetail(executor, 1, 2, 1);
    expect(week).toMatchObject({
      routineName: 'Demo Routine',
      cycleNumber: 2,
      weekNumber: 1,
    });
    expect(week.sessionStatuses.map((status) => status.status)).toEqual([
      'completed',
      'completed',
      'moved',
      'completed',
    ]);

    expect(week.planned).toHaveLength(4);
    const squatDay = week.planned[0];
    expect(squatDay?.name).toBe('Squat Day');
    expect(squatDay?.exercises[0]).toMatchObject({
      name: 'Barbell Full Squat',
      targetSets: 3,
      targetReps: 5,
      targetWeight: 107.5,
      unit: 'kg',
      isAmrap: true,
    });
    expect(squatDay?.exercises[1]?.name).toBe('Bent Over Two-Dumbbell Row');

    // The logged side covers the moved session too — it was performed.
    expect(week.logged).toHaveLength(4);
    expect(week.logged.map((session) => session.exercises.length)).toEqual([4, 5, 4, 4]);

    const pressLogged = week.logged[3];
    expect(pressLogged?.exercises.map((exercise) => exercise.exerciseName)).toEqual([
      'Barbell Curl',
      'Barbell Shoulder Press',
      'Cable Crunch',
      'Wide-Grip Lat Pulldown',
    ]);
    const latPulldown = pressLogged?.exercises[3];
    expect(latPulldown?.sets).toEqual([
      { setNumber: 1, weight: 110, reps: 10, unit: 'lb' },
      { setNumber: 2, weight: 110, reps: 10, unit: 'lb' },
      { setNumber: 3, weight: 110, reps: 10, unit: 'lb' },
    ]);
  });

  it('shows a discarded session in the plan with no logged side', async () => {
    const { executor } = await setupDemo();
    const week = await loadWeekDetail(executor, 1, 2, 2);
    const statuses = week.sessionStatuses;
    expect(statuses[1]).toMatchObject({ status: 'discarded' });
    expect(week.logged.some((session) => session.sessionId === statuses[1]?.sessionId)).toBe(
      false,
    );
    expect(week.logged).toHaveLength(3);
  });

  it('leaves the current week partially resolved: three logged sessions, one pending', async () => {
    const { executor } = await setupDemo();
    const week = await loadWeekDetail(executor, 1, 6, 4);
    expect(week.sessionStatuses.map((status) => status.status)).toEqual([
      'completed',
      'completed',
      'completed',
      'pending',
    ]);
    expect(week.logged).toHaveLength(3);
    expect(week.planned).toHaveLength(4);
  });
});
