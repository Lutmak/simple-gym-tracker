import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { displayFontSize, fontSize, spacing } from '../utils/scale';

/**
 * A labelled live readout — sets done, volume, duration. The value uses display type on purpose:
 * stats are read from a distance, not in the hand. The unit sits beside the number it qualifies
 * (H4); a bare number is a defect.
 */
export type StatProps = {
  label: string;
  value: string;
  unit?: string;
  testID?: string;
};

export function Stat({ label, value, unit, testID }: StatProps) {
  const { tokens } = useTheme();

  return (
    <View style={styles.stat} testID={testID}>
      <View style={styles.valueRow}>
        <Text
          style={[styles.value, { color: tokens.textPrimary }]}
          maxFontSizeMultiplier={1.5}
        >
          {value}
        </Text>
        {unit !== undefined && (
          <Text style={[styles.unit, { color: tokens.textSecondary }]} maxFontSizeMultiplier={1.5}>
            {unit}
          </Text>
        )}
      </View>
      <Text style={[styles.label, { color: tokens.textSecondary }]} maxFontSizeMultiplier={1.5}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stat: {
    alignItems: 'center',
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.inline,
  },
  value: {
    fontSize: displayFontSize.stat,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  unit: {
    fontSize: displayFontSize.displayUnit,
  },
  label: {
    fontSize: fontSize.caption,
    marginTop: spacing.label,
  },
});
