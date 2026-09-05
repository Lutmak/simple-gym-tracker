/**
 * G2 — Progress: the routine view (SPECS.md G2, §3.3, §3.7).
 *
 * Pure core plus thin database edges, same split as utils/today.ts. The
 * primary progress surface answers the maintainer's "el progreso principal
 * que nos interesa es por rutina": cycles and weeks in ascending order with
 * the current week marked, and per-week adherence from WeekSessions statuses.
 * Charts render the weight_logged value with the row's own unit (§3.7 —
 * nothing is ever converted; the unit travels with the log row).
 *
 * P1 added what a week opens into: `sessionDetailsOfWeek` and
 * `sessionExercises` turn a week into the sessions and exercises one sheet
 * shows, and `cycleAdherence` states a cycle in the numbers the tiles read.
 * The calendar's own model moved to `utils/progressCalendar.ts` when it stopped
 * being "a dot per log" and became a day state (P2).
 *
 * U3 replaced the main-lift trend: `loadStrengthSeries` (and its pure
 * `buildStrengthPoints`/`buildTrainingMaxByCycle`/`buildStrengthChart` core) plots each main
 * lift's estimated 1RM from its AMRAP set and the training max it trained against, instead of the
 * session's raw top weight — the audit's defect 10, "the sawtooth is the wave, not progress".
 */

import type {
  RoutineDatabase,
  RoutineLoadSource,
  RoutineUnit,
} from './routineActions';
import { chartRangeStart, type ChartRange } from './chart';
import { estimate1RM } from './fiveThreeOne';
import { DAY_SECONDS, nominalSessionStamp, targetWeightFor } from './today';

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
  /** One status per planned session, in the routine's own session order — U3's four state
   * discs, which need each session's own status, not just the week's totals. */
  sessionStatuses: WeekSessionStatus[];
}

