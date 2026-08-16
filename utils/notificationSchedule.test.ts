import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import type { RoutineDatabase } from './routineActions';
import {
  DEFAULT_NOTIFICATION_TIME,
  EMPTY_DAY_TIMES,
  expoWeekday,
  isTimeOfDay,
  loadActiveRoutineTrainingDays,
  notificationSchedule,
  parseTimeOfDay,
  pruneDayTimes,
  resolveDayTimes,
  resolveNotificationTime,
  setDayTime,
  type DayTimes,
  type TrainingDay,
} from './notificationSchedule';

const MONDAY = 1;
const WEDNESDAY = 3;
const FRIDAY = 5;

const days = (...entries: [number, string][]): TrainingDay[] =>
  entries.map(([weekday, sessionName]) => ({ weekday, sessionName }));

const THREE_DAY_ROUTINE = days(
  [MONDAY, 'Squat Day'],
  [WEDNESDAY, 'Press Day'],
  [FRIDAY, 'Deadlift Day'],
);

const schedule = (overrides: Partial<Parameters<typeof notificationSchedule>[0]> = {}) =>
  notificationSchedule({
    enabled: true,
    defaultTime: '08:00',
    dayTimes: EMPTY_DAY_TIMES,
    trainingDays: THREE_DAY_ROUTINE,
    weekStartsOn: 1,
    ...overrides,
  });

describe('parsing a time of day', () => {
  it('reads a valid 24-hour time', () => {
    expect(parseTimeOfDay('07:05')).toEqual({ hour: 7, minute: 5 });
    expect(parseTimeOfDay('23:59')).toEqual({ hour: 23, minute: 59 });
    expect(parseTimeOfDay('00:00')).toEqual({ hour: 0, minute: 0 });
  });

  it('refuses anything that is not one, rather than guessing', () => {
    for (const value of ['24:00', '7:05', '07:60', '0705', '', 'noon', null, 705]) {
      expect(parseTimeOfDay(value)).toBeNull();
      expect(isTimeOfDay(value)).toBe(false);
    }
  });

  it('falls back to the default time for an unusable stored value', () => {
    expect(resolveNotificationTime('06:30')).toBe('06:30');
    expect(resolveNotificationTime('25:00')).toBe(DEFAULT_NOTIFICATION_TIME);
    expect(resolveNotificationTime(undefined)).toBe(DEFAULT_NOTIFICATION_TIME);
  });
});

describe('resolveDayTimes — a stored map is never trusted', () => {
  it('keeps only weekdays 0–6 carrying a real time', () => {
    expect(
      resolveDayTimes({
        '1': '07:00',
        '6': '10:30',
        '7': '07:00',
        '-1': '07:00',
        '1.5': '07:00',
        '3': 'whenever',
        '4': 42,
      }),
    ).toEqual({ '1': '07:00', '6': '10:30' });
  });

  it('treats a missing, null or non-object store as no overrides', () => {
    expect(resolveDayTimes(undefined)).toEqual({});
    expect(resolveDayTimes(null)).toEqual({});
    expect(resolveDayTimes(['07:00'])).toEqual({});
    expect(resolveDayTimes('07:00')).toEqual({});
  });
});

describe('setDayTime', () => {
  it('gives one day its own time and leaves the others alone', () => {
    const next = setDayTime({ '3': '19:00' }, MONDAY, '06:15', '08:00');
    expect(next).toEqual({ '3': '19:00', '1': '06:15' });
  });

  it('stores no override for a time equal to the default', () => {
    expect(setDayTime({ '1': '06:15' }, MONDAY, '08:00', '08:00')).toEqual({});
  });

  it('returns the same map when nothing changes, so no write is needed', () => {
    const current: DayTimes = { '1': '06:15' };
    expect(setDayTime(current, MONDAY, '06:15', '08:00')).toBe(current);
    expect(setDayTime(current, WEDNESDAY, '08:00', '08:00')).toBe(current);
  });

  it('ignores an unusable time and an impossible weekday', () => {
    const current: DayTimes = { '1': '06:15' };
    expect(setDayTime(current, MONDAY, '25:00', '08:00')).toEqual({});
    expect(setDayTime(current, 9, '07:00', '08:00')).toBe(current);
  });
});

describe('pruneDayTimes — the routine changed its days', () => {
  it('drops the times of days the routine no longer trains', () => {
    const current: DayTimes = { '1': '06:15', '3': '19:00', '5': '07:30' };
    expect(pruneDayTimes(current, days([MONDAY, 'Squat Day']))).toEqual({
      '1': '06:15',
    });
  });

  it('drops every time when no routine is active', () => {
    expect(pruneDayTimes({ '1': '06:15' }, [])).toEqual({});
  });

  it('returns the same map when every day survives', () => {
    const current: DayTimes = { '1': '06:15' };
    expect(pruneDayTimes(current, THREE_DAY_ROUTINE)).toBe(current);
  });
});

