import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { APP_TEXT_MAX_FONT_SIZE_MULTIPLIER } from './AppTextInput';
import {
  buildCalendarMonth,
  calendarMonthIndex,
  monthOfStamp,
  shiftCalendarMonth,
  type CalendarMonth,
} from '../utils/calendar';
import type { FirstWeekday } from '../utils/inicio';
import { fontSize, spacing, tabBar, touchTarget } from '../utils/scale';

export type CalendarProps = {
  minStamp: number;
  maxStamp: number;
  firstWeekday: FirstWeekday;
  weekdayLabels: readonly string[];
  monthLabels: readonly string[];
  occupiedBy: ReadonlyMap<number, string>;
  dateLabel: (stamp: number) => string;
  occupiedLabel: (sessionName: string) => string;
  previousMonthLabel: string;
  nextMonthLabel: string;
  onSelectDate: (stamp: number) => void;
  testID?: string;
};

export function Calendar({
  minStamp,
  maxStamp,
  firstWeekday,
  weekdayLabels,
  monthLabels,
  occupiedBy,
  dateLabel,
  occupiedLabel,
  previousMonthLabel,
  nextMonthLabel,
  onSelectDate,
  testID,
}: CalendarProps) {
  const { tokens } = useTheme();
  const [month, setMonth] = useState<CalendarMonth>(() => monthOfStamp(minStamp));
  const firstMonth = monthOfStamp(minStamp);
  const lastMonth = monthOfStamp(maxStamp);

  useEffect(() => {
    setMonth(monthOfStamp(minStamp));
  }, [minStamp]);

  const model = buildCalendarMonth(month, firstWeekday, minStamp, maxStamp, occupiedBy);
  const monthIndex = calendarMonthIndex(month);
  const canGoPrevious = monthIndex > calendarMonthIndex(firstMonth);
  const canGoNext = monthIndex < calendarMonthIndex(lastMonth);

  return (
    <View testID={testID}>
      <View style={styles.monthHeader}>
        <Pressable
          disabled={!canGoPrevious}
          onPress={() => setMonth((current) => shiftCalendarMonth(current, -1))}
          accessibilityRole="button"
          accessibilityLabel={previousMonthLabel}
          style={({ pressed }) => [
            styles.monthNav,
            pressed && canGoPrevious && { backgroundColor: tokens.inputFill },
          ]}
        >
          <Ionicons
            name="chevron-back"
            size={tabBar.icon}
            color={canGoPrevious ? tokens.textPrimary : tokens.disabled}
          />
        </Pressable>
        <Text
          style={[styles.monthTitle, { color: tokens.textPrimary }]}
          maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        >
          {`${monthLabels[month.month]} ${month.year}`}
        </Text>
        <Pressable
          disabled={!canGoNext}
          onPress={() => setMonth((current) => shiftCalendarMonth(current, 1))}
          accessibilityRole="button"
          accessibilityLabel={nextMonthLabel}
          style={({ pressed }) => [
            styles.monthNav,
            pressed && canGoNext && { backgroundColor: tokens.inputFill },
          ]}
        >
          <Ionicons
            name="chevron-forward"
            size={tabBar.icon}
            color={canGoNext ? tokens.textPrimary : tokens.disabled}
          />
        </Pressable>
      </View>
      <View style={styles.weekdayRow}>
        {weekdayLabels.map((label, index) => (
          <Text
            key={`${label}-${index}`}
            style={[styles.weekday, { color: tokens.textSecondary }]}
            maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          >
            {label}
          </Text>
        ))}
      </View>
      <View style={styles.grid}>
        {model.weeks.map((week, weekIndex) => (
          <View key={`week-${weekIndex}`} style={styles.week}>
            {week.map((cell, dayIndex) => {
              if (cell === null) {
                return <View key={`blank-${dayIndex}`} style={styles.cell} />;
              }

              const canSelect = cell.selectable;
              const accessibilityLabel = cell.occupiedBy === null
                ? dateLabel(cell.stamp)
                : `${dateLabel(cell.stamp)} · ${occupiedLabel(cell.occupiedBy)}`;
              return (
                <Pressable
                  key={cell.stamp}
                  disabled={!canSelect}
                  onPress={() => onSelectDate(cell.stamp)}
                  accessibilityRole="button"
                  accessibilityLabel={accessibilityLabel}
                  testID={testID === undefined ? undefined : `${testID}-date-${cell.stamp}`}
                  style={({ pressed }) => [
                    styles.cell,
                    pressed && canSelect && { backgroundColor: tokens.inputFill },
                  ]}
                >
                  <Text
                    style={[styles.dayNumber, { color: canSelect ? tokens.textPrimary : tokens.disabled }]}
                    maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                  >
                    {cell.day}
                  </Text>
                  {cell.occupiedBy !== null && (
                    <Text
                      style={[styles.occupiedMark, { color: tokens.textSecondary }]}
                      maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                    >
                      ·
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.cardGap,
  },
  monthNav: {
    minWidth: touchTarget.icon,
    minHeight: touchTarget.icon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitle: {
    fontSize: fontSize.cardTitle,
    fontWeight: '700',
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: spacing.label,
  },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  grid: {
    gap: spacing.label,
  },
  week: {
    flexDirection: 'row',
    gap: spacing.label,
  },
  cell: {
    flex: 1,
    minHeight: touchTarget.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNumber: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  occupiedMark: {
    fontSize: fontSize.caption,
    lineHeight: fontSize.caption,
  },
});
