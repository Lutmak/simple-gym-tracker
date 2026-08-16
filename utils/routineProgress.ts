/**
 * G2 — Progress: the routine view (SPECS.md G2, §3.3, §3.7).
 *
 * Pure core plus thin database edges, same split as utils/today.ts. The
 * primary progress surface answers the maintainer's "el progreso principal
 * que nos interesa es por rutina": cycles and weeks in ascending order with
 * the current week marked, per-week adherence from WeekSessions statuses, and
 * the trend of each main-role exercise as its top logged weight per session.
 * Charts render the weight_logged value with the row's own unit (§3.7 —
 * nothing is ever converted; the unit travels with the log row). The calendar
 * markers come from Workout_Log dates alone — the calendar is a historical
 * view, never a scheduler.
 */

import type {
  RoutineDatabase,
  RoutineLoadSource,
  RoutineUnit,
} from './routineActions';
import { targetWeightFor } from './today';

export type WeekSessionStatus = 'pending' | 'completed' | 'moved' | 'discarded';
export type CycleStatus = 'planned' | 'active' | 'complete';

export interface ProgressRoutine {
  routineId: number;
  name: string;
  isActive: boolean;
  unit: RoutineUnit;
  roundingIncrement: number;
}

export interface ProgressCycle {
  cycleId: number;
  cycleNumber: number;
  weeks: number;
  status: CycleStatus;
  currentWeek: number;
}

export interface WeekAdherence {
  planned: number;
  completed: number;
  moved: number;
  discarded: number;
  pending: number;
}

export interface ProgressWeek {
  weekNumber: number;
  adherence: WeekAdherence;
  /** Every session of the week is resolved — the week is openable read-only-with-edit. */
  resolved: boolean;
  /** The active cycle's current week, marked in the UI. */
  isCurrent: boolean;
}

export interface ProgressCycleView {
  cycle: ProgressCycle;
  weeks: ProgressWeek[];
}

export interface LiftWeightRow {
  /** Whole UTC day (noon) stamp of the log date. */
  date: number;
  weight: number;
  reps: number;
  unit: RoutineUnit;
}

export interface MainLiftPoint {
  date: number;
  weight: number;
  reps: number;
}

export interface MainLiftSeries {
  exerciseName: string;
  /** The series label unit: the last log row's unit, falling back to the plan. */
  unit: RoutineUnit;
  points: MainLiftPoint[];
}

export interface CalendarLogRow {
  workoutLogId: number;
  workoutName: string;
  dayName: string;
  /** Whole UTC day (noon) stamp. */
  date: number;
}

export interface PlannedExercise {
  sessionExerciseId: number;
  name: string;
  role: 'main' | 'accessory';
  targetSets: number;
  targetReps: number;
  /** Concrete target weight in `unit`; null for bodyweight. */
  targetWeight: number | null;
  unit: RoutineUnit;
  isAmrap: boolean;
}

export interface PlannedSession {
  sessionId: number;
  weekday: number;
  name: string;
  exercises: PlannedExercise[];
}

export interface LoggedSet {
  setNumber: number;
  weight: number;
  reps: number;
  unit: RoutineUnit;
}

export interface LoggedExercise {
  exerciseName: string;
  sets: LoggedSet[];
}

export interface LoggedSession {
  sessionId: number;
  date: number;
  exercises: LoggedExercise[];
}

export interface WeekSessionView {
  sessionId: number;
  status: WeekSessionStatus;
  resolvedOnDate: number | null;
}

export interface WeekDetailData {
  routineId: number;
  routineName: string;
  cycleId: number;
  cycleNumber: number;
  weekNumber: number;
  sessionStatuses: WeekSessionView[];
  planned: PlannedSession[];
  logged: LoggedSession[];
}

export interface RoutineProgressData {
  routine: ProgressRoutine;
  cycles: ProgressCycleView[];
}

