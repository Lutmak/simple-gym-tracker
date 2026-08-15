import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Row } from '../components/Row';
import { Screen } from '../components/Screen';
import { Section } from '../components/Section';
import { Sheet } from '../components/Sheet';
import { WeekOverview } from '../components/WeekOverview';
import { Calendar } from '../components/Calendar';
import { fontSize, spacing, tabBar } from '../utils/scale';
import {
  dayStampOf,
  loadMoveDayPlan,
  resolveDiscardSession,
  resolveDoTodaySession,
  resolveMoveSession,
  undoDiscardSession,
  type MoveDayPlan,
  type QueuedSession,
} from '../utils/today';
import {
  datePartsOfStamp,
  loadInicioData,
  type InicioData,
  type InicioDayStatus,
} from '../utils/inicio';
import type { RoutineDatabase } from '../utils/routineActions';
import type { InicioStackParamList } from '../App';
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

const legendStatuses: readonly InicioDayStatus[] = [
  'completed',
  'moved',
  'discarded',
  'pending',
  'rest',
];

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
  const [resolutionSessionId, setResolutionSessionId] = useState<number | null>(null);
  const [resolutionSession, setResolutionSession] = useState<QueuedSession | null>(null);
  const [resolutionSheetVisible, setResolutionSheetVisible] = useState(false);
  const [resolutionStep, setResolutionStep] = useState<ResolutionStep>('outcomes');
  const [moveDayPlan, setMoveDayPlan] = useState<MoveDayPlan | null>(null);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [pendingReopenId, setPendingReopenId] = useState<number | null>(null);
  const [pendingReopenSession, setPendingReopenSession] = useState<QueuedSession | null>(null);
  const [undoDiscard, setUndoDiscard] = useState<UndoDiscard | null>(null);

  const routineDb: RoutineDatabase = {
    run: (sql: string, params?: readonly unknown[]) => db.runAsync(sql, (params ?? []) as never[]),
    get: async (sql: string, params?: readonly unknown[]) =>
      (await db.getFirstAsync<Record<string, unknown>>(sql, (params ?? []) as never[])) ?? undefined,
    getAll: async (sql: string, params?: readonly unknown[]) =>
      db.getAllAsync<Record<string, unknown>>(sql, (params ?? []) as never[]),
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
      setResolutionSessionId(null);
      setResolutionSession(null);
      setResolutionSheetVisible(false);
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

    setResolutionSessionId(resolutionRequestId);
    setResolutionSession(data.queue.head);
    setResolutionStep('outcomes');
    setMoveDayPlan(null);
    setCalendarVisible(false);
    setResolutionError(null);
    setResolutionSheetVisible(true);
  }, [data, navigation, resolutionRequestId]);

  if (data === null) {
    return (
      <Screen>
        <ActivityIndicator color={tokens.accent} />
      </Screen>
    );
  }

  const todayStamp = dayStampOf(new Date());
  const weekdayLabels = data.week.days.map((day) => t(WEEKDAY_SHORT_KEYS[day.weekday]));
  const legend = legendStatuses.map((status) => ({
    status,
    label: t(`inicioWeek${status[0].toUpperCase()}${status.slice(1)}`),
  }));

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
  const startSession = (weekSessionId: number) =>
    navigation.navigate('StartSession', { weekSessionId });
  // H2 consumes this route request to mount the standard resolution Sheet.
  const openSessionResolution = (weekSessionId: number) =>
    navigation.navigate('InicioIndex', { resolutionWeekSessionId: weekSessionId });

  const closeResolution = () => {
    setPendingReopenId(null);
    setPendingReopenSession(null);
    setResolutionSessionId(null);
    setResolutionSession(null);
    setResolutionSheetVisible(false);
    setResolutionStep('outcomes');
    setMoveDayPlan(null);
    setCalendarVisible(false);
    setResolutionError(null);
  };

  const handleSheetClosed = useCallback(() => {
    if (pendingReopenId === null) {
      setPendingReopenSession(null);
      setResolutionSession(null);
      return;
    }
    setPendingReopenId(null);
    setPendingReopenSession(null);
    setResolutionSessionId(pendingReopenId);
    setResolutionSession(pendingReopenSession);
    setResolutionStep('outcomes');
    setMoveDayPlan(null);
    setCalendarVisible(false);
    setResolutionError(null);
    setResolutionSheetVisible(true);
  }, [pendingReopenId, pendingReopenSession]);

  const finishResolution = (next: InicioData | null) => {
    if (!navigation.isFocused()) {
      setPendingReopenId(null);
      setPendingReopenSession(null);
      setResolutionSessionId(null);
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
    setResolutionSessionId(null);
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

  const renderAnswer = () => {
    if (data.queue.routine === null) {
      return (
        <EmptyState
          title={t('inicioNoRoutineMessage')}
          actionLabel={t('goToRoutines')}
          onAction={openRoutines}
          testID="inicio-no-routine"
        />
      );
    }

    if (data.queue.head !== null && data.queue.resolution === 'unresolved') {
      const session = data.queue.head;
      const resolutionChoices = session.doTodayAvailable
        ? t('inicioResolutionChoices')
        : t('inicioResolutionChoicesWithoutToday');
      return (
        <View testID="inicio-unresolved">
          <Text style={[styles.overline, { color: tokens.textSecondary }]}>{t('inicioUnresolved')}</Text>
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

    if (data.queue.head !== null && data.queue.resolution === 'due') {
      const session = data.queue.head;
      const exercises = session.exercises.slice(0, 5);
      const remaining = session.exercises.length - exercises.length;
      const summary = data.durationMinutes === null
        ? t('inicioExerciseCount', { count: session.exercises.length })
        : t('inicioExerciseCountWithDuration', {
            count: session.exercises.length,
            minutes: data.durationMinutes,
          });
      return (
        <View testID="inicio-due">
          <Text style={[styles.overline, { color: tokens.textSecondary }]}>{t('inicioToday')}</Text>
          <Text style={[styles.sessionTitle, { color: tokens.textPrimary }]}>{session.name}</Text>
          <Text style={[styles.helper, { color: tokens.textSecondary }]}>{summary}</Text>
          <View style={styles.exerciseList}>
            {exercises.map((exercise) => (
              <Row
                key={exercise.name}
                label={exercise.name}
                detail={`${exercise.targetSets} × ${exercise.isAmrap ? `${exercise.targetReps}+` : exercise.targetReps}`}
                right={
                  <Text style={[styles.weight, { color: tokens.textPrimary }]}>
                    {exercise.targetWeight === null
                      ? '—'
                      : `${formatWeight(exercise.targetWeight)} ${exercise.unit}`}
                  </Text>
                }
                divided
              />
            ))}
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

    return (
      <View testID="inicio-rest">
        <Text style={[styles.overline, { color: tokens.textSecondary }]}>{t('inicioToday')}</Text>
        <Text style={[styles.sessionTitle, { color: tokens.textPrimary }]}>{t('inicioRestDay')}</Text>
        {data.queue.upcoming !== null && (
          <Text style={[styles.helper, { color: tokens.textSecondary }]}>
            {t('inicioNextSession', {
              weekday: t(WEEKDAY_FULL_KEYS[data.queue.upcoming.weekday]),
              name: data.queue.upcoming.name,
            })}
          </Text>
        )}
        <Row label={t('inicioFreeLogging')} onPress={() => navigation.navigate('FreeLogging')} />
      </View>
    );
  };

  return (
    <>
      <Screen scroll testID="inicio-screen">
        <Section testID="inicio-answer">
          {renderAnswer()}
        </Section>
        <Section title={t('inicioWeekTitle')} testID="inicio-week">
          <WeekOverview
            days={data.week.days}
            todayStamp={todayStamp}
            weekdayLabels={weekdayLabels}
            legend={legend}
          />
        </Section>
        <Text style={[styles.streak, { color: tokens.textPrimary }]} testID="inicio-streak">
          {t('inicioStreak', {
            count: data.streak.weeks,
            weeks: data.streak.weeks,
            completed: data.streak.current.completed,
            planned: data.streak.current.planned,
          })}
        </Text>
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
    </>
  );
}

const styles = StyleSheet.create({
  overline: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  sessionTitle: {
    fontSize: fontSize.screenTitle,
    fontWeight: '700',
    marginTop: spacing.label,
  },
  helper: {
    fontSize: fontSize.helper,
    marginTop: spacing.label,
  },
  exerciseList: {
    marginTop: spacing.card,
  },
  weight: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  fullButton: {
    alignSelf: 'stretch',
    marginTop: spacing.card,
  },
  streak: {
    fontSize: fontSize.body,
    fontWeight: '600',
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
