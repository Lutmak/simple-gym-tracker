import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { hexWithOpacity, type DataStateKey } from '../utils/theme';
import { APP_TEXT_MAX_FONT_SIZE_MULTIPLIER } from './AppTextInput';
import {
  calendarMonthIndex,
  shiftCalendarMonth,
  type CalendarMonth,
} from '../utils/calendar';
import {
  PROGRESS_DAY_GLYPHS,
  PROGRESS_DAY_STATES,
  buildProgressMonth,
  type ProgressCalendarDay,
  type ProgressDayState,
} from '../utils/progressCalendar';
import type { FirstWeekday } from '../utils/inicio';
import { dataMark, fontSize, spacing, tabBar, touchTarget } from '../utils/scale';

/**
 * The calendar of Progreso (SPEC.md U1, ADR-0047 §4.1).
 *
 * **Five states, told apart two ways at once, never by colour alone.**
 *
 * - **A tinted disc per state**, from the `data.state` tokens: green for done, blue for moved,
 *   amber for discarded, violet for free. `planned` carries no fill — an unhappened day is the
 *   *absence* of colour, not a fifth hue — so it stays bare text, exactly as before this rebuild.
 * - **A glyph per state**, inside the disc: `✓` done · `→` moved · `✕` discarded · `○` planned ·
 *   `+` free session. This is the second cue ADR-0047 requires: nothing here is read by colour
 *   alone, which matters for the colour-vision-deficient reader as much as it does on a washed-out
 *   phone screen in gym lighting.
 * - **A ring means today**, in `textPrimary`, independent of whatever state the day also carries.
 *
 * The legend is not optional decoration: it is the thing that makes the grid readable on first
 * sight, and §4.5 says a label that needs a manual is not a label. Each entry repeats the same
 * pairing the grid uses — a colour dot, the glyph, the word — so the legend is where the mapping
 * is learned once rather than guessed from the grid.
 *
 * Every marked day is tappable and opens its session; an unmarked day is inert rather than a
 * dead-end dialog, which is the recorded defect.
 */

/** `planned` has no data.state entry (no fill); every other state does. */
const DISC_STATE_KEYS: Partial<Record<ProgressDayState, DataStateKey>> = {
  done: 'done',
  moved: 'moved',
  discarded: 'discarded',
  free: 'free',
};

/** The disc is a tint, not the saturated token, so the day number stays legible on top of it. */
const DISC_FILL_OPACITY = 0.22;

export type ProgressCalendarProps = {
  /** The month shown first — normally the month of the most recent activity. */
  initialMonth: CalendarMonth;
  /** The months the data spans, so navigation stops where history does. */
  firstMonth: CalendarMonth;
  lastMonth: CalendarMonth;
  firstWeekday: FirstWeekday;
  days: ReadonlyMap<number, ProgressCalendarDay>;
  todayStamp: number;
  weekdayLabels: readonly string[];
  monthLabels: readonly string[];
  stateLabels: Readonly<Record<ProgressDayState, string>>;
  previousMonthLabel: string;
  nextMonthLabel: string;
  todayLabel: string;
  dateLabel: (stamp: number) => string;
  onSelectDay: (entry: ProgressCalendarDay) => void;
  testID?: string;
};

