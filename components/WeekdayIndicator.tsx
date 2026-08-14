import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import { useTranslation } from 'react-i18next';
import { APP_TEXT_MAX_FONT_SIZE_MULTIPLIER } from './AppTextInput';
import { fontSize, radius, spacing } from '../utils/scale';

const WEEKDAY_SHORT_KEYS = [
  'weekdayShortSun',
  'weekdayShortMon',
  'weekdayShortTue',
  'weekdayShortWed',
  'weekdayShortThu',
  'weekdayShortFri',
  'weekdayShortSat',
] as const;

type Props = {
  /** The routine's session weekdays, Date.getDay() convention (0 = Sunday). */
  weekdays: readonly number[];
};

/**
 * The compact mini-calendar: seven cells, one per weekday, filled where the
 * routine trains. The row starts on the user's `firstWeekday` setting.
 */
export default function WeekdayIndicator({ weekdays }: Props) {
  const { theme } = useTheme();
  const { firstWeekday } = useSettings();
  const { t } = useTranslation();

  const start = firstWeekday === 'Monday' ? 1 : 0;
  const orderedDays = Array.from({ length: 7 }, (_, index) => (start + index) % 7);

  return (
    <View style={styles.row}>
      {orderedDays.map((weekday) => {
        const active = weekdays.includes(weekday);
        return (
          <View
            key={weekday}
            style={[
              styles.cell,
              { borderColor: theme.border },
              active && { backgroundColor: theme.buttonBackground },
            ]}
          >
            <Text
              maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              style={[
                styles.letter,
                {
                  color: active ? theme.buttonText : theme.text,
                  opacity: active ? 1 : 0.5,
                },
              ]}
            >
              {t(WEEKDAY_SHORT_KEYS[weekday])}
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
  cell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
});