/** The smallest deep-link target needed to reopen a saved routine week. */
export interface ProgressFocus {
  routineId: number;
  cycleId: number;
  weekNumber: number;
}

export function hasProgressFocus(
  data: RoutineProgressData,
  focus: ProgressFocus,
): boolean {
  if (data.routine.routineId !== focus.routineId) {
    return false;
  }
  return data.cycles.some(
    (cycleView) =>
      cycleView.cycle.cycleId === focus.cycleId &&
      cycleView.weeks.some((week) => week.weekNumber === focus.weekNumber),
  );
}

/** Adherence from one week's WeekSessions statuses (§3.6 statuses). */
export function computeWeekAdherence(
  rows: readonly { status: WeekSessionStatus }[],
): WeekAdherence {
  const adherence: WeekAdherence = {
    planned: rows.length,
    completed: 0,
    moved: 0,
    discarded: 0,
    pending: 0,
  };
  for (const row of rows) {
    adherence[row.status] += 1;
  }
  return adherence;
}

/** Weeks 1..N in ascending order; the active cycle's current week is marked. */
export function buildCycleWeeks(
  cycle: { status: CycleStatus; currentWeek: number },
  weekCount: number,
  rows: readonly { weekNumber: number; status: WeekSessionStatus }[],
): ProgressWeek[] {
  const weeks: ProgressWeek[] = [];
  for (let weekNumber = 1; weekNumber <= weekCount; weekNumber += 1) {
    const adherence = computeWeekAdherence(
      rows.filter((row) => row.weekNumber === weekNumber),
    );
    weeks.push({
      weekNumber,
      adherence,
      resolved: adherence.pending === 0,
      isCurrent: cycle.status === 'active' && weekNumber === cycle.currentWeek,
    });
  }
  return weeks;
}

/**
 * The top logged weight per session day, ascending by date. A session logs an
 * exercise several times; the series plots the heaviest set of each day. All
 * values stay in the unit they were logged in (§3.7).
 */
export function buildLiftSeries(rows: readonly LiftWeightRow[]): MainLiftPoint[] {
  const bestByDate = new Map<number, LiftWeightRow>();
  for (const row of rows) {
    const current = bestByDate.get(row.date);
    if (
      current === undefined ||
      row.weight > current.weight ||
      (row.weight === current.weight && row.reps > current.reps)
    ) {
      bestByDate.set(row.date, row);
    }
  }
  return [...bestByDate.values()]
    .sort((a, b) => a.date - b.date)
    .map(({ date, weight, reps }) => ({ date, weight, reps }));
}

/**
 * B7's rule, shared with G3: a chart is drawn only for a series with at least
 * two points; empty and single-point series are handled by the caller instead
 * of being handed to the chart library.
 */
export function hasChartableSeries(points: readonly MainLiftPoint[]): boolean {
  return points.length >= 2;
}

/** Day stamp → number of logged sessions that day. */
export function buildCalendarMarkers(rows: readonly CalendarLogRow[]): Map<number, number> {
  const markers = new Map<number, number>();
  for (const row of rows) {
    markers.set(row.date, (markers.get(row.date) ?? 0) + 1);
  }
  return markers;
}

/** The logs performed on one day stamp, in log order. */
export function logsOnDate(
  rows: readonly CalendarLogRow[],
  date: number,
): CalendarLogRow[] {
  return rows
    .filter((row) => row.date === date)
    .sort((a, b) => a.workoutLogId - b.workoutLogId);
}

const num = (value: unknown): number => Number(value);
const str = (value: unknown): string => String(value);
const nullableNum = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);
const nullableStr = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

const toRoutine = (row: Record<string, unknown>): ProgressRoutine => ({
  routineId: num(row.routine_id),
  name: str(row.name),
  isActive: num(row.is_active) === 1,
  unit: str(row.unit) as RoutineUnit,
  roundingIncrement: num(row.rounding_increment),
});

