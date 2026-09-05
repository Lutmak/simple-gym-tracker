/**
 * G2 — Progress: the routine view (SPECS.md G2, §3.3, §3.7).
 *
 * Pure core plus thin database edges, same split as utils/today.ts. The
 * primary progress surface answers the maintainer's "el progreso principal
 * que nos interesa es por rutina": cycles and weeks in ascending order with
 * the current week marked, per-week adherence from WeekSessions statuses, and
 * the trend of each main-role exercise as its top logged weight per session.
 * Charts render the weight_logged value with the row's own unit (§3.7 —
 * nothing is ever converted; the unit travels with the log row).
 *
 * P1 added what a week opens into: `sessionDetailsOfWeek` and
 * `sessionExercises` turn a week into the sessions and exercises one sheet
 * shows, and `cycleAdherence` states a cycle in the numbers the tiles read.
 * The calendar's own model moved to `utils/progressCalendar.ts` when it stopped
 * being "a dot per log" and became a day state (P2).
 */

import type {
  RoutineDatabase,
  RoutineLoadSource,
  RoutineUnit,
} from './routineActions';
import { groupByUnit } from './chart';
import { nominalSessionStamp, targetSetsFor, type PlannedTargetSet } from './today';

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
  /** The day the cycle was completed — what "Ciclo 1 · completado el 12 de marzo" reads from. */
  completedAt: number | null;
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

export interface LiftUnitSeries {
  /** The unit every point of this series is in — never mixed within one series (§3.7). */
  unit: RoutineUnit;
  points: MainLiftPoint[];
}

export interface MainLiftSeries {
  exerciseName: string;
  /**
   * One chartable series per logged unit, most recently logged first, and never empty: an
   * exercise with nothing logged still carries its plan's unit so the chart can say so.
   */
  series: LiftUnitSeries[];
}

export interface PlannedExercise {
  sessionExerciseId: number;
  name: string;
  role: 'main' | 'accessory';
  targetSets: number;
  targetReps: number;
  /** Concrete target weight in `unit`; null for bodyweight. First work set's, kept for callers that only want one number. */
  targetWeight: number | null;
  unit: RoutineUnit;
  isAmrap: boolean;
  /** Why a null weight reads "bodyweight" rather than "not learned yet" (U5's `formatPlanLine`). */
  loadSource: RoutineLoadSource;
  /** Every planned work set's own target for the week being viewed — a wave exercise's sets differ (U5). */
  sets: PlannedTargetSet[];
}

export interface PlannedSession {
  sessionId: number;
  weekday: number;
  name: string;
  exercises: PlannedExercise[];
}

export interface LoggedSet {
  /** The `Weight_Log` row behind this set — what an edit writes to (P1). */
  weightLogId: number;
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
  /** The cycle's first day — the origin every nominal session date is measured from. */
  cycleStartedAt: number | null;
  /** The routine's step, so a correction is −/+ one increment rather than a keyboard (§3.5). */
  roundingIncrement: number;
  weekNumber: number;
  sessionStatuses: WeekSessionView[];
  planned: PlannedSession[];
  logged: LoggedSession[];
}

/** A session as one surface shows it: the plan, what was logged, and its state. */
export type SessionDetailStatus = WeekSessionStatus | 'free';

