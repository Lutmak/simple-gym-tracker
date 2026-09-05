import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import AppTextInput from '../components/AppTextInput';
import { ChartRangeControl } from '../components/ChartRangeControl';
import { CollapsibleRow } from '../components/CollapsibleRow';
import { EmptyState } from '../components/EmptyState';
import { ExerciseHistoryView } from '../components/ExerciseHistoryView';
import { ExerciseSheet } from '../components/ExerciseSheet';
import { ProgressCalendar } from '../components/ProgressCalendar';
import { ProgressChart, type ProgressChartSeries } from '../components/ProgressChart';
import { Row } from '../components/Row';
import { Screen } from '../components/Screen';
import { Section } from '../components/Section';
import { Stat } from '../components/Stat';
import {
  SessionDetailSheet,
  type SessionDetailTarget,
} from '../components/SessionDetailSheet';
import { WeekStateDiscs } from '../components/WeekStateDiscs';
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
  buildStrengthChart,
  cycleAdherence,
  hasProgressFocus,
  loadProgressRoutines,
  loadRoutineProgress,
  loadStrengthSeries,
  weekSessionsDone,
  windowStrengthChart,
  type ProgressCycle,
  type ProgressFocus,
  type ProgressRoutine,
  type ProgressWeek,
  type RoutineProgressData,
  type StrengthLift,
  type WeekSessionStatus,
} from '../utils/routineProgress';
import { mainLiftColours } from '../utils/liftColours';
import {
  historyShortfall,
  loadExercisesWithHistory,
  rankExerciseHistory,
  type ExerciseSummary,
} from '../utils/exerciseHistory';
import { windowByRange, type ChartRange } from '../utils/chart';
import type { RoutineDatabase } from '../utils/routineActions';
import type { RootTabParamList } from '../App';

