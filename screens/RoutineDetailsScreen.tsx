import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import { fontSize, spacing } from '../utils/scale';
import WeekdayIndicator from '../components/WeekdayIndicator';
import {
  activatePresetRoutine,
  activateRoutineById,
  deleteRoutine,
  duplicateRoutine,
  getActiveRoutine,
  loadPresetRoutineSource,
  loadRoutineSourceById,
  routineNeedsWeights,
  type ExerciseSource,
  type RoutineDatabase,
  type RoutineSourceBundle,
  type RoutineUnit,
} from '../utils/routineActions';
import type { RoutinesStackParamList } from '../App';

type Props = NativeStackScreenProps<RoutinesStackParamList, 'RoutineDetails'>;

const WEEKDAY_FULL_KEYS = [
  'weekdayFullSun',
  'weekdayFullMon',
  'weekdayFullTue',
  'weekdayFullWed',
  'weekdayFullThu',
  'weekdayFullFri',
  'weekdayFullSat',
] as const;

const formatRest = (seconds: number): string =>
  seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`;

const formatWeight = (value: number): string => String(Number(value.toFixed(1)));

export default function RoutineDetailsScreen({ navigation, route }: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { weightFormat, firstWeekday } = useSettings();
  const db = useSQLiteContext();
  const { routineId, presetKey } = route.params;

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

  const [source, setSource] = useState<RoutineSourceBundle | null>(null);
  const [busy, setBusy] = useState(false);

  const isPreset = presetKey !== undefined;

  useFocusEffect(
    useCallback(() => {
      const load = async () => {
        try {
          const loaded =
            presetKey !== undefined
              ? await loadPresetRoutineSource(routineDb, presetKey)
              : await loadRoutineSourceById(routineDb, routineId as number);
          setSource(loaded);
          navigation.setOptions({ title: loaded.routine.name });
        } catch (error) {
          console.error('Error loading routine:', error);
        }
      };
      load();
    }, [db, routineId, presetKey, navigation]),
  );

  if (!source) {
    return <View style={[styles.container, { backgroundColor: theme.background }]} />;
  }

  const { routine, sessions, exercises } = source;
  const isActive = routine.isActive;
  const unit: RoutineUnit = routine.unit ?? (weightFormat === 'lbs' ? 'lb' : 'kg');
  const weekdays = sessions.map((session) => session.weekday);

  const weekStart = firstWeekday === 'Monday' ? 1 : 0;
  const orderedSessions = [...sessions].sort(
    (a, b) => ((a.weekday - weekStart + 7) % 7) - ((b.weekday - weekStart + 7) % 7),
  );

  const progressionText =
    routine.progressionRule === 'wave'
      ? t('progressionWave')
      : routine.progressionRule === 'linear'
        ? t('progressionLinear')
        : t('progressionNone');

  const loadLabel = (exercise: ExerciseSource): string => {
    const exerciseUnit: RoutineUnit = exercise.unitOverride ?? unit;
    if (exercise.loadSource === 'bodyweight') {
      return t('loadBodyweight');
    }
    if (exercise.loadSource === 'absolute') {
      return exercise.absoluteWeight !== null
        ? t('loadAbsoluteValue', {
            weight: formatWeight(exercise.absoluteWeight),
            unit: exerciseUnit,
          })
        : t('weightAtActivation');
    }
    if (exercise.trainingMaxWeight !== null) {
      return t('loadTrainingMaxValue', {
        weight: formatWeight(exercise.trainingMaxWeight),
        unit: exerciseUnit,
      });
    }
    const pct = exercise.trainingMaxPct !== null ? Math.round(exercise.trainingMaxPct * 100) : 90;
    return t('loadTrainingMax', { pct });
  };

  const confirmAndActivate = (proceed: () => void) => {
    getActiveRoutine(routineDb).then((active) => {
      if (active) {
        Alert.alert(
          t('switchRoutineTitle'),
          t('switchRoutineMessage', { name: active.name }),
          [
            { text: t('Cancel'), style: 'cancel' },
            { text: t('confirm'), onPress: proceed },
          ],
        );
      } else {
        proceed();
      }
    });
  };

  const finishActivation = () => {
    setBusy(false);
    Alert.alert(
      t('routineActivated'),
      t('routineActivatedMessage', { name: routine.name }),
      [{ text: t('ok'), onPress: () => navigation.popToTop() }],
    );
  };

  const activateNow = async () => {
    setBusy(true);
    try {
      if (presetKey !== undefined) {
        await activatePresetRoutine(routineDb, presetKey, unit, new Map());
      } else {
        await activateRoutineById(routineDb, routineId as number);
      }
      finishActivation();
    } catch (error) {
      console.error('Error activating routine:', error);
      setBusy(false);
      Alert.alert(t('errorTitle'), t('errorActivatingRoutine'));
    }
  };

  const handleActivate = () => {
    if (presetKey !== undefined && routineNeedsWeights(source)) {
      confirmAndActivate(() => navigation.navigate('ActivateRoutine', { presetKey }));
    } else {
      confirmAndActivate(activateNow);
    }
  };

  const handleDuplicate = () => {
    setBusy(true);
    duplicateRoutine(routineDb, routineId as number)
      .then(() => {
        setBusy(false);
        Alert.alert(
          t('routineDuplicated'),
          t('routineDuplicatedMessage', { name: routine.name }),
          [{ text: t('ok'), onPress: () => navigation.popToTop() }],
        );
      })
      .catch((error: unknown) => {
        console.error('Error duplicating routine:', error);
        setBusy(false);
        Alert.alert(t('errorTitle'), t('errorDuplicatingRoutine'));
      });
  };

  const handleDelete = () => {
    Alert.alert(
      t('deleteRoutineTitle'),
      isActive
        ? t('deleteRoutineActiveMessage', { name: routine.name })
        : t('deleteRoutineMessage', { name: routine.name }),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Delete'),
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            deleteRoutine(routineDb, routineId as number)
              .then(() => {
                setBusy(false);
                navigation.popToTop();
              })
              .catch((error: unknown) => {
                console.error('Error deleting routine:', error);
                setBusy(false);
                Alert.alert(t('errorTitle'), t('errorDeletingRoutine'));
              });
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: theme.text }]}>{routine.name}</Text>
          {isActive && (
            <View style={[styles.activeBadge, { backgroundColor: theme.buttonBackground }]}>
              <Text
                style={[styles.activeBadgeText, { color: theme.buttonText }]}
                maxFontSizeMultiplier={1.5}
              >
                {t('activeRoutine')}
              </Text>
            </View>
          )}
        </View>

        {routine.description !== null && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('description')}</Text>
            <Text style={[styles.body, { color: theme.text }]}>{routine.description}</Text>
          </View>
        )}

        {routine.philosophy !== null && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('philosophy')}</Text>
            <Text style={[styles.body, { color: theme.text }]}>{routine.philosophy}</Text>
          </View>
        )}

        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={styles.statRow}>
            <Text style={[styles.statLabel, { color: theme.text }]}>{t('recommendedDays')}</Text>
            <Text style={[styles.statValue, { color: theme.text }]}>
              {routine.recommendedDays ?? sessions.length}
            </Text>
          </View>
          <View style={styles.weekdayRow}>
            <WeekdayIndicator weekdays={weekdays} />
          </View>
          <View style={styles.statRow}>
            <Text style={[styles.statLabel, { color: theme.text }]}>
              {t('sessionCount', { count: sessions.length })}
            </Text>
          </View>
          <View style={styles.statRow}>
            <Text style={[styles.statLabel, { color: theme.text }]}>{t('restMainLabel')}</Text>
            <Text style={[styles.statValue, { color: theme.text }]}>
              {formatRest(routine.restMainSeconds)}
            </Text>
          </View>
          <View style={styles.statRow}>
            <Text style={[styles.statLabel, { color: theme.text }]}>{t('restAccessoryLabel')}</Text>
            <Text style={[styles.statValue, { color: theme.text }]}>
              {formatRest(routine.restAccessorySeconds)}
            </Text>
          </View>
          <View style={styles.statRow}>
            <Text style={[styles.statLabel, { color: theme.text }]}>{t('progressionRule')}</Text>
            <Text style={[styles.statValue, { color: theme.text }]}>{progressionText}</Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('weekOverview')}</Text>
        {orderedSessions.map((session) => {
          const sessionExercises = exercises.filter(
            (exercise) => exercise.sessionId === session.sessionId,
          );
          return (
            <View
              key={session.sessionId}
              style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
            >
              <Text style={[styles.dayTitle, { color: theme.text }]}>
                {t(WEEKDAY_FULL_KEYS[session.weekday])} · {session.name}
              </Text>
              {sessionExercises.map((exercise) => (
                <View key={exercise.exerciseId} style={styles.exerciseRow}>
                  <Text style={[styles.exerciseName, { color: theme.text }]} numberOfLines={1}>
                    {exercise.name}
                  </Text>
                  <Text
                    style={[styles.exerciseDetail, { color: theme.text }]}
                    maxFontSizeMultiplier={1.5}
                  >
                    {exercise.targetSets}×{exercise.targetReps} · {loadLabel(exercise)}
                  </Text>
                </View>
              ))}
            </View>
          );
        })}
      </ScrollView>

      <View style={[styles.actionBar, { backgroundColor: theme.card, borderColor: theme.border }]}>
        {isActive ? (
          <View style={[styles.actionBadge, { backgroundColor: theme.buttonBackground }]}>
            <Text style={[styles.actionBadgeText, { color: theme.buttonText }]}>
              {t('activeRoutine')}
            </Text>
          </View>
        ) : (
          <ActionButton
            label={t('activate')}
            icon='play'
            primary
            disabled={busy}
            onPress={handleActivate}
            theme={theme}
          />
        )}
        {!isPreset && (
          <>
            <ActionButton
              label={t('edit')}
              icon='create-outline'
              disabled={busy}
              onPress={() => navigation.navigate('EditRoutine', { routineId: routineId as number })}
              theme={theme}
            />
            <ActionButton
              label={t('duplicate')}
              icon='copy-outline'
              disabled={busy}
              onPress={handleDuplicate}
              theme={theme}
            />
            <ActionButton
              label={t('delete')}
              icon='trash-outline'
              danger
              disabled={busy}
              onPress={handleDelete}
              theme={theme}
            />
          </>
        )}
      </View>
    </View>
  );
}

type Theme = ReturnType<typeof useTheme>['theme'];

type ActionButtonProps = {
  label: string;
  icon: string;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  onPress: () => void;
  theme: Theme;
};

const ActionButton = ({
  label,
  icon,
  disabled,
  primary,
  danger,
  onPress,
  theme,
}: ActionButtonProps) => {
  const color = primary ? theme.buttonText : danger ? '#B00020' : theme.text;
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        primary && { backgroundColor: theme.buttonBackground },
        danger && { borderColor: '#B00020' },
        pressed && styles.actionPressed,
        disabled && styles.actionDisabled,
      ]}
    >
      <Ionicons name={icon as never} size={20} color={color} />
      <Text
        style={[styles.actionLabel, { color }]}
        maxFontSizeMultiplier={1.5}
      >
        {label}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.gutter,
    paddingBottom: spacing.section,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
    marginBottom: spacing.section,
  },
  title: {
    fontSize: fontSize.screenTitle,
    fontWeight: '900',
    flexShrink: 1,
  },
  activeBadge: {
    borderRadius: 100,
    paddingHorizontal: spacing.card,
    paddingVertical: 2,
  },
  activeBadgeText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  section: {
    marginBottom: spacing.section,
  },
  sectionTitle: {
    fontSize: fontSize.sectionTitle,
    fontWeight: '900',
    marginBottom: spacing.card,
  },
  body: {
    fontSize: fontSize.body,
    lineHeight: 20,
    opacity: 0.85,
  },
  card: {
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.card,
    marginBottom: spacing.cardGap,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.card,
    marginBottom: spacing.label,
  },
  statLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  statValue: {
    fontSize: fontSize.body,
    flexShrink: 1,
    textAlign: 'right',
  },
  weekdayRow: {
    marginBottom: spacing.card,
  },
  dayTitle: {
    fontSize: fontSize.cardTitle,
    fontWeight: '700',
    marginBottom: spacing.card,
  },
  exerciseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.card,
    paddingVertical: spacing.label,
  },
  exerciseName: {
    fontSize: fontSize.body,
    flexShrink: 1,
  },
  exerciseDetail: {
    fontSize: fontSize.caption,
    opacity: 0.7,
  },
  actionBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    padding: spacing.card,
    gap: spacing.cardGap,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 10,
    paddingVertical: spacing.label,
  },
  actionLabel: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    marginTop: 2,
  },
  actionPressed: {
    opacity: 0.7,
  },
  actionDisabled: {
    opacity: 0.4,
  },
  actionBadge: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    minHeight: 48,
  },
  actionBadgeText: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
});
