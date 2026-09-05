import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { APP_TEXT_MAX_FONT_SIZE_MULTIPLIER } from './AppTextInput';
import { hexWithOpacity, type DataStateKey } from '../utils/theme';
import { dataMark, fontSize, spacing, touchTarget } from '../utils/scale';
import type { InicioDay, InicioDayStatus, InicioSessionTarget } from '../utils/inicio';

/**
 * "Esta semana"'s week strip (SPEC.md U2, ADR-0047 §4.1): a coloured disc per day, told apart the
 * same two ways Progreso's calendar uses — a tinted `data.state` fill and a glyph, never colour
 * alone — with today rung in `textPrimary` independently of whatever state the day also carries.
 *
 * Unlike the calendar there is **no legend row**: seven cells are the whole point, and a legend
 * under them would be exactly the "box under the box" this iteration is removing elsewhere. A
 * long-press names the day instead, in a one-line caption that appears under the row and clears
 * itself — a tooltip without inventing a tooltip primitive.
 *
 * Only a resolved day (`completed`/`moved`/`discarded`) is tappable, opening the same session
 * sheet the calendar does (`day.target !== null` — computed once in `utils/inicio.ts`, not
 * re-derived here); `pending` and `rest` are inert, nothing has happened there to open.
 *
 * **Every cell shares one outer footprint** (`DISC_SIZE`, the same box `touchTarget.icon` used
 * everywhere else) so today's ring lands in the same place regardless of what the day carries —
 * found on review: a `pending` day drawn as a bare glyph, with no disc at all, read as a "tiny o"
 * next to the filled discs beside it. `pending` now draws that same box as a hollow ring
 * (`divider`, no fill — an un-happened day is the *absence* of colour, ADR-0047), which is a real
 * ring rather than a character standing in for one. `rest` stays visually quiet on purpose — it
 * is not a training day to weigh equally against the four that are — as a small dot at
 * `dataMark.dot`, the same token the app's other identity dots already use, centred inside that
 * same outer box.
 */

/** Only the resolved statuses carry a glyph; `pending`'s ring and `rest`'s dot need no character. */
const GLYPH: Partial<Record<InicioDayStatus, string>> = {
  completed: '✓',
  moved: '→',
  discarded: '✕',
};

/** `pending`/`rest` carry no `data.state` entry — an unhappened day is the absence of colour. */
const STATE_KEY: Partial<Record<InicioDayStatus, DataStateKey>> = {
  completed: 'done',
  moved: 'moved',
  discarded: 'discarded',
};

const DISC_FILL_OPACITY = 0.22;
const CAPTION_TIMEOUT_MS = 2500;

export type WeekOverviewProps = {
  days: readonly InicioDay[];
  todayStamp: number;
  weekdayLabels: readonly string[];
  statusLabels: Readonly<Record<InicioDayStatus, string>>;
  onSelectDay: (target: InicioSessionTarget) => void;
  testID?: string;
};

export function WeekOverview({
  days,
  todayStamp,
  weekdayLabels,
  statusLabels,
  onSelectDay,
  testID,
}: WeekOverviewProps) {
  const { tokens } = useTheme();
  const [captionIndex, setCaptionIndex] = useState<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    },
    [],
  );

  const showCaption = (index: number) => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
    }
    setCaptionIndex(index);
    timeoutRef.current = setTimeout(() => setCaptionIndex(null), CAPTION_TIMEOUT_MS);
  };

  const discFill = (status: InicioDayStatus): string | null => {
    const key = STATE_KEY[status];
    return key === undefined ? null : hexWithOpacity(tokens.data.state[key], DISC_FILL_OPACITY);
  };

  const glyphColor = (status: InicioDayStatus): string =>
    status === 'completed' || status === 'moved' ? tokens.textPrimary : tokens.textSecondary;

  const caption = captionIndex === null ? null : days[captionIndex];

  return (
    <View testID={testID}>
      <View style={styles.dayRow}>
        {days.map((day, index) => {
          const isToday = day.stamp === todayStamp;
          const isPending = day.status === 'pending';
          const isRest = day.status === 'rest';
          const fill = discFill(day.status);
          const glyph = GLYPH[day.status];
          const label = `${weekdayLabels[index]} · ${statusLabels[day.status]}`;
          return (
            <Pressable
              key={day.stamp}
              disabled={day.target === null}
              onPress={day.target === null ? undefined : () => onSelectDay(day.target as InicioSessionTarget)}
              onLongPress={() => showCaption(index)}
              accessibilityRole={day.target === null ? undefined : 'button'}
              accessibilityLabel={label}
              style={({ pressed }) => [
                styles.cell,
                pressed && day.target !== null && { backgroundColor: tokens.inputFill },
              ]}
              testID={testID === undefined ? undefined : `${testID}-day-${day.stamp}`}
            >
              <Text
                style={[styles.weekday, { color: tokens.textSecondary }]}
                maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              >
                {weekdayLabels[index]}
              </Text>
              <View
                style={[
                  styles.disc,
                  isPending && { borderColor: tokens.divider, borderWidth: 2 },
                  fill !== null && { backgroundColor: fill },
                  isToday && { borderColor: tokens.textPrimary, borderWidth: 2 },
                ]}
              >
                {isRest ? (
                  <View style={[styles.restDot, { backgroundColor: tokens.divider }]} />
                ) : (
                  glyph !== undefined && (
                    <Text
                      style={[styles.glyph, { color: glyphColor(day.status) }]}
                      maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                    >
                      {glyph}
                    </Text>
                  )
                )}
              </View>
            </Pressable>
          );
        })}
      </View>
      {caption !== null && (
        <Text
          style={[styles.caption, { color: tokens.textSecondary }]}
          testID={testID === undefined ? undefined : `${testID}-caption`}
        >
          {`${weekdayLabels[captionIndex as number]} · ${statusLabels[caption.status]}${
            caption.sessionName === null ? '' : ` · ${caption.sessionName}`
          }`}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dayRow: {
    flexDirection: 'row',
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.inline,
    paddingVertical: spacing.label,
  },
  weekday: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  disc: {
    width: touchTarget.icon,
    height: touchTarget.icon,
    borderRadius: touchTarget.icon / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  glyph: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  restDot: {
    width: dataMark.dot,
    height: dataMark.dot,
    borderRadius: dataMark.dot / 2,
  },
  caption: {
    fontSize: fontSize.caption,
    marginTop: spacing.label,
    textAlign: 'center',
  },
});
