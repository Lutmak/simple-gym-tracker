/**
 * H1 — the Inicio answer, current week and adherence streak.
 *
 * The queue remains the source of truth for the answer. This module only adds
 * the calendar-shaped read model that Inicio needs, keeping date grouping and
 * adherence rules outside the screen.
 */

import {
  buildQueueRows,
  computeSessionQueue,
  DAY_SECONDS,
  dayStampOfStamp,
  effectiveDay,
  loadSessionQueueInput,
  nextPlanSession,
  type QueueRow,
  type QueueWeekSessionRow,
  type SessionQueueInput,
  type SessionQueueState,
  type UpcomingSession,
} from './today';
import { mainLiftColours, type LiftColourCandidate } from './liftColours';
import type { RoutineDatabase } from './routineActions';

export type InicioInput = SessionQueueInput;
export type FirstWeekday = 'Sunday' | 'Monday';
export type InicioDayStatus =
  | 'rest'
  | 'pending'
  | 'completed'
  | 'moved'
  | 'discarded';

/**
 * Enough to open `SessionDetailSheet`'s `'session'` target (`components/SessionDetailSheet.tsx`)
 * for a resolved day of the week strip — null for `pending`/`rest`, which are not pressable
 * (SPEC.md U2: "the cell simply is not pressable").
 */
export interface InicioSessionTarget {
  routineId: number;
  cycleId: number;
  cycleNumber: number;
  weekNumber: number;
  sessionId: number;
}

export interface InicioDay {
  stamp: number;
  weekday: number;
  status: InicioDayStatus;
  sessionName: string | null;
  /** Non-null exactly for `completed`/`moved`/`discarded` — the tappable statuses. */
  target: InicioSessionTarget | null;
}

export interface InicioWeek {
  startStamp: number;
  days: InicioDay[];
  planned: number;
  completed: number;
  moved: number;
  discarded: number;
  pending: number;
}

export interface InicioStreak {
  weeks: number;
  current: {
    planned: number;
    completed: number;
  };
}

export interface SessionDurationRow {
  startedAt: number | null;
  completedAt: number | null;
}

export interface InicioDateParts {
  weekday: number;
  day: number;
  month: number;
  year: number;
}

/** The two Stat tiles beside the streak that need more than the queue's own read model. */
export interface InicioCycleStats {
  /**
   * `null` when there is no active cycle to measure yet (no routine, or between cycles) — the
   * screen shows an em dash rather than a misleading 0/100%.
   */
  adherencePercent: number | null;
  cyclesCompleted: number;
}

export interface InicioData {
  queue: SessionQueueState;
  week: InicioWeek;
  streak: InicioStreak;
  cycleStats: InicioCycleStats;
  /**
   * The next two sessions after the queue's own head, for the "PRÓXIMAS" list (§U2) — distinct
   * from `queue.upcoming`, which is only the single next one the resolution flow itself needs.
   */
  upcomingSessions: UpcomingSession[];
  /** A routine's main lifts, coloured once and reused by every row that names one (ADR-0047). */
  mainLiftColours: ReadonlyMap<string, number>;
  durationMinutes: number | null;
}

export function datePartsOfStamp(stamp: number): InicioDateParts {
  const date = new Date(stamp * 1000);
  return {
    weekday: date.getUTCDay(),
    day: date.getUTCDate(),
    month: date.getUTCMonth(),
    year: date.getUTCFullYear(),
  };
}

export function weekStartStamp(todayStamp: number, firstWeekday: FirstWeekday): number {
  const firstDay = firstWeekday === 'Monday' ? 1 : 0;
  const daysSinceStart = (new Date(todayStamp * 1000).getUTCDay() - firstDay + 7) % 7;
  return todayStamp - daysSinceStart * DAY_SECONDS;
}

/** The tappable statuses (SPEC.md U2) — everything a resolved day's cell can carry. */
const TAPPABLE_STATUSES: ReadonlySet<InicioDayStatus> = new Set([
  'completed',
  'moved',
  'discarded',
]);

/**
 * Every row this calendar week actually holds, keyed by the day it sits on
 * (`effectiveDay` — the day it was resolved onto, its nominal day otherwise):
 * the same rule `utils/progressCalendar.ts` places a session by, so a moved
 * or pulled-forward row lands in the same cell everywhere it is drawn,
 * regardless of which week its nominal date falls in. The one-session-per-day
 * invariant (ADR-0033) means at most one row ever lands on a given day.
 */
