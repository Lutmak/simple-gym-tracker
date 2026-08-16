/**
 * P2 — the calendar of Progreso, and what a day means (SPECS.md P2, §3.1, §3.7).
 *
 * The recorded defect: *"El calendario hasta abajo, se ve feo y descuadrado. Si pico un día solo me
 * sale la fecha y un botón enorme de cancelar. ¿Para qué me sirve?"* The old calendar counted rows
 * in `Workout_Log` and drew a dot per log, so it could say "something happened here" and nothing
 * else — no plan, no move, no discard, and nothing to open.
 *
 * This module answers the two questions a calendar day must answer, and it answers them purely:
 *
 * - **What state is this day in?** `planned · done · moved · discarded · free`. The state comes
 *   from the week session that sits on the day — the same rows the queue (§3.1) resolves — plus the
 *   logs that belong to no week session, which are exactly the free-logging sessions (H6).
 * - **What does tapping it open?** Every marked day carries its own target, so the screen never has
 *   to search for the session again.
 *
 * A session's day is `resolved_on_date` when it has one and its nominal cycle day otherwise, which
 * is the same rule `utils/today.ts` uses to order the queue: a moved session shows on the day it
 * landed on, a discarded one on the day that counts as not done.
 */

import { nominalSessionStamp } from './today';
import {
  buildMonthGrid,
  type CalendarMonth,
  type MonthGridDay,
} from './calendar';
import type { FirstWeekday } from './inicio';
import type { WeekSessionStatus } from './routineProgress';
import type { RoutineDatabase } from './routineActions';

/**
 * The five states a day can be in. `planned` covers a session that has not been
 * resolved — the future days of the plan and any past day still waiting for the
 * user's answer (§3.1).
 */
export type ProgressDayState = 'planned' | 'done' | 'moved' | 'discarded' | 'free';

/** What tapping a marked day opens: one session, or one free-logging session. */
export type ProgressDayTarget =
  | {
      kind: 'session';
      routineId: number;
      cycleId: number;
      cycleNumber: number;
      weekNumber: number;
      sessionId: number;
    }
  | { kind: 'freeLog'; workoutLogId: number; workoutName: string; date: number };

/** One week session of a routine, as the calendar reads it from the database. */
export interface ProgressCalendarSessionRow {
  weekSessionId: number;
  cycleId: number;
  cycleNumber: number;
  /** Null when the cycle never started: such a session has no calendar day. */
  cycleStartedAt: number | null;
  weekNumber: number;
  sessionId: number;
  sessionName: string;
  weekday: number;
  status: WeekSessionStatus;
  resolvedOnDate: number | null;
}

/** A log that belongs to no week session — free logging (H6). */
export interface ProgressCalendarFreeLogRow {
  workoutLogId: number;
  workoutName: string;
  date: number;
}

export interface ProgressCalendarInput {
  routineId: number;
  sessions: readonly ProgressCalendarSessionRow[];
  freeLogs: readonly ProgressCalendarFreeLogRow[];
}

export interface ProgressCalendarDay {
  stamp: number;
  state: ProgressDayState;
  /** The session's name, or the free log's — what the day is, in words. */
  name: string;
  target: ProgressDayTarget;
}

export interface ProgressCalendarCell {
  stamp: number;
  day: number;
  /** Null on a day with nothing on it: a rest day, or a day before the routine began. */
  entry: ProgressCalendarDay | null;
}

export type ProgressCalendarWeek = readonly (ProgressCalendarCell | null)[];

/** The order the legend is read in, strongest state first. */
export const PROGRESS_DAY_STATES: readonly ProgressDayState[] = [
  'done',
  'moved',
  'discarded',
  'planned',
  'free',
];

/**
 * The mark of each state.
 *
 * The palette is monochrome (ENGINEERING.md §3.5), so the five states are told apart by **glyph**
 * first — a tick, an arrow, a cross, a ring, a plus — and never by colour alone. The screen adds
 * weight and a struck-through day number on top of this; the glyph is what survives a greyscale
 * screenshot, a colour-blind reader and a legend read from across the room.
 */
export const PROGRESS_DAY_GLYPHS: Readonly<Record<ProgressDayState, string>> = {
  done: '✓',
  moved: '→',
  discarded: '✕',
  planned: '○',
  free: '+',
};

/** Statuses map one-to-one onto states; free logging has no week session at all. */
export function dayStateOfStatus(status: WeekSessionStatus): ProgressDayState {
  switch (status) {
    case 'completed':
      return 'done';
    case 'moved':
      return 'moved';
    case 'discarded':
      return 'discarded';
    case 'pending':
      return 'planned';
  }
}

/**
 * The day a session sits on: the day it was resolved onto when it has one — a
 * move, a do-it-today, a completion — and its nominal cycle day otherwise.
 * Null when the cycle never started, which is a session with no date yet.
 */
