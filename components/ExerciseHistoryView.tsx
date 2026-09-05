import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { ChartRangeControl } from './ChartRangeControl';
import { ProgressChart } from './ProgressChart';
import { Row } from './Row';
import { Section } from './Section';
import { fontSize, spacing, tabBar } from '../utils/scale';
import { windowByRange, type ChartRange } from '../utils/chart';
import {
  loadExerciseUnitHistory,
  type ExerciseUnitHistory,
} from '../utils/exerciseHistory';
import type { RoutineDatabase } from '../utils/routineActions';

/**
 * P4 — one exercise's history, and the only place it is drawn.
 *
 * *"Los ejercicios se deslizan hacia la derecha para buscarlos."* The catalog carousel is gone;
 * this view is the destination the search list, R2's exercise sheet and every exercise row in the
 * app arrive at, and it is keyed on the catalog exercise name, so it covers every routine and
 * every free session at once (`loadExerciseUnitHistory`).
 *
 * Three charts — load, estimated 1RM, volume (P3) — through **one date range** the user picks
 * once for all of them. One chart per metric **per unit**: a run of kg followed by a machine read
 * in lb is two series and is drawn as two, never as one line that changes meaning halfway
 * (§3.5 — nothing is converted, ever).
 *
 * It owns its own loading, as R2's sheet does, so a surface that wants to show an exercise's
 * history needs to know its name and nothing else about the schema.
 */

export type ExerciseHistoryViewProps = {
  exerciseName: string;
  range: ChartRange;
  onChangeRange: (range: ChartRange) => void;
  onBack: () => void;
  /** Opens R2's shared sheet for this exercise — the description, from the chart. */
  onOpenSheet: (exerciseName: string) => void;
  /** Today, as a whole-day stamp: the anchor every range is measured back from. */
  todayStamp: number;
  /** The screen's long-date formatter, so one screen has one date voice. */
  formatDate: (stamp: number) => string;
  /** Bumped by the caller when a logged set is corrected elsewhere. */
  revision?: number;
  testID?: string;
};

