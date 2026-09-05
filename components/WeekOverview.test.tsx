import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { WeekOverview } from './WeekOverview';
import { ThemeProvider } from '../context/ThemeContext';
import { lightTokens, hexWithOpacity } from '../utils/theme';
import type { InicioDay, InicioDayStatus } from '../utils/inicio';

/**
 * The redesigned week strip (SPEC.md U2, ADR-0047 §4.1): a tinted `data.state` disc per day,
 * today rung in `textPrimary`, no legend row, and only a resolved day tappable — the same
 * properties `ProgressCalendar.test.tsx` pins for the calendar, plus the long-press caption this
 * strip uses instead of a legend.
 */

const STAMP = (offset: number): number =>
  Math.floor(Date.UTC(2026, 7, 10 + offset, 12, 0, 0) / 1000); // starting Monday 2026-08-10

const day = (offset: number, status: InicioDayStatus, sessionName: string | null = null): InicioDay => ({
  stamp: STAMP(offset),
  weekday: (offset + 1) % 7,
  status,
  sessionName,
  target:
    status === 'completed' || status === 'moved' || status === 'discarded'
      ? { routineId: 1, cycleId: 1, cycleNumber: 1, weekNumber: 1, sessionId: offset + 1 }
      : null,
});

const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const STATUS_LABELS: Record<InicioDayStatus, string> = {
  completed: 'hecha',
  moved: 'movida',
  discarded: 'descartada',
  pending: 'pendiente',
  rest: 'descanso',
};

const renderWeek = (days: readonly InicioDay[], todayStamp: number, onSelectDay = jest.fn()) => {
  render(
    <ThemeProvider>
      <WeekOverview
        days={days}
        todayStamp={todayStamp}
        weekdayLabels={WEEKDAY_LABELS}
        statusLabels={STATUS_LABELS}
        onSelectDay={onSelectDay}
        testID="week"
      />
    </ThemeProvider>,
  );
  return onSelectDay;
};

describe('WeekOverview — state discs (ADR-0047)', () => {
  it('fills a completed day with the done token, tinted', () => {
    const days = [day(0, 'completed'), day(1, 'rest'), day(2, 'rest'), day(3, 'rest'), day(4, 'rest'), day(5, 'rest'), day(6, 'rest')];
    renderWeek(days, STAMP(10));
    const cell = screen.getByTestId(`week-day-${STAMP(0)}`);
    const disc = cell.findAllByType(View)[0];
    expect(disc.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ backgroundColor: hexWithOpacity(lightTokens.data.state.done, 0.22) }),
      ]),
    );
  });

  it('leaves a pending day with no fill', () => {
    const days = [day(0, 'pending'), day(1, 'rest'), day(2, 'rest'), day(3, 'rest'), day(4, 'rest'), day(5, 'rest'), day(6, 'rest')];
    renderWeek(days, STAMP(10));
    const cell = screen.getByTestId(`week-day-${STAMP(0)}`);
    const disc = cell.findAllByType(View)[0];
    const flatStyle = ([] as unknown[]).concat(disc.props.style);
    expect(flatStyle.some((entry) => (entry as Record<string, unknown>)?.backgroundColor)).toBe(false);
  });

  it('rings today in textPrimary regardless of state', () => {
    const days = [day(0, 'completed'), day(1, 'rest'), day(2, 'rest'), day(3, 'rest'), day(4, 'rest'), day(5, 'rest'), day(6, 'rest')];
    renderWeek(days, STAMP(0));
    const cell = screen.getByTestId(`week-day-${STAMP(0)}`);
    const disc = cell.findAllByType(View)[0];
    expect(disc.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ borderColor: lightTokens.textPrimary, borderWidth: 2 }),
      ]),
    );
  });

  it('has no legend row — no state word appears until a cell is long-pressed', () => {
    const days = [day(0, 'completed'), day(1, 'moved'), day(2, 'discarded'), day(3, 'pending'), day(4, 'rest'), day(5, 'rest'), day(6, 'rest')];
    renderWeek(days, STAMP(10));
    expect(screen.queryByText('hecha')).toBeNull();
    expect(screen.queryByText('movida')).toBeNull();
    expect(screen.queryByText('descartada')).toBeNull();
  });
});

describe('WeekOverview — tappability', () => {
  it('opens the session sheet with the day\'s target for a completed/moved/discarded day', () => {
    const days = [day(0, 'completed', 'Squat Day'), day(1, 'rest'), day(2, 'rest'), day(3, 'rest'), day(4, 'rest'), day(5, 'rest'), day(6, 'rest')];
    const onSelectDay = renderWeek(days, STAMP(10));
    fireEvent.press(screen.getByTestId(`week-day-${STAMP(0)}`));
    expect(onSelectDay).toHaveBeenCalledWith({ routineId: 1, cycleId: 1, cycleNumber: 1, weekNumber: 1, sessionId: 1 });
  });

  it('does nothing for a pending or rest day', () => {
    const days = [day(0, 'pending'), day(1, 'rest'), day(2, 'rest'), day(3, 'rest'), day(4, 'rest'), day(5, 'rest'), day(6, 'rest')];
    const onSelectDay = renderWeek(days, STAMP(10));
    fireEvent.press(screen.getByTestId(`week-day-${STAMP(0)}`));
    fireEvent.press(screen.getByTestId(`week-day-${STAMP(1)}`));
    expect(onSelectDay).not.toHaveBeenCalled();
  });
});

describe('WeekOverview — long-press caption', () => {
  it('names the day on long-press, and it is not there before', () => {
    const days = [day(0, 'completed', 'Squat Day'), day(1, 'rest'), day(2, 'rest'), day(3, 'rest'), day(4, 'rest'), day(5, 'rest'), day(6, 'rest')];
    renderWeek(days, STAMP(10));
    expect(screen.queryByTestId('week-caption')).toBeNull();
    fireEvent(screen.getByTestId(`week-day-${STAMP(0)}`), 'longPress');
    expect(screen.getByTestId('week-caption')).toHaveTextContent('L · hecha · Squat Day');
  });

  it('clears itself after a timeout', () => {
    jest.useFakeTimers();
    const days = [day(0, 'completed'), day(1, 'rest'), day(2, 'rest'), day(3, 'rest'), day(4, 'rest'), day(5, 'rest'), day(6, 'rest')];
    renderWeek(days, STAMP(10));
    fireEvent(screen.getByTestId(`week-day-${STAMP(0)}`), 'longPress');
    expect(screen.getByTestId('week-caption')).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.queryByTestId('week-caption')).toBeNull();
    jest.useRealTimers();
  });
});
