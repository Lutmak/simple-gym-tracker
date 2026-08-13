/**
 * The seeded demo routine: one active linear routine with two cycles of logged
 * history. `buildDemoRows` is pure — it produces typed row objects with stable
 * keys; `loadDemoData` / `removeDemoData` are the thin imperative edges that
 * resolve the keys to ids and write the rows. Loading is idempotent (guarded on
 * the routine key), removal restores the database, and reload works.
 */

export type DemoWeightUnit = 'kg' | 'lb';
export type DemoLoadSource = 'training_max_pct' | 'absolute' | 'bodyweight';
export type DemoSessionStatus = 'pending' | 'completed' | 'moved' | 'discarded';
export type DemoProposalStatus = 'pending' | 'accepted' | 'held' | 'edited' | 'declined';

export const DEMO_ROUTINE_KEY = 'demo-linear-3day';
export const DEMO_ROUTINE_NAME = 'Demo Routine';

export interface DemoRoutineRow {
  routineKey: string;
  name: string;
  origin: 'catalog' | 'user';
  progressionRule: 'wave' | 'linear' | 'none';
  unit: DemoWeightUnit;
  roundingIncrement: number;
  restMainSeconds: number;
  restAccessorySeconds: number;
  isActive: boolean;
  createdAt: number;
}

export interface DemoSessionRow {
  sessionKey: string;
  weekday: number;
  name: string;
  sortOrder: number;
}

export interface DemoSessionExerciseRow {
  exerciseKey: string;
  sessionKey: string;
  catalogKey: string | null;
  name: string;
  role: 'main' | 'accessory';
  targetSets: number;
  targetReps: number;
  loadSource: DemoLoadSource;
  absoluteWeight: number | null;
  unitOverride: DemoWeightUnit | null;
  isAmrap: boolean;
  sortOrder: number;
}

export interface DemoCycleRow {
  cycleKey: string;
  cycleNumber: number;
  weeks: number;
  status: 'planned' | 'active' | 'complete';
  currentWeek: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface DemoCycleWeekRow {
  cycleKey: string;
  weekNumber: number;
}

export interface DemoSet {
  weight: number;
  reps: number;
}

export interface DemoWeekSessionRow {
  cycleKey: string;
  weekNumber: number;
  sessionKey: string;
  status: DemoSessionStatus;
  date: number;
  results: Record<string, DemoSet[]>;
}

export interface DemoProposalRow {
  sessionExerciseKey: string;
  currentTarget: number;
  proposedTarget: number;
  unit: DemoWeightUnit;
  reason: string;
  status: Exclude<DemoProposalStatus, 'pending'>;
}

export interface DemoRows {
  routine: DemoRoutineRow;
  sessions: DemoSessionRow[];
  exercises: DemoSessionExerciseRow[];
  cycles: DemoCycleRow[];
  cycleWeeks: DemoCycleWeekRow[];
  weekSessions: DemoWeekSessionRow[];
  proposals: DemoProposalRow[];
}

const epoch = (ymd: string): number => {
  const [year, month, day] = ymd.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day, 12, 0, 0) / 1000);
};

const SESSIONS: readonly DemoSessionRow[] = [
  { sessionKey: 'squat-day', weekday: 1, name: 'Squat Day', sortOrder: 1 },
  { sessionKey: 'bench-day', weekday: 3, name: 'Bench Day', sortOrder: 2 },
  { sessionKey: 'deadlift-day', weekday: 5, name: 'Deadlift Day', sortOrder: 3 },
];