export function ExerciseHistoryView({
  exerciseName,
  range,
  onChangeRange,
  onBack,
  onOpenSheet,
  todayStamp,
  formatDate,
  revision,
  testID,
}: ExerciseHistoryViewProps) {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const db = useSQLiteContext();

  const [history, setHistory] = useState<ExerciseUnitHistory | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);

    const routineDb: RoutineDatabase = {
      run: (sql, params) => db.runAsync(sql, (params ?? []) as never[]),
      get: async (sql, params) =>
        (await db.getFirstAsync<Record<string, unknown>>(
          sql,
          (params ?? []) as never[],
        )) ?? undefined,
      getAll: async (sql, params) =>
        db.getAllAsync<Record<string, unknown>>(sql, (params ?? []) as never[]),
    };

    loadExerciseUnitHistory(routineDb, exerciseName)
      .then((loaded) => {
        if (!cancelled) {
          setHistory(loaded);
        }
      })
      .catch((error: unknown) => {
        console.error('Error loading the exercise history:', error);
        if (!cancelled) {
          setHistory({ exerciseName, mixedUnits: false, series: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [db, exerciseName, revision]);

  const allPoints = (history?.series ?? []).flatMap((entry) => entry.points);
  const sessions = allPoints.length;
  const lastDate =
    sessions === 0 ? null : Math.max(...allPoints.map((point) => point.date));

  // A range other than "todo" can be empty or hold a single point while the exercise has fifty
  // sessions behind it, so it says "in this range" rather than "ever".
  const emptyLabel = range === 'all' ? t('progressNoData') : t('progressNoDataInRange');
  const singlePointLabel =
    range === 'all' ? t('progressSinglePoint') : t('progressSinglePointInRange');

  const chartTitle = (key: string, unit: string): string =>
    history !== null && history.series.length > 1
      ? t('progressChartInUnit', { title: t(key), unit })
      : t(key);

  return (
    <View testID={testID ?? 'exercise-history'}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('progressBackToRoutine')}
          style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
          testID="exercise-history-back"
        >
          <Ionicons name="chevron-back" size={tabBar.icon} color={tokens.textPrimary} />
          <Text style={[styles.backLabel, { color: tokens.textPrimary }]}>
            {t('progressBackToRoutine')}
          </Text>
        </Pressable>
        <Text style={[styles.overline, { color: tokens.textSecondary }]}>
          {t('progressExerciseHistory')}
        </Text>
        <Text style={[styles.name, { color: tokens.textPrimary }]}>{exerciseName}</Text>
        {history !== null && (
          <Text style={[styles.helper, { color: tokens.textSecondary }]}>
            {lastDate === null
              ? t('progressNoData')
              : t('progressExerciseSessionsLine', {
                  count: sessions,
                  date: formatDate(lastDate),
                })}
          </Text>
        )}
        {history?.mixedUnits === true && (
          <Text style={[styles.helper, { color: tokens.textSecondary }]}>
            {t('progressHistoryMixedUnits')}
          </Text>
        )}
      </View>

      <Section title={t('progressRange')} testID="exercise-history-range">
        <ChartRangeControl
          value={range}
          onChange={onChangeRange}
          testID="exercise-history-range-control"
        />
      </Section>

      {history === null ? (
        <ActivityIndicator color={tokens.accent} />
      ) : (
        history.series.map((entry) => {
          const points = windowByRange(entry.points, range, todayStamp);
          return (
            <Section
              key={entry.unit}
              title={
                history.series.length > 1
                  ? t('progressSeriesInUnit', { unit: entry.unit })
                  : undefined
              }
              testID={`exercise-history-${entry.unit}`}
            >
              <ProgressChart
                title={chartTitle('progressLoadOverTime', entry.unit)}
                dates={points.map((point) => point.date)}
                series={[
                  {
                    key: 'load',
                    label: chartTitle('progressLoadOverTime', entry.unit),
                    color: tokens.data.series[0],
                    values: points.map((point) => point.weight),
                  },
                ]}
                unit={entry.unit}
                range={range}
                emptyLabel={emptyLabel}
                singlePointLabel={singlePointLabel}
                testID={`exercise-history-load-${entry.unit}`}
              />
              <ProgressChart
                title={chartTitle('progressEstimated1rm', entry.unit)}
                dates={points.map((point) => point.date)}
                series={[
                  {
                    key: '1rm',
                    label: chartTitle('progressEstimated1rm', entry.unit),
                    color: tokens.data.series[0],
                    values: points.map((point) => point.estimated1RM),
                  },
                ]}
                unit={entry.unit}
                range={range}
                emptyLabel={emptyLabel}
                singlePointLabel={singlePointLabel}
                testID={`exercise-history-1rm-${entry.unit}`}
              />
              <ProgressChart
                title={chartTitle('progressVolume', entry.unit)}
                dates={points.map((point) => point.date)}
                series={[
                  {
                    key: 'volume',
                    label: chartTitle('progressVolume', entry.unit),
                    color: tokens.data.series[0],
                    values: points.map((point) => point.volume),
                  },
                ]}
                unit={entry.unit}
                range={range}
                emptyLabel={emptyLabel}
                singlePointLabel={singlePointLabel}
                testID={`exercise-history-volume-${entry.unit}`}
              />
            </Section>
          );
        })
      )}

      <Section testID="exercise-history-actions">
        <Row
          label={t('progressOpenExerciseInfo')}
          right={
            <Ionicons
              name="information-circle-outline"
              size={tabBar.icon}
              color={tokens.textSecondary}
            />
          }
          onPress={() => onOpenSheet(exerciseName)}
          testID="exercise-history-open-sheet"
        />
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.section,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
    marginBottom: spacing.cardGap,
  },
  backLabel: {
    fontSize: fontSize.body,
  },
  overline: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  name: {
    fontSize: fontSize.screenTitle,
    fontWeight: '700',
    marginTop: spacing.label,
  },
  helper: {
    fontSize: fontSize.helper,
    marginTop: spacing.label,
  },
});