const weekQueueRowsByDay = (input: InicioInput, startStamp: number): Map<number, QueueRow> => {
  const rows = new Map<number, QueueRow>();
  for (const row of buildQueueRows(input)) {
    const day = effectiveDay(row);
    if (day < startStamp || day >= startStamp + 7 * DAY_SECONDS) {
      continue;
    }
    rows.set(day, row);
  }
  return rows;
};

export function buildInicioWeek(
  input: InicioInput,
  todayStamp: number,
  firstWeekday: FirstWeekday,
): InicioWeek {
  const startStamp = weekStartStamp(todayStamp, firstWeekday);
  const rowByDay = weekQueueRowsByDay(input, startStamp);
  const firstDay = firstWeekday === 'Monday' ? 1 : 0;
  const days: InicioDay[] = [];

  for (let index = 0; index < 7; index += 1) {
    const weekday = (firstDay + index) % 7;
    const stamp = startStamp + index * DAY_SECONDS;
    const row = rowByDay.get(stamp);
    // A day this week does not hold a row draws as `rest` (SPEC.md Z2): a ring
    // for a training weekday with nothing behind it would disagree with the
    // "N of M" count below, which only ever counts what the week holds.
    const status: InicioDayStatus = row?.weekSession.status ?? 'rest';
    const target: InicioSessionTarget | null =
      input.routine === null || row === undefined || !TAPPABLE_STATUSES.has(status)
        ? null
        : {
            routineId: input.routine.routineId,
            cycleId: row.cycle.cycleId,
            cycleNumber: row.cycle.cycleNumber,
            weekNumber: row.weekSession.weekNumber,
            sessionId: row.session.sessionId,
          };
    days.push({
      stamp,
      weekday,
      status,
      sessionName: row?.session.name ?? null,
      target,
    });
  }

  const plannedDays = days.filter((day) => day.status !== 'rest');
  return {
    startStamp,
    days,
    planned: plannedDays.length,
    completed: plannedDays.filter((day) => day.status === 'completed' || day.status === 'moved').length,
    moved: plannedDays.filter((day) => day.status === 'moved').length,
    discarded: plannedDays.filter((day) => day.status === 'discarded').length,
    pending: plannedDays.filter((day) => day.status === 'pending').length,
  };
}

interface StreakWeek {
  startStamp: number;
  planned: number;
  completed: number;
  complete: boolean;
}

const weekRowsFor = (
  input: InicioInput,
  cycleId: number,
  weekNumber: number,
): Map<number, QueueWeekSessionRow> => {
  const rows = new Map<number, QueueWeekSessionRow>();
  for (const row of input.weekSessions) {
    if (row.cycleId === cycleId && row.weekNumber === weekNumber) {
      rows.set(row.sessionId, row);
    }
  }
  return rows;
};

const buildStreakWeeks = (input: InicioInput): StreakWeek[] => {
  if (input.routine === null || input.sessions.length === 0) {
    return [];
  }

  const weeks: StreakWeek[] = [];
  for (const cycle of input.cycles) {
    if (cycle.startedAt === null) {
      continue;
    }
    const weekCount = Math.max(
      0,
      ...input.weekSessions
        .filter((row) => row.cycleId === cycle.cycleId)
        .map((row) => row.weekNumber),
    );
    for (let weekNumber = 1; weekNumber <= weekCount; weekNumber += 1) {
      const rowBySession = weekRowsFor(input, cycle.cycleId, weekNumber);
      const completed = input.sessions.filter((session) => {
        const row = rowBySession.get(session.sessionId);
        return row?.status === 'completed' || row?.status === 'moved';
      }).length;
      const startStamp = dayStampOfStamp(cycle.startedAt) + (weekNumber - 1) * 7 * DAY_SECONDS;
      weeks.push({
        startStamp,
        planned: input.sessions.length,
        completed,
        complete: completed === input.sessions.length,
      });
    }
  }
  return weeks.sort((a, b) => a.startStamp - b.startStamp);
};