const EXERCISES: readonly Omit<DemoSessionExerciseRow, 'sortOrder'>[] = [
  {
    exerciseKey: 'squat',
    sessionKey: 'squat-day',
    catalogKey: 'Barbell_Full_Squat',
    name: 'Barbell Full Squat',
    role: 'main',
    targetSets: 3,
    targetReps: 5,
    loadSource: 'absolute',
    absoluteWeight: 102.5,
    unitOverride: null,
    isAmrap: true,
  },
  {
    exerciseKey: 'row',
    sessionKey: 'squat-day',
    catalogKey: 'Bent_Over_Two-Dumbbell_Row',
    name: 'Bent Over Two-Dumbbell Row',
    role: 'accessory',
    targetSets: 3,
    targetReps: 10,
    loadSource: 'absolute',
    absoluteWeight: 22.5,
    unitOverride: null,
    isAmrap: false,
  },
  {
    exerciseKey: 'bench',
    sessionKey: 'bench-day',
    catalogKey: 'Barbell_Bench_Press_-_Medium_Grip',
    name: 'Barbell Bench Press - Medium Grip',
    role: 'main',
    targetSets: 3,
    targetReps: 5,
    loadSource: 'absolute',
    absoluteWeight: 70,
    unitOverride: null,
    isAmrap: false,
  },
  {
    exerciseKey: 'ohp',
    sessionKey: 'bench-day',
    catalogKey: 'Barbell_Shoulder_Press',
    name: 'Barbell Shoulder Press',
    role: 'main',
    targetSets: 3,
    targetReps: 5,
    loadSource: 'absolute',
    absoluteWeight: 45,
    unitOverride: null,
    isAmrap: false,
  },
  {
    exerciseKey: 'lat-pulldown',
    sessionKey: 'bench-day',
    catalogKey: 'Wide-Grip_Lat_Pulldown',
    name: 'Wide-Grip Lat Pulldown',
    role: 'accessory',
    targetSets: 3,
    targetReps: 10,
    loadSource: 'absolute',
    absoluteWeight: 110,
    unitOverride: 'lb',
    isAmrap: false,
  },
  {
    exerciseKey: 'deadlift',
    sessionKey: 'deadlift-day',
    catalogKey: 'Barbell_Deadlift',
    name: 'Barbell Deadlift',
    role: 'main',
    targetSets: 1,
    targetReps: 5,
    loadSource: 'absolute',
    absoluteWeight: 142.5,
    unitOverride: null,
    isAmrap: false,
  },
  {
    exerciseKey: 'leg-curl',
    sessionKey: 'deadlift-day',
    catalogKey: 'Lying_Leg_Curls',
    name: 'Lying Leg Curls',
    role: 'accessory',
    targetSets: 3,
    targetReps: 10,
    loadSource: 'absolute',
    absoluteWeight: 30,
    unitOverride: null,
    isAmrap: false,
  },
];

const CYCLES: readonly DemoCycleRow[] = [
  {
    cycleKey: 'cycle-1',
    cycleNumber: 1,
    weeks: 4,
    status: 'complete',
    currentWeek: 4,
    startedAt: epoch('2026-04-06'),
    completedAt: epoch('2026-05-01'),
  },
  {
    cycleKey: 'cycle-2',
    cycleNumber: 2,
    weeks: 4,
    status: 'active',
    currentWeek: 4,
    startedAt: epoch('2026-05-04'),
    completedAt: null,
  },
];

interface DemoLoggedSession {
  sessionKey: string;
  status: 'completed' | 'moved' | 'discarded';
  date: string;
  results: Record<string, DemoSet[]>;
}

interface DemoWeekLog {
  weekNumber: number;
  sessions: DemoLoggedSession[];
}

const onTargetResults = (
  sessionKey: string,
  weights: Record<string, number>,
): Record<string, DemoSet[]> => {
  const results: Record<string, DemoSet[]> = {};
  for (const exercise of EXERCISES) {
    if (exercise.sessionKey !== sessionKey) {
      continue;
    }
    results[exercise.exerciseKey] = Array.from(
      { length: exercise.targetSets },
      () => ({ weight: weights[exercise.exerciseKey], reps: exercise.targetReps }),
    );
  }
  return results;
};

const withAmrap = (
  results: Record<string, DemoSet[]>,
  exerciseKey: string,
  reps: number,
): Record<string, DemoSet[]> => {
  const sets = results[exerciseKey];
  return {
    ...results,
    [exerciseKey]: [...sets.slice(0, -1), { ...sets[sets.length - 1], reps }],
  };
};

