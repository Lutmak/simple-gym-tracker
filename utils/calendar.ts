import { weekdayOfStamp } from './today';
import type { FirstWeekday } from './inicio';

export interface CalendarMonth {
  year: number;
  month: number;
}

export interface CalendarCell {
  stamp: number;
  day: number;
  occupiedBy: string | null;
  selectable: boolean;
}

export type CalendarWeek = readonly (CalendarCell | null)[];

export interface CalendarMonthModel {
  month: CalendarMonth;
  weeks: readonly CalendarWeek[];
}

const stampForUtcDate = (year: number, month: number, day: number): number =>
  Math.floor(Date.UTC(year, month, day, 12, 0, 0) / 1000);

/** One day of a month grid: the whole-day stamp and its day number. */
export interface MonthGridDay {
  stamp: number;
  day: number;
}

export type MonthGridWeek = readonly (MonthGridDay | null)[];

export function monthOfStamp(stamp: number): CalendarMonth {
  const date = new Date(stamp * 1000);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

export function shiftCalendarMonth(month: CalendarMonth, amount: number): CalendarMonth {
  const absoluteMonth = month.year * 12 + month.month + amount;
  return {
    year: Math.floor(absoluteMonth / 12),
    month: absoluteMonth % 12,
  };
}

export function calendarMonthIndex(month: CalendarMonth): number {
  return month.year * 12 + month.month;
}

/**
 * The weekdays of a row, in the order the user's `firstWeekday` setting puts them.
 * Weekday numbers follow `Date.getUTCDay()` — 0 is Sunday.
 */
export function weekdayOrder(firstWeekday: FirstWeekday): number[] {
  const firstDay = firstWeekday === 'Monday' ? 1 : 0;
  return Array.from({ length: 7 }, (_, index) => (firstDay + index) % 7);
}

/**
 * A month as rows of seven days, honouring `firstWeekday`: leading and trailing
 * cells are null so every row is a real week. This is the only place the app
 * turns a month into a grid — the move picker and Progreso's calendar both read
 * it, so a first-weekday bug can only be written once.
 */
export function buildMonthGrid(
  month: CalendarMonth,
  firstWeekday: FirstWeekday,
): MonthGridWeek[] {
  const firstDay = firstWeekday === 'Monday' ? 1 : 0;
  const firstStamp = stampForUtcDate(month.year, month.month, 1);
  const leadingBlanks = (weekdayOfStamp(firstStamp) - firstDay + 7) % 7;
  const daysInMonth = new Date(Date.UTC(month.year, month.month + 1, 0, 12, 0, 0)).getUTCDate();
  const cells: (MonthGridDay | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => ({
      stamp: stampForUtcDate(month.year, month.month, index + 1),
      day: index + 1,
    })),
  ];

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  const weeks: MonthGridWeek[] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}

export function buildCalendarMonth(
  month: CalendarMonth,
  firstWeekday: FirstWeekday,
  minStamp: number,
  maxStamp: number,
  occupiedBy: ReadonlyMap<number, string>,
): CalendarMonthModel {
  const weeks: CalendarWeek[] = buildMonthGrid(month, firstWeekday).map((week) =>
    week.map((cell) => {
      if (cell === null) {
        return null;
      }
      const occupied = occupiedBy.get(cell.stamp) ?? null;
      return {
        stamp: cell.stamp,
        day: cell.day,
        occupiedBy: occupied,
        selectable: cell.stamp >= minStamp && cell.stamp <= maxStamp && occupied === null,
      };
    }),
  );

  return { month, weeks };
}