export function computeInicioStreak(
  input: InicioInput,
  todayStamp: number,
  firstWeekday: FirstWeekday,
): InicioStreak {
  const currentWeek = buildInicioWeek(input, todayStamp, firstWeekday);
  const currentWeekStart = currentWeek.startStamp;
  const currentWeekEnd = currentWeek.startStamp + 6 * DAY_SECONDS;
  const historicalWeeks = buildStreakWeeks(input).filter(
    (week) => week.startStamp <= currentWeekEnd,
  );

  const currentCycleWeek = [...historicalWeeks]
    .reverse()
    .find(
      (week) =>
        week.startStamp <= currentWeekEnd &&
        week.startStamp + 6 * DAY_SECONDS >= currentWeekStart,
    );
  let currentEntry: StreakWeek | undefined = currentCycleWeek;
  if (currentCycleWeek === undefined && currentWeek.planned > 0) {
    // No cycle row covers this week — between cycles, or before the first one
    // is materialised. The week is still in progress either way, so it takes
    // the same treatment as a cycle's own current week below.
    currentEntry = {
      startStamp: currentWeekStart,
      planned: currentWeek.planned,
      completed: currentWeek.completed,
      complete: currentWeek.completed === currentWeek.planned,
    };
    historicalWeeks.push(currentEntry);
  }

  let weeks = 0;
  for (let index = historicalWeeks.length - 1; index >= 0; index -= 1) {
    // A week still being trained never breaks the streak: only a finished week
    // whose plan went unmet does (§3.7).
    if (historicalWeeks[index] === currentEntry && currentEntry?.complete === false) {
      continue;
    }
    if (!historicalWeeks[index].complete) {
      break;
    }
    weeks += 1;
  }

  return {
    weeks,
    current: {
      planned: currentWeek.planned,
      completed: currentWeek.completed,
    },
  };
}

export function averageSessionDurationMinutes(
  rows: readonly SessionDurationRow[],
): number | null {
  const durations = rows
    .filter(
      (row): row is { startedAt: number; completedAt: number } =>
        row.startedAt !== null &&
        row.completedAt !== null &&
        row.completedAt > row.startedAt,
    )
    .map((row) => row.completedAt - row.startedAt);
  if (durations.length === 0) {
    return null;
  }
  return Math.max(
    1,
    Math.round(
      durations.reduce((sum, duration) => sum + duration, 0) /
        durations.length /
        (60 * 1000),
    ),
  );
}

/**
 * "Adherence this cycle" (SPEC.md U2's Stat tile) and cycles completed. Read from
 * `current_week`/`weeks` rather than from dates: a week counts once its cycle has reached it,
 * regardless of whether every day inside it has actually happened yet, so the number never needs
 * `todayStamp` and never depends on how the calendar carves up a week — the same rule the streak
 * (ADR-0041) already applies to "is this week done", just at cycle scope instead of a rolling one.
 */
export function computeInicioCycleStats(input: InicioInput): InicioCycleStats {
  const cyclesCompleted = input.cycles.filter((cycle) => cycle.status === 'complete').length;
  const activeCycle = [...input.cycles]
    .filter((cycle) => cycle.status === 'active')
    .sort((a, b) => b.cycleNumber - a.cycleNumber)[0];
  if (activeCycle === undefined) {
    return { adherencePercent: null, cyclesCompleted };
  }

  const rowsSoFar = input.weekSessions.filter(
    (row) => row.cycleId === activeCycle.cycleId && row.weekNumber <= activeCycle.currentWeek,
  );
  if (rowsSoFar.length === 0) {
    return { adherencePercent: null, cyclesCompleted };
  }

  const adherent = rowsSoFar.filter(
    (row) => row.status === 'completed' || row.status === 'moved',
  ).length;
  return {
    adherencePercent: Math.round((adherent / rowsSoFar.length) * 100),
    cyclesCompleted,
  };
}

/**
 * The routine's main lifts, coloured once (`utils/liftColours.ts`). Built from the same
 * `sessions`/`exercises` rows the queue already loaded — no second query. `mainLiftColours`
 * trusts the order it is given rather than re-deriving "the routine's order" itself, so this
 * sorts by session order then in-session order before handing the rows over.
 */
export function computeMainLiftColours(input: InicioInput): ReadonlyMap<string, number> {
  const sessionOrder = new Map(input.sessions.map((session) => [session.sessionId, session.sortOrder]));
  const rows: LiftColourCandidate[] = [...input.exercises]
    .sort(
      (a, b) =>
        (sessionOrder.get(a.sessionId) ?? 0) - (sessionOrder.get(b.sessionId) ?? 0) ||
        a.sortOrder - b.sortOrder,
    )
    .map((exercise) => ({
      name: exercise.name,
      role: exercise.role,
    }));
  return mainLiftColours(rows);
}

