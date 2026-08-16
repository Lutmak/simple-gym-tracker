import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import AppTextInput from '../components/AppTextInput';
import { EmptyState } from '../components/EmptyState';
import { ExerciseSheet } from '../components/ExerciseSheet';
import { ProgressCalendar } from '../components/ProgressCalendar';
import { ProgressChart } from '../components/ProgressChart';
import { Row } from '../components/Row';
import { Screen } from '../components/Screen';
import { Section } from '../components/Section';
import {
  SessionDetailSheet,
  type SessionDetailTarget,
} from '../components/SessionDetailSheet';
import { fontSize, spacing, tabBar } from '../utils/scale';
import { dayStampOf, loadSessionQueueInput } from '../utils/today';
import {
  computeInicioStreak,
  datePartsOfStamp,
  type InicioStreak,
} from '../utils/inicio';
import { calendarMonthIndex, monthOfStamp, weekdayOrder } from '../utils/calendar';
import {
  buildProgressCalendarDays,
  loadProgressCalendar,
  type ProgressCalendarDay,
  type ProgressDayState,
} from '../utils/progressCalendar';
import {
  cycleAdherence,
  hasProgressFocus,
  loadMainLiftSeries,
  loadProgressRoutines,
  loadRoutineProgress,
  weekSessionsDone,
  type MainLiftSeries,
  type ProgressCycle,
  type ProgressFocus,
  type ProgressRoutine,
  type ProgressWeek,
  type RoutineProgressData,
} from '../utils/routineProgress';
import {
  filterExerciseSummaries,
  loadExerciseSeries,
  loadExercisesWithHistory,
  type ExerciseSeries,
  type ExerciseSummary,
} from '../utils/exerciseHistory';
import type { RoutineDatabase } from '../utils/routineActions';
import type { RootTabParamList } from '../App';

/**
 * Progreso — one screen about the routine you are training (SPECS.md P1, P2).
 *
 * The two recorded defects were *"dos botones gigantes hasta arriba… tengo que mover la mano
 * incomodísimo"* and *"Ciclo 1, ciclo completado, un 1, un 3 de 3 — ¿qué estoy viendo? Estoy
 * perdido."* Both came from the same cause: the screen was two screens behind a segmented control,
 * and it printed numbers without ever saying what they counted.
 *
 * What replaced it:
 *
 * - **No mode switch.** The Rutina/Ejercicios control is gone. This screen is the active routine;
 *   an exercise's own history is one search away and one tap from R2's shared sheet.
 * - **Every number carries its noun.** `Semana 2 · 3 de 3 sesiones`, `Ciclo 1 · completado el
 *   12 de marzo · 16 de 16 sesiones (100 %)`. There is no bare `3 de 3` anywhere (§0.5).
 * - **One primitive per repeated thing.** Every week of every cycle is the same `Row`, so cycle 1
 *   and cycle 2 cannot look different from each other, which they did.
 * - **The calendar is first-class**, above the cycle history rather than at the bottom of a scroll,
 *   and every marked day opens its session through the same `Sheet` a week opens through.
 *
 * The screen holds no rules: cycles, adherence, day states and the streak all come from
 * `utils/routineProgress.ts`, `utils/progressCalendar.ts` and `utils/inicio.ts`, which are tested
 * without a device.
 */

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

const WEEKDAY_FULL_KEYS = [
  'weekdayFullSun',
  'weekdayFullMon',
  'weekdayFullTue',
  'weekdayFullWed',
  'weekdayFullThu',
  'weekdayFullFri',
  'weekdayFullSat',
] as const;

/** The search field lists what fits on a phone, not the whole catalog. */
const MAX_SEARCH_RESULTS = 8;

type Props = BottomTabScreenProps<RootTabParamList, 'Progress'>;

