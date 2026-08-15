/**
 * M1 — The session queue (SPECS.md §3.1).
 *
 * The active routine's sessions form an ordered queue; exactly one is ever
 * offered. Pure core: `computeSessionQueue` derives the single head — the
 * oldest unresolved past session ahead of today's, or today's session — and
 * what becomes visible once the head is resolved. The resolution actions
 * (`applyDoToday`, `applyMove`, `applyDiscard`) and guarded discard undo are
 * pure transformations over the week-session rows, each with one thin writer
 * below. A day has exactly
 * one session slot by construction: do-today and move reject a target day
 * that any other session already occupies, so sessions can never stack onto
 * one day, and "do it today" cannot be answered twice for the same day.
 *
 * Date convention is unchanged from Iteration 3: whole UTC days (noon) in
 * epoch seconds. A session's nominal date derives from its cycle start, week
 * number and weekday; a resolved session records the day it lands on in
 * `resolved_on_date` (a discarded session records its nominal day — the day
 * that counts as not done).
 */

import { roundTo } from './progression';
import type { RoutineDatabase, RoutineLoadSource, RoutineUnit } from './routineActions';

export const DAY_SECONDS = 86400;

/** Named move choices keep the usual answer within the next few days. */
export const MOVE_NAMED_DAY_COUNT = 3;
/** The calendar remains useful without allowing a move into an arbitrary future. */
export const MOVE_CALENDAR_HORIZON_DAYS = 28;

/** Whole UTC day (noon) in epoch seconds for a local Date. */
export const dayStampOf = (date: Date): number => {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0) / 1000,
  );
};