export function sessionCalendarDate(row: ProgressCalendarSessionRow): number | null {
  if (row.resolvedOnDate !== null) {
    return row.resolvedOnDate;
  }
  if (row.cycleStartedAt === null) {
    return null;
  }
  return nominalSessionStamp(row.cycleStartedAt, row.weekNumber, row.weekday);
}

/**
 * Which of two entries on one day is shown. The queue forbids two sessions on
 * one day (§3.1), but a discarded session's nominal day and a later cycle's
 * plan can still meet, and a free log can land on a training day. Resolved
 * states outrank an unresolved plan, and a routine session outranks a free log:
 * the day belongs to the plan when the plan has something to say about it.
 */
const STATE_PRECEDENCE: Readonly<Record<ProgressDayState, number>> = {
  done: 5,
  moved: 4,
  discarded: 3,
  planned: 2,
  free: 1,
};

/** Day stamp → what that day is, for one routine plus every free log. */
export function buildProgressCalendarDays(
  input: ProgressCalendarInput,
): Map<number, ProgressCalendarDay> {
  const days = new Map<number, ProgressCalendarDay>();

  const consider = (candidate: ProgressCalendarDay): void => {
    const current = days.get(candidate.stamp);
    if (
      current === undefined ||
      STATE_PRECEDENCE[candidate.state] > STATE_PRECEDENCE[current.state]
    ) {
      days.set(candidate.stamp, candidate);
    }
  };

  for (const row of input.sessions) {
    const stamp = sessionCalendarDate(row);
    if (stamp === null) {
      continue;
    }
    consider({
      stamp,
      state: dayStateOfStatus(row.status),
      name: row.sessionName,
      target: {
        kind: 'session',
        routineId: input.routineId,
        cycleId: row.cycleId,
        cycleNumber: row.cycleNumber,
        weekNumber: row.weekNumber,
        sessionId: row.sessionId,
      },
    });
  }

  for (const row of input.freeLogs) {
    consider({
      stamp: row.date,
      state: 'free',
      name: row.workoutName,
      target: {
        kind: 'freeLog',
        workoutLogId: row.workoutLogId,
        workoutName: row.workoutName,
        date: row.date,
      },
    });
  }

  return days;
}

/** One month of the calendar, in rows of seven, honouring `firstWeekday`. */
export function buildProgressMonth(
  month: CalendarMonth,
  firstWeekday: FirstWeekday,
  days: ReadonlyMap<number, ProgressCalendarDay>,
): ProgressCalendarWeek[] {
  return buildMonthGrid(month, firstWeekday).map((week) =>
    week.map((cell: MonthGridDay | null) =>
      cell === null
        ? null
        : {
            stamp: cell.stamp,
            day: cell.day,
            entry: days.get(cell.stamp) ?? null,
          },
    ),
  );
}

const num = (value: unknown): number => Number(value);
const str = (value: unknown): string => String(value);
const nullableNum = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

/**
 * Every week session of one routine plus every log that belongs to no week
 * session. The second query is what puts free logging on the calendar: H6 moved
 * free logging out of Progreso as an *action*, and it stays here as *history*.
 */
export async function loadProgressCalendar(
  db: RoutineDatabase,
  routineId: number,
): Promise<ProgressCalendarInput> {
  const sessionRows = await db.getAll(
    `SELECT ws.week_session_id, c.cycle_id, c.cycle_number, c.started_at,
            cw.week_number, ws.session_id, s.name AS session_name, s.weekday,
            ws.status, ws.resolved_on_date
     FROM WeekSessions ws
     JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
     JOIN Cycles c ON c.cycle_id = cw.cycle_id
     JOIN Sessions s ON s.session_id = ws.session_id
     WHERE c.routine_id = ?
     ORDER BY c.cycle_number, cw.week_number, s.sort_order;`,
    [routineId],
  );

  const freeLogRows = await db.getAll(
    `SELECT workout_log_id, workout_name, workout_date AS date
     FROM Workout_Log
     WHERE workout_log_id NOT IN (
       SELECT completed_log_id FROM WeekSessions WHERE completed_log_id IS NOT NULL
     )
     ORDER BY workout_date;`,
    [],
  );

  return {
    routineId,
    sessions: sessionRows.map((row) => ({
      weekSessionId: num(row.week_session_id),
      cycleId: num(row.cycle_id),
      cycleNumber: num(row.cycle_number),
      cycleStartedAt: nullableNum(row.started_at),
      weekNumber: num(row.week_number),
      sessionId: num(row.session_id),
      sessionName: str(row.session_name),
      weekday: num(row.weekday),
      status: str(row.status) as WeekSessionStatus,
      resolvedOnDate: nullableNum(row.resolved_on_date),
    })),
    freeLogs: freeLogRows.map((row) => ({
      workoutLogId: num(row.workout_log_id),
      workoutName: str(row.workout_name),
      date: num(row.date),
    })),
  };
}
