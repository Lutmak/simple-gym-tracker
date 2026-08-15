import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

import { Timer, formatDuration } from './Timer';

describe('formatDuration', () => {
  it('formats seconds as M:SS', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(92)).toBe('1:32');
    expect(formatDuration(600)).toBe('10:00');
  });

  it('switches to H:MM:SS past an hour', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('never shows a negative time', () => {
    expect(formatDuration(-3)).toBe('0:00');
  });
});

describe('Timer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('counts a rest down to zero', () => {
    render(<Timer duration={3} />);
    expect(screen.getByText('0:03')).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByText('0:02')).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.getByText('0:00')).toBeTruthy();
  });

  it('fires onComplete once when the rest ends', () => {
    const onComplete = jest.fn();
    render(<Timer duration={2} onComplete={onComplete} />);

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('stops ticking while paused', () => {
    render(<Timer duration={60} paused />);

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(screen.getByText('1:00')).toBeTruthy();
  });

  it('counts up in elapsed mode', () => {
    render(<Timer mode="elapsed" />);
    expect(screen.getByText('0:00')).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.getByText('0:02')).toBeTruthy();
  });
});