export function ProgressCalendar({
  initialMonth,
  firstMonth,
  lastMonth,
  firstWeekday,
  days,
  todayStamp,
  weekdayLabels,
  monthLabels,
  stateLabels,
  previousMonthLabel,
  nextMonthLabel,
  todayLabel,
  dateLabel,
  onSelectDay,
  testID,
}: ProgressCalendarProps) {
  const { tokens } = useTheme();
  const [month, setMonth] = useState<CalendarMonth>(initialMonth);

  const weeks = buildProgressMonth(month, firstWeekday, days);
  const index = calendarMonthIndex(month);
  const canGoPrevious = index > calendarMonthIndex(firstMonth);
  const canGoNext = index < calendarMonthIndex(lastMonth);

  const dayNumberStyle = (state: ProgressDayState | null) => {
    if (state === null) {
      return { color: tokens.textSecondary };
    }
    if (state === 'done' || state === 'moved' || state === 'free') {
      return { color: tokens.textPrimary };
    }
    if (state === 'discarded') {
      return { color: tokens.textSecondary, textDecorationLine: 'line-through' as const };
    }
    return { color: tokens.textSecondary };
  };

  /** The disc's tint (ADR-0047 §4.1) — `null` for `planned`, which carries no fill. */
  const discColor = (state: ProgressDayState | null): string | null => {
    const stateKey = state === null ? undefined : DISC_STATE_KEYS[state];
    return stateKey === undefined ? null : hexWithOpacity(tokens.data.state[stateKey], DISC_FILL_OPACITY);
  };

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
          testID={testID === undefined ? undefined : `${testID}-previous`}
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
          testID={testID === undefined ? undefined : `${testID}-next`}
        >
          <Ionicons
            name="chevron-forward"
            size={tabBar.icon}
            color={canGoNext ? tokens.textPrimary : tokens.disabled}
          />
        </Pressable>
      </View>

      <View style={styles.weekdayRow}>
        {weekdayLabels.map((label, position) => (
          <Text
            key={`${label}-${position}`}
            style={[styles.weekday, { color: tokens.textSecondary }]}
            maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          >
            {label}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {weeks.map((week, weekIndex) => (
          <View key={`week-${weekIndex}`} style={styles.week}>
            {week.map((cell, dayIndex) => {
              if (cell === null) {
                return <View key={`blank-${dayIndex}`} style={styles.cell} />;
              }
              const entry = cell.entry;
              const isToday = cell.stamp === todayStamp;
              const label =
                entry === null
                  ? dateLabel(cell.stamp)
                  : `${dateLabel(cell.stamp)} · ${entry.name} · ${stateLabels[entry.state]}`;
              return (
                <Pressable
                  key={cell.stamp}
                  disabled={entry === null}
                  onPress={() => {
                    if (entry !== null) {
                      onSelectDay(entry);
                    }
                  }}
                  accessibilityRole={entry === null ? undefined : 'button'}
                  accessibilityLabel={isToday ? `${label} · ${todayLabel}` : label}
                  testID={testID === undefined ? undefined : `${testID}-day-${cell.stamp}`}
                  style={({ pressed }) => [
                    styles.cell,
                    pressed && entry !== null && { backgroundColor: tokens.inputFill },
                  ]}
                >
                  <View
                    style={[
                      styles.disc,
                      isToday && { borderColor: tokens.textPrimary, borderWidth: 2 },
                      (() => {
                        const fill = discColor(entry?.state ?? null);
                        return fill === null ? null : { backgroundColor: fill };
                      })(),
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayNumber,
                        dayNumberStyle(entry?.state ?? null),
                        entry !== null && styles.dayNumberMarked,
                      ]}
                      maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                    >
                      {cell.day}
                    </Text>
                    <Text
                      style={[styles.glyph, dayNumberStyle(entry?.state ?? null)]}
                      maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                    >
                      {entry === null ? ' ' : PROGRESS_DAY_GLYPHS[entry.state]}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <View style={styles.legend}>
        {PROGRESS_DAY_STATES.map((state) => {
          const stateKey = DISC_STATE_KEYS[state];
          return (
            <View key={state} style={styles.legendItem}>
              <View
                style={[
                  styles.legendDot,
                  stateKey === undefined
                    ? { borderWidth: 1, borderColor: tokens.divider }
                    : { backgroundColor: tokens.data.state[stateKey] },
                ]}
              />
              <Text
                style={[styles.legendGlyph, { color: tokens.textPrimary }]}
                maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              >
                {PROGRESS_DAY_GLYPHS[state]}
              </Text>
              <Text
                style={[styles.legendLabel, { color: tokens.textSecondary }]}
                maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              >
                {stateLabels[state]}
              </Text>
            </View>
          );
        })}
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
  disc: {
    width: touchTarget.control,
    height: touchTarget.control,
    borderRadius: touchTarget.control / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  dayNumber: {
    fontSize: fontSize.body,
  },
  dayNumberMarked: {
    fontWeight: '700',
  },
  glyph: {
    fontSize: fontSize.caption,
    lineHeight: fontSize.body,
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
  legendDot: {
    width: dataMark.dot,
    height: dataMark.dot,
    borderRadius: dataMark.dot / 2,
  },
  legendGlyph: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  legendLabel: {
    fontSize: fontSize.caption,
  },
});
