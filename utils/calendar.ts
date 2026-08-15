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

export function buildCalendarMonth(
  month: CalendarMonth,
  firstWeekday: FirstWeekday,
  minStamp: number,
  maxStamp: number,
  occupiedBy: ReadonlyMap<number, string>,
): CalendarMonthModel {
  const firstDay = firstWeekday === 'Monday' ? 1 : 0;
  const firstStamp = stampForUtcDate(month.year, month.month, 1);
  const leadingBlanks = (weekdayOfStamp(firstStamp) - firstDay + 7) % 7;
  const daysInMonth = new Date(Date.UTC(month.year, month.month + 1, 0, 12, 0, 0)).getUTCDate();
  const cells: (CalendarCell | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const stamp = stampForUtcDate(month.year, month.month, day);
      const occupied = occupiedBy.get(stamp) ?? null;
      return {
        stamp,
        day,
        occupiedBy: occupied,
        selectable: stamp >= minStamp && stamp <= maxStamp && occupied === null,
      };
    }),
  ];

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  const weeks: CalendarWeek[] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }

  return { month, weeks };
}
