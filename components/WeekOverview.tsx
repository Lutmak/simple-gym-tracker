import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { APP_TEXT_MAX_FONT_SIZE_MULTIPLIER } from './AppTextInput';
import { fontSize, spacing } from '../utils/scale';
import type { InicioDay, InicioDayStatus } from '../utils/inicio';

type Props = {
  days: readonly InicioDay[];
  todayStamp: number;
  weekdayLabels: readonly string[];
  legend: readonly { label: string; status: InicioDayStatus }[];
};

const symbolFor = (status: InicioDayStatus): string => {
  switch (status) {
    case 'completed':
      return '✓';
    case 'moved':
      return '→';
    case 'discarded':
      return '✕';
    case 'pending':
      return '○';
    case 'rest':
      return '·';
  }
};

export function WeekOverview({ days, todayStamp, weekdayLabels, legend }: Props) {
  const { tokens } = useTheme();

  const colorFor = (status: InicioDayStatus): string => {
    switch (status) {
      case 'completed':
        return tokens.success;
      case 'discarded':
        return tokens.warning;
      case 'moved':
        return tokens.accent;
      case 'pending':
      case 'rest':
        return tokens.textSecondary;
    }
  };

  return (
    <View>
      <View style={styles.dayRow}>
        {days.map((day, index) => (
          <View
            key={day.stamp}
            style={[
              styles.day,
              { borderColor: day.stamp === todayStamp ? tokens.accent : tokens.divider },
              day.stamp === todayStamp && styles.today,
            ]}
            accessibilityLabel={`${weekdayLabels[index]} ${symbolFor(day.status)}`}
          >
            <Text
              style={[styles.weekday, { color: tokens.textSecondary }]}
              maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
            >
              {weekdayLabels[index]}
            </Text>
            <Text
              style={[styles.symbol, { color: colorFor(day.status) }]}
              maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
            >
              {symbolFor(day.status)}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.legend}>
        {legend.map((item) => (
          <View key={item.status} style={styles.legendItem}>
            <Text style={[styles.legendSymbol, { color: colorFor(item.status) }]}>
              {symbolFor(item.status)}
            </Text>
            <Text style={[styles.legendLabel, { color: tokens.textSecondary }]}>
              {item.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dayRow: {
    flexDirection: 'row',
    gap: spacing.inline,
  },
  day: {
    flex: 1,
    aspectRatio: 1,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.inline,
  },
  today: {
    borderWidth: 2,
  },
  weekday: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  symbol: {
    fontSize: fontSize.cardTitle,
    fontWeight: '700',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.card,
    rowGap: spacing.label,
    marginTop: spacing.card,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
  },
  legendSymbol: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  legendLabel: {
    fontSize: fontSize.caption,
  },
});