/**
 * The next two sessions after the queue's own head (SPEC.md U2's "PRÓXIMAS" list) — on a rest day
 * this is what fills the screen instead of nothing. Reads the same seeded week-session rows the
 * queue does, in queue order, then chains `nextPlanSession` past the end of the active cycle for
 * whatever a not-yet-seeded next cycle cannot supply (§3.4: the next cycle only exists once the
 * pending review is answered).
 */
export function buildInicioUpcoming(
  input: InicioInput,
  todayStamp: number,
  count: number,
): UpcomingSession[] {
  if (input.routine === null) {
    return [];
  }

  const headId = computeSessionQueue(input, todayStamp).head?.weekSessionId ?? null;
  const pendingRows = buildQueueRows(input)
    .filter((row) => row.weekSession.status === 'pending')
    .filter((row) => row.weekSession.weekSessionId !== headId)
    .sort(
      (a, b) => a.nominal - b.nominal || a.weekSession.weekSessionId - b.weekSession.weekSessionId,
    );

  const result: UpcomingSession[] = pendingRows.slice(0, count).map((row) => ({
    weekSessionId: row.weekSession.weekSessionId,
    sessionId: row.session.sessionId,
    name: row.session.name,
    weekday: row.session.weekday,
    date: row.weekSession.resolvedOnDate ?? row.nominal,
  }));

  let cursor = result.length > 0 ? result[result.length - 1].date : todayStamp;
  while (result.length < count) {
    const next = nextPlanSession(input.sessions, cursor);
    if (next === null) {
      break;
    }
    result.push(next);
    cursor = next.date;
  }
  return result;
}

/** The hero's exercise list stops here; the rest becomes "+N ejercicios más" (SPEC.md U2). */
export const INICIO_HERO_EXERCISE_LIMIT = 3;

export interface TruncatedExercises<T> {
  shown: T[];
  remaining: number;
}

export function truncateHeroExercises<T>(
  exercises: readonly T[],
  limit: number = INICIO_HERO_EXERCISE_LIMIT,
): TruncatedExercises<T> {
  return {
    shown: exercises.slice(0, limit),
    remaining: Math.max(0, exercises.length - limit),
  };
}

export function computeInicioData(
  input: InicioInput,
  todayStamp: number,
  firstWeekday: FirstWeekday,
  durationRows: readonly SessionDurationRow[] = [],
): InicioData {
  const queue = computeSessionQueue(input, todayStamp);
  return {
    queue,
    week: buildInicioWeek(input, todayStamp, firstWeekday),
    streak: computeInicioStreak(input, todayStamp, firstWeekday),
    cycleStats: computeInicioCycleStats(input),
    upcomingSessions: buildInicioUpcoming(input, todayStamp, 2),
    mainLiftColours: computeMainLiftColours(input),
    durationMinutes:
      queue.resolution === 'due' && queue.head !== null
        ? averageSessionDurationMinutes(durationRows)
        : null,
  };
}

export async function loadInicioData(
  db: RoutineDatabase,
  todayStamp: number,
  firstWeekday: FirstWeekday,
): Promise<InicioData> {
  const input = await loadSessionQueueInput(db);
  const queue = computeSessionQueue(input, todayStamp);
  const durationRows =
    queue.resolution === 'due' && queue.head !== null
      ? await db.getAll(
          `SELECT MIN(wl.started_at) AS started_at, MAX(wl.completed_at) AS completed_at
           FROM WeekSessions ws
           JOIN Workout_Log wol ON wol.workout_log_id = ws.completed_log_id
           JOIN Weight_Log wl ON wl.workout_log_id = wol.workout_log_id
           WHERE ws.session_id = ? AND ws.status IN ('completed', 'moved')
           GROUP BY ws.completed_log_id;`,
          [queue.head.sessionId],
        )
      : [];

  return computeInicioData(input, todayStamp, firstWeekday, durationRows.map((row) => ({
    startedAt: row.started_at === null || row.started_at === undefined ? null : Number(row.started_at),
    completedAt:
      row.completed_at === null || row.completed_at === undefined ? null : Number(row.completed_at),
  })));
}
