/**
 * D5 — Today's session (SPECS.md D5, §3.3, §3.6).
 *
 * Pure core: `computeTodayState` classifies the active cycle's week-session rows
 * into "due today", "missed" and "next session" from the cycle's start date and
 * the caller's today stamp. Day stamps are whole UTC days (noon) in epoch
 * seconds — the same convention the demo data writes. The thin edges load the
 * rows (`loadTodayState`) and write a missed-session resolution
 * (`resolveMissedSession`).
 *
 * Missed-session rules: a pending session is missed when its nominal date
 * (derived from the cycle start, its week number and its weekday) is before
 * today and it carries no intent marker. "Do it today" records the intent by
 * setting `resolved_on_date` while leaving the status `pending`, so the prompt
 * never reappears and the session is surfaced as due today.
 */

import { roundTo } from './progression';
import type { RoutineDatabase, RoutineLoadSource, RoutineUnit } from './routineActions';

export const DAY_SECONDS = 86400;

/** Whole UTC day (noon) in epoch seconds for a local Date. */
export const dayStampOf = (date: Date): number => {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0) / 1000,
  );
};

/** Whole UTC day (noon) of an arbitrary epoch-seconds stamp. */
const dayStampOfStamp = (stamp: number): number => {
  const date = new Date(stamp * 1000);
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0) / 1000,
  );
};

export const weekdayOfStamp = (stamp: number): number => new Date(stamp * 1000).getUTCDay();

/** The nominal calendar date of a session in a given week of a cycle. */
export function nominalSessionStamp(
  cycleStartStamp: number,
  weekNumber: number,
  sessionWeekday: number,
): number {
  const start = dayStampOfStamp(cycleStartStamp);
  const offset = (sessionWeekday - weekdayOfStamp(start) + 7) % 7;
  return start + (7 * (weekNumber - 1) + offset) * DAY_SECONDS;
}

/** The next occurrence of a weekday from today, inclusive. */
export function nextOccurrenceStamp(todayStamp: number, weekday: number): number {
  const offset = (weekday - weekdayOfStamp(todayStamp) + 7) % 7;
  return todayStamp + offset * DAY_SECONDS;
}

/** The concrete target weight for an exercise's load source (§7.3, SPECS.md). */
export function targetWeightFor(
  exercise: {
    loadSource: RoutineLoadSource;
    absoluteWeight: number | null;
    trainingMaxWeight: number | null;
    trainingMaxPct: number | null;
  },
  roundingIncrement: number,
): number | null {
  switch (exercise.loadSource) {
    case 'absolute':
      return exercise.absoluteWeight;
    case 'training_max_pct':
      if (exercise.trainingMaxWeight === null || exercise.trainingMaxPct === null) {
        return null;
      }
      // Same arithmetic as progression.ts currentTargetFor, rounded like its proposals.
      return roundTo(exercise.trainingMaxWeight * exercise.trainingMaxPct, roundingIncrement);
    case 'bodyweight':
      return null;
  }
}

export interface TodaySessionRow {
  sessionId: number;
  weekday: number;
  name: string;
  sortOrder: number;
}

export interface TodayExerciseRow {
  sessionId: number;
  name: string;
  targetSets: number;
  targetReps: number;
  loadSource: RoutineLoadSource;
  absoluteWeight: number | null;
  trainingMaxWeight: number | null;
  trainingMaxPct: number | null;
  unitOverride: RoutineUnit | null;
  isAmrap: boolean;
  sortOrder: number;
}

export interface TodayWeekSessionRow {
  weekSessionId: number;
  weekNumber: number;
  sessionId: number;
  status: 'pending' | 'completed' | 'moved' | 'discarded';
  resolvedOnDate: number | null;
}

export interface TodayStateInput {
  routine: {
    routineId: number;
    name: string;
    unit: RoutineUnit;
    roundingIncrement: number;
  } | null;
  cycle: { startedAt: number | null; currentWeek: number; weeks: number } | null;
  sessions: readonly TodaySessionRow[];
  exercises: readonly TodayExerciseRow[];
  weekSessions: readonly TodayWeekSessionRow[];
}

export interface TodayExercise {
  name: string;
  targetSets: number;
  targetReps: number;
  /** Concrete target weight in `unit`; null for bodyweight. */
  targetWeight: number | null;
  unit: RoutineUnit;
  isAmrap: boolean;
  sortOrder: number;
}

export interface TodaySessionInfo {
  weekSessionId: number;
  sessionId: number;
  name: string;
  weekday: number;
  /** The calendar date the session is due, in epoch day stamps. */
  date: number;
  exercises: TodayExercise[];
}

export interface MissedSession {
  weekSessionId: number;
  sessionId: number;
  name: string;
  weekday: number;
  /** The calendar date the session was originally scheduled for. */
  date: number;
}

export interface NextSession {
  name: string;
  weekday: number;
  date: number;
  /** Null when derived from the plan alone, because no cycle exists yet. */
  weekSessionId: number | null;
}

