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
  loadSessionQueueInput,
  type QueueWeekSessionRow,
  type SessionQueueInput,
  type SessionQueueState,
} from './today';
import type { RoutineDatabase } from './routineActions';

export type InicioInput = SessionQueueInput;
export type FirstWeekday = 'Sunday' | 'Monday';
export type InicioDayStatus =
  | 'rest'
  | 'pending'
  | 'completed'
  | 'moved'
  | 'discarded';

export interface InicioDay {
  stamp: number;
  weekday: number;
  status: InicioDayStatus;
  sessionName: string | null;
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

export interface InicioData {
  queue: SessionQueueState;
  week: InicioWeek;
  streak: InicioStreak;
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

const statusForRow = (row: QueueWeekSessionRow | undefined): InicioDayStatus =>
  row?.status ?? 'pending';

const weekSessionRowsByDay = (
  input: InicioInput,
  startStamp: number,
): Map<string, QueueWeekSessionRow> => {
  const rows = new Map<string, QueueWeekSessionRow>();
  for (const row of buildQueueRows(input)) {
    if (row.nominal < startStamp || row.nominal >= startStamp + 7 * DAY_SECONDS) {
      continue;
    }
    rows.set(`${row.session.sessionId}:${row.nominal}`, row.weekSession);
  }
  return rows;
};

export function buildInicioWeek(
  input: InicioInput,
  todayStamp: number,
  firstWeekday: FirstWeekday,
): InicioWeek {
  const startStamp = weekStartStamp(todayStamp, firstWeekday);
  const rowBySessionDay = weekSessionRowsByDay(input, startStamp);
  const sessionByWeekday = new Map(input.sessions.map((session) => [session.weekday, session]));
  const firstDay = firstWeekday === 'Monday' ? 1 : 0;
  const days: InicioDay[] = [];

  for (let index = 0; index < 7; index += 1) {
    const weekday = (firstDay + index) % 7;
    const stamp = startStamp + index * DAY_SECONDS;
    const session = sessionByWeekday.get(weekday);
    const row = session === undefined
      ? undefined
      : rowBySessionDay.get(`${session.sessionId}:${stamp}`);
    days.push({
      stamp,
      weekday,
      status: session === undefined ? 'rest' : statusForRow(row),
      sessionName: session?.name ?? null,
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
