import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ExerciseSheet } from '../components/ExerciseSheet';
import { Hero } from '../components/Hero';
import { Row } from '../components/Row';
import { Screen } from '../components/Screen';
import { Section } from '../components/Section';
import { SessionDetailSheet, type SessionDetailTarget } from '../components/SessionDetailSheet';
import { Sheet } from '../components/Sheet';
import { Stat } from '../components/Stat';
import { WeekOverview } from '../components/WeekOverview';
import { Calendar } from '../components/Calendar';
import { dataMark, fontSize, spacing, tabBar } from '../utils/scale';
import {
  dayStampOf,
  loadMoveDayPlan,
  resolveDiscardSession,
  resolveDoTodaySession,
  resolveMoveSession,
  resolvePullForwardSession,
  undoDiscardSession,
  type MoveDayPlan,
  type QueuedExercise,
  type QueuedSession,
} from '../utils/today';
import {
  datePartsOfStamp,
  loadInicioData,
  truncateHeroExercises,
  type InicioData,
  type InicioDayStatus,
  type InicioSessionTarget,
} from '../utils/inicio';
import type { RoutineDatabase } from '../utils/routineActions';
import type { InicioStackParamList, RootTabParamList } from '../App';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useQueueRevision } from '../context/QueueRevision';

type Props = NativeStackScreenProps<InicioStackParamList, 'InicioIndex'>;

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

const formatWeight = (value: number): string => String(Number(value.toFixed(1)));

const WEEK_STATUS_KEY: Record<InicioDayStatus, string> = {
  completed: 'inicioWeekCompleted',
  moved: 'inicioWeekMoved',
  discarded: 'inicioWeekDiscarded',
  pending: 'inicioWeekPending',
  rest: 'inicioWeekRest',
};

type ResolutionStep = 'outcomes' | 'move';

interface UndoDiscard {
  weekSessionId: number;
  sessionName: string;
}