export interface ProgressCycleView {
  cycle: ProgressCycle;
  weeks: ProgressWeek[];
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

/**
 * Weeks 1..N in ascending order; the active cycle's current week is marked. `rows` must already
 * be in the routine's own session order (its caller's `ORDER BY ... sort_order`) — that order is
 * what `sessionStatuses` reads for U3's per-session state discs, and this function never reorders.
 */
export function buildCycleWeeks(
  cycle: { status: CycleStatus; currentWeek: number },
  weekCount: number,
  rows: readonly { weekNumber: number; status: WeekSessionStatus }[],
): ProgressWeek[] {
  const weeks: ProgressWeek[] = [];
  for (let weekNumber = 1; weekNumber <= weekCount; weekNumber += 1) {
    const weekRows = rows.filter((row) => row.weekNumber === weekNumber);
    const adherence = computeWeekAdherence(weekRows);
    weeks.push({
      weekNumber,
      adherence,
      resolved: adherence.pending === 0,
      isCurrent: cycle.status === 'active' && weekNumber === cycle.currentWeek,
      sessionStatuses: weekRows.map((row) => row.status),
    });
  }
  return weeks;
}

/**
 * B7's rule, shared with G3: a chart is drawn only for a series with at least
 * two points; empty and single-point series are handled by the caller instead
 * of being handed to the chart library.
 */
export function hasChartableSeries<T extends { date: number }>(points: readonly T[]): boolean {
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
     JOIN Sessions s ON s.session_id = ws.session_id
     WHERE c.routine_id = ?
     ORDER BY cw.cycle_id, cw.week_number, s.sort_order;`,
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

/**
 * U3 — Progreso's strength chart (SPEC.md U3, ADR-0047, audit defect 10): one main lift's
 * estimated 1RM from each non-deload week's AMRAP set, and the training max it was actually
 * trained against that cycle, as a step. Replaces `loadMainLiftSeries`'s top-weight-per-session
 * series, which plotted the wave's own sawtooth (5/3/1 loads by design, week to week) rather than
 * whether the lifter got stronger.
 */

/** A cycle's AMRAP weeks are always its first three (§3.2, F3) — same rule `cycleReview.ts` uses:
 * true whether the cycle has a 4th (deload) week or not, since a deload-off cycle's week 3 is
 * still a normal AMRAP week, not a renumbered deload. */
export const AMRAP_WEEK_COUNT = 3;

export interface AmrapSetRow {
  cycleNumber: number;
  weekNumber: number;
  /** The day this week's set was logged — folded into a per-week anchor, never used bare (see
   * `buildStrengthChart`): different main lifts of the same routine can log their AMRAP set on
   * different weekdays of the same training week. */
  date: number;
  setNumber: number;
  weight: number;
  reps: number;
}

export interface StrengthWeekPoint {
  cycleNumber: number;
  weekNumber: number;
  /** The cycle's start plus `(weekNumber - 1)` weeks — a lift-independent anchor, so every main
   * lift of the routine plots the same training week at the same x-position even when they were
   * each trained on a different day of it. */
  date: number;
  estimated1RM: number;
}

/**
 * One e1RM point per (cycle, week) with a logged AMRAP result: the last of at least three logged
 * sets, the same detection `cycleReview.ts`'s own AMRAP history uses. A week with fewer than three
 * logged sets (not trained, discarded, or still pending) contributes no point — deload weeks
 * (`weekNumber > AMRAP_WEEK_COUNT`) are never even considered.
 */
export function buildStrengthPoints(
  rows: readonly AmrapSetRow[],
  cycleWeekAnchor: (cycleNumber: number, weekNumber: number) => number,
): StrengthWeekPoint[] {
  const groups = new Map<string, AmrapSetRow[]>();
  for (const row of rows) {
    if (row.weekNumber > AMRAP_WEEK_COUNT) {
      continue;
    }
    const key = `${row.cycleNumber}:${row.weekNumber}`;
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [row]);
    } else {
      bucket.push(row);
    }
  }

  const points: StrengthWeekPoint[] = [];
  for (const bucket of groups.values()) {
    if (bucket.length < 3) {
      continue;
    }
    const amrapSet = [...bucket].sort((a, b) => a.setNumber - b.setNumber)[bucket.length - 1];
    points.push({
      cycleNumber: amrapSet.cycleNumber,
      weekNumber: amrapSet.weekNumber,
      date: cycleWeekAnchor(amrapSet.cycleNumber, amrapSet.weekNumber),
      estimated1RM: estimate1RM(amrapSet.weight, amrapSet.reps),
    });
  }
  return points.sort(
    (a, b) => a.cycleNumber - b.cycleNumber || a.weekNumber - b.weekNumber,
  );
}

export interface StrengthCycleTM {
  cycleNumber: number;
  trainingMax: number;
}

export interface TmProposalRow {
  cycleNumber: number;
  /** The cycle had reached its last week when this row was stored — the TM-type row (§3.4)
   * `selectStoredProposals` keeps, as opposed to a mid-cycle derived week target. */
  atCycleEnd: boolean;
  currentTarget: number;
}

/**
 * The training max in effect during each cycle of the routine: the TM-type Progression_Proposal
 * row stored at that cycle's own end (`current_target` — the value BEFORE that cycle's review
 * changed it, since `Progression_Proposal` rows are scoped to their own cycle and are never
 * rewritten by a later one), or, for a cycle whose own review has not stored one yet, the live
 * plan value — correct precisely because nothing has overwritten it since (a plan write only
 * happens on that cycle's own apply, `cycleReview.ts`'s `planWrite`).
 */
export function buildTrainingMaxByCycle(
  cycleNumbers: readonly number[],
  proposalRows: readonly TmProposalRow[],
  liveTrainingMax: number,
): StrengthCycleTM[] {
  const stored = new Map(
    proposalRows.filter((row) => row.atCycleEnd).map((row) => [row.cycleNumber, row.currentTarget]),
  );
  return cycleNumbers.map((cycleNumber) => ({
    cycleNumber,
    trainingMax: stored.get(cycleNumber) ?? liveTrainingMax,
  }));
}

export interface StrengthLift {
  sessionExerciseId: number;
  exerciseName: string;
  unit: RoutineUnit;
  /** True for a `training_max_pct` lift — the only load source with a training max to step. */
  hasTrainingMax: boolean;
  /** Ascending by (cycleNumber, weekNumber); deload weeks are never in this list. */
  points: StrengthWeekPoint[];
  /** Ascending by cycleNumber; empty when `hasTrainingMax` is false. */
  trainingMax: StrengthCycleTM[];
}

export interface StrengthAxisPoint {
  cycleNumber: number;
  weekNumber: number;
  date: number;
}

export interface StrengthChartLift {
  exerciseName: string;
  unit: RoutineUnit;
  hasTrainingMax: boolean;
  /** Aligned 1:1 with `StrengthChartData.axis`: a week this lift has no AMRAP point of its own
   * carries the last known value forward (or, before its first point, repeats that first value),
   * so every lift hands the chart a full-length numeric array — `ProgressChart`'s parallel-array
   * contract — without inventing a value the log never produced. */
  estimated1RM: number[];
  /** Same alignment as `estimated1RM`; empty when `hasTrainingMax` is false. */
  trainingMax: number[];
}

export interface StrengthChartData {
  axis: StrengthAxisPoint[];
  /** Only lifts with at least one logged AMRAP point — an untrained lift draws no flat line. */
  lifts: StrengthChartLift[];
}

/**
 * One shared axis for every main lift's chart (P3/U3 — "one point per training week", the cadence
 * `ProgressChart`'s own docstring already anticipates), built from the union of every lift's own
 * (cycle, week) points so a lift trained on a different weekday of the same week still lands on
 * the same x-position as its training partners.
 */
export function buildStrengthChart(lifts: readonly StrengthLift[]): StrengthChartData {
  const charted = lifts.filter((lift) => lift.points.length > 0);

  const axisEntries = new Map<string, StrengthAxisPoint>();
  for (const lift of charted) {
    for (const point of lift.points) {
      const key = `${point.cycleNumber}:${point.weekNumber}`;
      if (!axisEntries.has(key)) {
        axisEntries.set(key, {
          cycleNumber: point.cycleNumber,
          weekNumber: point.weekNumber,
          date: point.date,
        });
      }
    }
  }
  const axis = [...axisEntries.values()].sort((a, b) => a.date - b.date);

  const alignedValues = (byKey: ReadonlyMap<string, number>): number[] => {
    const raw = axis.map((point) => byKey.get(`${point.cycleNumber}:${point.weekNumber}`) ?? null);
    const firstKnown = raw.find((value): value is number => value !== null) ?? 0;
    let last = firstKnown;
    return raw.map((value) => {
      if (value !== null) {
        last = value;
      }
      return last;
    });
  };

  return {
    axis,
    lifts: charted.map((lift) => {
      const e1rmByKey = new Map(
        lift.points.map((point) => [`${point.cycleNumber}:${point.weekNumber}`, point.estimated1RM]),
      );
      const tmByCycle = new Map(lift.trainingMax.map((tm) => [tm.cycleNumber, tm.trainingMax]));
      return {
        exerciseName: lift.exerciseName,
        unit: lift.unit,
        hasTrainingMax: lift.hasTrainingMax,
        estimated1RM: alignedValues(e1rmByKey),
        trainingMax: lift.hasTrainingMax
          ? axis.map((point) => tmByCycle.get(point.cycleNumber) ?? 0)
          : [],
      };
    }),
  };
}

/**
 * `chart` windowed to a range (P3/U3 — the one range control every chart on this tab reads
 * through): the axis and every lift's `estimated1RM`/`trainingMax` are cut to the same kept
 * indices, so `ProgressChart`'s parallel-array contract survives the window.
 */
export function windowStrengthChart(
  chart: StrengthChartData,
  range: ChartRange,
  todayStamp: number,
): StrengthChartData {
  const start = chartRangeStart(range, todayStamp);
  const keep = chart.axis
    .map((point, index) => index)
    .filter((index) => start === null || chart.axis[index].date >= start);
  return {
    axis: keep.map((index) => chart.axis[index]),
    lifts: chart.lifts.map((lift) => ({
      ...lift,
      estimated1RM: keep.map((index) => lift.estimated1RM[index]),
      trainingMax: lift.hasTrainingMax ? keep.map((index) => lift.trainingMax[index]) : [],
    })),
  };
}

/**
 * The routine's main lifts, keyed by exercise name (a lift appearing as `role = 'main'` in more
 * than one session — unusual, but not forbidden — is represented once, by its lowest `sort_order`
 * row: the one `mainLiftColours` also reads).
 */
async function loadMainLiftPlanRows(
  db: RoutineDatabase,
  routineId: number,
): Promise<
  {
    sessionExerciseId: number;
    exerciseName: string;
    sortOrder: number;
    loadSource: RoutineLoadSource;
    trainingMaxWeight: number | null;
    unit: RoutineUnit;
  }[]
> {
  const routineRow = await db.get('SELECT unit FROM Routines WHERE routine_id = ?;', [routineId]);
  const routineUnit: RoutineUnit =
    routineRow === undefined ? 'kg' : (str(routineRow.unit) as RoutineUnit);

  const rows = await db.getAll(
    `SELECT se.session_exercise_id, se.exercise_name, se.sort_order, se.load_source,
            se.training_max_weight, se.unit_override
     FROM SessionExercises se
     JOIN Sessions s ON s.session_id = se.session_id
     WHERE s.routine_id = ? AND se.role = 'main'
     ORDER BY se.sort_order;`,
    [routineId],
  );

  const byName = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const name = str(row.exercise_name);
    if (!byName.has(name)) {
      byName.set(name, row);
    }
  }
  return [...byName.values()].map((row) => ({
    sessionExerciseId: num(row.session_exercise_id),
    exerciseName: str(row.exercise_name),
    sortOrder: num(row.sort_order),
    loadSource: str(row.load_source) as RoutineLoadSource,
    trainingMaxWeight: nullableNum(row.training_max_weight),
    unit: (nullableStr(row.unit_override) as RoutineUnit | null) ?? routineUnit,
  }));
}

/**
 * Every main lift of the routine, its estimated-1RM points and its per-cycle training max
 * (SPEC.md U3). One lift per name; see `loadMainLiftPlanRows`.
 */
export async function loadStrengthSeries(
  db: RoutineDatabase,
  routineId: number,
): Promise<StrengthLift[]> {
  const plan = await loadMainLiftPlanRows(db, routineId);
  if (plan.length === 0) {
    return [];
  }

  const cycleRows = await db.getAll(
    `SELECT cycle_number, started_at FROM Cycles WHERE routine_id = ? ORDER BY cycle_number;`,
    [routineId],
  );
  const cycleNumbers = cycleRows.map((row) => num(row.cycle_number));
  const cycleStartOf = new Map<number, number>();
  for (const row of cycleRows) {
    if (row.started_at !== null && row.started_at !== undefined) {
      cycleStartOf.set(num(row.cycle_number), num(row.started_at));
    }
  }
  const cycleWeekAnchor = (cycleNumber: number, weekNumber: number): number => {
    const startedAt = cycleStartOf.get(cycleNumber) ?? 0;
    return startedAt + (weekNumber - 1) * 7 * DAY_SECONDS;
  };

  const setRows = await db.getAll(
    `SELECT c.cycle_number, cw.week_number, wol.workout_date AS date, le.exercise_name,
            wl.set_number, wl.weight_logged, wl.reps_logged
     FROM Cycles c
     JOIN CycleWeeks cw ON cw.cycle_id = c.cycle_id
     JOIN WeekSessions ws ON ws.cycle_week_id = cw.cycle_week_id
     JOIN Workout_Log wol ON wol.workout_log_id = ws.completed_log_id
     JOIN Logged_Exercises le ON le.workout_log_id = wol.workout_log_id
     JOIN Weight_Log wl ON wl.logged_exercise_id = le.logged_exercise_id
     WHERE c.routine_id = ? AND cw.week_number <= ?
     ORDER BY c.cycle_number, cw.week_number, le.exercise_name, wl.set_number;`,
    [routineId, AMRAP_WEEK_COUNT],
  );

  return Promise.all(
    plan.map(async (lift) => {
      const rows: AmrapSetRow[] = setRows
        .filter((row) => str(row.exercise_name) === lift.exerciseName)
        .map((row) => ({
          cycleNumber: num(row.cycle_number),
          weekNumber: num(row.week_number),
          date: num(row.date),
          setNumber: num(row.set_number),
          weight: num(row.weight_logged),
          reps: num(row.reps_logged),
        }));
      const points = buildStrengthPoints(rows, cycleWeekAnchor);

      const hasTrainingMax = lift.loadSource === 'training_max_pct';
      let trainingMax: StrengthCycleTM[] = [];
      if (hasTrainingMax) {
        const proposalRows: TmProposalRow[] = (
          await db.getAll(
            `SELECT c.cycle_number, c.weeks, c.current_week, p.current_target
             FROM Progression_Proposal p JOIN Cycles c ON c.cycle_id = p.cycle_id
             WHERE p.routine_id = ? AND p.session_exercise_id = ?
             ORDER BY c.cycle_number;`,
            [routineId, lift.sessionExerciseId],
          )
        ).map((row) => ({
          cycleNumber: num(row.cycle_number),
          atCycleEnd: num(row.current_week) >= num(row.weeks),
          currentTarget: num(row.current_target),
        }));
        trainingMax = buildTrainingMaxByCycle(
          cycleNumbers,
          proposalRows,
          lift.trainingMaxWeight ?? 0,
        );
      }

      return {
        sessionExerciseId: lift.sessionExerciseId,
        exerciseName: lift.exerciseName,
        unit: lift.unit,
        hasTrainingMax,
        points,
        trainingMax,
      };
    }),
  );
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