export interface SessionDetail {
  sessionId: number | null;
  name: string;
  status: SessionDetailStatus;
  /** The day the session sits on; null when its cycle has not started. */
  date: number | null;
  planned: PlannedExercise[];
  logged: LoggedExercise[];
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

/**
 * Sessions of the week that actually happened. A moved session was done, on
 * another day (§3.1) — it counts, which is why moving never breaks a streak and
 * discarding does (§3.7).
 */
export function weekSessionsDone(adherence: WeekAdherence): number {
  return adherence.completed + adherence.moved;
}

export interface CycleAdherence {
  done: number;
  planned: number;
  /** Whole per cent, 0 when the cycle plans nothing — never NaN on screen. */
  percent: number;
}

/** Adherence over a whole cycle: sessions done out of sessions planned (§3.7). */
export function cycleAdherence(weeks: readonly ProgressWeek[]): CycleAdherence {
  let done = 0;
  let planned = 0;
  for (const week of weeks) {
    done += weekSessionsDone(week.adherence);
    planned += week.adherence.planned;
  }
  return {
    done,
    planned,
    percent: planned === 0 ? 0 : Math.round((done / planned) * 100),
  };
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

/**
 * One week's sessions as the sheet shows them: the plan, what was logged
 * against it, the state it ended in and the day it sits on. Only sessions the
 * week actually contains appear — a session added to the routine afterwards has
 * no week row and is not part of a past week (§3.2 keeps history untouched).
 *
 * The date follows the same rule as the queue and the calendar: the day the
 * session was resolved onto when it has one, its nominal cycle day otherwise.
 */
export function sessionDetailsOfWeek(week: WeekDetailData): SessionDetail[] {
  const plannedById = new Map(week.planned.map((session) => [session.sessionId, session]));
  const loggedById = new Map(week.logged.map((session) => [session.sessionId, session]));
  const order = new Map(week.planned.map((session, index) => [session.sessionId, index]));

  return [...week.sessionStatuses]
    .sort(
      (a, b) =>
        (order.get(a.sessionId) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.sessionId) ?? Number.MAX_SAFE_INTEGER) ||
        a.sessionId - b.sessionId,
    )
    .map((status) => {
      const planned = plannedById.get(status.sessionId);
      const logged = loggedById.get(status.sessionId);
      const nominal =
        planned === undefined || week.cycleStartedAt === null
          ? null
          : nominalSessionStamp(week.cycleStartedAt, week.weekNumber, planned.weekday);
      return {
        sessionId: status.sessionId,
        name: planned?.name ?? '',
        status: status.status,
        date: status.resolvedOnDate ?? logged?.date ?? nominal,
        planned: planned?.exercises ?? [],
        logged: logged?.exercises ?? [],
      };
    });
}

/** One exercise of a session: what was planned for it, and what was logged. */
export interface SessionExerciseView {
  name: string;
  /** Null for an exercise added during the session, and for a free log. */
  planned: PlannedExercise | null;
  sets: LoggedSet[];
}

/**
 * A session as a list of exercises rather than two lists side by side. The plan
 * leads, in its own order; anything logged that the plan did not contain — an
 * exercise added mid-session (§3.4), or every exercise of a free log — follows
 * in the order it was logged. Matching is by name, which is the same key
 * history is written with (§3.2).
 */
export function sessionExercises(detail: SessionDetail): SessionExerciseView[] {
  const setsByName = new Map(
    detail.logged.map((exercise) => [exercise.exerciseName, exercise.sets]),
  );
  const views: SessionExerciseView[] = detail.planned.map((planned) => ({
    name: planned.name,
    planned,
    sets: setsByName.get(planned.name) ?? [],
  }));
  const plannedNames = new Set(detail.planned.map((planned) => planned.name));
  for (const exercise of detail.logged) {
    if (!plannedNames.has(exercise.exerciseName)) {
      views.push({ name: exercise.exerciseName, planned: null, sets: exercise.sets });
    }
  }
  return views;
}

export interface PlanLineLabels {
  /** The line's leading word — "Planificado"/"Planned". */
  label: string;
  /** What a set whose weight is not yet learned reads instead of a number (ADR-0034). */
  unlearnedWeight: string;
  /** What a bodyweight exercise's set reads instead of a number. */
  bodyweight: string;
}

/**
 * The session detail sheet's plan line (SPEC.md U5): that week's actual per-set targets, e.g.
 * "Planificado: 37.5 · 43 · 49 kg × 5+" — every set's own load when they differ, which is the
 * ordinary case for a wave exercise every single week, collapsed to one number when every set
 * really does share it (an accessory's flat weight). Never the training-max-ish single figure a
 * caller gets by asking `targetWeightFor` for one number without a week — that number sits next
 * to sets whose real target is not it, which is the defect this replaces.
 */
export function formatPlanLine(
  sets: readonly PlannedTargetSet[],
  unit: RoutineUnit,
  loadSource: RoutineLoadSource,
  labels: PlanLineLabels,
): string {
  if (sets.length === 0) {
    return labels.label;
  }
  const missingWeightLabel = loadSource === 'bodyweight' ? labels.bodyweight : labels.unlearnedWeight;
  const formatSetWeight = (weight: number): string => String(Number(weight.toFixed(1)));
  const knownWeights = sets
    .map((set) => set.targetWeight)
    .filter((weight): weight is number => weight !== null);
  const weightsUniform =
    knownWeights.length === sets.length &&
    knownWeights.every((weight) => weight === knownWeights[0]);

  const loadText =
    knownWeights.length === 0
      ? missingWeightLabel
      : weightsUniform
        ? `${formatSetWeight(knownWeights[0])} ${unit}`
        : `${sets
            .map((set) => (set.targetWeight === null ? missingWeightLabel : formatSetWeight(set.targetWeight)))
            .join(' · ')} ${unit}`;

  const firstReps = sets[0].targetReps;
  const repsUniform = sets.every((set) => set.targetReps === firstReps);
  const repsText = repsUniform
    ? `${firstReps}${sets.some((set) => set.isAmrap) ? '+' : ''}`
    : sets.map((set) => `${set.targetReps}${set.isAmrap ? '+' : ''}`).join('/');

  return `${labels.label}: ${loadText} × ${repsText}`;
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
  completedAt: nullableNum(row.completed_at),
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
    `SELECT cycle_id, cycle_number, weeks, status, current_week, completed_at
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
    const groups = groupByUnit(rows);
    const series: LiftUnitSeries[] =
      groups.length === 0
        ? [{ unit: planUnit, points: [] }]
        : groups.map((group) => ({
            unit: group.unit,
            points: buildLiftSeries(group.rows),
          }));
    return { exerciseName: name, series };
  });
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
  weightLogId: number;
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
    `SELECT r.name, r.unit, r.rounding_increment, c.cycle_number, c.started_at
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
              wl.weight_log_id, wl.set_number, wl.weight_logged, wl.reps_logged, wl.unit
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
    weightLogId: num(row.weight_log_id),
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
    // U5: computed against THIS week's wave, not the flat fallback
    // `targetWeightFor` gives without a week number — that fallback reads a
    // training-max-ish figure next to sets that actually differ.
    const sets = targetSetsFor(row, roundingIncrement, weekNumber);
    session.exercises.push({
      sessionExerciseId: row.sessionExerciseId,
      name: row.name,
      role: row.role,
      targetSets: row.targetSets,
      targetReps: row.targetReps,
      targetWeight: sets[0]?.targetWeight ?? null,
      unit: row.unitOverride ?? routineUnit,
      isAmrap: row.isAmrap,
      loadSource: row.loadSource,
      sets,
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
      weightLogId: row.weightLogId,
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
    cycleStartedAt: nullableNum(routineRow.started_at),
    roundingIncrement,
    weekNumber,
    sessionStatuses,
    planned,
    logged,
  };
}

/**
 * One free-logging session (H6), read the same way a planned one is: it has no
 * plan to compare against, so the sheet shows what was logged and says what it
 * was. Keyed on the log rather than on a week session, because a free session
 * belongs to no routine's plan by definition.
 */
export async function loadFreeLogDetail(
  db: RoutineDatabase,
  workoutLogId: number,
): Promise<SessionDetail | null> {
  const logRow = await db.get(
    `SELECT workout_name, workout_date AS date FROM Workout_Log WHERE workout_log_id = ?;`,
    [workoutLogId],
  );
  if (logRow === undefined) {
    return null;
  }

  const setRows = await db.getAll(
    `SELECT le.exercise_name, wl.weight_log_id, wl.set_number, wl.weight_logged,
            wl.reps_logged, wl.unit
     FROM Logged_Exercises le
     JOIN Weight_Log wl ON wl.logged_exercise_id = le.logged_exercise_id
     WHERE le.workout_log_id = ?
     ORDER BY le.logged_exercise_id, wl.set_number;`,
    [workoutLogId],
  );

  const logged: LoggedExercise[] = [];
  const byName = new Map<string, LoggedExercise>();
  for (const row of setRows) {
    const name = str(row.exercise_name);
    let exercise = byName.get(name);
    if (exercise === undefined) {
      exercise = { exerciseName: name, sets: [] };
      byName.set(name, exercise);
      logged.push(exercise);
    }
    exercise.sets.push({
      weightLogId: num(row.weight_log_id),
      setNumber: num(row.set_number),
      weight: num(row.weight_logged),
      reps: num(row.reps_logged),
      unit: str(row.unit) as RoutineUnit,
    });
  }

  return {
    sessionId: null,
    name: str(logRow.workout_name),
    status: 'free',
    date: num(logRow.date),
    planned: [],
    logged,
  };
}