const withMiss = (
  results: Record<string, DemoSet[]>,
  exerciseKey: string,
  reps: number,
): Record<string, DemoSet[]> => {
  const sets = results[exerciseKey];
  return {
    ...results,
    [exerciseKey]: [...sets.slice(0, -1), { ...sets[sets.length - 1], reps }],
  };
};

const CYCLE_1_WEIGHTS: Record<string, number> = {
  squat: 100,
  row: 22.5,
  bench: 70,
  ohp: 45,
  'lat-pulldown': 110,
  deadlift: 140,
  'leg-curl': 30,
};

const CYCLE_2_WEIGHTS: Record<string, number> = {
  squat: 102.5,
  row: 22.5,
  bench: 70,
  ohp: 45,
  'lat-pulldown': 110,
  deadlift: 142.5,
  'leg-curl': 30,
};

const CYCLE_1_WEEKS: readonly DemoWeekLog[] = [
  {
    weekNumber: 1,
    sessions: [
      {
        sessionKey: 'squat-day',
        status: 'completed',
        date: '2026-04-06',
        results: withAmrap(onTargetResults('squat-day', CYCLE_1_WEIGHTS), 'squat', 6),
      },
      { sessionKey: 'bench-day', status: 'completed', date: '2026-04-08', results: onTargetResults('bench-day', CYCLE_1_WEIGHTS) },
      { sessionKey: 'deadlift-day', status: 'completed', date: '2026-04-10', results: onTargetResults('deadlift-day', CYCLE_1_WEIGHTS) },
    ],
  },
  {
    weekNumber: 2,
    sessions: [
      {
        sessionKey: 'squat-day',
        status: 'completed',
        date: '2026-04-13',
        results: withAmrap(onTargetResults('squat-day', CYCLE_1_WEIGHTS), 'squat', 5),
      },
      {
        sessionKey: 'bench-day',
        status: 'completed',
        date: '2026-04-15',
        results: withMiss(onTargetResults('bench-day', CYCLE_1_WEIGHTS), 'bench', 4),
      },
      { sessionKey: 'deadlift-day', status: 'completed', date: '2026-04-17', results: onTargetResults('deadlift-day', CYCLE_1_WEIGHTS) },
    ],
  },
  {
    weekNumber: 3,
    sessions: [
      {
        sessionKey: 'squat-day',
        status: 'completed',
        date: '2026-04-20',
        results: withAmrap(onTargetResults('squat-day', CYCLE_1_WEIGHTS), 'squat', 6),
      },
      { sessionKey: 'bench-day', status: 'completed', date: '2026-04-22', results: onTargetResults('bench-day', CYCLE_1_WEIGHTS) },
      { sessionKey: 'deadlift-day', status: 'completed', date: '2026-04-24', results: onTargetResults('deadlift-day', CYCLE_1_WEIGHTS) },
    ],
  },
  {
    weekNumber: 4,
    sessions: [
      {
        sessionKey: 'squat-day',
        status: 'completed',
        date: '2026-04-27',
        results: withAmrap(onTargetResults('squat-day', CYCLE_1_WEIGHTS), 'squat', 5),
      },
      { sessionKey: 'bench-day', status: 'completed', date: '2026-04-29', results: onTargetResults('bench-day', CYCLE_1_WEIGHTS) },
      { sessionKey: 'deadlift-day', status: 'completed', date: '2026-05-01', results: onTargetResults('deadlift-day', CYCLE_1_WEIGHTS) },
    ],
  },
];