/** Whole UTC day (noon) of an arbitrary epoch-seconds stamp. */
export const dayStampOfStamp = (stamp: number): number => {
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

export interface QueueSessionRow {
  sessionId: number;
  weekday: number;
  name: string;
  sortOrder: number;
}

export interface QueueExerciseRow {
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

export interface QueueCycleRow {
  cycleId: number;
  cycleNumber: number;
  startedAt: number | null;
}

export interface QueueWeekSessionRow {
  weekSessionId: number;
  cycleId: number;
  weekNumber: number;
  sessionId: number;
  status: 'pending' | 'completed' | 'moved' | 'discarded';
  resolvedOnDate: number | null;
}

export interface SessionQueueInput {
  routine: {
    routineId: number;
    name: string;
    unit: RoutineUnit;
    roundingIncrement: number;
  } | null;
  /** Every cycle of the routine — the queue spans cycles, not just the active one. */
  cycles: readonly QueueCycleRow[];
  sessions: readonly QueueSessionRow[];
  exercises: readonly QueueExerciseRow[];
  /** Every week session of the routine, all statuses (resolved rows occupy their day). */
  weekSessions: readonly QueueWeekSessionRow[];
}

export interface QueuedExercise {
  name: string;
  targetSets: number;
  targetReps: number;
  /** Concrete target weight in `unit`; null for bodyweight. */
  targetWeight: number | null;
  unit: RoutineUnit;
  isAmrap: boolean;
  sortOrder: number;
}

export interface QueuedSession {
  weekSessionId: number;
  sessionId: number;
  name: string;
  weekday: number;
  /** The day the session sits on now: the resolved day when due, the nominal day while unresolved. */
  date: number;
  /** The session's planned day — its cycle position, unchanged by do-today or move. */
  originDate: number;
  /**
   * Whether "do it today" is available for this head (meaningful only while
   * unresolved): false when another session already occupies today, which is
   * exactly the stacking the queue exists to forbid.
   */
  doTodayAvailable: boolean;
  /** The session occupying today when `doTodayAvailable` is false. */
  todayOccupiedBy: string | null;
  exercises: QueuedExercise[];
}

export interface UpcomingSession {
  /** Null when derived from the plan alone, because no cycle session exists. */
  weekSessionId: number | null;
  sessionId: number | null;
  name: string;
  weekday: number;
  date: number;
}

export interface SessionQueueState {
  routine: SessionQueueInput['routine'];
  /**
   * The one session ever offered. 'unresolved' — a missed session the user
   * must resolve (do today / move / discard) before anything behind it shows;
   * 'due' — start it. Null when nothing is pending today.
   */
  head: QueuedSession | null;
  resolution: 'due' | 'unresolved' | null;
  /** The next session after the head — what resolving the head reveals. */
  upcoming: UpcomingSession | null;
}

export interface QueueRow {
  weekSession: QueueWeekSessionRow;
  session: QueueSessionRow;
  cycle: QueueCycleRow;
  nominal: number;
}

/** Every week session with a datable cycle start, carrying its nominal date. */
export function buildQueueRows(input: SessionQueueInput): QueueRow[] {
  const sessionById = new Map(input.sessions.map((session) => [session.sessionId, session]));
  const cycleById = new Map(input.cycles.map((cycle) => [cycle.cycleId, cycle]));
  const rows: QueueRow[] = [];
  for (const weekSession of input.weekSessions) {
    const session = sessionById.get(weekSession.sessionId);
    const cycle = cycleById.get(weekSession.cycleId);
    if (session === undefined || cycle === undefined || cycle.startedAt === null) {
      continue;
    }
    rows.push({
      weekSession,
      session,
      cycle,
      nominal: nominalSessionStamp(cycle.startedAt, weekSession.weekNumber, session.weekday),
    });
  }
  return rows;
}

const effectiveDay = (row: QueueRow): number => row.weekSession.resolvedOnDate ?? row.nominal;

const byQueueOrder = (a: QueueRow, b: QueueRow): number =>
  a.nominal - b.nominal ||
  a.cycle.cycleNumber - b.cycle.cycleNumber ||
  a.weekSession.weekSessionId - b.weekSession.weekSessionId;

function buildHead(
  headRow: QueueRow,
  rows: readonly QueueRow[],
  exercisesBySession: ReadonlyMap<number, QueueExerciseRow[]>,
  routineUnit: RoutineUnit,
  roundingIncrement: number,
  todayStamp: number,
): QueuedSession {
  const exercises = exercisesBySession.get(headRow.session.sessionId) ?? [];
  const todayOccupant = rows.find(
    (row) =>
      row.weekSession.weekSessionId !== headRow.weekSession.weekSessionId &&
      effectiveDay(row) === todayStamp,
  );
  return {
    weekSessionId: headRow.weekSession.weekSessionId,
    sessionId: headRow.session.sessionId,
    name: headRow.session.name,
    weekday: headRow.session.weekday,
    date: effectiveDay(headRow),
    originDate: headRow.nominal,
    doTodayAvailable: todayOccupant === undefined,
    todayOccupiedBy: todayOccupant?.session.name ?? null,
    exercises: exercises.map((exercise) => ({
      name: exercise.name,
      targetSets: exercise.targetSets,
      targetReps: exercise.targetReps,
      targetWeight: targetWeightFor(exercise, roundingIncrement),
      unit: exercise.unitOverride ?? routineUnit,
      isAmrap: exercise.isAmrap,
      sortOrder: exercise.sortOrder,
    })),
  };
}

/**
 * The queue as an ordered list of pending sessions: a session resolved onto
 * today ("do it today") is in progress and stays first — exactly one session
 * is ever in progress; everything else follows its nominal date.
 */
function queueOrder(rows: readonly QueueRow[], todayStamp: number): QueueRow[] {
  const pending = rows.filter((row) => row.weekSession.status === 'pending').sort(byQueueOrder);
  const inProgress = pending.filter(
    (row) => row.weekSession.resolvedOnDate === todayStamp,
  );
  if (inProgress.length === 0) {
    return pending;
  }
  const inProgressIds = new Set(inProgress.map((row) => row.weekSession.weekSessionId));
  return [...inProgress, ...pending.filter((row) => !inProgressIds.has(row.weekSession.weekSessionId))];
}

export function computeSessionQueue(
  input: SessionQueueInput,
  todayStamp: number,
): SessionQueueState {
  const routine = input.routine;
  if (routine === null) {
    return { routine: null, head: null, resolution: null, upcoming: null };
  }

  const rows = buildQueueRows(input);
  const queue = queueOrder(rows, todayStamp);

  const exercisesBySession = new Map<number, QueueExerciseRow[]>();
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

  let headRow: QueueRow | undefined;
  let resolution: SessionQueueState['resolution'] = null;
  const first = queue[0];
  if (first !== undefined) {
    if (first.weekSession.resolvedOnDate === todayStamp) {
      headRow = first;
      resolution = 'due';
    } else if (first.weekSession.resolvedOnDate === null && first.nominal < todayStamp) {
      headRow = first;
      resolution = 'unresolved';
    } else if (first.nominal === todayStamp) {
      headRow = first;
      resolution = 'due';
    }
  }

  const head: QueuedSession | null =
    headRow === undefined
      ? null
      : buildHead(
          headRow,
          rows,
          exercisesBySession,
          routine.unit,
          routine.roundingIncrement,
          todayStamp,
        );

  const upcomingRow = headRow === undefined ? queue[0] : queue[1];
  const upcoming: UpcomingSession | null =
    upcomingRow === undefined
      ? headRow === undefined
        ? nextPlanSession(input.sessions, todayStamp)
        : null
      : {
          weekSessionId: upcomingRow.weekSession.weekSessionId,
          sessionId: upcomingRow.session.sessionId,
          name: upcomingRow.session.name,
          weekday: upcomingRow.session.weekday,
          date: effectiveDay(upcomingRow),
        };

  return { routine, head, resolution, upcoming };
}

/**
 * Plan-based fallback when nothing is pending anywhere: the next session by
 * weekday order, never today itself — a session is only actionable once a
 * week row exists for it.
 */
function nextPlanSession(
  sessions: readonly QueueSessionRow[],
  todayStamp: number,
): UpcomingSession | null {
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
    sessionId: null,
  };
}

export interface MoveDayChoice {
  stamp: number;
  occupiedBy: string | null;
}

export interface MoveDayPlan {
  choices: MoveDayChoice[];
  minStamp: number;
  maxStamp: number;
  occupiedBy: ReadonlyMap<number, string>;
}

const occupiedSessionsByDay = (
  rows: readonly QueueRow[],
  weekSessionId: number,
): Map<number, string> => {
  const occupiedBy = new Map<number, string>();
  for (const row of rows) {
    if (row.weekSession.weekSessionId === weekSessionId) {
      continue;
    }
    const day = effectiveDay(row);
    if (!occupiedBy.has(day)) {
      occupiedBy.set(day, row.session.name);
    }
  }
  return occupiedBy;
};

/** The named choices and bounded calendar range for one move decision. */
export function buildMoveDayPlan(
  input: SessionQueueInput,
  weekSessionId: number,
  todayStamp: number,
): MoveDayPlan {
  const occupiedBy = occupiedSessionsByDay(buildQueueRows(input), weekSessionId);
  const minStamp = todayStamp + DAY_SECONDS;
  const maxStamp = todayStamp + MOVE_CALENDAR_HORIZON_DAYS * DAY_SECONDS;
  const choices = Array.from({ length: MOVE_NAMED_DAY_COUNT }, (_, index) => {
    const stamp = minStamp + index * DAY_SECONDS;
    return { stamp, occupiedBy: occupiedBy.get(stamp) ?? null };
  });

  return { choices, minStamp, maxStamp, occupiedBy };
}

export type QueueApplyRejection =
  | 'notPending'
  | 'dayOccupied'
  | 'undatable'
  | 'notDiscarded';

export interface QueueApplySuccess {
  ok: true;
  /** The week-session rows with the resolution applied — the new queue state. */
  weekSessions: QueueWeekSessionRow[];
}

export interface QueueApplyFailure {
  ok: false;
  reason: QueueApplyRejection;
}

export type QueueApplyOutcome = QueueApplySuccess | QueueApplyFailure;

const pendingRow = (
  input: SessionQueueInput,
  rows: readonly QueueRow[],
  weekSessionId: number,
): QueueRow | undefined => {
  const weekSession = input.weekSessions.find(
    (row) => row.weekSessionId === weekSessionId,
  );
  if (weekSession === undefined || weekSession.status !== 'pending') {
    return undefined;
  }
  return rows.find((row) => row.weekSession.weekSessionId === weekSessionId);
};

const dayOccupiedByOther = (
  rows: readonly QueueRow[],
  weekSessionId: number,
  dayStamp: number,
): boolean =>
  rows.some(
    (row) =>
      row.weekSession.weekSessionId !== weekSessionId && effectiveDay(row) === dayStamp,
  );

const replaceWeekSession = (
  input: SessionQueueInput,
  weekSessionId: number,
  patch: Partial<QueueWeekSessionRow>,
): QueueWeekSessionRow[] =>
  input.weekSessions.map((row) =>
    row.weekSessionId === weekSessionId ? { ...row, ...patch } : row,
  );

/**
 * "Do it today": the session becomes today's session and the queue head until
 * it is resolved. Rejected when another session already occupies today — the
 * one-per-day invariant, which is what makes stacking impossible.
 */
export function applyDoToday(
  input: SessionQueueInput,
  weekSessionId: number,
  todayStamp: number,
): QueueApplyOutcome {
  const rows = buildQueueRows(input);
  const target = pendingRow(input, rows, weekSessionId);
  if (target === undefined) {
    return { ok: false, reason: 'notPending' };
  }
  if (dayOccupiedByOther(rows, weekSessionId, todayStamp)) {
    return { ok: false, reason: 'dayOccupied' };
  }
  return {
    ok: true,
    weekSessions: replaceWeekSession(input, weekSessionId, {
      resolvedOnDate: todayStamp,
    }),
  };
}

/**
 * "Move it": the session keeps its cycle position and exercises; only its day
 * changes. Rejected when the target day already has any other session.
 */
export function applyMove(
  input: SessionQueueInput,
  weekSessionId: number,
  targetStamp: number,
): QueueApplyOutcome {
  const rows = buildQueueRows(input);
  const target = pendingRow(input, rows, weekSessionId);
  if (target === undefined) {
    return { ok: false, reason: 'notPending' };
  }
  if (dayOccupiedByOther(rows, weekSessionId, targetStamp)) {
    return { ok: false, reason: 'dayOccupied' };
  }
  return {
    ok: true,
    weekSessions: replaceWeekSession(input, weekSessionId, {
      status: 'moved',
      resolvedOnDate: targetStamp,
    }),
  };
}

/**
 * "Discard it": recorded as discarded on its nominal day — the day that
 * counts as not done — never deleted silently. Never rejected on occupancy:
 * discarding cannot place two sessions on one day.
 */
export function applyDiscard(
  input: SessionQueueInput,
  weekSessionId: number,
): QueueApplyOutcome {
  const weekSession = input.weekSessions.find(
    (row) => row.weekSessionId === weekSessionId,
  );
  if (weekSession === undefined || weekSession.status !== 'pending') {
    return { ok: false, reason: 'notPending' };
  }
  const rows = buildQueueRows(input);
  const target = rows.find((row) => row.weekSession.weekSessionId === weekSessionId);
  if (target === undefined) {
    return { ok: false, reason: 'undatable' };
  }
  return {
    ok: true,
    weekSessions: replaceWeekSession(input, weekSessionId, {
      status: 'discarded',
      resolvedOnDate: target.nominal,
    }),
  };
}

/** Undo a recorded discard by restoring the unresolved queue row in place. */
export function applyUndoDiscard(
  input: SessionQueueInput,
  weekSessionId: number,
): QueueApplyOutcome {
  const weekSession = input.weekSessions.find(
    (row) => row.weekSessionId === weekSessionId,
  );
  if (weekSession === undefined || weekSession.status !== 'discarded') {
    return { ok: false, reason: 'notDiscarded' };
  }
  return {
    ok: true,
    weekSessions: replaceWeekSession(input, weekSessionId, {
      status: 'pending',
      resolvedOnDate: null,
    }),
  };
}

const num = (value: unknown): number => Number(value);
const str = (value: unknown): string => String(value);
const nullableNum = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);
const nullableStr = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

