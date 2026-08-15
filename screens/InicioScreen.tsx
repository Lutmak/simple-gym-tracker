import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Row } from '../components/Row';
import { Screen } from '../components/Screen';
import { Section } from '../components/Section';
import { WeekOverview } from '../components/WeekOverview';
import { fontSize, spacing } from '../utils/scale';
import { dayStampOf } from '../utils/today';
import {
  datePartsOfStamp,
  loadInicioData,
  type InicioData,
  type InicioDayStatus,
} from '../utils/inicio';
import type { RoutineDatabase } from '../utils/routineActions';
import type { InicioStackParamList } from '../App';

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

export default function InicioScreen({ navigation }: Props) {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const { firstWeekday } = useSettings();
  const db = useSQLiteContext();
  const [data, setData] = useState<InicioData | null>(null);

  const routineDb: RoutineDatabase = {
    run: (sql: string, params?: readonly unknown[]) => db.runAsync(sql, (params ?? []) as never[]),
    get: async (sql: string, params?: readonly unknown[]) =>
      (await db.getFirstAsync<Record<string, unknown>>(sql, (params ?? []) as never[])) ?? undefined,
    getAll: async (sql: string, params?: readonly unknown[]) =>
      db.getAllAsync<Record<string, unknown>>(sql, (params ?? []) as never[]),
  };

  const reload = useCallback(() => {
    loadInicioData(routineDb, dayStampOf(new Date()), firstWeekday)
      .then(setData)
      .catch((error) => console.error('Error loading Inicio:', error));
  }, [db, firstWeekday]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

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
      return (
        <View testID="inicio-unresolved">
          <Text style={[styles.overline, { color: tokens.textSecondary }]}>{t('inicioUnresolved')}</Text>
          <Text style={[styles.sessionTitle, { color: tokens.textPrimary }]}>{data.queue.head.name}</Text>
          <Text style={[styles.helper, { color: tokens.textSecondary }]}>
            {formatDate(data.queue.head.date)} · {t('inicioNotLogged')}
          </Text>
          <Row
            label={t('inicioResolveSession')}
            detail={t('inicioResolutionChoices')}
            divided
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
          weeks: data.streak.weeks,
          completed: data.streak.current.completed,
          planned: data.streak.current.planned,
        })}
      </Text>
    </Screen>
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
});
