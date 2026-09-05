import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { dataMark, displayFontSize, fontSize, spacing } from '../utils/scale';

/**
 * A labelled live readout — sets done, volume, duration. The value uses display type on purpose:
 * stats are read from a distance, not in the hand. The unit sits beside the number it qualifies
 * (H4); a bare number is a defect.
 *
 * Two additions for Iteration 5 (ADR-0047, SPEC.md U1):
 *
 * - **`color`** — an optional identity swatch, a small dot before the value. It takes a `data`
 *   token only (a routine's series colour, e.g. the cycle tile on Progreso), never a raw colour or
 *   a chrome token; this is data wearing colour, not a UI accent.
 * - **`trend`** — an optional direction since last time. The glyph (▲/▼/flat dash) is the primary
 *   cue; `success`/`warning` colour it only as a second cue, never alone, matching the app's
 *   existing at-a-glance semantics (ADR-0031) rather than inventing a third chromatic meaning.
 */
export type StatTrend = 'up' | 'down' | 'flat';

export type StatProps = {
  label: string;
  value: string;
  unit?: string;
  /** A `data` token identifying what this stat is about (e.g. a lift's series colour). */
  color?: string;
  /** Direction since the last reading; paired with a glyph so nothing is read by colour alone. */
  trend?: StatTrend;
  testID?: string;
};

const TREND_ICON: Record<StatTrend, string> = {
  up: 'arrow-up',
  down: 'arrow-down',
  flat: 'remove',
};

export function Stat({ label, value, unit, color, trend, testID }: StatProps) {
  const { tokens } = useTheme();
  const trendColor =
    trend === 'up' ? tokens.success : trend === 'down' ? tokens.warning : tokens.textSecondary;

  return (
    <View style={styles.stat} testID={testID}>
      <View style={styles.valueRow}>
        {color !== undefined && (
          <View
            style={[styles.swatch, { backgroundColor: color }]}
            testID={testID === undefined ? undefined : `${testID}-swatch`}
          />
        )}
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
        {trend !== undefined && (
          <Ionicons
            name={TREND_ICON[trend]}
            size={fontSize.body}
            color={trendColor}
            testID={testID === undefined ? undefined : `${testID}-trend`}
          />
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
  swatch: {
    width: dataMark.dot,
    height: dataMark.dot,
    borderRadius: dataMark.dot / 2,
    alignSelf: 'center',
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
