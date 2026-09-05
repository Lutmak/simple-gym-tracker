import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { hexWithOpacity, type DataStateKey } from '../utils/theme';
import { PROGRESS_DAY_GLYPHS, dayStateOfStatus, type ProgressDayState } from '../utils/progressCalendar';
import type { WeekSessionStatus } from '../utils/routineProgress';
import { dataMark, fontSize, spacing } from '../utils/scale';

/**
 * One week of a cycle, as a row of small state discs (SPEC.md U3 "ESTE CICLO"/"CICLOS
 * ANTERIORES") — the same states and the same glyph-plus-tint pairing `ProgressCalendar` draws for
 * a day, sized down for an inline row of one disc per planned session rather than one per day of
 * the month. `planned` carries no fill, same reasoning as the calendar: an unresolved session is
 * the *absence* of colour, rung by a `divider` ring instead.
 */

/** `planned` has no `data.state` entry (no fill); every other state does — same set the calendar uses. */
const DISC_STATE_KEYS: Partial<Record<ProgressDayState, DataStateKey>> = {
  done: 'done',
  moved: 'moved',
  discarded: 'discarded',
};

/** A tint, not the saturated token, so the glyph stays legible on top of it (matches the calendar). */
const DISC_FILL_OPACITY = 0.22;

export type WeekStateDiscsProps = {
  statuses: readonly WeekSessionStatus[];
  /** The word each status reads as, for the accessibility label of its disc. */
  statusLabels: Readonly<Record<WeekSessionStatus, string>>;
  testID?: string;
};

export function WeekStateDiscs({ statuses, statusLabels, testID }: WeekStateDiscsProps) {
  const { tokens } = useTheme();

  return (
    <View style={styles.row} testID={testID}>
      {statuses.map((status, index) => {
        const state = dayStateOfStatus(status);
        const stateKey = DISC_STATE_KEYS[state];
        const fill = stateKey === undefined ? null : hexWithOpacity(tokens.data.state[stateKey], DISC_FILL_OPACITY);
        return (
          <View
            key={index}
            style={[
              styles.disc,
              fill === null ? { borderWidth: 1, borderColor: tokens.divider } : { backgroundColor: fill },
            ]}
            accessibilityLabel={statusLabels[status]}
            testID={testID === undefined ? undefined : `${testID}-${index}`}
          >
            <Text
              style={[
                styles.glyph,
                { color: state === 'discarded' ? tokens.textSecondary : tokens.textPrimary },
              ]}
            >
              {PROGRESS_DAY_GLYPHS[state]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.inline,
  },
  disc: {
    width: dataMark.dot * 2.5,
    height: dataMark.dot * 2.5,
    borderRadius: dataMark.dot * 1.25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
});
