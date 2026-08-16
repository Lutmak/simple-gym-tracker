import {
  assignWeekday,
  dayOnWeekday,
  firstFreeWeekday,
  orderByWeekday,
  usedWeekdays,
  weekdayOrder,
} from './trainingDays';

type Day = { key: string; weekday: number; name: string };

const days = (...entries: [string, number][]): Day[] =>
  entries.map(([key, weekday]) => ({ key, weekday, name: key.toUpperCase() }));

describe('weekdayOrder', () => {
  it('starts on Monday when the setting says so', () => {
    expect(weekdayOrder('Monday')).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('starts on Sunday when the setting says so', () => {
    expect(weekdayOrder('Sunday')).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('assignWeekday', () => {
  it('moves a day to a free weekday', () => {
    const moved = assignWeekday(days(['a', 1], ['b', 3]), 'a', 5);
    expect(moved).toEqual(days(['a', 5], ['b', 3]));
  });

  it('swaps rather than deletes when the weekday is taken', () => {
    const moved = assignWeekday(days(['a', 1], ['b', 3]), 'a', 3);
    expect(moved).toHaveLength(2);
    expect(moved.find((day) => day.key === 'a')?.weekday).toBe(3);
    expect(moved.find((day) => day.key === 'b')?.weekday).toBe(1);
  });

  it('keeps every configured day across a sequence of reassignments', () => {
    let week = days(['a', 1], ['b', 2], ['c', 4], ['d', 5]);
    week = assignWeekday(week, 'a', 2);
    week = assignWeekday(week, 'd', 1);
    week = assignWeekday(week, 'c', 2);
    expect(week).toHaveLength(4);
    expect(new Set(week.map((day) => day.weekday)).size).toBe(4);
    expect(week.map((day) => day.name).sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('keeps the exercises and names of both swapped days', () => {
    const moved = assignWeekday(days(['a', 1], ['b', 3]), 'b', 1);
    expect(moved.find((day) => day.key === 'b')?.name).toBe('B');
    expect(moved.find((day) => day.key === 'a')?.name).toBe('A');
  });

  it('is a no-op for the day it already is', () => {
    expect(assignWeekday(days(['a', 1]), 'a', 1)).toEqual(days(['a', 1]));
  });

  it('is a no-op for an unknown key or an impossible weekday', () => {
    expect(assignWeekday(days(['a', 1]), 'zzz', 4)).toEqual(days(['a', 1]));
    expect(assignWeekday(days(['a', 1]), 'a', 9)).toEqual(days(['a', 1]));
  });
});

describe('orderByWeekday', () => {
  it('orders the plan the way the user reads a week', () => {
    const week = orderByWeekday(days(['a', 0], ['b', 1], ['c', 5]), 'Monday');
    expect(week.map((day) => day.key)).toEqual(['b', 'c', 'a']);
  });

  it('honours a Sunday-first week', () => {
    const week = orderByWeekday(days(['a', 0], ['b', 1], ['c', 5]), 'Sunday');
    expect(week.map((day) => day.key)).toEqual(['a', 'b', 'c']);
  });
});

describe('firstFreeWeekday', () => {
  it('is the first unused day of the user week', () => {
    expect(firstFreeWeekday(days(['a', 1], ['b', 2]), 'Monday')).toBe(3);
    expect(firstFreeWeekday(days(['a', 1], ['b', 2]), 'Sunday')).toBe(0);
  });

  it('is null on a full week', () => {
    const full = days(['a', 0], ['b', 1], ['c', 2], ['d', 3], ['e', 4], ['f', 5], ['g', 6]);
    expect(firstFreeWeekday(full, 'Monday')).toBeNull();
  });
});

describe('usedWeekdays and dayOnWeekday', () => {
  it('reports what a picker cell holds', () => {
    const week = days(['a', 1], ['b', 3]);
    expect(usedWeekdays(week)).toEqual(new Set([1, 3]));
    expect(dayOnWeekday(week, 3)?.key).toBe('b');
    expect(dayOnWeekday(week, 3, 'b')).toBeNull();
    expect(dayOnWeekday(week, 6)).toBeNull();
  });
});