const toSessionRow = (row: Record<string, unknown>): QueueSessionRow => ({
  sessionId: num(row.session_id),
  weekday: num(row.weekday),
  name: str(row.name),
  sortOrder: num(row.sort_order),
});

const toExerciseRow = (row: Record<string, unknown>): QueueExerciseRow => ({
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

const toCycleRow = (row: Record<string, unknown>): QueueCycleRow => ({
  cycleId: num(row.cycle_id),
  cycleNumber: num(row.cycle_number),
  startedAt: nullableNum(row.started_at),
});

const toWeekSessionRow = (row: Record<string, unknown>): QueueWeekSessionRow => ({
  weekSessionId: num(row.week_session_id),
  cycleId: num(row.cycle_id),
  weekNumber: num(row.week_number),
  sessionId: num(row.session_id),
  status: str(row.status) as QueueWeekSessionRow['status'],
  resolvedOnDate: nullableNum(row.resolved_on_date),
});

/** The active routine's queue inputs — cycles, plan rows and every week session. */
export async function loadSessionQueueInput(db: RoutineDatabase): Promise<SessionQueueInput> {
  const routineRow = await db.get(
    `SELECT routine_id, name, unit, rounding_increment
     FROM Routines WHERE is_active = 1 LIMIT 1;`,
    [],
  );
  if (routineRow === undefined) {
    return { routine: null, cycles: [], sessions: [], exercises: [], weekSessions: [] };
  }
  const routine: SessionQueueInput['routine'] = {
    routineId: num(routineRow.routine_id),
    name: str(routineRow.name),
    unit: str(routineRow.unit) as RoutineUnit,
    roundingIncrement: num(routineRow.rounding_increment),
  };

  const cycleRows = await db.getAll(
    `SELECT cycle_id, cycle_number, started_at
     FROM Cycles WHERE routine_id = ? ORDER BY cycle_number;`,
    [routine.routineId],
  );
  const cycles = cycleRows.map(toCycleRow);

  const sessionRows = await db.getAll(
    `SELECT session_id, weekday, name, sort_order
     FROM Sessions WHERE routine_id = ? ORDER BY sort_order;`,
    [routine.routineId],
  );
  const sessions = sessionRows.map(toSessionRow);

  const weekSessionRows = await db.getAll(
    `SELECT ws.week_session_id, cw.cycle_id, cw.week_number, ws.session_id,
            ws.status, ws.resolved_on_date
     FROM WeekSessions ws
     JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
     WHERE cw.cycle_id IN (SELECT cycle_id FROM Cycles WHERE routine_id = ?);`,
    [routine.routineId],
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

  return { routine, cycles, sessions, exercises, weekSessions };
}

/** The queue for the active routine, from the database. */
export async function loadSessionQueue(
  db: RoutineDatabase,
  todayStamp: number,
): Promise<SessionQueueState> {
  return computeSessionQueue(await loadSessionQueueInput(db), todayStamp);
}

/** The move choices for a session, loaded from the same queue rows as its writer. */
export async function loadMoveDayPlan(
  db: RoutineDatabase,
  weekSessionId: number,
  todayStamp: number,
): Promise<MoveDayPlan> {
  return buildMoveDayPlan(await loadSessionQueueInput(db), weekSessionId, todayStamp);
}

/**
 * The resolution writers. Each validates through the pure layer against
 * the same rows the queue computes from, then writes one row; a rejected
 * resolution throws rather than being applied. The `status = 'pending'` guard
 * makes a second resolution a no-op.
 */
export async function resolveDoTodaySession(
  db: RoutineDatabase,
  weekSessionId: number,
  todayStamp: number,
): Promise<void> {
  const input = await loadSessionQueueInput(db);
  const outcome = applyDoToday(input, weekSessionId, todayStamp);
  if (!outcome.ok) {
    throw new Error(`resolveDoTodaySession: ${outcome.reason}`);
  }
  await db.run(
    `UPDATE WeekSessions SET resolved_on_date = ?
     WHERE week_session_id = ? AND status = 'pending';`,
    [todayStamp, weekSessionId],
  );
}

export async function resolveMoveSession(
  db: RoutineDatabase,
  weekSessionId: number,
  targetStamp: number,
): Promise<void> {
  const input = await loadSessionQueueInput(db);
  const outcome = applyMove(input, weekSessionId, targetStamp);
  if (!outcome.ok) {
    throw new Error(`resolveMoveSession: ${outcome.reason}`);
  }
  await db.run(
    `UPDATE WeekSessions SET status = 'moved', resolved_on_date = ?
     WHERE week_session_id = ? AND status = 'pending';`,
    [targetStamp, weekSessionId],
  );
}

export async function resolveDiscardSession(
  db: RoutineDatabase,
  weekSessionId: number,
): Promise<void> {
  const input = await loadSessionQueueInput(db);
  const outcome = applyDiscard(input, weekSessionId);
  if (!outcome.ok) {
    throw new Error(`resolveDiscardSession: ${outcome.reason}`);
  }
  const discarded = outcome.weekSessions.find(
    (row) => row.weekSessionId === weekSessionId,
  );
  if (discarded === undefined) {
    throw new Error('resolveDiscardSession: no row to write');
  }
  await db.run(
    `UPDATE WeekSessions SET status = 'discarded', resolved_on_date = ?
     WHERE week_session_id = ? AND status = 'pending';`,
    [discarded.resolvedOnDate, weekSessionId],
  );
}

export async function undoDiscardSession(
  db: RoutineDatabase,
  weekSessionId: number,
): Promise<void> {
  const input = await loadSessionQueueInput(db);
  const outcome = applyUndoDiscard(input, weekSessionId);
  if (!outcome.ok) {
    throw new Error(`undoDiscardSession: ${outcome.reason}`);
  }
  await db.run(
    `UPDATE WeekSessions SET status = 'pending', resolved_on_date = NULL
     WHERE week_session_id = ? AND status = 'discarded';`,
    [weekSessionId],
  );
}