export default function ProgressScreen({ navigation, route }: Props) {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const { dateFormat, firstWeekday } = useSettings();
  const db = useSQLiteContext();

  const requestedFocus: ProgressFocus | undefined = route.params?.focus;
  /** R2: the exercise sheet's "see the full chart" link arrives here. */
  const requestedExercise: string | undefined = route.params?.exercise;
  /** A saved routine's progress, opened from the routines tab. */
  const requestedRoutineId: number | undefined = route.params?.routineId;

  const [routines, setRoutines] = useState<ProgressRoutine[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [routineData, setRoutineData] = useState<RoutineProgressData | null>(null);
  const [series, setSeries] = useState<MainLiftSeries[]>([]);
  const [calendarDays, setCalendarDays] = useState<Map<number, ProgressCalendarDay>>(
    () => new Map(),
  );
  const [streak, setStreak] = useState<InicioStreak | null>(null);
  const [summaries, setSummaries] = useState<ExerciseSummary[]>([]);
  const [query, setQuery] = useState('');
  const [chartedExercise, setChartedExercise] = useState<string | null>(null);
  const [exerciseSeries, setExerciseSeries] = useState<ExerciseSeries | null>(null);
  /** R2: the exercise whose shared sheet is open. */
  const [information, setInformation] = useState<string | null>(null);
  const [detailTarget, setDetailTarget] = useState<SessionDetailTarget | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);

  const routineDb: RoutineDatabase = {
    run: (sql, params) => db.runAsync(sql, (params ?? []) as never[]),
    get: async (sql, params) =>
      (await db.getFirstAsync<Record<string, unknown>>(sql, (params ?? []) as never[])) ??
      undefined,
    getAll: async (sql, params) =>
      db.getAllAsync<Record<string, unknown>>(sql, (params ?? []) as never[]),
  };

  const todayStamp = dayStampOf(new Date());

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const load = async () => {
        const [loadedRoutines, loadedSummaries] = await Promise.all([
          loadProgressRoutines(routineDb),
          loadExercisesWithHistory(routineDb),
        ]);
        if (cancelled) {
          return;
        }
        setRoutines(loadedRoutines);
        setSummaries(loadedSummaries);

        const exists = (routineId: number | undefined): boolean =>
          routineId !== undefined &&
          loadedRoutines.some((routine) => routine.routineId === routineId);
        // What the caller asked for, then what was being read, then the routine
        // being trained: Progreso is about the active routine unless told otherwise.
        const preferred =
          [requestedRoutineId, requestedFocus?.routineId, selectedId ?? undefined].find(
            exists,
          ) ??
          loadedRoutines.find((routine) => routine.isActive)?.routineId ??
          loadedRoutines[0]?.routineId ??
          null;
        setSelectedId((current) => (current === preferred ? current : preferred));

        // R2's deep link wins over whatever was last charted: the user asked for
        // this exercise's history from its sheet.
        if (requestedExercise !== undefined) {
          if (loadedSummaries.some((entry) => entry.name === requestedExercise)) {
            setChartedExercise(requestedExercise);
          }
          navigation.setParams({ exercise: undefined });
        }
        if (requestedRoutineId !== undefined) {
          navigation.setParams({ routineId: undefined });
        }

        if (preferred === null) {
          setRoutineData(null);
          setSeries([]);
          setCalendarDays(new Map());
          setStreak(null);
          setLoaded(true);
          if (requestedFocus !== undefined) {
            navigation.setParams({ focus: undefined });
          }
          return;
        }

        const [data, liftSeries, calendar, queueInput] = await Promise.all([
          loadRoutineProgress(routineDb, preferred),
          loadMainLiftSeries(routineDb, preferred),
          loadProgressCalendar(routineDb, preferred),
          loadSessionQueueInput(routineDb),
        ]);
        if (cancelled) {
          return;
        }
        setRoutineData(data);
        setSeries(liftSeries);
        setCalendarDays(buildProgressCalendarDays(calendar));
        setStreak(
          queueInput.routine !== null && queueInput.routine.routineId === preferred
            ? computeInicioStreak(queueInput, todayStamp, firstWeekday)
            : null,
        );
        setLoaded(true);

        if (requestedFocus !== undefined) {
          if (hasProgressFocus(data, requestedFocus)) {
            const focused = data.cycles.find(
              (view) => view.cycle.cycleId === requestedFocus.cycleId,
            );
            if (focused !== undefined) {
              setDetailTarget({
                kind: 'week',
                routineId: requestedFocus.routineId,
                cycleId: requestedFocus.cycleId,
                cycleNumber: focused.cycle.cycleNumber,
                weekNumber: requestedFocus.weekNumber,
              });
            }
          }
          navigation.setParams({ focus: undefined });
        }
      };

      load().catch((error: unknown) => {
        console.error('Error loading progress:', error);
        if (!cancelled) {
          setRoutineData(null);
          setSeries([]);
          setCalendarDays(new Map());
          setStreak(null);
          setLoaded(true);
        }
      });

      return () => {
        cancelled = true;
      };
    }, [
      db,
      firstWeekday,
      navigation,
      requestedExercise,
      requestedFocus,
      requestedRoutineId,
      revision,
      selectedId,
    ]),
  );

  React.useEffect(() => {
    if (chartedExercise === null) {
      setExerciseSeries(null);
      return;
    }
    let cancelled = false;
    loadExerciseSeries(routineDb, chartedExercise)
      .then((loadedSeries) => {
        if (!cancelled) {
          setExerciseSeries(loadedSeries);
        }
      })
      .catch((error: unknown) => {
        console.error('Error loading the exercise history:', error);
        if (!cancelled) {
          setExerciseSeries(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [db, chartedExercise, revision]);

  const formatDate = (stamp: number): string => {
    const parts = datePartsOfStamp(stamp);
    return t('inicioDate', {
      weekday: t(WEEKDAY_FULL_KEYS[parts.weekday]),
      day: parts.day,
      month: t(MONTH_KEYS[parts.month]),
      year: parts.year,
    });
  };

  const shortDate = (stamp: number): string => {
    const date = new Date(stamp * 1000);
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return dateFormat === 'mm-dd-yyyy' ? `${month}/${day}` : `${day}/${month}`;
  };

  const calendarBounds = useMemo(() => {
    const stamps = [...calendarDays.keys()];
    const todayMonth = monthOfStamp(todayStamp);
    if (stamps.length === 0) {
      return { first: todayMonth, last: todayMonth, initial: todayMonth };
    }
    const months = [
      ...stamps.map((stamp) => monthOfStamp(stamp)),
      todayMonth,
    ].sort((a, b) => calendarMonthIndex(a) - calendarMonthIndex(b));
    const first = months[0];
    const last = months[months.length - 1];
    return { first, last, initial: todayMonth };
  }, [calendarDays, todayStamp]);

  const searchResults = useMemo(
    () => filterExerciseSummaries(summaries, query).slice(0, MAX_SEARCH_RESULTS),
    [summaries, query],
  );

  /** The legend, and the word every marked day says to a screen reader. */
  const stateLabels = useMemo(
    (): Record<ProgressDayState, string> => ({
      done: t('progressDayDone'),
      moved: t('progressDayMoved'),
      discarded: t('progressDayDiscarded'),
      planned: t('progressDayPlanned'),
      free: t('progressDayFree'),
    }),
    [t],
  );

  const openExerciseSheet = (exerciseName: string) => setInformation(exerciseName);

  const openWeek = (cycle: ProgressCycle, week: ProgressWeek) => {
    if (selectedId === null) {
      return;
    }
    setDetailTarget({
      kind: 'week',
      routineId: selectedId,
      cycleId: cycle.cycleId,
      cycleNumber: cycle.cycleNumber,
      weekNumber: week.weekNumber,
    });
  };

  const openDay = (entry: ProgressCalendarDay) => {
    setDetailTarget(
      entry.target.kind === 'session'
        ? {
            kind: 'session',
            routineId: entry.target.routineId,
            cycleId: entry.target.cycleId,
            cycleNumber: entry.target.cycleNumber,
            weekNumber: entry.target.weekNumber,
            sessionId: entry.target.sessionId,
          }
        : { kind: 'freeLog', workoutLogId: entry.target.workoutLogId },
    );
  };

  const cycleHint = (cycle: ProgressCycle, weeks: readonly ProgressWeek[]): string => {
    const adherence = cycleAdherence(weeks);
    const sessions = t('progressSessionsOf', {
      done: adherence.done,
      planned: adherence.planned,
      percent: adherence.percent,
    });
    if (cycle.status === 'complete') {
      return cycle.completedAt === null
        ? `${t('progressCycleDone')} · ${sessions}`
        : `${t('progressCycleDoneOn', { date: formatDate(cycle.completedAt) })} · ${sessions}`;
    }
    if (cycle.status === 'active') {
      return `${t('progressCycleWeekOf', {
        week: cycle.currentWeek,
        weeks: cycle.weeks,
      })} · ${sessions}`;
    }
    return t('progressCycleNotStarted', { weeks: cycle.weeks });
  };

  const renderWeekRow = (cycle: ProgressCycle, week: ProgressWeek) => {
    const done = weekSessionsDone(week.adherence);
    const detail = week.isCurrent
      ? `${t('progressWeekSessions', { done, planned: week.adherence.planned })} · ${t(
          'progressWeekCurrent',
        )}`
      : t('progressWeekSessions', { done, planned: week.adherence.planned });
    return (
      <Row
        key={`${cycle.cycleId}-${week.weekNumber}`}
        label={t('progressWeekLabel', { week: week.weekNumber })}
        detail={detail}
        detailBelow
        right={
          <Ionicons name="chevron-forward" size={tabBar.icon} color={tokens.textSecondary} />
        }
        onPress={() => openWeek(cycle, week)}
        divided
        testID={`progress-week-${cycle.cycleNumber}-${week.weekNumber}`}
      />
    );
  };

  const renderAnswer = () => {
    const routine = routines.find((entry) => entry.routineId === selectedId);
    if (routine === undefined) {
      return null;
    }
    return (
      <View testID="progress-answer">
        <Text style={[styles.overline, { color: tokens.textSecondary }]}>{t('progress')}</Text>
        <Text style={[styles.routineName, { color: tokens.textPrimary }]}>{routine.name}</Text>
        {routine.isActive && streak !== null && (
          <Text style={[styles.helper, { color: tokens.textSecondary }]} testID="progress-streak">
            {t('inicioStreak', {
              count: streak.weeks,
              weeks: streak.weeks,
              completed: streak.current.completed,
              planned: streak.current.planned,
            })}
          </Text>
        )}
        {!routine.isActive && (
          <Text style={[styles.helper, { color: tokens.textSecondary }]}>
            {t('progressSavedRoutine')}
          </Text>
        )}
      </View>
    );
  };

  const renderSearch = () => (
    <Section
      title={t('progressFindExercise')}
      hint={t('progressFindExerciseHint')}
      testID="progress-search"
    >
      <AppTextInput
        variant="text"
        value={query}
        onChangeText={setQuery}
        placeholder={t('progressSearchPlaceholder')}
        testID="progress-search-field"
      />
      {searchResults.map((entry) => (
        <Row
          key={entry.name}
          label={entry.name}
          detail={t('progressLastLogged', { date: formatDate(entry.lastDate) })}
          detailBelow
          right={
            <Ionicons
              name="information-circle-outline"
              size={tabBar.icon}
              color={tokens.textSecondary}
            />
          }
          onPress={() => openExerciseSheet(entry.name)}
          divided
        />
      ))}
      {query.trim() !== '' && searchResults.length === 0 && (
        <Text style={[styles.helper, { color: tokens.textSecondary }]}>
          {t('progressSearchNoMatch')}
        </Text>
      )}
    </Section>
  );

  const renderChartedExercise = () => {
    if (chartedExercise === null) {
      return null;
    }
    const loadedSeries =
      exerciseSeries !== null && exerciseSeries.exerciseName === chartedExercise
        ? exerciseSeries
        : null;
    const note = loadedSeries?.mixedUnits === true ? t('progressHistoryMixedUnits') : undefined;
    return (
      <Section
        title={t('progressExerciseHistoryOf', { name: chartedExercise })}
        testID="progress-exercise-history"
      >
        {loadedSeries === null ? (
          <ActivityIndicator color={tokens.accent} />
        ) : (
          <>
            <ProgressChart
              title={t('progressLoadOverTime')}
              points={loadedSeries.points.map((point) => ({
                date: point.date,
                value: point.weight,
              }))}
              unit={loadedSeries.unit}
              formatDate={shortDate}
              emptyLabel={t('progressNoData')}
              singlePointLabel={t('progressSinglePoint')}
              note={note}
            />
            <ProgressChart
              title={t('progressEstimated1rm')}
              points={loadedSeries.points.map((point) => ({
                date: point.date,
                value: point.estimated1RM,
              }))}
              unit={loadedSeries.unit}
              formatDate={shortDate}
              emptyLabel={t('progressNoData')}
              singlePointLabel={t('progressSinglePoint')}
            />
            <ProgressChart
              title={t('progressVolume')}
              points={loadedSeries.points.map((point) => ({
                date: point.date,
                value: point.volume,
              }))}
              unit={loadedSeries.unit}
              formatDate={shortDate}
              emptyLabel={t('progressNoData')}
              singlePointLabel={t('progressSinglePoint')}
            />
          </>
        )}
        <Row
          label={t('progressCloseExercise')}
          onPress={() => setChartedExercise(null)}
          testID="progress-close-exercise"
        />
      </Section>
    );
  };

  const renderCalendar = () => (
    <Section
      title={t('progressCalendar')}
      hint={t('progressCalendarHint')}
      testID="progress-calendar"
    >
      <ProgressCalendar
        initialMonth={calendarBounds.initial}
        firstMonth={calendarBounds.first}
        lastMonth={calendarBounds.last}
        firstWeekday={firstWeekday}
        days={calendarDays}
        todayStamp={todayStamp}
        weekdayLabels={weekdayOrder(firstWeekday).map((weekday) =>
          t(WEEKDAY_SHORT_KEYS[weekday]),
        )}
        monthLabels={MONTH_KEYS.map((key) => t(key))}
        stateLabels={stateLabels}
        previousMonthLabel={t('progressPreviousMonth')}
        nextMonthLabel={t('progressNextMonth')}
        todayLabel={t('inicioToday')}
        dateLabel={formatDate}
        onSelectDay={openDay}
        testID="progress-calendar-grid"
      />
    </Section>
  );

  const renderCycles = () => {
    if (routineData === null || routineData.routine.routineId !== selectedId) {
      return null;
    }
    if (routineData.cycles.length === 0) {
      return (
        <Section title={t('progressCycles')} testID="progress-no-cycles">
          <Text style={[styles.helper, { color: tokens.textSecondary }]}>
            {t('progressNoCycles')}
          </Text>
        </Section>
      );
    }
    return routineData.cycles.map((view) => (
      <Section
        key={view.cycle.cycleId}
        title={t('progressCycleHeader', { n: view.cycle.cycleNumber })}
        hint={cycleHint(view.cycle, view.weeks)}
        testID={`progress-cycle-${view.cycle.cycleNumber}`}
      >
        {view.weeks.map((week) => renderWeekRow(view.cycle, week))}
      </Section>
    ));
  };

  const renderMainLifts = () => {
    if (series.length === 0) {
      return null;
    }
    return (
      <Section title={t('progressMainLifts')} testID="progress-main-lifts">
        {series.map((entry) => (
          <ProgressChart
            key={entry.exerciseName}
            title={entry.exerciseName}
            points={entry.points.map((point) => ({ date: point.date, value: point.weight }))}
            unit={entry.unit}
            formatDate={shortDate}
            emptyLabel={t('progressNoData')}
            singlePointLabel={t('progressSinglePoint')}
          />
        ))}
      </Section>
    );
  };

  const renderOtherRoutines = () => {
    const others = routines.filter((routine) => routine.routineId !== selectedId);
    if (others.length === 0) {
      return null;
    }
    return (
      <Section
        title={t('progressOtherRoutines')}
        hint={t('progressOtherRoutinesHint')}
        testID="progress-other-routines"
      >
        {others.map((routine) => (
          <Row
            key={routine.routineId}
            label={routine.name}
            detail={routine.isActive ? t('activeRoutine') : undefined}
            right={
              <Ionicons name="chevron-forward" size={tabBar.icon} color={tokens.textSecondary} />
            }
            onPress={() => {
              setSelectedId(routine.routineId);
              setChartedExercise(null);
            }}
            divided
          />
        ))}
      </Section>
    );
  };

  if (!loaded) {
    return (
      <Screen testID="progress-screen">
        <ActivityIndicator color={tokens.accent} />
      </Screen>
    );
  }

  return (
    <>
      <Screen scroll testID="progress-screen">
        {routines.length === 0 ? (
          <EmptyState
            title={t('progressNoRoutinesTitle')}
            message={t('progressNoRoutines')}
            actionLabel={t('goToRoutines')}
            onAction={() => navigation.navigate('Routines')}
            testID="progress-no-routines"
          />
        ) : (
          <>
            <Section testID="progress-header">{renderAnswer()}</Section>
            {renderSearch()}
            {renderChartedExercise()}
            {renderCalendar()}
            {renderCycles()}
            {renderMainLifts()}
            {renderOtherRoutines()}
          </>
        )}
      </Screen>

      {/* P1/P2: a week and a day open the same sheet. */}
      <SessionDetailSheet
        target={detailTarget}
        visible={detailTarget !== null && information === null}
        onClose={() => setDetailTarget(null)}
        onOpenExercise={openExerciseSheet}
        onEdited={() => setRevision((current) => current + 1)}
        formatDate={formatDate}
      />

      {/* R2: the same exercise sheet the runner, the editor and the picker open. */}
      <ExerciseSheet
        exercise={information === null ? null : { name: information }}
        onClose={() => setInformation(null)}
        onOpenHistory={(exerciseName) => {
          setInformation(null);
          setChartedExercise(exerciseName);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  overline: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  routineName: {
    fontSize: fontSize.screenTitle,
    fontWeight: '700',
    marginTop: spacing.label,
  },
  helper: {
    fontSize: fontSize.helper,
    marginTop: spacing.label,
  },
});