export interface TodayState {
  routine: TodayStateInput['routine'];
  dueToday: TodaySessionInfo[];
  missed: MissedSession[];
  nextSession: NextSession | null;
}

export function computeTodayState(input: TodayStateInput, todayStamp: number): TodayState {
  const routine = input.routine;
  const cycle = input.cycle;
  if (routine === null) {
    return { routine: null, dueToday: [], missed: [], nextSession: null };
  }

  const sessionById = new Map(input.sessions.map((session) => [session.sessionId, session]));
  const exercisesBySession = new Map<number, TodayExerciseRow[]>();
  for (const exercise of input.exercises) {
    const list = exercisesBySession.get(exercise.sessionId);
    if (list === undefined) {
      exercisesBySession.set(exercise.sessionId, [exercise]);
    } else {
      list.push(exercise);
    }
  }
  for (const list of exercisesBySession.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  if (cycle === null || cycle.startedAt === null) {
    return {
      routine,
      dueToday: [],
      missed: [],
      nextSession: nextPlanSession(input.sessions, todayStamp),
    };
  }

  const startedAt = cycle.startedAt;
  const rows = input.weekSessions.flatMap((weekSession) => {
    const session = sessionById.get(weekSession.sessionId);
    if (session === undefined) {
      return [];
    }
    return [
      {
        weekSession,
        session,
        nominal: nominalSessionStamp(startedAt, weekSession.weekNumber, session.weekday),
      },
    ];
  });

  const missed = rows
    .filter(
      ({ weekSession, nominal }) =>
        weekSession.status === 'pending' &&
        weekSession.resolvedOnDate === null &&
        nominal < todayStamp,
    )
    .sort((a, b) => a.nominal - b.nominal)
    .map(({ weekSession, session, nominal }) => ({
      weekSessionId: weekSession.weekSessionId,
      sessionId: session.sessionId,
      name: session.name,
      weekday: session.weekday,
      date: nominal,
    }));

  const dueRows = rows
    .filter(
      ({ weekSession, nominal }) =>
        weekSession.status === 'pending' &&
        (nominal === todayStamp || weekSession.resolvedOnDate === todayStamp),
    )
    .sort((a, b) => a.nominal - b.nominal);

  const dueToday = dueRows.map(({ weekSession, session, nominal }) => ({
    weekSessionId: weekSession.weekSessionId,
    sessionId: session.sessionId,
    name: session.name,
    weekday: session.weekday,
    date: weekSession.resolvedOnDate ?? nominal,
    exercises: (exercisesBySession.get(session.sessionId) ?? []).map((exercise) => ({
      name: exercise.name,
      targetSets: exercise.targetSets,
      targetReps: exercise.targetReps,
      targetWeight: targetWeightFor(exercise, routine.roundingIncrement),
      unit: exercise.unitOverride ?? routine.unit,
      isAmrap: exercise.isAmrap,
      sortOrder: exercise.sortOrder,
    })),
  }));

  const lastWeek = Math.min(cycle.currentWeek + 1, cycle.weeks);
  const nextRow = rows
    .filter(
      ({ weekSession, nominal }) =>
        weekSession.status === 'pending' &&
        weekSession.resolvedOnDate === null &&
        weekSession.weekNumber >= cycle.currentWeek &&
        weekSession.weekNumber <= lastWeek &&
        nominal > todayStamp,
    )
    .sort((a, b) => a.nominal - b.nominal)[0];

  const nextSession: NextSession | null =
    nextRow === undefined
      ? null
      : {
          name: nextRow.session.name,
          weekday: nextRow.session.weekday,
          date: nextRow.nominal,
          weekSessionId: nextRow.weekSession.weekSessionId,
        };

  return { routine, dueToday, missed, nextSession };
}

/**
 * Plan-based fallback for a routine with no cycle (or one without a start
 * date): the next session by weekday order, never today itself — the session
 * is only actionable once a week row exists for it.
 */
function nextPlanSession(
  sessions: readonly TodaySessionRow[],
  todayStamp: number,
): NextSession | null {
  if (sessions.length === 0) {
    return null;
  }
  const todayWeekday = weekdayOfStamp(todayStamp);
  const offset = (weekday: number): number => {
    const days = (weekday - todayWeekday + 7) % 7;
    return days === 0 ? 7 : days;
  };
  const next = [...sessions].sort((a, b) => offset(a.weekday) - offset(b.weekday))[0];
  if (next === undefined) {
    return null;
  }
  return {
    name: next.name,
    weekday: next.weekday,
    date: todayStamp + offset(next.weekday) * DAY_SECONDS,
    weekSessionId: null,
  };
}

const num = (value: unknown): number => Number(value);
const str = (value: unknown): string => String(value);
const nullableNum = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);
const nullableStr = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

const toSessionRow = (row: Record<string, unknown>): TodaySessionRow => ({
  sessionId: num(row.session_id),
  weekday: num(row.weekday),
  name: str(row.name),
  sortOrder: num(row.sort_order),
});