describe('notificationSchedule', () => {
  it('lists every training day at the default time', () => {
    const { days: listed, reminders } = schedule();

    expect(listed.map((day) => [day.sessionName, day.time, day.custom])).toEqual([
      ['Squat Day', '08:00', false],
      ['Press Day', '08:00', false],
      ['Deadlift Day', '08:00', false],
    ]);
    expect(reminders).toEqual(listed);
  });

  it('gives a day its own time and marks it as differing from the default', () => {
    const { days: listed } = schedule({ dayTimes: { '3': '19:30' } });

    expect(listed[1]).toMatchObject({
      sessionName: 'Press Day',
      time: '19:30',
      hour: 19,
      minute: 30,
      custom: true,
    });
    expect(listed[0].custom).toBe(false);
  });

  it('does not mark a day whose own time happens to equal the default', () => {
    const { days: listed } = schedule({ dayTimes: { '1': '08:00' } });
    expect(listed[0].custom).toBe(false);
  });

  it('orders the days from the first weekday the user chose', () => {
    const sunday = days([0, 'Sunday Session'], [MONDAY, 'Squat Day']);

    expect(
      notificationSchedule({
        enabled: true,
        defaultTime: '08:00',
        dayTimes: EMPTY_DAY_TIMES,
        trainingDays: sunday,
        weekStartsOn: 1,
      }).days.map((day) => day.weekday),
    ).toEqual([MONDAY, 0]);

    expect(
      notificationSchedule({
        enabled: true,
        defaultTime: '08:00',
        dayTimes: EMPTY_DAY_TIMES,
        trainingDays: sunday,
        weekStartsOn: 0,
      }).days.map((day) => day.weekday),
    ).toEqual([0, MONDAY]);
  });

  it('schedules nothing when reminders are off, but still lists the days', () => {
    const { days: listed, reminders } = schedule({ enabled: false });

    expect(listed).toHaveLength(3);
    expect(reminders).toEqual([]);
  });

  it('schedules nothing when no routine is active', () => {
    const { days: listed, reminders } = schedule({ trainingDays: [] });

    expect(listed).toEqual([]);
    expect(reminders).toEqual([]);
  });

  it('falls back to the default time when the stored default is unusable', () => {
    const { days: listed } = schedule({ defaultTime: 'half seven' });
    expect(listed.every((day) => day.time === DEFAULT_NOTIFICATION_TIME)).toBe(true);
  });

  it('ignores a training day whose weekday is out of range', () => {
    const { days: listed } = schedule({
      trainingDays: days([MONDAY, 'Squat Day'], [9, 'Nowhere Day']),
    });
    expect(listed.map((day) => day.sessionName)).toEqual(['Squat Day']);
  });

  it('translates a weekday to the notification API convention', () => {
    expect(expoWeekday(0)).toBe(1);
    expect(expoWeekday(6)).toBe(7);
  });
});

const connect = (): { db: DatabaseSync; executor: SchemaExecutor & RoutineDatabase } => {
  const db = new DatabaseSync(':memory:');
  const executor: SchemaExecutor & RoutineDatabase = {
    exec: (sql: string) => db.exec(sql),
    run: (sql: string, params?: readonly unknown[]) => {
      db.prepare(sql).run(...((params ?? []) as SQLInputValue[]));
    },
    getAll: <T = Record<string, unknown>>(
      sql: string,
      params: readonly unknown[] = [],
    ) => Promise.resolve(db.prepare(sql).all(...(params as SQLInputValue[])) as T[]),
    get: <T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []) =>
      Promise.resolve(
        db.prepare(sql).get(...(params as SQLInputValue[])) as T | undefined,
      ),
  };
  return { db, executor };
};

const insertRoutine = (
  db: DatabaseSync,
  name: string,
  isActive: boolean,
  sessions: [number, string][],
): void => {
  db.prepare(
    `INSERT INTO Routines
     (name, origin, progression_rule, unit, rounding_increment,
      rest_main_seconds, rest_accessory_seconds, is_active, created_at)
     VALUES (?, 'user', 'linear', 'kg', 2.5, 180, 90, ?, 0);`,
  ).run(name, isActive ? 1 : 0);
  const routineId = (
    db.prepare('SELECT routine_id FROM Routines WHERE name = ?;').get(name) as {
      routine_id: number;
    }
  ).routine_id;
  for (const [index, [weekday, sessionName]] of sessions.entries()) {
    db.prepare(
      'INSERT INTO Sessions (routine_id, weekday, name, sort_order) VALUES (?, ?, ?, ?);',
    ).run(routineId, weekday, sessionName, index + 1);
  }
};

describe('loadActiveRoutineTrainingDays', () => {
  it('returns null when no routine is active', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    insertRoutine(db, 'Saved Routine', false, [[MONDAY, 'Squat Day']]);

    expect(await loadActiveRoutineTrainingDays(executor)).toBeNull();
    db.close();
  });

  it('returns the active routine days in the routine order', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    insertRoutine(db, 'Saved Routine', false, [[MONDAY, 'Other Day']]);
    insertRoutine(db, 'Active Routine', true, [
      [MONDAY, 'Squat Day'],
      [FRIDAY, 'Deadlift Day'],
    ]);

    expect(await loadActiveRoutineTrainingDays(executor)).toEqual({
      routineName: 'Active Routine',
      days: [
        { weekday: MONDAY, sessionName: 'Squat Day' },
        { weekday: FRIDAY, sessionName: 'Deadlift Day' },
      ],
    });
    db.close();
  });

  it('distinguishes an active routine with no days from no routine at all', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    insertRoutine(db, 'Empty Routine', true, []);

    expect(await loadActiveRoutineTrainingDays(executor)).toEqual({
      routineName: 'Empty Routine',
      days: [],
    });
    db.close();
  });

  it('follows the routine the user activated instead of the one they left', async () => {
    const { db, executor } = connect();
    await runSchema(executor);
    insertRoutine(db, 'First Routine', false, [[MONDAY, 'Squat Day']]);
    insertRoutine(db, 'Second Routine', true, [[WEDNESDAY, 'Press Day']]);

    const loaded = await loadActiveRoutineTrainingDays(executor);
    const pruned = pruneDayTimes({ '1': '06:15' }, loaded?.days ?? []);

    expect(loaded?.routineName).toBe('Second Routine');
    expect(pruned).toEqual({});
    db.close();
  });
});
