import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { displayFontSize, fontSize } from '../utils/scale';

/**
 * A self-ticking timer in display type — read from the floor, not the hand. Counts down a rest or
 * counts up a session's elapsed time; a parent can control the displayed countdown when it also
 * owns pause and adjustment state. `onComplete` fires exactly once when an uncontrolled countdown
 * reaches zero.
 */

/** "92" → "1:32"; "3661" → "1:01:01". */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const minutesText =
    hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const restText = String(rest).padStart(2, '0');
  return hours > 0 ? `${hours}:${minutesText}:${restText}` : `${minutesText}:${restText}`;
}

export type TimerProps = {
  /** countdown: total seconds to count down from (the rest). elapsed: counts up from 0. */
  mode?: 'countdown' | 'elapsed';
  /** countdown only. */
  duration?: number;
  /** A parent-controlled countdown value, used when a footer owns pause and adjustment state. */
  currentSeconds?: number;
  paused?: boolean;
  /** countdown only; fires once when the timer reaches zero. */
  onComplete?: () => void;
  /** Which display token the time renders in. */
  size?: 'rest' | 'workout' | 'header';
  testID?: string;
};

export function Timer({
  mode = 'countdown',
  duration = 0,
  currentSeconds,
  paused = false,
  onComplete,
  size = 'rest',
  testID,
}: TimerProps) {
  const { tokens } = useTheme();
  const [remaining, setRemaining] = useState(mode === 'countdown' ? duration : 0);
  const controlled = currentSeconds !== undefined;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (mode === 'countdown' && !controlled) {
      setRemaining(duration);
    }
  }, [controlled, duration, mode]);

  const displayedSeconds = currentSeconds ?? remaining;
  const runningOut = mode === 'countdown' && displayedSeconds <= 0;

  useEffect(() => {
    if (controlled || paused || runningOut) {
      return;
    }
    const interval = setInterval(() => {
      setRemaining((current) =>
        mode === 'countdown' ? Math.max(current - 1, 0) : current + 1,
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [controlled, paused, runningOut, mode]);

  useEffect(() => {
    if (!controlled && mode === 'countdown' && remaining === 0 && !paused) {
      onCompleteRef.current?.();
    }
  }, [controlled, remaining, mode, paused]);

  const sizeValue =
    size === 'rest'
      ? displayFontSize.restTimer
      : size === 'workout'
        ? displayFontSize.workoutTimer
        : fontSize.body;

  return (
    <Text
      style={[
        styles.time,
        { color: tokens.textPrimary, fontSize: sizeValue },
      ]}
      testID={testID}
    >
      {formatDuration(displayedSeconds)}
    </Text>
  );
}

const styles = StyleSheet.create({
  time: {
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
