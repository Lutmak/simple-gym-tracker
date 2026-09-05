import React from 'react';
import { View } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { ProgressCalendar } from './ProgressCalendar';
import { ThemeProvider } from '../context/ThemeContext';
import { lightTokens, hexWithOpacity } from '../utils/theme';
import type { ProgressCalendarDay, ProgressDayState } from '../utils/progressCalendar';

/**
 * The calendar's ADR-0047 rebuild: every non-`planned` state fills its cell with a tinted
 * `data.state` disc, `planned` stays bare, today rings in `textPrimary`, and the legend carries a
 * colour dot alongside its glyph and word. These are the properties a screenshot proves once and
 * a test keeps proving on every change.
 */

const day = (stamp: number, state: ProgressDayState): ProgressCalendarDay => ({
  stamp,
  state,
  name: 'Squat Day',
  target: { kind: 'session', routineId: 1, cycleId: 1, cycleNumber: 1, weekNumber: 1, sessionId: 1 },
});

// One UTC day (noon), day-of-month equal to its position for readability in the assertions below.
const STAMP_OF_DAY = (day: number): number =>
  Math.floor(Date.UTC(2026, 7, day, 12, 0, 0) / 1000); // August 2026

const renderCalendar = (days: ReadonlyMap<number, ProgressCalendarDay>, todayStamp?: number) =>
  render(
    <ThemeProvider>
      <ProgressCalendar
        initialMonth={{ year: 2026, month: 7 }}
        firstMonth={{ year: 2026, month: 0 }}
        lastMonth={{ year: 2026, month: 11 }}
        firstWeekday="Monday"
        days={days}
        todayStamp={todayStamp ?? STAMP_OF_DAY(15)}
        weekdayLabels={['L', 'M', 'X', 'J', 'V', 'S', 'D']}
        monthLabels={[
          'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
          'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
        ]}
        stateLabels={{
          planned: 'planificada',
          done: 'hecha',
          moved: 'movida',
          discarded: 'descartada',
          free: 'libre',
        }}
        previousMonthLabel="Mes anterior"
        nextMonthLabel="Mes siguiente"
        todayLabel="Hoy"
        dateLabel={(stamp) => String(stamp)}
        onSelectDay={() => {}}
        testID="calendar"
      />
    </ThemeProvider>,
  );

describe('ProgressCalendar — state discs (ADR-0047)', () => {
  it('fills a done day with the done token, tinted', () => {
    const stamp = STAMP_OF_DAY(3);
    renderCalendar(new Map([[stamp, day(stamp, 'done')]]));
    const cell = screen.getByTestId(`calendar-day-${stamp}`);
    const disc = cell.findAllByType(View)[0];
    expect(disc.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          backgroundColor: hexWithOpacity(lightTokens.data.state.done, 0.22),
        }),
      ]),
    );
  });

  it('leaves a planned day with no fill', () => {
    const stamp = STAMP_OF_DAY(4);
    renderCalendar(new Map([[stamp, day(stamp, 'planned')]]));
    const cell = screen.getByTestId(`calendar-day-${stamp}`);
    const disc = cell.findAllByType(View)[0];
    const flatStyle = ([] as unknown[]).concat(disc.props.style);
    expect(flatStyle.some((entry) => (entry as Record<string, unknown>)?.backgroundColor)).toBe(
      false,
    );
  });

  it('rings today in textPrimary regardless of state', () => {
    const stamp = STAMP_OF_DAY(15);
    renderCalendar(new Map([[stamp, day(stamp, 'done')]]), stamp);
    const cell = screen.getByTestId(`calendar-day-${stamp}`);
    const disc = cell.findAllByType(View)[0];
    expect(disc.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ borderColor: lightTokens.textPrimary, borderWidth: 2 }),
      ]),
    );
  });
});

describe('ProgressCalendar — legend', () => {
  it('shows a colour dot, the glyph and the word for every state', () => {
    renderCalendar(new Map());
    expect(screen.getByText('hecha')).toBeTruthy();
    expect(screen.getByText('movida')).toBeTruthy();
    expect(screen.getByText('descartada')).toBeTruthy();
    expect(screen.getByText('planificada')).toBeTruthy();
    expect(screen.getByText('libre')).toBeTruthy();
    expect(screen.getByText('✓')).toBeTruthy();
  });
});

