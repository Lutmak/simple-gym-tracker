import {
  buildCalendarMonth,
  calendarMonthIndex,
  monthOfStamp,
  shiftCalendarMonth,
} from './calendar';

const dayStamp = (ymd: string): number => {
  const [year, month, day] = ymd.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day, 12, 0, 0) / 1000);
};

describe('calendar model', () => {
  it('orders the first row according to the first weekday and constrains cells', () => {
    const month = monthOfStamp(dayStamp('2026-08-15'));
    const model = buildCalendarMonth(
      month,
      'Monday',
      dayStamp('2026-08-17'),
      dayStamp('2026-08-28'),
      new Map([[dayStamp('2026-08-19'), 'Squat Day']]),
    );

    expect(model.weeks[0]?.map((cell) => cell?.day ?? null)).toEqual([
      null,
      null,
      null,
      null,
      null,
      1,
      2,
    ]);
    expect(model.weeks.flat().find((cell) => cell?.day === 19)).toMatchObject({
      occupiedBy: 'Squat Day',
      selectable: false,
    });
    expect(model.weeks.flat().find((cell) => cell?.day === 28)?.selectable).toBe(true);
    expect(model.weeks.flat().find((cell) => cell?.day === 29)?.selectable).toBe(false);
  });

  it('moves between calendar months without changing the date convention', () => {
    const january = { year: 2026, month: 0 };
    const december = shiftCalendarMonth(january, -1);
    const february = shiftCalendarMonth(january, 1);

    expect(december).toEqual({ year: 2025, month: 11 });
    expect(february).toEqual({ year: 2026, month: 1 });
    expect(calendarMonthIndex(february) - calendarMonthIndex(december)).toBe(2);
  });
});
