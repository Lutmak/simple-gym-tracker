import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import { APP_TEXT_MAX_FONT_SIZE_MULTIPLIER } from '../components/AppTextInput';
import { fontSize, radius, spacing } from '../utils/scale';
import {
  dayStampOf,
  loadTodayState,
  nextOccurrenceStamp,
  resolveMissedSession,
  type MissedSession,
  type TodayExercise,
  type TodaySessionInfo,
  type TodayState,
} from '../utils/today';
import type { RoutineDatabase } from '../utils/routineActions';
import type { TodayStackParamList } from '../App';

type Props = NativeStackScreenProps<TodayStackParamList, 'Today'>;

const WEEKDAY_FULL_KEYS = [
  'weekdayFullSun',
  'weekdayFullMon',
  'weekdayFullTue',
  'weekdayFullWed',
  'weekdayFullThu',
  'weekdayFullFri',
  'weekdayFullSat',
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

export default function TodayScreen({ navigation }: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { dateFormat, firstWeekday } = useSettings();
  const db = useSQLiteContext();

  const [state, setState] = useState<TodayState | null>(null);
  const [expandedMove, setExpandedMove] = useState<number | null>(null);

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

  const reload = useCallback(() => {
    loadTodayState(routineDb, dayStampOf(new Date()))
      .then(setState)
      .catch((error) => console.error('Error loading today:', error));
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const resolve = (
    missed: MissedSession,
    resolution: 'moved' | 'doToday' | 'discarded',
    targetStamp?: number,
  ) => {
    resolveMissedSession(routineDb, missed.weekSessionId, resolution, {
      todayStamp: dayStampOf(new Date()),
      targetStamp,
    })
      .then(() => {
        setExpandedMove(null);
        reload();
      })
      .catch((error) => console.error('Error resolving missed session:', error));
  };

  const formatDate = (stamp: number): string => {
    const date = new Date(stamp * 1000);
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = date.getUTCFullYear();
    return dateFormat === 'mm-dd-yyyy' ? `${mm}/${dd}/${yyyy}` : `${dd}/${mm}/${yyyy}`;
  };

  const weekdayAndDate = (weekday: number, stamp: number): string =>
    t('weekdayAndDate', { weekday: t(WEEKDAY_FULL_KEYS[weekday]), date: formatDate(stamp) });

  const renderExercise = (exercise: TodayExercise) => (
    <View key={exercise.name} style={styles.exerciseRow}>
      <Text style={[styles.exerciseName, { color: theme.text }]} numberOfLines={1}>
        {exercise.name}
      </Text>
      <Text style={[styles.exerciseTarget, { color: theme.text }]}>
        {`${exercise.targetSets} × ${exercise.isAmrap ? `${exercise.targetReps}+` : exercise.targetReps}`}
        {exercise.targetWeight === null
          ? ` · ${t('loadBodyweight')}`
          : ` · ${t('loadAbsoluteValue', {
              weight: formatWeight(exercise.targetWeight),
              unit: exercise.unit,
            })}`}
      </Text>
    </View>
  );

  const renderSession = (session: TodaySessionInfo) => (
    <View
      key={session.weekSessionId}
      style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
    >
      <Text style={[styles.cardTitle, { color: theme.text }]}>{session.name}</Text>
      <Text style={[styles.helper, { color: theme.text }]}>
        {weekdayAndDate(session.weekday, session.date)}
      </Text>
      <View style={styles.exerciseList}>{session.exercises.map(renderExercise)}</View>
      <Pressable
        style={({ pressed }) => [
          styles.primaryButton,
          { backgroundColor: theme.buttonBackground },
          pressed && styles.pressed,
        ]}
        onPress={() =>
          navigation.navigate('StartSession', { weekSessionId: session.weekSessionId })
        }
      >
        <Text style={[styles.primaryButtonText, { color: theme.buttonText }]}>
          {t('todayStartSession')}
        </Text>
      </Pressable>
    </View>
  );

  const renderMissed = (missed: MissedSession) => {
    const moveOpen = expandedMove === missed.weekSessionId;
    const start = firstWeekday === 'Monday' ? 1 : 0;
    const orderedWeekdays = Array.from({ length: 7 }, (_, index) => (start + index) % 7);
    return (
      <View
        key={missed.weekSessionId}
        style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
      >
        <Text style={[styles.cardTitle, { color: theme.text }]}>{missed.name}</Text>
        <Text style={[styles.helper, { color: theme.text }]}>
          {weekdayAndDate(missed.weekday, missed.date)}
        </Text>
        <Text style={[styles.helper, { color: theme.text }]}>{t('missedSessionPrompt')}</Text>
        <View style={styles.buttonRow}>
          <Pressable
            style={({ pressed }) => [
              styles.secondaryButton,
              { borderColor: theme.border },
              pressed && styles.pressed,
            ]}
            onPress={() => setExpandedMove(moveOpen ? null : missed.weekSessionId)}
          >
            <Text style={[styles.secondaryButtonText, { color: theme.text }]}>
              {t('missedMove')}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              styles.grow,
              { backgroundColor: theme.buttonBackground },
              pressed && styles.pressed,
            ]}
            onPress={() => resolve(missed, 'doToday')}
          >
            <Text style={[styles.primaryButtonText, { color: theme.buttonText }]}>
              {t('missedDoToday')}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.secondaryButton,
              { borderColor: theme.border },
              pressed && styles.pressed,
            ]}
            onPress={() => resolve(missed, 'discarded')}
          >
            <Text style={[styles.secondaryButtonText, { color: theme.text }]}>
              {t('missedDiscard')}
            </Text>
          </Pressable>
        </View>
        {moveOpen && (
          <View style={styles.moveArea}>
            <Text style={[styles.helper, { color: theme.text }]}>{t('missedMoveHint')}</Text>
            <View style={styles.weekdayRow}>
              {orderedWeekdays.map((weekday) => (
                <Pressable
                  key={weekday}
                  style={({ pressed }) => [
                    styles.weekdayCell,
                    { borderColor: theme.border },
                    pressed && styles.pressed,
                  ]}
                  onPress={() =>
                    resolve(
                      missed,
                      'moved',
                      nextOccurrenceStamp(dayStampOf(new Date()), weekday),
                    )
                  }
                >
                  <Text
                    maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                    style={[styles.weekdayLetter, { color: theme.text }]}
                  >
                    {t(WEEKDAY_SHORT_KEYS[weekday])}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </View>
    );
  };

  if (state === null) {
    return <View style={[styles.container, { backgroundColor: theme.background }]} />;
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>{t('today')}</Text>

        {state.routine === null ? (
          <View
            style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
          >
            <Text style={[styles.cardTitle, { color: theme.text }]}>
              {t('noActiveRoutineTitle')}
            </Text>
            <Text style={[styles.helper, { color: theme.text }]}>
              {t('noActiveRoutineMessage')}
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: theme.buttonBackground },
                pressed && styles.pressed,
              ]}
              onPress={() => navigation.getParent()?.navigate('Routines')}
            >
              <Text style={[styles.primaryButtonText, { color: theme.buttonText }]}>
                {t('goToRoutines')}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            {state.missed.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>
                  {t('missedSessionsTitle')}
                </Text>
                {state.missed.map(renderMissed)}
              </>
            )}

            {state.dueToday.length > 0 ? (
              <>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>
                  {t('todaySession')}
                </Text>
                {state.dueToday.map(renderSession)}
              </>
            ) : (
              <>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>
                  {t('noSessionTodayTitle')}
                </Text>
                {state.nextSession !== null && (
                  <View
                    style={[
                      styles.card,
                      { backgroundColor: theme.card, borderColor: theme.border },
                    ]}
                  >
                    <Text style={[styles.cardTitle, { color: theme.text }]}>
                      {state.nextSession.name}
                    </Text>
                    <Text style={[styles.helper, { color: theme.text }]}>
                      {weekdayAndDate(state.nextSession.weekday, state.nextSession.date)}
                    </Text>
                  </View>
                )}
                <Pressable
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { backgroundColor: theme.buttonBackground },
                    pressed && styles.pressed,
                  ]}
                  onPress={() => navigation.navigate('FreeLogging')}
                >
                  <Text style={[styles.primaryButtonText, { color: theme.buttonText }]}>
                    {t('freeLogging')}
                  </Text>
                </Pressable>
              </>
            )}
          </>
        )}
      </ScrollView>
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
  helper: {
    fontSize: fontSize.helper,
    opacity: 0.7,
    marginTop: spacing.label,
  },
  exerciseList: {
    marginTop: spacing.card,
    gap: spacing.cardGap,
  },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.inline,
  },
  exerciseName: {
    fontSize: fontSize.body,
    fontWeight: '600',
    flex: 1,
  },
  exerciseTarget: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.inline,
    marginTop: spacing.card,
  },
  primaryButton: {
    borderRadius: radius.control,
    paddingHorizontal: spacing.card,
    paddingVertical: spacing.card,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.card,
  },
  secondaryButton: {
    borderRadius: radius.control,
    borderWidth: 1,
    paddingHorizontal: spacing.card,
    paddingVertical: spacing.card,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: {
    flex: 1,
    marginTop: 0,
  },
  pressed: {
    opacity: 0.7,
  },
  primaryButtonText: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
  secondaryButtonText: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
  moveArea: {
    marginTop: spacing.card,
  },
  weekdayRow: {
    flexDirection: 'row',
    gap: spacing.inline,
    marginTop: spacing.card,
  },
  weekdayCell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdayLetter: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
});