export default function InicioScreen({ navigation, route }: Props) {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const { firstWeekday } = useSettings();
  const { bump } = useQueueRevision();
  const db = useSQLiteContext();
  const [data, setData] = useState<InicioData | null>(null);
  const [resolutionSession, setResolutionSession] = useState<QueuedSession | null>(null);
  const [resolutionSheetVisible, setResolutionSheetVisible] = useState(false);
  const [resolutionStep, setResolutionStep] = useState<ResolutionStep>('outcomes');
  const [moveDayPlan, setMoveDayPlan] = useState<MoveDayPlan | null>(null);
  const [calendarVisible, setCalendarVisible] = useState(false);
  /** R2: the exercise whose shared sheet is open. */
  const [information, setInformation] = useState<string | null>(null);
  /** U2: a resolved week-strip day's session sheet (`components/SessionDetailSheet.tsx`). */
  const [detailTarget, setDetailTarget] = useState<SessionDetailTarget | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [pendingReopenId, setPendingReopenId] = useState<number | null>(null);
  const [pendingReopenSession, setPendingReopenSession] = useState<QueuedSession | null>(null);
  const [undoDiscard, setUndoDiscard] = useState<UndoDiscard | null>(null);
  const [pullingForward, setPullingForward] = useState(false);

  const routineDb: RoutineDatabase = {
    run: (sql: string, params?: readonly unknown[]) => db.runAsync(sql, (params ?? []) as never[]),
    get: async (sql: string, params?: readonly unknown[]) =>
      (await db.getFirstAsync<Record<string, unknown>>(sql, (params ?? []) as never[])) ?? undefined,
    getAll: async (sql: string, params?: readonly unknown[]) =>
      db.getAllAsync<Record<string, unknown>>(sql, (params ?? []) as never[]),
  };

  /** R2's link from the exercise sheet to that exercise's full chart, on the Progreso tab. */
  const openExerciseHistory = (exerciseName: string) => {
    setInformation(null);
    navigation
      .getParent<BottomTabNavigationProp<RootTabParamList>>()
      ?.navigate('Progress', { exercise: exerciseName });
  };

  const reload = useCallback(async (): Promise<InicioData | null> => {
    try {
      const next = await loadInicioData(routineDb, dayStampOf(new Date()), firstWeekday);
      setData(next);
      return next;
    } catch {
      return null;
    }
  }, [db, firstWeekday]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => {
      setUndoDiscard(null);
      setPendingReopenId(null);
      setPendingReopenSession(null);
      setResolutionSession(null);
      setResolutionSheetVisible(false);
      setDetailTarget(null);
    });
    return unsubscribe;
  }, [navigation]);

  const resolutionRequestId = route.params?.resolutionWeekSessionId;

  useEffect(() => {
    if (resolutionRequestId === undefined || data === null) {
      return;
    }

    navigation.setParams({ resolutionWeekSessionId: undefined });
    if (
      data.queue.resolution !== 'unresolved' ||
      data.queue.head === null ||
      data.queue.head.weekSessionId !== resolutionRequestId
    ) {
      return;
    }

    setResolutionSession(data.queue.head);
    setResolutionStep('outcomes');
    setMoveDayPlan(null);
    setCalendarVisible(false);
    setResolutionError(null);
    setResolutionSheetVisible(true);
  }, [data, navigation, resolutionRequestId]);

  const handleSheetClosed = useCallback(() => {
    if (pendingReopenId === null) {
      setPendingReopenSession(null);
      setResolutionSession(null);
      return;
    }
    setPendingReopenId(null);
    setPendingReopenSession(null);
    setResolutionSession(pendingReopenSession);
    setResolutionStep('outcomes');
    setMoveDayPlan(null);
    setCalendarVisible(false);
    setResolutionError(null);
    setResolutionSheetVisible(true);
  }, [pendingReopenId, pendingReopenSession]);

  if (data === null) {
    return (
      <Screen>
        <ActivityIndicator color={tokens.accent} />
      </Screen>
    );
  }

  const todayStamp = dayStampOf(new Date());
  const weekdayLabels = data.week.days.map((day) => t(WEEKDAY_SHORT_KEYS[day.weekday]));
  const weekStatusLabels = Object.fromEntries(
    (Object.entries(WEEK_STATUS_KEY) as [InicioDayStatus, string][]).map(([status, key]) => [
      status,
      t(key),
    ]),
  ) as Record<InicioDayStatus, string>;

  const formatDate = (stamp: number): string => {
    const date = datePartsOfStamp(stamp);
    return t('inicioDate', {
      weekday: t(WEEKDAY_FULL_KEYS[date.weekday]),
      day: date.day,
      month: t(MONTH_KEYS[date.month]),
      year: date.year,
    });
  };

  const openRoutines = () => navigation.getParent()?.navigate('Routines');
  /** §3.4/F4 — the cycle-review link from Inicio's own answer block. */
  const openReview = () => {
    if (data === null || data.queue.routine === null || data.queue.review === null) {
      return;
    }
    navigation
      .getParent<NavigationProp<RootTabParamList>>()
      ?.navigate('Routines', {
        screen: 'CycleReview',
        params: { routineId: data.queue.routine.routineId, cycleId: data.queue.review.cycleId },
      });
  };
  const startSession = (weekSessionId: number) =>
    navigation.navigate('StartSession', { weekSessionId });
  // H2 consumes this route request to mount the standard resolution Sheet.
  const openSessionResolution = (weekSessionId: number) =>
    navigation.navigate('InicioIndex', { resolutionWeekSessionId: weekSessionId });
  /** A resolved week-strip cell opens the same session sheet the Progreso calendar does. */
  const openSessionDetail = (target: InicioSessionTarget) =>
    setDetailTarget({ kind: 'session', ...target });

  /** §3.3 — "adelantar": the rest-day hero's own shortcut to the tab bar's rest-day sheet action. */
  const pullForward = async () => {
    if (pullingForward) {
      return;
    }
    setPullingForward(true);
    try {
      const weekSessionId = await resolvePullForwardSession(routineDb, todayStamp);
      bump();
      startSession(weekSessionId);
    } catch (error) {
      console.error('Error pulling the next session forward:', error);
    } finally {
      setPullingForward(false);
    }
  };

  const closeResolution = () => {
    setPendingReopenId(null);
    setPendingReopenSession(null);
    setResolutionSession(null);
    setResolutionSheetVisible(false);
    setResolutionStep('outcomes');
    setMoveDayPlan(null);
    setCalendarVisible(false);
    setResolutionError(null);
  };

  const finishResolution = (next: InicioData | null) => {
    if (!navigation.isFocused()) {
      setPendingReopenId(null);
      setPendingReopenSession(null);
      setResolutionSession(null);
      setResolutionSheetVisible(false);
      return;
    }
    const nextId =
      next?.queue.resolution === 'unresolved' && next.queue.head !== null
        ? next.queue.head.weekSessionId
        : null;
    const nextSession =
      next?.queue.resolution === 'unresolved' && next.queue.head !== null
        ? next.queue.head
        : null;
    setPendingReopenId(nextId);
    setPendingReopenSession(nextSession);
    setResolutionSheetVisible(false);
    setResolutionStep('outcomes');
    setMoveDayPlan(null);
    setCalendarVisible(false);
    setResolutionError(null);
  };

  const reportResolutionError = () => setResolutionError(t('inicioResolutionError'));

  const resolveDoToday = async () => {
    if (resolutionSession === null || !resolutionSession.doTodayAvailable || resolving) {
      return;
    }
    setResolving(true);
    setResolutionError(null);
    try {
      await resolveDoTodaySession(routineDb, resolutionSession.weekSessionId, todayStamp);
      bump();
      const next = await reload();
      finishResolution(next);
    } catch {
      reportResolutionError();
    } finally {
      setResolving(false);
    }
  };

  const openMoveStep = async () => {
    if (resolutionSession === null || resolving) {
      return;
    }
    setResolutionStep('move');
    setMoveDayPlan(null);
    setCalendarVisible(false);
    setResolutionError(null);
    try {
      const plan = await loadMoveDayPlan(
        routineDb,
        resolutionSession.weekSessionId,
        todayStamp,
      );
      setMoveDayPlan(plan);
    } catch {
      reportResolutionError();
    }
  };

  const resolveMove = async (targetStamp: number) => {
    if (resolutionSession === null || resolving) {
      return;
    }
    setResolving(true);
    setResolutionError(null);
    try {
      await resolveMoveSession(routineDb, resolutionSession.weekSessionId, targetStamp);
      bump();
      const next = await reload();
      finishResolution(next);
    } catch {
      reportResolutionError();
    } finally {
      setResolving(false);
    }
  };

  const resolveDiscard = async () => {
    if (resolutionSession === null || resolving) {
      return;
    }
    const discardedSession = {
      weekSessionId: resolutionSession.weekSessionId,
      sessionName: resolutionSession.name,
    };
    setResolving(true);
    setResolutionError(null);
    try {
      await resolveDiscardSession(routineDb, discardedSession.weekSessionId);
      setUndoDiscard(discardedSession);
      bump();
      const next = await reload();
      finishResolution(next);
    } catch {
      reportResolutionError();
    } finally {
      setResolving(false);
    }
  };

  const undoLastDiscard = async () => {
    if (undoDiscard === null || resolving) {
      return;
    }
    setResolving(true);
    try {
      await undoDiscardSession(routineDb, undoDiscard.weekSessionId);
      setUndoDiscard(null);
      bump();
      await reload();
    } catch {
      // Keep the undo affordance visible when the guarded writer rejects it.
    } finally {
      setResolving(false);
    }
  };

  const renderResolutionSheet = () => {
    if (resolutionSession === null) {
      return null;
    }

    const orderedCalendarWeekdays = firstWeekday === 'Monday'
      ? [1, 2, 3, 4, 5, 6, 0]
      : [0, 1, 2, 3, 4, 5, 6];
    const calendarWeekdayLabels = orderedCalendarWeekdays.map((weekday) =>
      t(WEEKDAY_SHORT_KEYS[weekday]),
    );

    return (
      <Sheet
        visible={resolutionSheetVisible}
        onClose={closeResolution}
        onClosed={handleSheetClosed}
        title={resolutionStep === 'outcomes'
          ? resolutionSession.name
          : t('inicioResolutionMoveTitle', { name: resolutionSession.name })}
        onBack={resolutionStep === 'move'
          ? () => {
              setResolutionStep('outcomes');
              setMoveDayPlan(null);
              setCalendarVisible(false);
              setResolutionError(null);
            }
          : undefined}
        testID="inicio-resolution-sheet"
      >
        {resolutionStep === 'outcomes' ? (
          <View testID="inicio-resolution-step-one">
            <Text style={[styles.sheetDate, { color: tokens.textSecondary }]}>
              {formatDate(resolutionSession.date)}
            </Text>
            {!resolutionSession.doTodayAvailable && (
              <Text style={[styles.resolutionHint, { color: tokens.textSecondary }]}>
                {t('inicioResolutionTodayTaken', {
                  name: resolutionSession.todayOccupiedBy ?? t('inicioToday'),
                })}
              </Text>
            )}
            {resolutionSession.doTodayAvailable && (
              <Row
                label={t('inicioResolutionDoToday')}
                detail={t('inicioResolutionDoTodayDetail', { date: formatDate(todayStamp) })}
                detailBelow
                right={<Ionicons name="chevron-forward" size={tabBar.icon} color={tokens.textSecondary} />}
                onPress={resolveDoToday}
                disabled={resolving}
                divided
                testID="inicio-resolution-do-today"
              />
            )}
            <Row
              label={t('inicioResolutionMove')}
              detail={t('inicioResolutionMoveDetail')}
              detailBelow
              right={<Ionicons name="chevron-forward" size={tabBar.icon} color={tokens.textSecondary} />}
              onPress={openMoveStep}
              disabled={resolving}
              divided
              testID="inicio-resolution-move"
            />
            <Row
              label={t('inicioResolutionDiscard')}
              detail={t('inicioResolutionDiscardDetail')}
              detailBelow
              onPress={resolveDiscard}
              disabled={resolving}
              divided
              testID="inicio-resolution-discard"
            />
            {resolutionError !== null && (
              <Text style={[styles.resolutionError, { color: tokens.warning }]}>
                {resolutionError}
              </Text>
            )}
          </View>
        ) : (
          <View testID="inicio-resolution-step-two">
            {moveDayPlan === null ? (
              <ActivityIndicator color={tokens.accent} />
            ) : (
              <>
                {moveDayPlan.choices.map((choice, index) => {
                  const label = index === 0
                    ? t('inicioMoveNamedDay', {
                        relative: t('inicioMoveTomorrow'),
                        date: formatDate(choice.stamp),
                      })
                    : formatDate(choice.stamp);
                  const occupied = choice.occupiedBy !== null;
                  return (
                    <Row
                      key={choice.stamp}
                      label={label}
                      detail={occupied
                        ? t('inicioMoveOccupied', { name: choice.occupiedBy })
                        : t('inicioMoveAvailable')}
                      detailBelow
                      right={occupied
                        ? undefined
                        : <Ionicons name="chevron-forward" size={tabBar.icon} color={tokens.textSecondary} />}
                      onPress={() => resolveMove(choice.stamp)}
                      disabled={occupied || resolving}
                      divided
                    />
                  );
                })}
                <Row
                  label={t('inicioMoveOtherDay')}
                  detail={t('inicioMoveOtherDayHint')}
                  detailBelow
                  right={<Ionicons name="chevron-forward" size={tabBar.icon} color={tokens.textSecondary} />}
                  onPress={() => setCalendarVisible(true)}
                  disabled={resolving}
                  divided={!calendarVisible}
                  testID="inicio-resolution-other-day"
                />
                {calendarVisible && (
                  <View style={styles.calendar} testID="inicio-resolution-calendar">
                    <Calendar
                      minStamp={moveDayPlan.minStamp}
                      maxStamp={moveDayPlan.maxStamp}
                      firstWeekday={firstWeekday}
                      weekdayLabels={calendarWeekdayLabels}
                      monthLabels={MONTH_KEYS.map((key) => t(key))}
                      occupiedBy={moveDayPlan.occupiedBy}
                      dateLabel={formatDate}
                      occupiedLabel={(name) => t('inicioMoveOccupied', { name })}
                      previousMonthLabel={t('progressPreviousMonth')}
                      nextMonthLabel={t('progressNextMonth')}
                      onSelectDate={resolveMove}
                      testID="inicio-move-calendar"
                    />
                  </View>
                )}
                {resolutionError !== null && (
                  <Text style={[styles.resolutionError, { color: tokens.warning }]}>
                    {resolutionError}
                  </Text>
                )}
              </>
            )}
          </View>
        )}
      </Sheet>
    );
  };

  /** ADR-0047 §4.1: the main lift's own series colour, next to its row — null for an accessory. */
  const exerciseColor = (exercise: QueuedExercise): string | null => {
    if (exercise.role !== 'main') {
      return null;
    }
    const index = data.mainLiftColours.get(exercise.name) ?? 0;
    return tokens.data.series[index];
  };

  /** SPEC.md U2: "HOY · viernes 4 de septiembre" — the missed day's own date when unresolved. */
  const overline = (): string => {
    const { queue } = data;
    if (queue.head !== null && queue.resolution === 'unresolved') {
      return `${t('inicioUnresolved')} · ${formatDate(queue.head.date)}`;
    }
    if (queue.head === null && queue.review !== null) {
      return t('inicioReviewOverline');
    }
    return `${t('inicioToday')} · ${formatDate(todayStamp)}`;
  };

  const renderHero = () => {
    const { queue } = data;

    if (queue.head !== null && queue.resolution === 'unresolved') {
      const session = queue.head;
      const resolutionChoices = session.doTodayAvailable
        ? t('inicioResolutionChoices')
        : t('inicioResolutionChoicesWithoutToday');
      return (
        <View testID="inicio-unresolved">
          <Text style={[styles.sessionTitle, { color: tokens.textPrimary }]}>{session.name}</Text>
          <Text style={[styles.helper, { color: tokens.textSecondary }]}>
            {formatDate(session.date)} · {t('inicioNotLogged')}
          </Text>
          <Row
            label={t('inicioResolveSession')}
            detail={resolutionChoices}
            right={<Ionicons name="chevron-forward" size={tabBar.icon} color={tokens.textSecondary} />}
            onPress={() => openSessionResolution(session.weekSessionId)}
            divided
            testID="inicio-resolve-session"
          />
        </View>
      );
    }

    if (queue.head !== null && queue.resolution === 'due') {
      const session = queue.head;
      const { shown, remaining } = truncateHeroExercises(session.exercises);
      const summary = data.durationMinutes === null
        ? t('inicioExerciseCount', { count: session.exercises.length })
        : t('inicioExerciseCountWithDuration', {
            count: session.exercises.length,
            minutes: data.durationMinutes,
          });
      return (
        <View testID="inicio-due">
          <Text style={[styles.sessionTitle, { color: tokens.textPrimary }]}>{session.name}</Text>
          <Text style={[styles.helper, { color: tokens.textSecondary }]}>{summary}</Text>
          <View style={styles.exerciseList}>
            {shown.map((exercise) => {
              const color = exerciseColor(exercise);
              return (
                <Row
                  key={exercise.name}
                  label={exercise.name}
                  detail={`${exercise.targetSets} × ${exercise.isAmrap ? `${exercise.targetReps}+` : exercise.targetReps}`}
                  right={
                    <View style={styles.exerciseRight}>
                      <Text style={[styles.weight, { color: tokens.textPrimary }]}>
                        {exercise.targetWeight === null
                          ? '—'
                          : `${formatWeight(exercise.targetWeight)} ${exercise.unit}`}
                      </Text>
                      {color !== null && (
                        <View
                          style={[styles.seriesDot, { backgroundColor: color }]}
                          testID={`inicio-exercise-dot-${exercise.name}`}
                        />
                      )}
                    </View>
                  }
                  /* R2: today's plan is one tap from what each exercise actually is. */
                  onPress={() => setInformation(exercise.name)}
                  divided
                />
              );
            })}
            {remaining > 0 && (
              <Text style={[styles.helper, { color: tokens.textSecondary }]}>
                {t('inicioMoreExercises', { count: remaining })}
              </Text>
            )}
          </View>
          <Button
            label={session.originDate === session.date ? t('inicioStartSession') : t('continueSession')}
            onPress={() => startSession(session.weekSessionId)}
            style={styles.fullButton}
          />
        </View>
      );
    }

    // §3.4/F4: a completed, unreviewed cycle has nothing left pending until
    // the review seeds the next one — this is Inicio's answer for it.
    if (queue.review !== null) {
      const review = queue.review;
      return (
        <View testID="inicio-review">
          <Text style={[styles.sessionTitle, { color: tokens.textPrimary }]}>
            {t('inicioReviewTitle', { cycle: review.cycleNumber })}
          </Text>
          <Text style={[styles.helper, { color: tokens.textSecondary }]}>
            {t('inicioReviewSummary', {
              completed: review.completedSessions,
              total: review.totalSessions,
              next: review.cycleNumber + 1,
            })}
          </Text>
          <Button
            label={t('sessionSummaryReview')}
            onPress={openReview}
            style={styles.fullButton}
            testID="inicio-review-open"
          />
        </View>
      );
    }

    // Rest day: the hero states it plainly and offers the one shortcut off it (§3.3).
    const nextUpcoming = data.upcomingSessions[0] ?? null;
    return (
      <View testID="inicio-rest">
        <Text style={[styles.sessionTitle, { color: tokens.textPrimary }]}>{t('inicioRestDay')}</Text>
        {nextUpcoming !== null && (
          <Text style={[styles.helper, { color: tokens.textSecondary }]}>
            {t('inicioNextSession', {
              weekday: t(WEEKDAY_FULL_KEYS[nextUpcoming.weekday]),
              name: nextUpcoming.name,
            })}
          </Text>
        )}
        {queue.upcoming !== null && queue.upcoming.weekSessionId !== null && (
          <Row
            label={t('restDayPullForward')}
            detail={t('restDayPullForwardDetail')}
            detailBelow
            right={<Ionicons name="chevron-forward" size={tabBar.icon} color={tokens.textSecondary} />}
            onPress={() => void pullForward()}
            disabled={pullingForward}
            testID="inicio-adelantar"
          />
        )}
      </View>
    );
  };

  if (data.queue.routine === null) {
    return (
      <Screen fill testID="inicio-screen">
        <EmptyState
          title={t('inicioNoRoutineMessage')}
          actionLabel={t('goToRoutines')}
          onAction={openRoutines}
          fill
          testID="inicio-no-routine"
        />
      </Screen>
    );
  }

  return (
    <>
      <Screen scroll testID="inicio-screen">
        <Text style={[styles.overline, { color: tokens.textSecondary }]} testID="inicio-overline">
          {overline()}
        </Text>
        <Hero testID="inicio-hero">{renderHero()}</Hero>

        <Section
          title={`${t('inicioWeekTitle')} · ${t('inicioWeekSessionCount', {
            completed: data.week.completed,
            planned: data.week.planned,
          })}`}
          testID="inicio-week"
        >
          <WeekOverview
            days={data.week.days}
            todayStamp={todayStamp}
            weekdayLabels={weekdayLabels}
            statusLabels={weekStatusLabels}
            onSelectDay={openSessionDetail}
            testID="inicio-week-overview"
          />
        </Section>

        <View style={styles.statsRow} testID="inicio-stats">
          <Stat
            value={String(data.streak.weeks)}
            label={t('inicioStatStreakLabel', { count: data.streak.weeks })}
            testID="inicio-stat-streak"
          />
          <Stat
            value={data.cycleStats.adherencePercent === null ? '—' : String(data.cycleStats.adherencePercent)}
            unit={data.cycleStats.adherencePercent === null ? undefined : '%'}
            label={t('inicioStatAdherenceLabel')}
            testID="inicio-stat-adherence"
          />
          <Stat
            value={String(data.cycleStats.cyclesCompleted)}
            label={t('inicioStatCyclesLabel', { count: data.cycleStats.cyclesCompleted })}
            testID="inicio-stat-cycles"
          />
        </View>

        {data.upcomingSessions.length > 0 && (
          <Section title={t('inicioUpcomingTitle')} testID="inicio-upcoming">
            {data.upcomingSessions.map((session, index) => (
              <Text
                key={`${session.weekSessionId ?? 'plan'}-${session.date}-${index}`}
                style={[styles.upcomingLine, { color: tokens.textPrimary }]}
              >
                {t('inicioUpcomingLine', {
                  weekday: t(WEEKDAY_FULL_KEYS[session.weekday]),
                  name: session.name,
                })}
              </Text>
            ))}
          </Section>
        )}

        {undoDiscard !== null && (
          <Row
            label={t('inicioUndoDiscard', { name: undoDiscard.sessionName })}
            onPress={undoLastDiscard}
            disabled={resolving}
            testID="inicio-undo-discard"
          />
        )}
      </Screen>
      {renderResolutionSheet()}

      {/* U2/P1/P2: a resolved week-strip cell opens the same sheet the Progreso calendar does. */}
      <SessionDetailSheet
        target={detailTarget}
        visible={detailTarget !== null && information === null}
        onClose={() => setDetailTarget(null)}
        onOpenExercise={(exerciseName) => setInformation(exerciseName)}
        onEdited={() => void reload()}
        formatDate={formatDate}
        testID="inicio-session-detail"
      />

      {/* R2: the shared exercise sheet, the same one the runner and the editor open. */}
      <ExerciseSheet
        exercise={information === null ? null : { name: information }}
        onClose={() => setInformation(null)}
        onOpenHistory={openExerciseHistory}
      />
    </>
  );
}

const styles = StyleSheet.create({
  overline: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: spacing.cardGap,
  },
  sessionTitle: {
    fontSize: fontSize.screenTitle,
    fontWeight: '700',
  },
  helper: {
    fontSize: fontSize.helper,
    marginTop: spacing.label,
  },
  exerciseList: {
    marginTop: spacing.card,
  },
  exerciseRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
  },
  weight: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  seriesDot: {
    width: dataMark.dot,
    height: dataMark.dot,
    borderRadius: dataMark.dot / 2,
  },
  fullButton: {
    alignSelf: 'stretch',
    marginTop: spacing.card,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.section,
  },
  upcomingLine: {
    fontSize: fontSize.body,
  },
  sheetDate: {
    fontSize: fontSize.helper,
    marginBottom: spacing.cardGap,
  },
  resolutionHint: {
    fontSize: fontSize.helper,
    marginBottom: spacing.cardGap,
  },
  resolutionError: {
    fontSize: fontSize.helper,
    marginTop: spacing.cardGap,
  },
  calendar: {
    marginTop: spacing.cardGap,
  },
});
