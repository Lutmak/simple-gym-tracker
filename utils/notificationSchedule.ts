/**
 * S3 — the reminder schedule, derived from the active routine (§3.8).
 *
 * "When does this app notify me" is one pure function of four things: whether
 * reminders are on, the default time, the per-day times the user chose, and the
 * training days the **active routine** plans. Nothing here imports
 * `expo-notifications`; `notificationUtils.applyTrainingDayReminders` is the
 * only place a schedule reaches the OS, and it takes what this module returns.
 * The reminders are local (`WEEKLY` triggers) — remote push does not exist in
 * this app and does not work in Expo Go at all.
 *
 * Three decisions are recorded here because they are the substance of S3:
 *
 * 1. **A per-day time is keyed on the weekday, not on the session.** "I train
 *    Monday mornings" is a fact about the user's week; a `session_id` is a fact
 *    about one routine's rows, and it does not survive editing that routine or
 *    activating another. Keying on the weekday means changing routine keeps a
 *    07:00 Monday and relabels it with the new session's name, and a weekday the
 *    new routine does not train drops out — `pruneDayTimes`, which is what
 *    "changing routine updates the list" means in storage.
 * 2. **No active routine means no reminders.** The schedule has exactly one
 *    owner (§3.8), and an alarm telling you to train when nothing is planned is
 *    the friction §7.5 exists to remove. The screen says so in words rather than
 *    keeping a blank daily alarm alive. This replaces the single global daily
 *    reminder that shipped before S3 — there is no second scheduling path left.
 * 3. **A day whose time equals the default carries no override.** `setDayTime`
 *    deletes rather than stores it, so a user who moves the default time later
 *    moves every day that never disagreed with it. It also means the stored map
 *    only ever holds real decisions.
 */

import { getActiveRoutine, type RoutineDatabase } from './routineActions';

export const DEFAULT_NOTIFICATION_TIME = '08:00';

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** `Sessions.weekday` runs 0 = Sunday … 6 = Saturday. */
const WEEKDAY_COUNT = 7;

export interface TimeOfDay {
  hour: number;
  minute: number;
}

/** `HH:MM` in, hour and minute out. Anything else is `null`, never a guess. */
export function parseTimeOfDay(value: unknown): TimeOfDay | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = TIME_OF_DAY.exec(value);
  if (match === null) {
    return null;
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export const isTimeOfDay = (value: unknown): value is string =>
  parseTimeOfDay(value) !== null;

/** A stored time, or the default when the store holds something unusable. */
export function resolveNotificationTime(stored: unknown): string {
  return isTimeOfDay(stored) ? stored : DEFAULT_NOTIFICATION_TIME;
}

const isWeekday = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value < WEEKDAY_COUNT;

/** One day the active routine trains on, named as the routine names it. */
export interface TrainingDay {
  /** 0 = Sunday … 6 = Saturday, the `Sessions.weekday` convention. */
  weekday: number;
  sessionName: string;
}

/** Weekday (as a string key, because it is persisted as JSON) → `HH:MM`. */
export type DayTimes = Readonly<Record<string, string>>;

export const EMPTY_DAY_TIMES: DayTimes = {};

/**
 * Sanitises a loaded map: only integer weekdays 0–6 with a real time survive.
 * A settings file edited by hand, or written by an older build, can hold
 * anything; the schedule must not be able to inherit a broken alarm from it.
 */
export function resolveDayTimes(stored: unknown): DayTimes {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return EMPTY_DAY_TIMES;
  }
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    const weekday = Number(key);
    if (isWeekday(weekday) && isTimeOfDay(value)) {
      clean[String(weekday)] = value;
    }
  }
  return clean;
}

/**
 * Gives one day its own time. A time equal to the default, or one that is not a
 * time at all, removes the override instead of storing it — and the map is
 * returned unchanged (same identity) when nothing actually differs, so a caller
 * can skip a pointless write.
 */
export function setDayTime(
  dayTimes: DayTimes,
  weekday: number,
  time: string,
  defaultTime: string,
): DayTimes {
  if (!isWeekday(weekday)) {
    return dayTimes;
  }
  const key = String(weekday);
  const clears = !isTimeOfDay(time) || time === resolveNotificationTime(defaultTime);

  if (clears) {
    if (!(key in dayTimes)) {
      return dayTimes;
    }
    return Object.fromEntries(
      Object.entries(dayTimes).filter(([stored]) => stored !== key),
    );
  }

  if (dayTimes[key] === time) {
    return dayTimes;
  }
  return { ...dayTimes, [key]: time };
}