const toCycle = (row: Record<string, unknown>): ProgressCycle => ({
  cycleId: num(row.cycle_id),
  cycleNumber: num(row.cycle_number),
  weeks: num(row.weeks),
  status: str(row.status) as CycleStatus,
  currentWeek: num(row.current_week),
});

/** Every routine, active first — the selector's list. */
export async function loadProgressRoutines(
  db: RoutineDatabase,
): Promise<ProgressRoutine[]> {
  const rows = await db.getAll(
    `SELECT routine_id, name, is_active, unit, rounding_increment
     FROM Routines ORDER BY is_active DESC, routine_id;`,
    [],
  );
  return rows.map(toRoutine);
}

/**
 * The selected routine's cycles (ascending) with their weeks built from
 * WeekSessions statuses.
 */
export async function loadRoutineProgress(
  db: RoutineDatabase,
  routineId: number,
): Promise<RoutineProgressData> {
  const routineRow = await db.get(
    `SELECT routine_id, name, is_active, unit, rounding_increment
     FROM Routines WHERE routine_id = ?;`,
    [routineId],
  );
  if (routineRow === undefined) {
    throw new Error(`Unknown routine ${routineId}`);
  }
  const routine = toRoutine(routineRow);

  const cycleRows = await db.getAll(
    `SELECT cycle_id, cycle_number, weeks, status, current_week
     FROM Cycles WHERE routine_id = ? ORDER BY cycle_number;`,
    [routineId],
  );
  const cycles = cycleRows.map(toCycle);

  const statusRows = (await db.getAll(
    `SELECT cw.cycle_id, cw.week_number, ws.status
     FROM WeekSessions ws
     JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
     JOIN Cycles c ON c.cycle_id = cw.cycle_id
     WHERE c.routine_id = ?
     ORDER BY cw.cycle_id, cw.week_number;`,
    [routineId],
  )).map((row) => ({
    cycleId: num(row.cycle_id),
    weekNumber: num(row.week_number),
    status: str(row.status) as WeekSessionStatus,
  }));

  const cyclesView: ProgressCycleView[] = cycles.map((cycle) => {
    const rows = statusRows.filter((row) => row.cycleId === cycle.cycleId);
    return {
      cycle,
      weeks: buildCycleWeeks(cycle, cycle.weeks, rows),
    };
  });
  return { routine, cycles: cyclesView };
}

/** One main-role exercise of the routine per series: top weight per session. */
export async function loadMainLiftSeries(
  db: RoutineDatabase,
  routineId: number,
): Promise<MainLiftSeries[]> {
  const routineRow = await db.get(
    'SELECT unit FROM Routines WHERE routine_id = ?;',
    [routineId],
  );
  const routineUnit: RoutineUnit =
    routineRow === undefined ? 'kg' : (str(routineRow.unit) as RoutineUnit);

  const planRows = await db.getAll(
    `SELECT se.session_exercise_id, se.exercise_name, se.unit_override
     FROM SessionExercises se
     JOIN Sessions s ON s.session_id = se.session_id
     WHERE s.routine_id = ? AND se.role = 'main'
     ORDER BY se.sort_order;`,
    [routineId],
  );

  const weightRows = await db.getAll(
    `SELECT wol.workout_date AS date, le.exercise_name, wl.weight_logged,
            wl.reps_logged, wl.unit
     FROM Cycles c
     JOIN CycleWeeks cw ON cw.cycle_id = c.cycle_id
     JOIN WeekSessions ws ON ws.cycle_week_id = cw.cycle_week_id
     JOIN Workout_Log wol ON wol.workout_log_id = ws.completed_log_id
     JOIN Logged_Exercises le ON le.workout_log_id = wol.workout_log_id
     JOIN Weight_Log wl ON wl.logged_exercise_id = le.logged_exercise_id
     WHERE c.routine_id = ?
     ORDER BY wol.workout_date;`,
    [routineId],
  );

  return planRows.map((plan) => {
    const name = str(plan.exercise_name);
    const planUnit =
      (nullableStr(plan.unit_override) as RoutineUnit | null) ?? routineUnit;
    const rows: LiftWeightRow[] = weightRows
      .filter((row) => str(row.exercise_name) === name)
      .map((row) => ({
        date: num(row.date),
        weight: num(row.weight_logged),
        reps: num(row.reps_logged),
        unit: str(row.unit) as RoutineUnit,
      }));
    const points = buildLiftSeries(rows);
    const unit = rows.length > 0 ? rows[rows.length - 1].unit : planUnit;
    return { exerciseName: name, unit, points };
  });
}