const CYCLE_2_WEEKS: readonly DemoWeekLog[] = [
  {
    weekNumber: 1,
    sessions: [
      {
        sessionKey: 'squat-day',
        status: 'completed',
        date: '2026-05-04',
        results: withAmrap(onTargetResults('squat-day', CYCLE_2_WEIGHTS), 'squat', 6),
      },
      {
        sessionKey: 'bench-day',
        status: 'completed',
        date: '2026-05-06',
        results: withMiss(onTargetResults('bench-day', CYCLE_2_WEIGHTS), 'bench', 4),
      },
      {
        sessionKey: 'deadlift-day',
        status: 'moved',
        date: '2026-05-09',
        results: onTargetResults('deadlift-day', CYCLE_2_WEIGHTS),
      },
    ],
  },
  {
    weekNumber: 2,
    sessions: [
      { sessionKey: 'squat-day', status: 'completed', date: '2026-05-11', results: onTargetResults('squat-day', CYCLE_2_WEIGHTS) },
      { sessionKey: 'bench-day', status: 'discarded', date: '2026-05-13', results: {} },
      { sessionKey: 'deadlift-day', status: 'completed', date: '2026-05-15', results: onTargetResults('deadlift-day', CYCLE_2_WEIGHTS) },
    ],
  },
  {
    weekNumber: 3,
    sessions: [
      {
        sessionKey: 'squat-day',
        status: 'completed',
        date: '2026-05-18',
        results: withAmrap(onTargetResults('squat-day', CYCLE_2_WEIGHTS), 'squat', 8),
      },
      { sessionKey: 'bench-day', status: 'completed', date: '2026-05-20', results: onTargetResults('bench-day', CYCLE_2_WEIGHTS) },
      { sessionKey: 'deadlift-day', status: 'completed', date: '2026-05-22', results: onTargetResults('deadlift-day', CYCLE_2_WEIGHTS) },
    ],
  },
];

const PROPOSALS: readonly DemoProposalRow[] = [
  {
    sessionExerciseKey: 'squat',
    currentTarget: 100,
    proposedTarget: 102.5,
    unit: 'kg',
    reason: 'Hit every target set and rep.',
    status: 'accepted',
  },
  {
    sessionExerciseKey: 'bench',
    currentTarget: 70,
    proposedTarget: 70,
    unit: 'kg',
    reason: 'Missed the last set (4 of 5 reps).',
    status: 'held',
  },
  {
    sessionExerciseKey: 'deadlift',
    currentTarget: 140,
    proposedTarget: 142.5,
    unit: 'kg',
    reason: 'Hit every target set and rep.',
    status: 'edited',
  },
  {
    sessionExerciseKey: 'ohp',
    currentTarget: 45,
    proposedTarget: 45,
    unit: 'kg',
    reason: 'Hit every target set and rep.',
    status: 'declined',
  },
];

export function buildDemoRows(): DemoRows {
  const exercises = EXERCISES.map((exercise, index) => ({
    ...exercise,
    sortOrder: index + 1,
  }));
  const exerciseByKey = new Map(exercises.map((e) => [e.exerciseKey, e]));

  const cycleWeeks: DemoCycleWeekRow[] = CYCLES.flatMap((cycle) =>
    Array.from({ length: cycle.weeks }, (_, index) => ({
      cycleKey: cycle.cycleKey,
      weekNumber: index + 1,
    })),
  );

  const weekSessions: DemoWeekSessionRow[] = [];
  for (const cycle of CYCLES) {
    const weekLogs =
      cycle.cycleKey === 'cycle-1' ? CYCLE_1_WEEKS : CYCLE_2_WEEKS;
    for (let weekNumber = 1; weekNumber <= cycle.weeks; weekNumber += 1) {
      const weekLog = weekLogs.find((week) => week.weekNumber === weekNumber);
      for (const session of SESSIONS) {
        const logged = weekLog?.sessions.find(
          (entry) => entry.sessionKey === session.sessionKey,
        );
        if (!logged) {
          weekSessions.push({
            cycleKey: cycle.cycleKey,
            weekNumber,
            sessionKey: session.sessionKey,
            status: 'pending',
            date: 0,
            results: {},
          });
          continue;
        }
        weekSessions.push({
          cycleKey: cycle.cycleKey,
          weekNumber,
          sessionKey: session.sessionKey,
          status: logged.status,
          date: epoch(logged.date),
          results: logged.results,
        });
      }
    }
  }

  const proposals: DemoProposalRow[] = PROPOSALS.map((proposal) => {
    const exercise = exerciseByKey.get(proposal.sessionExerciseKey);
    if (!exercise) {
      throw new Error(`Demo proposal references unknown exercise ${proposal.sessionExerciseKey}`);
    }
    return proposal;
  });

  return {
    routine: {
      routineKey: DEMO_ROUTINE_KEY,
      name: DEMO_ROUTINE_NAME,
      origin: 'user',
      progressionRule: 'linear',
      unit: 'kg',
      roundingIncrement: 2.5,
      restMainSeconds: 180,
      restAccessorySeconds: 90,
      isActive: true,
      createdAt: epoch('2026-04-01'),
    },
    sessions: [...SESSIONS],
    exercises,
    cycles: [...CYCLES],
    cycleWeeks,
    weekSessions,
    proposals,
  };
}