const toExerciseRow = (row: Record<string, unknown>): TodayExerciseRow => ({
  sessionId: num(row.session_id),
  name: str(row.name),
  targetSets: num(row.target_sets),
  targetReps: num(row.target_reps),
  loadSource: str(row.load_source) as RoutineLoadSource,
  absoluteWeight: nullableNum(row.absolute_weight),
  trainingMaxWeight: nullableNum(row.training_max_weight),
  trainingMaxPct: nullableNum(row.training_max_pct),
  unitOverride: nullableStr(row.unit_override) as RoutineUnit | null,
  isAmrap: num(row.is_amrap) === 1,
  sortOrder: num(row.sort_order),
});

const toWeekSessionRow = (row: Record<string, unknown>): TodayWeekSessionRow => ({
  weekSessionId: num(row.week_session_id),
  weekNumber: num(row.week_number),
  sessionId: num(row.session_id),
  status: str(row.status) as TodayWeekSessionRow['status'],
  resolvedOnDate: nullableNum(row.resolved_on_date),
});

export async function loadTodayState(
  db: RoutineDatabase,
  todayStamp: number,
): Promise<TodayState> {
  const routineRow = await db.get(
    `SELECT routine_id, name, unit, rounding_increment
     FROM Routines WHERE is_active = 1 LIMIT 1;`,
    [],
  );
  if (routineRow === undefined) {
    return { routine: null, dueToday: [], missed: [], nextSession: null };
  }
  const routine: TodayStateInput['routine'] = {
    routineId: num(routineRow.routine_id),
    name: str(routineRow.name),
    unit: str(routineRow.unit) as RoutineUnit,
    roundingIncrement: num(routineRow.rounding_increment),
  };

  const cycleRow = await db.get(
    `SELECT cycle_id, started_at, current_week, weeks
     FROM Cycles WHERE routine_id = ? AND status = 'active'
     ORDER BY cycle_number DESC LIMIT 1;`,
    [routine.routineId],
  );
  const cycle: TodayStateInput['cycle'] =
    cycleRow === undefined
      ? null
      : {
          startedAt: nullableNum(cycleRow.started_at),
          currentWeek: num(cycleRow.current_week),
          weeks: num(cycleRow.weeks),
        };

  const sessionRows = await db.getAll(
    `SELECT session_id, weekday, name, sort_order
     FROM Sessions WHERE routine_id = ? ORDER BY sort_order;`,
    [routine.routineId],
  );
  const sessions = sessionRows.map(toSessionRow);

  const weekSessionRows =
    cycleRow === undefined
      ? []
      : await db.getAll(
          `SELECT ws.week_session_id, cw.week_number, ws.session_id, ws.status, ws.resolved_on_date
           FROM WeekSessions ws JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
           WHERE cw.cycle_id = ? AND ws.status = 'pending';`,
          [num(cycleRow.cycle_id)],
        );
  const weekSessions = weekSessionRows.map(toWeekSessionRow);

  const exerciseRows = await db.getAll(
    `SELECT e.session_id, e.exercise_name AS name, e.target_sets, e.target_reps, e.load_source,
            e.absolute_weight, e.training_max_weight, e.training_max_pct, e.unit_override,
            e.is_amrap, e.sort_order
     FROM SessionExercises e JOIN Sessions s ON s.session_id = e.session_id
     WHERE s.routine_id = ? ORDER BY e.sort_order;`,
    [routine.routineId],
  );
  const exercises = exerciseRows.map(toExerciseRow);

  return computeTodayState(
    { routine, cycle, sessions, exercises, weekSessions },
    todayStamp,
  );
}

export type MissedResolution = 'moved' | 'doToday' | 'discarded';

export interface MissedResolutionOptions {
  todayStamp: number;
  /** The day a moved session lands on. Required for 'moved'. */
  targetStamp?: number;
}

/**
 * One §3.6 outcome for one unresolved session. The `status = 'pending'` guard
 * makes a second resolution a no-op — the prompt appears exactly once.
 */
export async function resolveMissedSession(
  db: RoutineDatabase,
  weekSessionId: number,
  resolution: MissedResolution,
  options: MissedResolutionOptions,
): Promise<void> {
  if (resolution === 'moved') {
    if (options.targetStamp === undefined) {
      throw new Error('resolveMissedSession: targetStamp is required for moved sessions');
    }
    await db.run(
      `UPDATE WeekSessions SET status = 'moved', resolved_on_date = ?
       WHERE week_session_id = ? AND status = 'pending';`,
      [options.targetStamp, weekSessionId],
    );
    return;
  }
  if (resolution === 'doToday') {
    await db.run(
      `UPDATE WeekSessions SET resolved_on_date = ?
       WHERE week_session_id = ? AND status = 'pending';`,
      [options.todayStamp, weekSessionId],
    );
    return;
  }
  await db.run(
    `UPDATE WeekSessions SET status = 'discarded', resolved_on_date = ?
     WHERE week_session_id = ? AND status = 'pending';`,
    [options.todayStamp, weekSessionId],
  );
}
