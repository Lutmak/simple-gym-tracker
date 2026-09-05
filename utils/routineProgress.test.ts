import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import { loadDemoData, type DemoDatabase } from './demoData';
import {
  buildCycleWeeks,
  buildLiftSeries,
  computeWeekAdherence,
  cycleAdherence,
  formatPlanLine,
  hasChartableSeries,
  hasProgressFocus,
  loadFreeLogDetail,
  loadMainLiftSeries,
  loadProgressRoutines,
  loadRoutineProgress,
  loadWeekDetail,
  sessionDetailsOfWeek,
  sessionExercises,
  weekSessionsDone,
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
            completedAt: null,
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

  it('counts a moved session as done and a discarded one as not done', () => {
    expect(
      weekSessionsDone({ planned: 4, completed: 2, moved: 1, discarded: 1, pending: 0 }),
    ).toBe(3);
    expect(
      weekSessionsDone({ planned: 3, completed: 0, moved: 0, discarded: 0, pending: 3 }),
    ).toBe(0);
  });

  it('adds a cycle adherence that never divides by zero', () => {
    const weeks = buildCycleWeeks({ status: 'complete', currentWeek: 4 }, 2, [
      { weekNumber: 1, status: 'completed' },
      { weekNumber: 1, status: 'moved' },
      { weekNumber: 2, status: 'completed' },
      { weekNumber: 2, status: 'discarded' },
    ]);
    expect(cycleAdherence(weeks)).toEqual({ done: 3, planned: 4, percent: 75 });
    expect(cycleAdherence([])).toEqual({ done: 0, planned: 0, percent: 0 });
    expect(
      cycleAdherence(buildCycleWeeks({ status: 'planned', currentWeek: 1 }, 3, [])),
    ).toEqual({ done: 0, planned: 0, percent: 0 });
  });

  it('lists a session as its plan first and anything extra that was logged after', () => {
    const views = sessionExercises({
      sessionId: 1,
      name: 'Squat Day',
      status: 'completed',
      date: 10,
      planned: [
        {
          sessionExerciseId: 1,
          name: 'Squat',
          role: 'main',
          targetSets: 3,
          targetReps: 5,
          targetWeight: 100,
          unit: 'kg',
          isAmrap: false,
          loadSource: 'training_max_pct',
          sets: [
            { targetReps: 5, targetWeight: 100, isAmrap: false },
            { targetReps: 5, targetWeight: 100, isAmrap: false },
            { targetReps: 5, targetWeight: 100, isAmrap: false },
          ],
        },
        {
          sessionExerciseId: 2,
          name: 'Plank',
          role: 'accessory',
          targetSets: 3,
          targetReps: 60,
          targetWeight: null,
          unit: 'kg',
          isAmrap: false,
          loadSource: 'bodyweight',
          sets: [
            { targetReps: 60, targetWeight: null, isAmrap: false },
            { targetReps: 60, targetWeight: null, isAmrap: false },
            { targetReps: 60, targetWeight: null, isAmrap: false },
          ],
        },
      ],
      logged: [
        {
          exerciseName: 'Curl',
          sets: [{ weightLogId: 3, setNumber: 1, weight: 20, reps: 12, unit: 'kg' }],
        },
        {
          exerciseName: 'Squat',
          sets: [{ weightLogId: 1, setNumber: 1, weight: 100, reps: 5, unit: 'kg' }],
        },
      ],
    });

    expect(views.map((view) => view.name)).toEqual(['Squat', 'Plank', 'Curl']);
    expect(views[0]?.planned?.targetWeight).toBe(100);
    expect(views[0]?.sets).toHaveLength(1);
    // Planned but not logged: the plan still shows, with nothing under it.
    expect(views[1]?.sets).toEqual([]);
    // Logged but not planned: an exercise added during the session (§3.4).
    expect(views[2]?.planned).toBeNull();
    expect(views[2]?.sets).toHaveLength(1);
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
    // Every main lift was logged in one unit, so each is exactly one series — P3's rule that a
    // series never spans a unit change.
    expect(series.every((entry) => entry.series.length === 1)).toBe(true);
    expect(series.every((entry) => entry.series[0].unit === 'kg')).toBe(true);

    // One point per logged session: 24 weeks per lift, minus the discarded
    // bench day and the unresolved press day.
    expect(series.map((entry) => entry.series[0].points.length)).toEqual([24, 23, 24, 23]);
    expect(series.every((entry) => hasChartableSeries(entry.series[0].points))).toBe(true);

    const squat = series[0].series[0];
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
    // U5: the first work set's own wave weight (65% of a 120 kg TM), not the
    // flat ~90%-of-TM figure `targetWeightFor` gave without a week number.
    expect(squatDay?.exercises[0]).toMatchObject({
      name: 'Barbell Full Squat',
      targetSets: 3,
      targetReps: 5,
      targetWeight: 77.5,
      unit: 'kg',
      isAmrap: true,
      loadSource: 'training_max_pct',
    });
    expect(squatDay?.exercises[0]?.sets).toEqual([
      { targetReps: 5, targetWeight: 77.5, isAmrap: false },
      { targetReps: 5, targetWeight: 90, isAmrap: false },
      { targetReps: 5, targetWeight: 102.5, isAmrap: true },
    ]);
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
    expect(
      latPulldown?.sets.map(({ setNumber, weight, reps, unit }) => ({
        setNumber,
        weight,
        reps,
        unit,
      })),
    ).toEqual([
      { setNumber: 1, weight: 110, reps: 10, unit: 'lb' },
      { setNumber: 2, weight: 110, reps: 10, unit: 'lb' },
      { setNumber: 3, weight: 110, reps: 10, unit: 'lb' },
    ]);
    // Every logged set carries the Weight_Log row an edit writes to (P1).
    expect(latPulldown?.sets.every((set) => Number.isInteger(set.weightLogId))).toBe(true);
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

  it('records when a completed cycle was finished, so the tile can say so', async () => {
    const { executor } = await setupDemo();
    const { cycles } = await loadRoutineProgress(executor, 1);
    expect(cycles[0]?.cycle.status).toBe('complete');
    expect(typeof cycles[0]?.cycle.completedAt).toBe('number');
    expect(cycles[5]?.cycle.status).toBe('active');
    expect(cycles[5]?.cycle.completedAt).toBeNull();
  });

  it('turns a week into one detail per session, dated, planned beside logged', async () => {
    const { executor } = await setupDemo();
    const details = sessionDetailsOfWeek(await loadWeekDetail(executor, 1, 2, 1));

    expect(details.map((detail) => detail.status)).toEqual([
      'completed',
      'completed',
      'moved',
      'completed',
    ]);
    expect(details[0]?.name).toBe('Squat Day');
    expect(details.every((detail) => detail.planned.length > 0)).toBe(true);
    expect(details.every((detail) => detail.logged.length > 0)).toBe(true);

    // The moved session sits on the day it landed on — Thursday to Saturday.
    const moved = details[2];
    expect(moved?.date).toBe(epoch('2026-04-04'));
    expect(moved?.date).not.toBe(epoch('2026-04-02'));
  });

  it('dates a discarded session on the day that counts as not done, with nothing logged', async () => {
    const { executor } = await setupDemo();
    const details = sessionDetailsOfWeek(await loadWeekDetail(executor, 1, 2, 2));
    const discarded = details.find((detail) => detail.status === 'discarded');
    expect(discarded?.logged).toEqual([]);
    expect(discarded?.planned.length).toBeGreaterThan(0);
    expect(typeof discarded?.date).toBe('number');
  });

  it('opens a free-logging session with what was logged and no plan', async () => {
    const { executor } = await setupDemo();
    const logRow = await executor.get(
      `SELECT workout_log_id FROM Workout_Log
       WHERE workout_log_id NOT IN (
         SELECT completed_log_id FROM WeekSessions WHERE completed_log_id IS NOT NULL
       );`,
      [],
    );
    const detail = await loadFreeLogDetail(executor, Number(logRow?.workout_log_id));

    expect(detail).not.toBeNull();
    expect(detail?.status).toBe('free');
    expect(detail?.date).toBe(epoch('2026-06-20'));
    expect(detail?.planned).toEqual([]);
    expect(detail?.logged.map((exercise) => exercise.exerciseName)).toEqual([
      'Hack Squat',
      'Cable Crossover',
    ]);
    expect(detail?.logged[0]?.sets).toHaveLength(3);
    expect(await loadFreeLogDetail(executor, 99999)).toBeNull();
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

describe('formatPlanLine — the session detail sheet\'s per-set plan line (SPEC.md U5)', () => {
  it('lists every set\'s own weight when a wave week\'s sets actually differ', () => {
    expect(
      formatPlanLine(
        [
          { targetReps: 5, targetWeight: 37.5, isAmrap: false },
          { targetReps: 5, targetWeight: 42.5, isAmrap: false },
          { targetReps: 5, targetWeight: 47.5, isAmrap: true },
        ],
        'kg',
        'training_max_pct',
        { label: 'Planificado', unlearnedWeight: 'peso por aprender', bodyweight: 'peso corporal' },
      ),
    ).toBe('Planificado: 37.5 · 42.5 · 47.5 kg × 5+');
  });

  it('collapses to one number when every set really does share the same weight', () => {
    expect(
      formatPlanLine(
        [
          { targetReps: 10, targetWeight: 100, isAmrap: false },
          { targetReps: 10, targetWeight: 100, isAmrap: false },
          { targetReps: 10, targetWeight: 100, isAmrap: false },
        ],
        'kg',
        'absolute',
        { label: 'Planificado', unlearnedWeight: 'peso por aprender', bodyweight: 'peso corporal' },
      ),
    ).toBe('Planificado: 100 kg × 10');
  });

  it('lists reps per set too when they differ, e.g. a 5/3/1+ wave week', () => {
    expect(
      formatPlanLine(
        [
          { targetReps: 5, targetWeight: 90, isAmrap: false },
          { targetReps: 3, targetWeight: 102, isAmrap: false },
          { targetReps: 1, targetWeight: 114, isAmrap: true },
        ],
        'kg',
        'training_max_pct',
        { label: 'Planned', unlearnedWeight: 'weight to learn', bodyweight: 'Bodyweight' },
      ),
    ).toBe('Planned: 90 · 102 · 114 kg × 5/3/1+');
  });

  it('reads "peso por aprender" for an unlearned training max, never a fabricated number', () => {
    expect(
      formatPlanLine(
        [
          { targetReps: 5, targetWeight: null, isAmrap: false },
          { targetReps: 5, targetWeight: null, isAmrap: false },
          { targetReps: 5, targetWeight: null, isAmrap: true },
        ],
        'kg',
        'training_max_pct',
        { label: 'Planificado', unlearnedWeight: 'peso por aprender', bodyweight: 'peso corporal' },
      ),
    ).toBe('Planificado: peso por aprender × 5+');
  });

  it('reads the bodyweight label instead, for a bodyweight exercise', () => {
    expect(
      formatPlanLine(
        [{ targetReps: 12, targetWeight: null, isAmrap: false }],
        'kg',
        'bodyweight',
        { label: 'Planificado', unlearnedWeight: 'peso por aprender', bodyweight: 'peso corporal' },
      ),
    ).toBe('Planificado: peso corporal × 12');
  });

  it('is just the label with no sets planned', () => {
    expect(
      formatPlanLine([], 'kg', 'absolute', {
        label: 'Planificado',
        unlearnedWeight: 'peso por aprender',
        bodyweight: 'peso corporal',
      }),
    ).toBe('Planificado');
  });
});