/**
 * Progreso — one screen about the routine you are training (SPEC.md U3, ADR-0047).
 *
 * Iteration 5's audit found the screen unusable in a new way: the exercise index led, the calendar
 * was bare numbers, and the main-lift charts plotted the 5/3/1 wave's own sawtooth — a session's
 * raw top weight, up and down by design every week — which reads as noise, not progress (defect
 * 10). U3 reorders the screen (tiles → calendar → strength → this cycle → past cycles → exercise
 * index, last) and replaces the main-lift trend with each lift's **estimated 1RM from its AMRAP
 * set**, plus the **training max it actually trained against**, both derived in `utils/
 * routineProgress.ts` (`loadStrengthSeries`) from `Progression_Proposal` rows and never from the
 * runner's raw log.
 *
 * The screen holds no rules: cycles, adherence, day states, the streak, strength points, training
 * maxes, range windowing and axis thinning all come from `utils/routineProgress.ts`,
 * `utils/progressCalendar.ts`, `utils/inicio.ts`, `utils/chart.ts` and `utils/exerciseHistory.ts`,
 * which are tested without a device. The screen composes primitives; the calendar and the tiles
 * are its one filled/anchored level (the tiles carry no surface at all — `Stat` never nests).
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
  const { firstWeekday } = useSettings();
  const db = useSQLiteContext();

  const requestedFocus: ProgressFocus | undefined = route.params?.focus;
  /** R2: the exercise sheet's "see the full chart" link arrives here. */
  const requestedExercise: string | undefined = route.params?.exercise;
  /** A saved routine's progress, opened from the routines tab. */
  const requestedRoutineId: number | undefined = route.params?.routineId;

  const [routines, setRoutines] = useState<ProgressRoutine[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [routineData, setRoutineData] = useState<RoutineProgressData | null>(null);
  const [strengthLifts, setStrengthLifts] = useState<StrengthLift[]>([]);
  const [calendarDays, setCalendarDays] = useState<Map<number, ProgressCalendarDay>>(
    () => new Map(),
  );
  const [streak, setStreak] = useState<InicioStreak | null>(null);
  const [summaries, setSummaries] = useState<ExerciseSummary[]>([]);
  const [query, setQuery] = useState('');
  const [chartedExercise, setChartedExercise] = useState<string | null>(null);
  /** One range for every chart on this tab, kept across the strength chart and exercise history. */
  const [range, setRange] = useState<ChartRange>('sixMonths');
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
          setStrengthLifts([]);
          setCalendarDays(new Map());
          setStreak(null);
          setLoaded(true);
          if (requestedFocus !== undefined) {
            navigation.setParams({ focus: undefined });
          }
          return;
        }

        const [data, lifts, calendar, queueInput] = await Promise.all([
          loadRoutineProgress(routineDb, preferred),
          loadStrengthSeries(routineDb, preferred),
          loadProgressCalendar(routineDb, preferred),
          loadSessionQueueInput(routineDb),
        ]);
        if (cancelled) {
          return;
        }
        setRoutineData(data);
        setStrengthLifts(lifts);
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
          setStrengthLifts([]);
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

  // The exercise history is a place, not a section: Android's back gesture must leave it the way
  // the on-screen back does, or the tab becomes a dead end (§7.2).
  useFocusEffect(
    useCallback(() => {
      if (chartedExercise === null) {
        return;
      }
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        setChartedExercise(null);
        return true;
      });
      return () => subscription.remove();
    }, [chartedExercise]),
  );

  const formatDate = (stamp: number): string => {
    const parts = datePartsOfStamp(stamp);
    return t('inicioDate', {
      weekday: t(WEEKDAY_FULL_KEYS[parts.weekday]),
      day: parts.day,
      month: t(MONTH_KEYS[parts.month]),
      year: parts.year,
    });
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
    () => rankExerciseHistory(summaries, query, MAX_SEARCH_RESULTS),
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

  /** The word each `WeekSessionStatus` reads as — the state discs' accessibility label. */
  const sessionStatusLabels = useMemo(
    (): Record<WeekSessionStatus, string> => ({
      completed: t('progressStatusCompleted'),
      moved: t('progressStatusMoved'),
      discarded: t('progressStatusDiscarded'),
      pending: t('progressStatusPending'),
    }),
    [t],
  );

  /** Each main lift's fixed series slot, by `sort_order` — `loadStrengthSeries` already returns
   * its lifts in ascending `sort_order`, so mapping them in array order is the routine's own
   * order (ADR-0047 §4.1). `mainLiftColours` returns the `theme.data.series` index, resolved to
   * an actual colour below wherever one is needed. */
  const liftColours = useMemo(
    () =>
      mainLiftColours(strengthLifts.map((lift) => ({ name: lift.exerciseName, role: 'main' as const }))),
    [strengthLifts],
  );

  const strengthChart = useMemo(() => buildStrengthChart(strengthLifts), [strengthLifts]);

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

  /** §3.4/F4 — the current-cycle block's link to its pending review. */
  const openReview = (cycle: ProgressCycle) => {
    if (selectedId === null) {
      return;
    }
    navigation.navigate('Routines', {
      screen: 'CycleReview',
      params: { routineId: selectedId, cycleId: cycle.cycleId },
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

  /** A past (always-complete) cycle's subheading — reused as-is for the current cycle too, when
   * it is not the review call (the one text this cycle can also be in). */
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

  const renderWeekRow = (cycle: ProgressCycle, week: ProgressWeek) => (
    <Row
      key={`${cycle.cycleId}-${week.weekNumber}`}
      label={t('progressWeekLabel', { week: week.weekNumber })}
      detailContent={
        <WeekStateDiscs
          statuses={week.sessionStatuses}
          statusLabels={sessionStatusLabels}
          testID={`progress-week-${cycle.cycleNumber}-${week.weekNumber}-discs`}
        />
      }
      right={
        <View style={styles.weekRowRight}>
          {week.isCurrent && (
            <Text style={[styles.currentTag, { color: tokens.textSecondary }]}>
              {t('progressWeekCurrent')}
            </Text>
          )}
          <Ionicons name="chevron-forward" size={tabBar.icon} color={tokens.textSecondary} />
        </View>
      }
      onPress={() => openWeek(cycle, week)}
      divided
      testID={`progress-week-${cycle.cycleNumber}-${week.weekNumber}`}
    />
  );

  /** Three Stat tiles: streak (or, for a saved/inactive routine, cycles completed), this cycle's
   * adherence, and the current position — a colour swatch names the routine by its first main
   * lift, the same identity the strength chart uses (Stat's own documented use, ADR-0047). */
  const renderTiles = () => {
    if (routineData === null || routineData.cycles.length === 0) {
      return null;
    }
    const routine = routines.find((entry) => entry.routineId === selectedId);
    const current = routineData.cycles[routineData.cycles.length - 1];
    const adherence = cycleAdherence(current.weeks);
    const completedCycles = routineData.cycles.filter(
      (view) => view.cycle.status === 'complete',
    ).length;
    const showStreak = routine?.isActive === true && streak !== null;
    const swatchIndex =
      strengthLifts.length > 0 ? liftColours.get(strengthLifts[0].exerciseName) : undefined;
    const swatch = swatchIndex !== undefined ? tokens.data.series[swatchIndex] : undefined;

    return (
      <View style={styles.tileRow} testID="progress-tiles">
        <Stat
          value={showStreak ? String(streak.weeks) : String(completedCycles)}
          label={showStreak ? t('progressStreakTileLabel') : t('progressCyclesTileLabel')}
          testID="progress-tile-streak"
        />
        <Stat
          value={String(adherence.percent)}
          unit="%"
          label={t('progressAdherenceTileLabel')}
          testID="progress-tile-adherence"
        />
        <Stat
          value={t('progressCycleHeader', { n: current.cycle.cycleNumber })}
          label={t('progressCycleWeekOf', {
            week: current.cycle.currentWeek,
            weeks: current.cycle.weeks,
          })}
          color={swatch}
          testID="progress-tile-cycle"
        />
      </View>
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

  /**
   * FUERZA (renamed from "Levantamientos principales"): one chart, every main lift as its own
   * line in its series colour, estimated 1RM from the AMRAP set with the training max as a dotted
   * step — never the session's raw top weight (audit defect 10). Tapping a legend item opens that
   * lift's full history (ADR-0040's standing "tap the exercise" contract).
   */
  const renderStrength = () => {
    if (strengthLifts.length === 0) {
      return null;
    }
    const windowed = windowStrengthChart(strengthChart, range, todayStamp);
    const series: ProgressChartSeries[] = windowed.lifts.flatMap((lift) => {
      const colourIndex = liftColours.get(lift.exerciseName);
      const color = colourIndex !== undefined ? tokens.data.series[colourIndex] : tokens.textSecondary;
      const openHistory = () => setChartedExercise(lift.exerciseName);
      const entries: ProgressChartSeries[] = [
        {
          key: `${lift.exerciseName}-1rm`,
          label: lift.exerciseName,
          color,
          values: lift.estimated1RM,
          onPress: openHistory,
        },
      ];
      if (lift.hasTrainingMax) {
        entries.push({
          key: `${lift.exerciseName}-tm`,
          label: lift.exerciseName,
          color,
          values: lift.trainingMax,
          style: 'step',
          onPress: openHistory,
        });
      }
      return entries;
    });
    const unit = windowed.lifts[0]?.unit ?? routines.find((r) => r.routineId === selectedId)?.unit ?? 'kg';

    return (
      <Section testID="progress-strength">
        <View style={styles.rangeRow}>
          <ChartRangeControl value={range} onChange={setRange} testID="progress-strength-range" />
        </View>
        <ProgressChart
          title={t('progressMainLifts')}
          note={t('progressStrengthHint')}
          dates={windowed.axis.map((point) => point.date)}
          series={series}
          unit={unit}
          range={range}
          emptyLabel={range === 'all' ? t('progressNoData') : t('progressNoDataInRange')}
          singlePointLabel={
            range === 'all' ? t('progressSinglePoint') : t('progressSinglePointInRange')
          }
          testID="progress-strength-chart"
        />
      </Section>
    );
  };

  /**
   * ESTE CICLO — the routine's current cycle, one row per week. When the cycle's last week is
   * resolved and the review has not been applied yet, the block's headline IS the review call
   * (§3.4/F4) rather than the usual "Este ciclo" title.
   */
  const renderThisCycle = () => {
    if (routineData === null || routineData.cycles.length === 0) {
      return null;
    }
    const current = routineData.cycles[routineData.cycles.length - 1];
    const { cycle, weeks } = current;
    const reviewPending = cycle.status === 'active' && cycle.currentWeek >= cycle.weeks;

    return (
      <View style={styles.block} testID="progress-this-cycle">
        {reviewPending ? (
          <>
            <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>
              {t('progressReviewFinishedTitle', { cycle: cycle.cycleNumber })}
            </Text>
            <Row
              label={t('sessionSummaryReview')}
              detail={t('progressReviewProposalDetail', { next: cycle.cycleNumber + 1 })}
              detailBelow
              right={
                <Ionicons name="chevron-forward" size={tabBar.icon} color={tokens.textSecondary} />
              }
              onPress={() => openReview(cycle)}
              divided
              testID="progress-this-cycle-review"
            />
          </>
        ) : (
          <>
            <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>
              {t('progressThisCycle')}
            </Text>
            <Text style={[styles.hint, { color: tokens.textSecondary }]}>
              {`${t('progressCycleHeader', { n: cycle.cycleNumber })} · ${cycleHint(cycle, weeks)}`}
            </Text>
          </>
        )}
        <View style={styles.blockContent}>{weeks.map((week) => renderWeekRow(cycle, week))}</View>
      </View>
    );
  };

  /** CICLOS ANTERIORES — every earlier cycle, collapsed behind one row, most recent first. */
  const renderPastCycles = () => {
    if (routineData === null || routineData.cycles.length < 2) {
      return null;
    }
    const past = [...routineData.cycles.slice(0, -1)].reverse();
    return (
      <View style={styles.block} testID="progress-past-cycles">
        <CollapsibleRow
          label={t('progressPastCycles')}
          detail={t('progressPastCyclesCount', { count: past.length })}
          testID="progress-past-cycles-row"
        >
          {past.map((view) => (
            <View key={view.cycle.cycleId} style={styles.pastCycleGroup}>
              <Text style={[styles.pastCycleTitle, { color: tokens.textPrimary }]}>
                {t('progressCycleHeader', { n: view.cycle.cycleNumber })}
              </Text>
              <Text style={[styles.hint, { color: tokens.textSecondary }]}>
                {cycleHint(view.cycle, view.weeks)}
              </Text>
              {view.weeks.map((week) => renderWeekRow(view.cycle, week))}
            </View>
          ))}
        </CollapsibleRow>
      </View>
    );
  };

  const renderNoCycles = () => (
    <Section title={t('progressCycles')} testID="progress-no-cycles">
      <Text style={[styles.hint, { color: tokens.textSecondary }]}>{t('progressNoCycles')}</Text>
    </Section>
  );

  const renderAnswer = () => {
    const routine = routines.find((entry) => entry.routineId === selectedId);
    if (routine === undefined) {
      return null;
    }
    return (
      <View testID="progress-answer">
        <Text style={[styles.overline, { color: tokens.textSecondary }]}>{t('progress')}</Text>
        <Text style={[styles.routineName, { color: tokens.textPrimary }]}>{routine.name}</Text>
        {!routine.isActive && (
          <Text style={[styles.hint, { color: tokens.textSecondary }]}>
            {t('progressSavedRoutine')}
          </Text>
        )}
      </View>
    );
  };

  /**
   * The last of the six blocks: a searchable index, most recently logged first. With the field
   * empty it is still only exercises with history, never the whole catalog; an exercise with too
   * little history is greyed and says why instead of opening into an empty chart (P4).
   */
  const renderExerciseIndex = () => (
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
      {searchResults.map((entry) => {
        const shortfall = historyShortfall(entry.sessions);
        return (
          <Row
            key={entry.name}
            label={entry.name}
            detail={
              shortfall === null
                ? t('progressExerciseSessionsLine', {
                    count: entry.sessions,
                    date: formatDate(entry.lastDate),
                  })
                : t('progressSinglePoint')
            }
            detailBelow
            right={
              shortfall === null ? (
                <Ionicons
                  name="chevron-forward"
                  size={tabBar.icon}
                  color={tokens.textSecondary}
                />
              ) : undefined
            }
            onPress={() => setChartedExercise(entry.name)}
            disabled={shortfall !== null}
            divided
            testID={`progress-exercise-${entry.name}`}
          />
        );
      })}
      {query.trim() !== '' && searchResults.length === 0 && (
        <Text style={[styles.hint, { color: tokens.textSecondary }]}>
          {t('progressSearchNoMatch')}
        </Text>
      )}
      {query.trim() === '' && summaries.length > MAX_SEARCH_RESULTS && (
        <Text style={[styles.hint, { color: tokens.textSecondary }]}>
          {t('progressSearchMore', { count: summaries.length - MAX_SEARCH_RESULTS })}
        </Text>
      )}
    </Section>
  );

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

  // P4: the exercise history is a destination, not a section — it replaces the routine view
  // rather than growing under it, which is what "one search and one tap from anywhere" means.
  if (chartedExercise !== null) {
    return (
      <>
        <Screen scroll testID="progress-screen">
          <ExerciseHistoryView
            exerciseName={chartedExercise}
            range={range}
            onChangeRange={setRange}
            onBack={() => setChartedExercise(null)}
            onOpenSheet={openExerciseSheet}
            todayStamp={todayStamp}
            formatDate={formatDate}
            revision={revision}
          />
        </Screen>

        <ExerciseSheet
          exercise={information === null ? null : { name: information }}
          onClose={() => setInformation(null)}
        />
      </>
    );
  }

  const hasCycles = routineData !== null && routineData.cycles.length > 0;

  return (
    <>
      <Screen scroll testID="progress-screen">
        {routines.length === 0 ? (
          <>
            <EmptyState
              title={t('progressNoRoutinesTitle')}
              message={t('progressNoRoutines')}
              actionLabel={t('goToRoutines')}
              onAction={() => navigation.navigate('Routines')}
              testID="progress-no-routines"
            />
            {/* Free sessions are history too: with no routine yet, this is still their door. */}
            {summaries.length > 0 && renderExerciseIndex()}
          </>
        ) : (
          <>
            <Section testID="progress-header">{renderAnswer()}</Section>
            {renderTiles()}
            {renderCalendar()}
            {renderStrength()}
            {hasCycles ? (
              <>
                {renderThisCycle()}
                {renderPastCycles()}
              </>
            ) : (
              renderNoCycles()
            )}
            {renderExerciseIndex()}
            {renderOtherRoutines()}
          </>
        )}
      </Screen>

      {/* One week and one calendar day open the same sheet. */}
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
  hint: {
    fontSize: fontSize.helper,
    marginTop: spacing.label,
  },
  tileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.section,
  },
  rangeRow: {
    marginBottom: spacing.cardGap,
  },
  block: {
    marginBottom: spacing.section,
  },
  blockContent: {
    marginTop: spacing.cardGap,
  },
  sectionTitle: {
    fontSize: fontSize.sectionTitle,
    fontWeight: '700',
  },
  weekRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
  },
  currentTag: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  pastCycleGroup: {
    gap: spacing.cardGap,
  },
  pastCycleTitle: {
    fontSize: fontSize.cardTitle,
    fontWeight: '700',
  },
});
