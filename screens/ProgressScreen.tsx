import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { useFocusEffect, useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import { APP_TEXT_MAX_FONT_SIZE_MULTIPLIER } from '../components/AppTextInput';
import { fontSize, radius, spacing, touchTarget } from '../utils/scale';
import { dayStampOf } from '../utils/today';
import {
  buildCalendarMarkers,
  hasChartableSeries,
  loadCalendarLogs,
  loadMainLiftSeries,
  loadProgressRoutines,
  loadRoutineProgress,
  loadWeekDetail,
  logsOnDate,
  type CalendarLogRow,
  type MainLiftPoint,
  type MainLiftSeries,
  type ProgressCycle,
  type ProgressRoutine,
  type ProgressWeek,
  type RoutineProgressData,
  type WeekDetailData,
} from '../utils/routineProgress';
import {
  loadExercisesWithHistory,
  loadExerciseSeries,
  type ExerciseSeries,
  type ExerciseSessionPoint,
  type ExerciseSummary,
} from '../utils/exerciseHistory';
import type { RoutineDatabase } from '../utils/routineActions';

const MONTH_KEYS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const WEEKDAY_SHORT_KEYS = [
  'weekdayShortSun',
  'weekdayShortMon',
  'weekdayShortTue',
  'weekdayShortWed',
  'weekdayShortThu',
  'weekdayShortFri',
  'weekdayShortSat',
] as const;

const formatWeight = (value: number): string => String(Number(value.toFixed(1)));

interface SelectedWeek {
  cycleId: number;
  cycleNumber: number;
  weekNumber: number;
}

export default function ProgressScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { dateFormat, firstWeekday } = useSettings();
  const { width } = useWindowDimensions();
  const db = useSQLiteContext();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();

  const [routines, setRoutines] = useState<ProgressRoutine[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [routineData, setRoutineData] = useState<RoutineProgressData | null>(null);
  const [series, setSeries] = useState<MainLiftSeries[]>([]);
  const [calendarLogs, setCalendarLogs] = useState<CalendarLogRow[]>([]);
  const [view, setView] = useState<'routine' | 'exercises'>('routine');
  const [exerciseSummaries, setExerciseSummaries] = useState<ExerciseSummary[]>([]);
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const [exerciseSeries, setExerciseSeries] = useState<ExerciseSeries | null>(null);
  const [weekDetail, setWeekDetail] = useState<SelectedWeek | null>(null);
  const [weekData, setWeekData] = useState<WeekDetailData | null>(null);
  const [dayPopup, setDayPopup] = useState<number | null>(null);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

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

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const load = async () => {
        const [loaded, logs, summaries] = await Promise.all([
          loadProgressRoutines(routineDb),
          loadCalendarLogs(routineDb),
          loadExercisesWithHistory(routineDb),
        ]);
        if (cancelled) {
          return;
        }
        setRoutines(loaded);
        setCalendarLogs(logs);
        setExerciseSummaries(summaries);
        const preferred =
          selectedId !== null && loaded.some((routine) => routine.routineId === selectedId)
            ? selectedId
            : (loaded.find((routine) => routine.isActive)?.routineId ??
              loaded[0]?.routineId ??
              null);
        setSelectedId((current) => (current === preferred ? current : preferred));
        const preferredExercise =
          selectedExercise !== null &&
          summaries.some((entry) => entry.name === selectedExercise)
            ? selectedExercise
            : (summaries[0]?.name ?? null);
        setSelectedExercise((current) =>
          current === preferredExercise ? current : preferredExercise,
        );
        if (preferred === null) {
          setRoutineData(null);
          setSeries([]);
          return;
        }
        const [data, liftSeries] = await Promise.all([
          loadRoutineProgress(routineDb, preferred),
          loadMainLiftSeries(routineDb, preferred),
        ]);
        if (!cancelled) {
          setRoutineData(data);
          setSeries(liftSeries);
        }
      };
      load().catch((error) => {
        console.error('Error loading progress:', error);
        if (!cancelled) {
          setRoutineData(null);
          setSeries([]);
          setCalendarLogs([]);
          setExerciseSummaries([]);
        }
      });
      return () => {
        cancelled = true;
      };
    }, [db, selectedId, selectedExercise]),
  );

  React.useEffect(() => {
    if (selectedExercise === null) {
      setExerciseSeries(null);
      return;
    }
    let cancelled = false;
    loadExerciseSeries(routineDb, selectedExercise)
      .then((series) => {
        if (!cancelled) {
          setExerciseSeries(series);
        }
      })
      .catch((error) => {
        console.error('Error loading the exercise history:', error);
        if (!cancelled) {
          setExerciseSeries(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [db, selectedExercise]);

  const markers = useMemo(() => buildCalendarMarkers(calendarLogs), [calendarLogs]);
  const formatDate = (stamp: number): string => {
    const date = new Date(stamp * 1000);
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = date.getUTCFullYear();
    return dateFormat === 'mm-dd-yyyy' ? `${mm}/${dd}/${yyyy}` : `${dd}/${mm}/${yyyy}`;
  };

  const shortDate = (stamp: number): string => {
    const date = new Date(stamp * 1000);
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    return dateFormat === 'mm-dd-yyyy' ? `${mm}/${dd}` : `${dd}/${mm}`;
  };

  const openWeekDetail = (cycle: ProgressCycle, week: ProgressWeek) => {
    setWeekData(null);
    setWeekDetail({ cycleId: cycle.cycleId, cycleNumber: cycle.cycleNumber, weekNumber: week.weekNumber });
  };

  React.useEffect(() => {
    if (weekDetail === null || selectedId === null) {
      setWeekData(null);
      return;
    }
    let cancelled = false;
    loadWeekDetail(routineDb, selectedId, weekDetail.cycleId, weekDetail.weekNumber)
      .then((data) => {
        if (!cancelled) {
          setWeekData(data);
        }
      })
      .catch((error) => {
        console.error('Error loading the week detail:', error);
        if (!cancelled) {
          setWeekDetail(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [db, weekDetail, selectedId]);

  const goToEditRoutine = () => {
    const routineId = weekData?.routineId ?? routineData?.routine.routineId;
    setWeekDetail(null);
    setWeekData(null);
    if (routineId !== undefined) {
      navigation.navigate('Routines', {
        screen: 'EditRoutine',
        params: { routineId },
      });
    }
  };

  const goToFreeLogging = () => {
    navigation.navigate('Today', { screen: 'FreeLogging' });
  };

  const chartLabels = (points: readonly MainLiftPoint[]): string[] => {
    const max = 6;
    if (points.length <= max) {
      return points.map((point) => shortDate(point.date));
    }
    const labels = points.map(() => '');
    const indices = new Set<number>([0, points.length - 1]);
    const step = Math.max(1, Math.floor(points.length / max));
    for (let index = step; index < points.length - 1; index += step) {
      indices.add(index);
    }
    for (const index of indices) {
      labels[index] = shortDate(points[index].date);
    }
    return labels;
  };

  const renderRoutineChip = (routine: ProgressRoutine) => {
    const selected = routine.routineId === selectedId;
    const active = routine.isActive;
    return (
      <Pressable
        key={routine.routineId}
        style={({ pressed }) => [
          styles.chip,
          { borderColor: theme.border },
          selected && { backgroundColor: theme.buttonBackground, borderColor: theme.buttonBackground },
          pressed && styles.pressed,
        ]}
        onPress={() => setSelectedId(routine.routineId)}
        accessibilityRole="button"
      >
        <Text
          maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          style={[
            styles.chipText,
            { color: theme.text },
            selected && { color: theme.buttonText },
          ]}
          numberOfLines={1}
        >
          {active ? `${routine.name} (${t('activeRoutine')})` : routine.name}
        </Text>
      </Pressable>
    );
  };

  const renderWeekCell = (cycle: ProgressCycle, week: ProgressWeek) => {
    const tappable = week.resolved && !week.isCurrent;
    const label = `${week.adherence.completed + week.adherence.moved + week.adherence.discarded}/${week.adherence.planned}`;
    return (
      <Pressable
        key={week.weekNumber}
        style={({ pressed }) => [
          styles.weekCell,
          { borderColor: theme.border, backgroundColor: theme.card },
          week.isCurrent && {
            borderColor: theme.buttonBackground,
            borderWidth: 2,
            backgroundColor: theme.buttonBackground,
          },
          !tappable && styles.dimmed,
          pressed && tappable && styles.pressed,
        ]}
        disabled={!tappable}
        onPress={() => openWeekDetail(cycle, week)}
        accessibilityRole="button"
      >
        <Text
          maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          style={[styles.weekNumber, { color: week.isCurrent ? theme.buttonText : theme.text }]}
        >
          {week.weekNumber}
        </Text>
        <Text
          maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          style={[styles.weekAdherence, { color: week.isCurrent ? theme.buttonText : theme.text }]}
        >
          {label}
        </Text>
        {week.isCurrent && (
          <Text
            maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
            style={[styles.currentBadge, { color: theme.buttonText }]}
          >
            {t('progressCurrentWeek')}
          </Text>
        )}
      </Pressable>
    );
  };

  const renderCycleCard = (cycle: ProgressCycle, weeks: readonly ProgressWeek[]) => (
    <View
      key={cycle.cycleId}
      style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
    >
      <View style={styles.cycleHeader}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>
          {t('progressCycleHeader', { n: cycle.cycleNumber })}
        </Text>
        {cycle.status === 'complete' && (
          <Text
            maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
            style={[styles.statusText, { color: theme.text }]}
          >
            {t('reviewCycleComplete')}
          </Text>
        )}
      </View>
      <View style={styles.weekRow}>{weeks.map((week) => renderWeekCell(cycle, week))}</View>
    </View>
  );

  const renderLiftChart = (entry: MainLiftSeries) => {
    const points = entry.points;
    const chartWidth = Math.max(200, width - spacing.gutter * 2 - spacing.card * 2);
    if (points.length === 0) {
      return (
        <View
          key={entry.exerciseName}
          style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
        >
          <Text style={[styles.cardTitle, { color: theme.text }]}>{entry.exerciseName}</Text>
          <Text style={[styles.helper, { color: theme.text }]}>{t('progressNoData')}</Text>
        </View>
      );
    }
    if (!hasChartableSeries(points)) {
      const point = points[0];
      return (
        <View
          key={entry.exerciseName}
          style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
        >
          <Text style={[styles.cardTitle, { color: theme.text }]}>{entry.exerciseName}</Text>
          <Text style={[styles.singlePoint, { color: theme.text }]}>
            {point === undefined
              ? ''
              : `${t('loadAbsoluteValue', {
                  weight: formatWeight(point.weight),
                  unit: entry.unit,
                })} · ${point.reps} ${t('repsPlaceholder')}`}
          </Text>
          <Text style={[styles.helper, { color: theme.text }]}>{t('progressSinglePoint')}</Text>
        </View>
      );
    }
    return (
      <View
        key={entry.exerciseName}
        style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
      >
        <Text style={[styles.cardTitle, { color: theme.text }]}>{entry.exerciseName}</Text>
        <LineChart
          data={{
            labels: chartLabels(points),
            datasets: [{ data: points.map((point) => point.weight) }],
          }}
          width={chartWidth}
          height={180}
          withShadow={false}
          withInnerLines
          withOuterLines
          withDots
          bezier={false}
          fromZero={false}
          yAxisSuffix={` ${entry.unit}`}
          chartConfig={{
            backgroundColor: theme.card,
            backgroundGradientFrom: theme.card,
            backgroundGradientTo: theme.card,
            decimalPlaces: 1,
            color: () => theme.buttonBackground,
            labelColor: () => theme.text,
            propsForDots: {
              r: '3',
              strokeWidth: '1',
              stroke: theme.border,
            },
          }}
          style={styles.chart}
        />
      </View>
    );
  };

  const renderExerciseChip = (entry: ExerciseSummary) => {
    const selected = entry.name === selectedExercise;
    return (
      <Pressable
        key={entry.name}
        style={({ pressed }) => [
          styles.chip,
          { borderColor: theme.border },
          selected && { backgroundColor: theme.buttonBackground, borderColor: theme.buttonBackground },
          pressed && styles.pressed,
        ]}
        onPress={() => setSelectedExercise(entry.name)}
        accessibilityRole="button"
      >
        <Text
          maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          style={[
            styles.chipText,
            { color: theme.text },
            selected && { color: theme.buttonText },
          ]}
          numberOfLines={1}
        >
          {entry.name}
        </Text>
      </Pressable>
    );
  };

  const renderMetricChart = (
    titleKey: string,
    points: readonly ExerciseSessionPoint[],
    unit: string,
    valueOf: (point: ExerciseSessionPoint) => number,
  ) => {
    const chartWidth = Math.max(200, width - spacing.gutter * 2 - spacing.card * 2);
    if (points.length === 0) {
      return (
        <View
          style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
        >
          <Text style={[styles.cardTitle, { color: theme.text }]}>{t(titleKey)}</Text>
          <Text style={[styles.helper, { color: theme.text }]}>{t('progressNoData')}</Text>
        </View>
      );
    }
    if (!hasChartableSeries(points)) {
      const point = points[0];
      return (
        <View
          style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
        >
          <Text style={[styles.cardTitle, { color: theme.text }]}>{t(titleKey)}</Text>
          <Text style={[styles.singlePoint, { color: theme.text }]}>
            {point === undefined
              ? ''
              : `${formatWeight(valueOf(point))} ${unit}`}
          </Text>
          <Text style={[styles.helper, { color: theme.text }]}>{t('progressSinglePoint')}</Text>
        </View>
      );
    }
    return (
      <View
        style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
      >
        <Text style={[styles.cardTitle, { color: theme.text }]}>{t(titleKey)}</Text>
        <LineChart
          data={{
            labels: chartLabels(points),
            datasets: [{ data: points.map(valueOf) }],
          }}
          width={chartWidth}
          height={180}
          withShadow={false}
          withInnerLines
          withOuterLines
          withDots
          bezier={false}
          fromZero={false}
          yAxisSuffix={` ${unit}`}
          chartConfig={{
            backgroundColor: theme.card,
            backgroundGradientFrom: theme.card,
            backgroundGradientTo: theme.card,
            decimalPlaces: 1,
            color: () => theme.buttonBackground,
            labelColor: () => theme.text,
            propsForDots: {
              r: '3',
              strokeWidth: '1',
              stroke: theme.border,
            },
          }}
          style={styles.chart}
        />
      </View>
    );
  };

  const renderExerciseHistory = () => {
    if (exerciseSummaries.length === 0) {
      return (
        <View
          style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
        >
          <Text style={[styles.cardTitle, { color: theme.text }]}>
            {t('progressExerciseHistory')}
          </Text>
          <Text style={[styles.helper, { color: theme.text }]}>{t('progressHistoryNone')}</Text>
        </View>
      );
    }
    return (
      <>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>
          {t('progressExerciseHistory')}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {exerciseSummaries.map(renderExerciseChip)}
        </ScrollView>
        {exerciseSeries === null || exerciseSeries.exerciseName !== selectedExercise ? null : (
          <>
            {exerciseSeries.mixedUnits && (
              <Text style={[styles.helper, { color: theme.text }]}>
                {t('progressHistoryMixedUnits')}
              </Text>
            )}
            {renderMetricChart(
              'progressLoadOverTime',
              exerciseSeries.points,
              exerciseSeries.unit,
              (point) => point.weight,
            )}
            {renderMetricChart(
              'progressEstimated1rm',
              exerciseSeries.points,
              exerciseSeries.unit,
              (point) => point.estimated1RM,
            )}
            {renderMetricChart(
              'progressVolume',
              exerciseSeries.points,
              exerciseSeries.unit,
              (point) => point.volume,
            )}
          </>
        )}
      </>
    );
  };

  const statusChip = (status: WeekDetailData['sessionStatuses'][number]['status']) => {
    const key =
      status === 'completed'
        ? 'progressStatusCompleted'
        : status === 'moved'
          ? 'progressStatusMoved'
          : status === 'discarded'
            ? 'progressStatusDiscarded'
            : '';
    if (key === '') {
      return null;
    }
    return (
      <Text
        maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        style={[styles.statusText, { color: theme.text }]}
      >
        {t(key)}
      </Text>
    );
  };

  const renderWeekDetail = () => {
    if (weekDetail === null || weekData === null) {
      return null;
    }
    return (
      <Modal
        visible
        animationType="slide"
        onRequestClose={() => {
          setWeekDetail(null);
          setWeekData(null);
        }}
      >
        <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={[styles.modalHeader, { borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]} numberOfLines={1}>
              {weekData.routineName}
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}
              onPress={() => {
                setWeekDetail(null);
                setWeekData(null);
              }}
              accessibilityRole="button"
            >
              <Ionicons name="close" size={24} color={theme.text} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalContent}>
            <Text style={[styles.modalSubtitle, { color: theme.text }]}>
              {t('progressWeekDetailTitle', {
                week: weekData.weekNumber,
                cycle: weekData.cycleNumber,
              })}
            </Text>
            {weekData.planned.map((session) => {
              const status = weekData.sessionStatuses.find(
                (entry) => entry.sessionId === session.sessionId,
              )?.status;
              const logged = weekData.logged.find(
                (entry) => entry.sessionId === session.sessionId,
              );
              return (
                <View
                  key={session.sessionId}
                  style={[
                    styles.card,
                    { backgroundColor: theme.card, borderColor: theme.border },
                  ]}
                >
                  <View style={styles.cycleHeader}>
                    <Text style={[styles.cardTitle, { color: theme.text }]}>{session.name}</Text>
                    {status !== undefined && statusChip(status)}
                  </View>
                  <View style={styles.compareRow}>
                    <View style={styles.compareColumn}>
                      <Text style={[styles.columnHeader, { color: theme.text }]}>
                        {t('progressPlanned')}
                      </Text>
                      {session.exercises.map((exercise) => (
                        <View key={exercise.sessionExerciseId} style={styles.compareItem}>
                          <Text style={[styles.exerciseName, { color: theme.text }]}>
                            {exercise.name}
                          </Text>
                          <Text style={[styles.exerciseDetail, { color: theme.text }]}>
                            {`${exercise.targetSets} × ${exercise.targetReps}${exercise.isAmrap ? '+' : ''}`}
                            {exercise.targetWeight === null
                              ? ` · ${t('loadBodyweight')}`
                              : ` · ${t('loadAbsoluteValue', {
                                  weight: formatWeight(exercise.targetWeight),
                                  unit: exercise.unit,
                                })}`}
                          </Text>
                        </View>
                      ))}
                    </View>
                    {logged !== undefined && (
                      <View style={styles.compareColumn}>
                        <Text style={[styles.columnHeader, { color: theme.text }]}>
                          {t('progressLogged')}
                        </Text>
                        {logged.exercises.map((exercise) => (
                          <View key={exercise.exerciseName} style={styles.compareItem}>
                            <Text style={[styles.exerciseName, { color: theme.text }]}>
                              {exercise.exerciseName}
                            </Text>
                            {exercise.sets.map((set) => (
                              <Text
                                key={set.setNumber}
                                style={[styles.exerciseDetail, { color: theme.text }]}
                              >
                                {`${set.setNumber}: ${formatWeight(set.weight)} ${set.unit} × ${set.reps}`}
                              </Text>
                            ))}
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </ScrollView>
          <View style={[styles.actionBar, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: theme.buttonBackground },
                pressed && styles.pressed,
              ]}
              onPress={goToEditRoutine}
              accessibilityRole="button"
            >
              <Text style={[styles.primaryButtonText, { color: theme.buttonText }]}>
                {t('progressEditRoutine')}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  };

  const renderCalendar = () => {
    const start = firstWeekday === 'Monday' ? 1 : 0;
    const orderedWeekdays = Array.from({ length: 7 }, (_, index) => (start + index) % 7);
    const firstDayOfMonth = new Date(month.year, month.month, 1).getDay();
    const daysInMonth = new Date(month.year, month.month + 1, 0).getDate();
    const leadingBlanks = (firstDayOfMonth - start + 7) % 7;
    const todayStamp = dayStampOf(new Date());
    const cells: (number | null)[] = [
      ...Array.from({ length: leadingBlanks }, () => null),
      ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
    ];
    while (cells.length % 7 !== 0) {
      cells.push(null);
    }

    const prevMonth = () => {
      setMonth((current) =>
        current.month === 0
          ? { year: current.year - 1, month: 11 }
          : { year: current.year, month: current.month - 1 },
      );
    };
    const nextMonth = () => {
      setMonth((current) =>
        current.month === 11
          ? { year: current.year + 1, month: 0 }
          : { year: current.year, month: current.month + 1 },
      );
    };

    return (
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <View style={styles.monthHeader}>
          <Pressable
            style={({ pressed }) => [styles.monthNav, pressed && styles.pressed]}
            onPress={prevMonth}
            accessibilityRole="button"
            accessibilityLabel={t('progressPreviousMonth')}
          >
            <Ionicons name="chevron-back" size={20} color={theme.text} />
          </Pressable>
          <Text style={[styles.monthTitle, { color: theme.text }]}>
            {`${t(MONTH_KEYS[month.month])} ${month.year}`}
          </Text>
          <Pressable
            style={({ pressed }) => [styles.monthNav, pressed && styles.pressed]}
            onPress={nextMonth}
            accessibilityRole="button"
            accessibilityLabel={t('progressNextMonth')}
          >
            <Ionicons name="chevron-forward" size={20} color={theme.text} />
          </Pressable>
        </View>
        <View style={styles.weekdayRow}>
          {orderedWeekdays.map((weekday) => (
            <Text
              key={weekday}
              maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              style={[styles.weekdayLetter, { color: theme.text }]}
            >
              {t(WEEKDAY_SHORT_KEYS[weekday])}
            </Text>
          ))}
        </View>
        <View style={styles.calendarGrid}>
          {cells.map((day, index) => {
            if (day === null) {
              return <View key={`blank-${index}`} style={styles.dayCell} />;
            }
            const stamp = dayStampOf(new Date(month.year, month.month, day));
            const count = markers.get(stamp) ?? 0;
            const isToday = stamp === todayStamp;
            return (
              <Pressable
                key={stamp}
                style={({ pressed }) => [
                  styles.dayCell,
                  isToday && { borderColor: theme.buttonBackground, borderWidth: 2 },
                  pressed && count > 0 && styles.pressed,
                ]}
                disabled={count === 0}
                onPress={() => setDayPopup(stamp)}
                accessibilityRole="button"
                accessibilityLabel={formatDate(stamp)}
              >
                <Text
                  maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                  style={[styles.dayNumber, { color: theme.text }]}
                >
                  {day}
                </Text>
                <View style={styles.dotRow}>
                  {Array.from({ length: Math.min(count, 3) }, (_, dotIndex) => (
                    <View
                      key={dotIndex}
                      style={[styles.dot, { backgroundColor: theme.buttonBackground }]}
                    />
                  ))}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  };

  const renderDayPopup = () => {
    if (dayPopup === null) {
      return null;
    }
    const logs = logsOnDate(calendarLogs, dayPopup);
    return (
      <Modal
        visible
        transparent
        animationType="fade"
        onRequestClose={() => setDayPopup(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setDayPopup(null)}>
          <Pressable
            style={[styles.popupCard, { backgroundColor: theme.card, borderColor: theme.border }]}
            onPress={() => {}}
          >
            <Text style={[styles.cardTitle, { color: theme.text }]}>
              {t('progressLogsOn', { date: formatDate(dayPopup) })}
            </Text>
            <View style={styles.popupList}>
              {logs.map((log) => (
                <View key={log.workoutLogId} style={styles.popupRow}>
                  <Text style={[styles.exerciseName, { color: theme.text }]} numberOfLines={1}>
                    {log.workoutName}
                  </Text>
                  <Text style={[styles.exerciseDetail, { color: theme.text }]} numberOfLines={1}>
                    {log.dayName}
                  </Text>
                </View>
              ))}
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.secondaryButton,
                { borderColor: theme.border },
                pressed && styles.pressed,
              ]}
              onPress={() => setDayPopup(null)}
              accessibilityRole="button"
            >
              <Text style={[styles.secondaryButtonText, { color: theme.text }]}>{t('Cancel')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>{t('progress')}</Text>

        <View style={styles.viewSwitcher}>
          <Pressable
            style={({ pressed }) => [
              styles.viewSwitchChip,
              { borderColor: theme.border },
              view === 'routine' && {
                backgroundColor: theme.buttonBackground,
                borderColor: theme.buttonBackground,
              },
              pressed && styles.pressed,
            ]}
            onPress={() => setView('routine')}
            accessibilityRole="button"
          >
            <Text
              maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              style={[
                styles.chipText,
                { color: theme.text },
                view === 'routine' && { color: theme.buttonText },
              ]}
            >
              {t('progressViewRoutine')}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.viewSwitchChip,
              { borderColor: theme.border },
              view === 'exercises' && {
                backgroundColor: theme.buttonBackground,
                borderColor: theme.buttonBackground,
              },
              pressed && styles.pressed,
            ]}
            onPress={() => setView('exercises')}
            accessibilityRole="button"
          >
            <Text
              maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              style={[
                styles.chipText,
                { color: theme.text },
                view === 'exercises' && { color: theme.buttonText },
              ]}
            >
              {t('progressViewExercises')}
            </Text>
          </Pressable>
        </View>

        {view === 'routine' ? (
          <>
            {routines.length > 0 && (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  {routines.map(renderRoutineChip)}
                </ScrollView>

                {routineData === null || routineData.routine.routineId !== selectedId ? null : (
                  <>
                    {routineData.cycles.length === 0 ? (
                      <View
                        style={[
                          styles.card,
                          { backgroundColor: theme.card, borderColor: theme.border },
                        ]}
                      >
                        <Text style={[styles.cardTitle, { color: theme.text }]}>
                          {routineData.routine.name}
                        </Text>
                        <Text style={[styles.helper, { color: theme.text }]}>
                          {t('progressNoCycles')}
                        </Text>
                      </View>
                    ) : (
                      routineData.cycles.map((cycleView) =>
                        renderCycleCard(cycleView.cycle, cycleView.weeks),
                      )
                    )}

                    <Text style={[styles.sectionTitle, { color: theme.text }]}>
                      {t('progressMainLifts')}
                    </Text>
                    {series.map(renderLiftChart)}

                    <Pressable
                      style={({ pressed }) => [
                        styles.secondaryButton,
                        styles.freeLoggingButton,
                        { borderColor: theme.border },
                        pressed && styles.pressed,
                      ]}
                      onPress={goToFreeLogging}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.secondaryButtonText, { color: theme.text }]}>
                        {t('freeLogging')}
                      </Text>
                    </Pressable>
                  </>
                )}
              </>
            )}

            {routines.length === 0 && (
              <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>{t('progress')}</Text>
                <Text style={[styles.helper, { color: theme.text }]}>{t('progressNoRoutines')}</Text>
                <Pressable
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { backgroundColor: theme.buttonBackground },
                    pressed && styles.pressed,
                  ]}
                  onPress={goToFreeLogging}
                  accessibilityRole="button"
                >
                  <Text style={[styles.primaryButtonText, { color: theme.buttonText }]}>
                    {t('freeLogging')}
                  </Text>
                </Pressable>
              </View>
            )}

            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              {t('progressCalendar')}
            </Text>
            {renderCalendar()}
          </>
        ) : (
          renderExerciseHistory()
        )}
      </ScrollView>
      {renderWeekDetail()}
      {renderDayPopup()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.gutter,
    paddingBottom: spacing.section * 2,
  },
  title: {
    fontSize: fontSize.screenTitle,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: spacing.section,
  },
  sectionTitle: {
    fontSize: fontSize.sectionTitle,
    fontWeight: '900',
    marginTop: spacing.section,
    marginBottom: spacing.card,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.inline,
    marginBottom: spacing.section,
  },
  viewSwitcher: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.inline,
    marginBottom: spacing.section,
  },
  viewSwitchChip: {
    flex: 1,
    maxWidth: 220,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.card,
    minHeight: touchTarget.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.card,
    minHeight: touchTarget.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.card,
    padding: spacing.card,
    marginBottom: spacing.cardGap,
  },
  cardTitle: {
    fontSize: fontSize.cardTitle,
    fontWeight: '700',
  },
  cycleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.card,
  },
  statusText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    opacity: 0.7,
  },
  weekRow: {
    flexDirection: 'row',
    gap: spacing.inline,
  },
  weekCell: {
    flex: 1,
    borderRadius: radius.control,
    borderWidth: 1,
    paddingVertical: spacing.label,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: touchTarget.control,
  },
  weekNumber: {
    fontSize: fontSize.cardTitle,
    fontWeight: '900',
  },
  weekAdherence: {
    fontSize: fontSize.caption,
    opacity: 0.8,
  },
  currentBadge: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    textAlign: 'center',
  },
  dimmed: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.5,
  },
  helper: {
    fontSize: fontSize.helper,
    opacity: 0.7,
    marginTop: spacing.label,
  },
  singlePoint: {
    fontSize: fontSize.body,
    fontWeight: '700',
    marginTop: spacing.card,
  },
  chart: {
    marginTop: spacing.card,
    marginLeft: -spacing.card,
  },
  primaryButton: {
    borderRadius: radius.control,
    paddingHorizontal: spacing.card,
    paddingVertical: spacing.card,
    minHeight: touchTarget.control,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.card,
  },
  secondaryButton: {
    borderRadius: radius.control,
    borderWidth: 1,
    paddingHorizontal: spacing.card,
    paddingVertical: spacing.card,
    minHeight: touchTarget.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
  secondaryButtonText: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
  freeLoggingButton: {
    marginTop: spacing.card,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.card,
  },
  modalTitle: {
    fontSize: fontSize.cardTitle,
    fontWeight: '700',
    flex: 1,
  },
  modalSubtitle: {
    fontSize: fontSize.helper,
    opacity: 0.7,
    textAlign: 'center',
    marginBottom: spacing.section,
  },
  closeButton: {
    width: touchTarget.icon,
    height: touchTarget.icon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: {
    padding: spacing.gutter,
    paddingBottom: spacing.section * 2,
  },
  compareRow: {
    flexDirection: 'row',
    gap: spacing.card,
  },
  compareColumn: {
    flex: 1,
  },
  columnHeader: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    opacity: 0.7,
    marginBottom: spacing.label,
  },
  compareItem: {
    marginBottom: spacing.card,
  },
  exerciseName: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  exerciseDetail: {
    fontSize: fontSize.helper,
    opacity: 0.8,
  },
  actionBar: {
    borderTopWidth: 1,
    padding: spacing.card,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.card,
  },
  monthNav: {
    width: touchTarget.icon,
    height: touchTarget.icon,
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
  weekdayLetter: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.caption,
    fontWeight: '600',
    opacity: 0.7,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.285714%',
    aspectRatio: 1,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  dayNumber: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  dotRow: {
    flexDirection: 'row',
    gap: 2,
    marginTop: 2,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.gutter,
  },
  popupCard: {
    width: '100%',
    maxWidth: 400,
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.card,
  },
  popupList: {
    marginTop: spacing.card,
    gap: spacing.cardGap,
  },
  popupRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.inline,
  },
});