/** Inclusive epoch range covering every demo log date — the removal window. */
export function demoLogDateRange(): [number, number] {
  const rows = buildDemoRows();
  const dates = rows.weekSessions
    .filter((session) => session.status !== 'pending')
    .map((session) => session.date);
  return [Math.min(...dates), Math.max(...dates)];
}

export interface DemoDatabase {
  run(sql: string, params?: readonly unknown[]): Promise<unknown> | unknown;
  get(
    sql: string,
    params?: readonly unknown[],
  ): Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;
}

const run = async (db: DemoDatabase, sql: string, params: readonly unknown[] = []): Promise<void> => {
  await db.run(sql, params);
};

const idOf = async (
  db: DemoDatabase,
  sql: string,
  params: readonly unknown[],
): Promise<number> => {
  const row = await db.get(sql, params);
  if (!row) {
    throw new Error(`Expected a row for ${sql}`);
  }
  return Number(row.id);
};

const unitOf = (exercise: DemoSessionExerciseRow, routineUnit: DemoWeightUnit): DemoWeightUnit =>
  exercise.unitOverride ?? routineUnit;

export async function loadDemoData(db: DemoDatabase): Promise<void> {
  const rows = buildDemoRows();

  const existing = await db.get(
    'SELECT routine_id FROM Routines WHERE routine_key = ?;',
    [rows.routine.routineKey],
  );
  if (existing) {
    return;
  }

  await run(db, 'BEGIN;');
  try {
    await run(db, 'UPDATE Routines SET is_active = 0 WHERE is_active = 1;');
    await run(
      db,
      `INSERT INTO Routines
         (routine_key, name, origin, progression_rule, unit, rounding_increment,
          rest_main_seconds, rest_accessory_seconds, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?);`,
      [
        rows.routine.routineKey,
        rows.routine.name,
        rows.routine.origin,
        rows.routine.progressionRule,
        rows.routine.unit,
        rows.routine.roundingIncrement,
        rows.routine.restMainSeconds,
        rows.routine.restAccessorySeconds,
        rows.routine.createdAt,
      ],
    );

    const routineId = await idOf(
      db,
      'SELECT routine_id AS id FROM Routines WHERE routine_key = ?;',
      [rows.routine.routineKey],
    );

    const sessionIds = new Map<string, number>();
    for (const session of rows.sessions) {
      await run(
        db,
        `INSERT INTO Sessions (routine_id, weekday, name, sort_order)
         VALUES (?, ?, ?, ?);`,
        [routineId, session.weekday, session.name, session.sortOrder],
      );
      const sessionId = await idOf(
        db,
        'SELECT session_id AS id FROM Sessions WHERE routine_id = ? AND weekday = ?;',
        [routineId, session.weekday],
      );
      sessionIds.set(session.sessionKey, sessionId);
    }

    const exerciseIds = new Map<string, number>();
    for (const exercise of rows.exercises) {
      const sessionId = sessionIds.get(exercise.sessionKey);
      if (!sessionId) {
        throw new Error(`Demo exercise references unknown session ${exercise.sessionKey}`);
      }
      await run(
        db,
        `INSERT INTO SessionExercises
           (session_id, catalog_exercise_id, exercise_name, role, target_sets, target_reps,
            load_source, absolute_weight, unit_override, is_amrap, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          sessionId,
          exercise.catalogKey,
          exercise.name,
          exercise.role,
          exercise.targetSets,
          exercise.targetReps,
          exercise.loadSource,
          exercise.absoluteWeight,
          exercise.unitOverride,
          exercise.isAmrap ? 1 : 0,
          exercise.sortOrder,
        ],
      );
      const exerciseId = await idOf(
        db,
        `SELECT session_exercise_id AS id FROM SessionExercises
         WHERE session_id = ? AND sort_order = ?;`,
        [sessionId, exercise.sortOrder],
      );
      exerciseIds.set(exercise.exerciseKey, exerciseId);
    }

    const cycleIds = new Map<string, number>();
    for (const cycle of rows.cycles) {
      await run(
        db,
        `INSERT INTO Cycles
           (routine_id, cycle_number, weeks, status, current_week, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        [
          routineId,
          cycle.cycleNumber,
          cycle.weeks,
          cycle.status,
          cycle.currentWeek,
          cycle.startedAt,
          cycle.completedAt,
        ],
      );
      const cycleId = await idOf(
        db,
        'SELECT cycle_id AS id FROM Cycles WHERE routine_id = ? AND cycle_number = ?;',
        [routineId, cycle.cycleNumber],
      );
      cycleIds.set(cycle.cycleKey, cycleId);
    }

    const weekIds = new Map<string, number>();
    for (const week of rows.cycleWeeks) {
      const cycleId = cycleIds.get(week.cycleKey);
      if (!cycleId) {
        throw new Error(`Demo week references unknown cycle ${week.cycleKey}`);
      }
      await run(
        db,
        `INSERT INTO CycleWeeks (cycle_id, week_number) VALUES (?, ?);`,
        [cycleId, week.weekNumber],
      );
      const weekId = await idOf(
        db,
        'SELECT cycle_week_id AS id FROM CycleWeeks WHERE cycle_id = ? AND week_number = ?;',
        [cycleId, week.weekNumber],
      );
      weekIds.set(`${week.cycleKey}:${week.weekNumber}`, weekId);
    }

    const exerciseByKey = new Map(rows.exercises.map((e) => [e.exerciseKey, e]));
    for (const weekSession of rows.weekSessions) {
      const weekId = weekIds.get(`${weekSession.cycleKey}:${weekSession.weekNumber}`);
      const sessionId = sessionIds.get(weekSession.sessionKey);
      const cycleId = cycleIds.get(weekSession.cycleKey);
      if (!weekId || !sessionId || !cycleId) {
        throw new Error(
          `Demo week session references unknown plan row (${weekSession.cycleKey} ` +
            `${weekSession.weekNumber} ${weekSession.sessionKey})`,
        );
      }

      let completedLogId: number | null = null;
      if (weekSession.status === 'completed' || weekSession.status === 'moved') {
        const session = rows.sessions.find((s) => s.sessionKey === weekSession.sessionKey);
        if (!session) {
          throw new Error(`Demo log references unknown session ${weekSession.sessionKey}`);
        }
        await run(
          db,
          `INSERT INTO Workout_Log (workout_name, day_name, workout_date)
           VALUES (?, ?, ?);`,
          [rows.routine.name, session.name, weekSession.date],
        );
        completedLogId = await idOf(
          db,
          `SELECT workout_log_id AS id FROM Workout_Log
           WHERE workout_name = ? AND day_name = ? AND workout_date = ?;`,
          [rows.routine.name, session.name, weekSession.date],
        );

        for (const [exerciseKey, sets] of Object.entries(weekSession.results)) {
          const exercise = exerciseByKey.get(exerciseKey);
          const exerciseId = exerciseIds.get(exerciseKey);
          if (!exercise || !exerciseId) {
            throw new Error(`Demo log references unknown exercise ${exerciseKey}`);
          }
          await run(
            db,
            `INSERT INTO Logged_Exercises (workout_log_id, exercise_name, sets, reps)
             VALUES (?, ?, ?, ?);`,
            [completedLogId, exercise.name, exercise.targetSets, exercise.targetReps],
          );
          const loggedExerciseId = await idOf(
            db,
            `SELECT logged_exercise_id AS id FROM Logged_Exercises
             WHERE workout_log_id = ? AND exercise_name = ?;`,
            [completedLogId, exercise.name],
          );

          const unit = unitOf(exercise, rows.routine.unit);
          for (const [index, set] of sets.entries()) {
            await run(
              db,
              `INSERT INTO Weight_Log
                 (workout_log_id, logged_exercise_id, exercise_name, set_number,
                  weight_logged, reps_logged, unit)
               VALUES (?, ?, ?, ?, ?, ?, ?);`,
              [
                completedLogId,
                loggedExerciseId,
                exercise.name,
                index + 1,
                set.weight,
                set.reps,
                unit,
              ],
            );
          }
        }
      }

      await run(
        db,
        `INSERT INTO WeekSessions
           (cycle_week_id, session_id, status, resolved_on_date, completed_log_id)
         VALUES (?, ?, ?, ?, ?);`,
        [
          weekId,
          sessionId,
          weekSession.status,
          weekSession.status === 'pending' ? null : weekSession.date,
          completedLogId,
        ],
      );
    }

    const cycle1Id = cycleIds.get('cycle-1');
    if (!cycle1Id) {
      throw new Error('Demo proposals require cycle-1');
    }
    for (const proposal of rows.proposals) {
      const exercise = exerciseByKey.get(proposal.sessionExerciseKey);
      const exerciseId = exerciseIds.get(proposal.sessionExerciseKey);
      if (!exercise || !exerciseId) {
        throw new Error(`Demo proposal references unknown exercise ${proposal.sessionExerciseKey}`);
      }
      await run(
        db,
        `INSERT INTO Progression_Proposal
           (routine_id, cycle_id, session_exercise_id, catalog_exercise_id, exercise_name,
            current_target, proposed_target, unit, reason, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          routineId,
          cycle1Id,
          exerciseId,
          exercise.catalogKey,
          exercise.name,
          proposal.currentTarget,
          proposal.proposedTarget,
          proposal.unit,
          proposal.reason,
          proposal.status,
          rows.cycles[0].completedAt,
        ],
      );
    }

    await run(db, 'COMMIT;');
  } catch (error) {
    await run(db, 'ROLLBACK;');
    throw error;
  }
}

export async function removeDemoData(db: DemoDatabase): Promise<void> {
  const rows = buildDemoRows();
  const [minDate, maxDate] = demoLogDateRange();

  await run(
    db,
    `DELETE FROM Weight_Log
     WHERE workout_log_id IN (
       SELECT workout_log_id FROM Workout_Log
       WHERE workout_name = ? AND workout_date BETWEEN ? AND ?
     );`,
    [rows.routine.name, minDate, maxDate],
  );
  await run(
    db,
    `DELETE FROM Logged_Exercises
     WHERE workout_log_id IN (
       SELECT workout_log_id FROM Workout_Log
       WHERE workout_name = ? AND workout_date BETWEEN ? AND ?
     );`,
    [rows.routine.name, minDate, maxDate],
  );
  await run(
    db,
    `DELETE FROM Workout_Log
     WHERE workout_name = ? AND workout_date BETWEEN ? AND ?;`,
    [rows.routine.name, minDate, maxDate],
  );
  await run(db, 'DELETE FROM Routines WHERE routine_key = ?;', [rows.routine.routineKey]);
}
