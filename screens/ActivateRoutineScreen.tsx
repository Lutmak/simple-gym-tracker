import React, { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import { fontSize, spacing } from '../utils/scale';
import AppTextInput from '../components/AppTextInput';
import { ExerciseSheet } from '../components/ExerciseSheet';
import {
  activatePresetRoutine,
  loadPresetRoutineSource,
  type ExerciseSource,
  type RoutineDatabase,
  type RoutineSourceBundle,
  type RoutineUnit,
} from '../utils/routineActions';
import type { RoutinesStackParamList } from '../App';

type Props = NativeStackScreenProps<RoutinesStackParamList, 'ActivateRoutine'>;

type InputState = Record<number, string>;

export default function ActivateRoutineScreen({ navigation, route }: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { weightFormat } = useSettings();
  const db = useSQLiteContext();
  const { presetKey } = route.params;

  const unit: RoutineUnit = weightFormat === 'lbs' ? 'lb' : 'kg';

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
  const [inputs, setInputs] = useState<InputState>({});
  const [busy, setBusy] = useState(false);
  /** R2: the exercise whose shared sheet is open. */
  const [information, setInformation] = useState<ExerciseSource | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadPresetRoutineSource(routineDb, presetKey)
        .then((loaded) => {
          setSource(loaded);
          navigation.setOptions({ title: loaded.routine.name });
        })
        .catch((error: unknown) => {
          console.error('Error loading preset routine:', error);
        });
    }, [db, presetKey, navigation]),
  );

  const needsInput = (loadSource: string): boolean => loadSource !== 'bodyweight';

  const setInput = (exerciseId: number, value: string) => {
    setInputs((current) => ({ ...current, [exerciseId]: value }));
  };

  const handleActivate = async () => {
    if (!source) {
      return;
    }
    const missing = source.exercises.some(
      (exercise) => needsInput(exercise.loadSource) && !(inputs[exercise.exerciseId] ?? ''),
    );
    if (missing) {
      Alert.alert(t('missingWeightsTitle'), t('missingWeightsMessage'));
      return;
    }

    const weightInputs = new Map<
      number,
      { trainingMaxWeight: number | null; absoluteWeight: number | null }
    >();
    for (const exercise of source.exercises) {
      const raw = inputs[exercise.exerciseId];
      const value = raw === undefined ? null : Number(raw);
      if (exercise.loadSource === 'training_max_pct') {
        weightInputs.set(exercise.exerciseId, {
          trainingMaxWeight: value,
          absoluteWeight: null,
        });
      } else if (exercise.loadSource === 'absolute') {
        weightInputs.set(exercise.exerciseId, {
          trainingMaxWeight: null,
          absoluteWeight: value,
        });
      }
    }

    setBusy(true);
    try {
      await activatePresetRoutine(routineDb, presetKey, unit, weightInputs);
      setBusy(false);
      Alert.alert(
        t('routineActivated'),
        t('routineActivatedMessage', { name: source.routine.name }),
        [{ text: t('ok'), onPress: () => navigation.popToTop() }],
      );
    } catch (error) {
      console.error('Error activating routine:', error);
      setBusy(false);
      Alert.alert(t('errorTitle'), t('errorActivatingRoutine'));
    }
  };

  if (!source) {
    return <View style={[styles.container, { backgroundColor: theme.background }]} />;
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps='handled'
      >
        <Text style={[styles.helper, { color: theme.text }]}>{t('setStartingWeightsHint')}</Text>
        {source.routine.progressionRule === 'wave' && (
          <Text style={[styles.helper, { color: theme.text }]}>{t('trainingMaxHint')}</Text>
        )}

        {source.sessions.map((session) => {
          const sessionExercises = source.exercises.filter(
            (exercise) => exercise.sessionId === session.sessionId,
          );
          return (
            <View
              key={session.sessionId}
              style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
            >
              <Text style={[styles.dayTitle, { color: theme.text }]}>{session.name}</Text>
              {sessionExercises.map((exercise) => (
                <View key={exercise.exerciseId} style={styles.exercise}>
                  {/* R2: the name opens the shared exercise sheet; the weight field keeps its own taps. */}
                  <Pressable
                    onPress={() => setInformation(exercise)}
                    accessibilityRole='button'
                    accessibilityLabel={t('exerciseInfoAction')}
                  >
                    <Text style={[styles.exerciseName, { color: theme.text }]} numberOfLines={1}>
                      {exercise.name}
                    </Text>
                  </Pressable>
                  <Text style={[styles.exerciseDetail, { color: theme.text }]}>
                    {exercise.targetSets}×{exercise.targetReps}
                  </Text>
                  {needsInput(exercise.loadSource) ? (
                    <AppTextInput
                      variant='numeric'
                      style={styles.input}
                      value={inputs[exercise.exerciseId] ?? ''}
                      onRawChange={(value) => setInput(exercise.exerciseId, value)}
                      keyboardType='decimal-pad'
                      placeholder={
                        exercise.loadSource === 'training_max_pct'
                          ? t('trainingMaxLabel', { unit })
                          : t('startingWeightLabel', { unit })
                      }
                    />
                  ) : (
                    <Text style={[styles.exerciseDetail, { color: theme.text }]}>
                      {t('bodyweightNoWeight')}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          disabled={busy}
          onPress={handleActivate}
          style={({ pressed }) => [
            styles.activateButton,
            { backgroundColor: theme.buttonBackground },
            pressed && styles.buttonPressed,
            busy && styles.buttonDisabled,
          ]}
        >
          <Text style={[styles.activateText, { color: theme.buttonText }]}>{t('activate')}</Text>
        </Pressable>
      </View>

      {/* R2: the shared exercise sheet. */}
      <ExerciseSheet
        exercise={
          information === null
            ? null
            : {
                name: information.name,
                catalogExerciseId: information.catalogExerciseId,
              }
        }
        plan={
          information === null
            ? null
            : {
                role: information.role,
                targetSets: information.targetSets,
                targetReps: information.targetReps,
                isAmrap: information.isAmrap,
              }
        }
        onClose={() => setInformation(null)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.gutter,
    paddingBottom: spacing.section,
  },
  helper: {
    fontSize: fontSize.helper,
    opacity: 0.7,
    marginBottom: spacing.card,
  },
  card: {
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.card,
    marginBottom: spacing.cardGap,
  },
  dayTitle: {
    fontSize: fontSize.cardTitle,
    fontWeight: '700',
    marginBottom: spacing.card,
  },
  exercise: {
    marginBottom: spacing.card,
  },
  exerciseName: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  exerciseDetail: {
    fontSize: fontSize.caption,
    opacity: 0.7,
    marginTop: 2,
  },
  input: {
    marginTop: spacing.label,
  },
  footer: {
    padding: spacing.gutter,
  },
  activateButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: 10,
  },
  activateText: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
});