/**
 * Drops the times of weekdays the routine no longer trains on. Called whenever
 * the training days are (re)loaded: activating another routine, or editing this
 * one's days, must not leave an alarm behind on a day nobody trains.
 * Returns the same map when there is nothing to drop.
 */
export function pruneDayTimes(
  dayTimes: DayTimes,
  trainingDays: readonly TrainingDay[],
): DayTimes {
  const trained = new Set(trainingDays.map((day) => String(day.weekday)));
  const kept = Object.entries(dayTimes).filter(([key]) => trained.has(key));
  if (kept.length === Object.keys(dayTimes).length) {
    return dayTimes;
  }
  return Object.fromEntries(kept);
}

export interface NotificationScheduleInput {
  /** The global toggle: off means no reminder exists, whatever else is set. */
  enabled: boolean;
  defaultTime: string;
  dayTimes: DayTimes;
  trainingDays: readonly TrainingDay[];
  /** 0 = weeks start on Sunday, 1 = on Monday — the `firstWeekday` setting. */
  weekStartsOn: number;
}

export interface TrainingDayReminder {
  weekday: number;
  sessionName: string;
  /** `HH:MM`, this day's own time or the global default. */
  time: string;
  hour: number;
  minute: number;
  /** True when this day disagrees with the default and says so on screen. */
  custom: boolean;
}

export interface NotificationSchedule {
  /** Every training day, in the user's week order — the list the screen shows. */
  days: readonly TrainingDayReminder[];
  /** What the OS is asked to fire. Empty whenever reminders are off. */
  reminders: readonly TrainingDayReminder[];
}

/**
 * The whole schedule. `days` is what Ajustes lists; `reminders` is what is
 * actually scheduled, and it is empty when the toggle is off or when there is
 * no routine to remind anyone about.
 */
export function notificationSchedule(
  input: NotificationScheduleInput,
): NotificationSchedule {
  const defaultTime = resolveNotificationTime(input.defaultTime);
  const weekStartsOn = isWeekday(input.weekStartsOn) ? input.weekStartsOn : 1;

  const days = input.trainingDays
    .filter((day) => isWeekday(day.weekday))
    .map<TrainingDayReminder>((day) => {
      const override = input.dayTimes[String(day.weekday)];
      const custom = isTimeOfDay(override) && override !== defaultTime;
      const time = custom ? override : defaultTime;
      const parsed = parseTimeOfDay(time) ?? { hour: 0, minute: 0 };
      return {
        weekday: day.weekday,
        sessionName: day.sessionName,
        time,
        hour: parsed.hour,
        minute: parsed.minute,
        custom,
      };
    })
    .sort(
      (left, right) =>
        ((left.weekday - weekStartsOn + WEEKDAY_COUNT) % WEEKDAY_COUNT) -
        ((right.weekday - weekStartsOn + WEEKDAY_COUNT) % WEEKDAY_COUNT),
    );

  return { days, reminders: input.enabled ? days : [] };
}

/**
 * `expo-notifications` counts weekdays from 1 = Sunday; the schema counts from
 * 0 = Sunday. The conversion lives here, next to the convention it translates,
 * so no screen and no scheduler has to remember it.
 */
export function expoWeekday(weekday: number): number {
  return weekday + 1;
}

/**
 * Weekday name keys in the schema's own order (0 = Sunday), so a screen indexes
 * this array with a `Sessions.weekday` and never re-derives the convention.
 */
export const WEEKDAY_LABEL_KEYS: readonly string[] = [
  'weekdayFullSun',
  'weekdayFullMon',
  'weekdayFullTue',
  'weekdayFullWed',
  'weekdayFullThu',
  'weekdayFullFri',
  'weekdayFullSat',
];

export interface ActiveRoutineDays {
  routineName: string;
  days: TrainingDay[];
}

/**
 * The active routine's training days. `null` — not an empty list — when no
 * routine is active, because "nothing is active" and "this routine trains on no
 * days" are different sentences and Ajustes says a different thing for each.
 */
export async function loadActiveRoutineTrainingDays(
  db: RoutineDatabase,
): Promise<ActiveRoutineDays | null> {
  const routine = await getActiveRoutine(db);
  if (routine === null) {
    return null;
  }
  const rows = await db.getAll(
    'SELECT weekday, name FROM Sessions WHERE routine_id = ? ORDER BY sort_order;',
    [routine.routineId],
  );
  return {
    routineName: routine.name,
    days: rows.map((row) => ({
      weekday: Number(row.weekday),
      sessionName: String(row.name),
    })),
  };
}