/** Every log in the database — the calendar's raw material. */
export async function loadCalendarLogs(
  db: RoutineDatabase,
): Promise<CalendarLogRow[]> {
  const rows = await db.getAll(
    `SELECT workout_log_id, workout_name, day_name, workout_date AS date
     FROM Workout_Log ORDER BY workout_date;`,
    [],
  );
  return rows.map((row) => ({
    workoutLogId: num(row.workout_log_id),
    workoutName: str(row.workout_name),
    dayName: str(row.day_name),
    date: num(row.date),
  }));
}

interface PlanExerciseRow {
  sessionId: number;
  weekday: number;
  sessionName: string;
  sessionExerciseId: number;
  name: string;
  role: 'main' | 'accessory';
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

interface LoggedRow {
  sessionId: number;
  date: number;
  exerciseName: string;
  setNumber: number;
  weight: number;
  reps: number;
  unit: RoutineUnit;
}

/**
 * One past week read-only-with-edit: the plan rows (SessionExercises targets,
 * resolved to concrete weights in each exercise's own unit) and the logged
 * rows of that week's completed or moved sessions, in the unit they were
 * logged in. Plan rows are the current plan — §3.2 keeps history untouched,
 * so the logged side is always the ground truth for a past week.
 */
export async function loadWeekDetail(
  db: RoutineDatabase,
  routineId: number,
  cycleId: number,
  weekNumber: number,
): Promise<WeekDetailData> {
  const routineRow = await db.get(
    `SELECT r.name, r.unit, r.rounding_increment, c.cycle_number
     FROM Routines r JOIN Cycles c ON c.routine_id = r.routine_id
     WHERE r.routine_id = ? AND c.cycle_id = ?;`,
    [routineId, cycleId],
  );
  if (routineRow === undefined) {
    throw new Error(`Unknown cycle ${cycleId} for routine ${routineId}`);
  }
  const routineUnit = str(routineRow.unit) as RoutineUnit;
  const roundingIncrement = num(routineRow.rounding_increment);

  const planRows: PlanExerciseRow[] = (
    await db.getAll(
      `SELECT s.session_id, s.weekday, s.name AS session_name,
              e.session_exercise_id, e.exercise_name AS name, e.role,
              e.target_sets, e.target_reps, e.load_source, e.absolute_weight,
              e.training_max_weight, e.training_max_pct, e.unit_override,
              e.is_amrap, e.sort_order
       FROM Sessions s
       JOIN SessionExercises e ON e.session_id = s.session_id
       WHERE s.routine_id = ?
       ORDER BY s.sort_order, e.sort_order;`,
      [routineId],
    )
  ).map((row) => ({
    sessionId: num(row.session_id),
    weekday: num(row.weekday),
    sessionName: str(row.session_name),
    sessionExerciseId: num(row.session_exercise_id),
    name: str(row.name),
    role: str(row.role) as PlanExerciseRow['role'],
    targetSets: num(row.target_sets),
    targetReps: num(row.target_reps),
    loadSource: str(row.load_source) as RoutineLoadSource,
    absoluteWeight: nullableNum(row.absolute_weight),
    trainingMaxWeight: nullableNum(row.training_max_weight),
    trainingMaxPct: nullableNum(row.training_max_pct),
    unitOverride: (nullableStr(row.unit_override) as RoutineUnit | null) ?? null,
    isAmrap: num(row.is_amrap) === 1,
    sortOrder: num(row.sort_order),
  }));

  const statusRows = await db.getAll(
    `SELECT ws.session_id, ws.status, ws.resolved_on_date
     FROM WeekSessions ws
     JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
     WHERE cw.cycle_id = ? AND cw.week_number = ?
     ORDER BY ws.session_id;`,
    [cycleId, weekNumber],
  );
  const sessionStatuses: WeekSessionView[] = statusRows.map((row) => ({
    sessionId: num(row.session_id),
    status: str(row.status) as WeekSessionStatus,
    resolvedOnDate: nullableNum(row.resolved_on_date),
  }));

  const loggedRows: LoggedRow[] = (
    await db.getAll(
      `SELECT ws.session_id, wol.workout_date AS date, le.exercise_name,
              wl.set_number, wl.weight_logged, wl.reps_logged, wl.unit
       FROM WeekSessions ws
       JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
       JOIN Workout_Log wol ON wol.workout_log_id = ws.completed_log_id
       JOIN Logged_Exercises le ON le.workout_log_id = wol.workout_log_id
       JOIN Weight_Log wl ON wl.logged_exercise_id = le.logged_exercise_id
       WHERE cw.cycle_id = ? AND cw.week_number = ?
         AND ws.status IN ('completed', 'moved')
       ORDER BY ws.session_id, le.exercise_name, wl.set_number;`,
      [cycleId, weekNumber],
    )
  ).map((row) => ({
    sessionId: num(row.session_id),
    date: num(row.date),
    exerciseName: str(row.exercise_name),
    setNumber: num(row.set_number),
    weight: num(row.weight_logged),
    reps: num(row.reps_logged),
    unit: str(row.unit) as RoutineUnit,
  }));

  const planned: PlannedSession[] = [];
  const plannedBySession = new Map<number, PlannedSession>();
  for (const row of planRows) {
    let session = plannedBySession.get(row.sessionId);
    if (session === undefined) {
      session = {
        sessionId: row.sessionId,
        weekday: row.weekday,
        name: row.sessionName,
        exercises: [],
      };
      plannedBySession.set(row.sessionId, session);
      planned.push(session);
    }
    session.exercises.push({
      sessionExerciseId: row.sessionExerciseId,
      name: row.name,
      role: row.role,
      targetSets: row.targetSets,
      targetReps: row.targetReps,
      targetWeight: targetWeightFor(row, roundingIncrement),
      unit: row.unitOverride ?? routineUnit,
      isAmrap: row.isAmrap,
    });
  }

  const logged: LoggedSession[] = [];
  const loggedBySession = new Map<number, LoggedSession>();
  const loggedBySessionExercise = new Map<string, LoggedExercise>();
  for (const row of loggedRows) {
    let session = loggedBySession.get(row.sessionId);
    if (session === undefined) {
      session = { sessionId: row.sessionId, date: row.date, exercises: [] };
      loggedBySession.set(row.sessionId, session);
      logged.push(session);
    }
    const key = `${row.sessionId}:${row.exerciseName}`;
    let exercise = loggedBySessionExercise.get(key);
    if (exercise === undefined) {
      exercise = { exerciseName: row.exerciseName, sets: [] };
      loggedBySessionExercise.set(key, exercise);
      session.exercises.push(exercise);
    }
    exercise.sets.push({
      setNumber: row.setNumber,
      weight: row.weight,
      reps: row.reps,
      unit: row.unit,
    });
  }

  return {
    routineId,
    routineName: str(routineRow.name),
    cycleId,
    cycleNumber: num(routineRow.cycle_number),
    weekNumber,
    sessionStatuses,
    planned,
    logged,
  };
}
