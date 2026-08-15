import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import { displayFontSize, fontSize, radius, spacing, touchTarget } from '../utils/scale';
import AppTextInput, {
  APP_TEXT_MAX_FONT_SIZE_MULTIPLIER,
  parseNumericInput,
} from '../components/AppTextInput';
import ExerciseCatalogPicker from '../components/ExerciseCatalogPicker';
import { saveFreeSession, type FreeLogExercise } from '../utils/freeLogging';
import { dayStampOf } from '../utils/today';
import type { RoutineDatabase, RoutineUnit } from '../utils/routineActions';
import type { InicioStackParamList } from '../App';

type Props = NativeStackScreenProps<InicioStackParamList, 'FreeLogging'>;

interface FreeSetDraft {
  uid: number;
  repsRaw: string;
  weightRaw: string;
}

interface FreeExerciseDraft {
  uid: number;
  name: string;
  unit: RoutineUnit;
  sets: FreeSetDraft[];
}

interface SavedSummary {
  sets: number;
  exercises: number;
}

/**
 * D7 — Free logging (SPECS.md D7): the runner without a routine. Exercises are
 * picked from the catalog (name snapshot only — the history tables have no
 * catalog column, so per-exercise history joins on the copied name), each
 * exercise owns its unit (defaulting to the global weight format), and sets
 * are added one by one and edited in place. No targets, no warm-ups, no rest
 * timer. Saving goes through saveFreeSession, which touches history only.
 */
export default function FreeLoggingScreen({ navigation }: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { weightFormat } = useSettings();
  const db = useSQLiteContext();

  const [exercises, setExercises] = useState<FreeExerciseDraft[]>([]);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [savedSummary, setSavedSummary] = useState<SavedSummary | null>(null);
  const nextUid = useRef(1);

  const uid = (): number => nextUid.current++;

  const defaultUnit: RoutineUnit = weightFormat === 'lbs' ? 'lb' : 'kg';

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

  const hasSets = exercises.some((exercise) => exercise.sets.length > 0);

  useEffect(() => {
    if (savedSummary !== null || !hasSets) {
      return;
    }
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      event.preventDefault();
      Alert.alert(t('runnerExitTitle'), t('runnerExitMessage'), [
        { text: t('runnerStay'), style: 'cancel' },
        {
          text: t('runnerExit'),
          style: 'destructive',
          onPress: () => navigation.dispatch(event.data.action),
        },
      ]);
    });
    return unsubscribe;
  }, [navigation, savedSummary, hasSets, t]);

  const addExercise = (selection: { catalogExerciseId: string | null; name: string }) => {
    setPickerVisible(false);
    setExercises((current) => [
      ...current,
      { uid: uid(), name: selection.name, unit: defaultUnit, sets: [] },
    ]);
  };

  const updateExercise = (
    exerciseUid: number,
    update: (exercise: FreeExerciseDraft) => FreeExerciseDraft,
  ) => {
    setExercises((current) =>
      current.map((exercise) => (exercise.uid === exerciseUid ? update(exercise) : exercise)),
    );
  };

  const addSet = (exerciseUid: number) => {
    updateExercise(exerciseUid, (exercise) => ({
      ...exercise,
      sets: [...exercise.sets, { uid: uid(), repsRaw: '', weightRaw: '' }],
    }));
  };

  const updateSetRaw = (
    exerciseUid: number,
    setUid: number,
    field: 'repsRaw' | 'weightRaw',
    value: string,
  ) => {
    setExercises((current) =>
      current.map((exercise) =>
        exercise.uid === exerciseUid
          ? {
              ...exercise,
              sets: exercise.sets.map((set) =>
                set.uid === setUid ? { ...set, [field]: value } : set,
              ),
            }
          : exercise,
      ),
    );
  };

  const deleteSet = (exerciseUid: number, setUid: number) => {
    updateExercise(exerciseUid, (exercise) => ({
      ...exercise,
      sets: exercise.sets.filter((set) => set.uid !== setUid),
    }));
  };

  const removeExercise = (exercise: FreeExerciseDraft) => {
    Alert.alert(
      t('freeRemoveExerciseTitle'),
      t('freeRemoveExerciseMessage', { name: exercise.name }),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Delete'),
          style: 'destructive',
          onPress: () =>
            setExercises((current) =>
              current.filter((candidate) => candidate.uid !== exercise.uid),
            ),
        },
      ],
    );
  };

  const setExerciseUnit = (exerciseUid: number, unit: RoutineUnit) => {
    updateExercise(exerciseUid, (exercise) => ({ ...exercise, unit }));
  };

  const parseSet = (set: FreeSetDraft): { reps: number; weight: number } | null => {
    const reps = parseNumericInput(set.repsRaw);
    if (reps === null || reps < 1 || !Number.isInteger(reps)) {
      return null;
    }
    const weight = parseNumericInput(set.weightRaw);
    if (weight === null || weight <= 0) {
      return null;
    }
    return { reps, weight };
  };

  const completeSets = exercises.reduce(
    (total, exercise) =>
      total + exercise.sets.filter((set) => parseSet(set) !== null).length,
    0,
  );

  const toFreeLog = (): FreeLogExercise[] =>
    exercises.flatMap((exercise) => {
      const sets = exercise.sets.flatMap((set) => {
        const parsed = parseSet(set);
        return parsed === null ? [] : [parsed];
      });
      return sets.length === 0 ? [] : [{ name: exercise.name, unit: exercise.unit, sets }];
    });

  const finish = () => {
    const log = toFreeLog();
    const loggedSets = log.reduce((total, exercise) => total + exercise.sets.length, 0);
    if (loggedSets === 0) {
      Alert.alert(t('runnerNothingSavedTitle'), t('runnerNothingSavedMessage'), [
        { text: t('runnerStay'), style: 'cancel' },
        {
          text: t('runnerExit'),
          style: 'destructive',
          onPress: () => navigation.goBack(),
        },
      ]);
      return;
    }

    const incomplete = exercises.reduce(
      (total, exercise) => total + exercise.sets.length,
      0,
    ) - loggedSets;

    const confirmAndSave = () => {
      saveFreeSession(routineDb, t('freeSessionName'), dayStampOf(new Date()), log)
        .then(() => {
          setExercises([]);
          setSavedSummary({ sets: loggedSets, exercises: log.length });
        })
        .catch((error) => {
          console.error('Error saving the free session:', error);
          Alert.alert(t('errorTitle'), t('runnerSaveFailed'));
        });
    };

    const confirmDialog = () => {
      Alert.alert(
        t('finishConfirmTitle'),
        t('finishConfirmMessage', {
          session: t('freeSessionName'),
          sets: t('runnerSetsCount', { count: loggedSets }),
          exercises: t('runnerExercisesCount', { count: log.length }),
        }),
        [
          { text: t('Cancel'), style: 'cancel' },
          { text: t('finishSession'), onPress: confirmAndSave },
        ],
      );
    };

    if (incomplete > 0) {
      Alert.alert(
        t('freeIncompleteSetsTitle'),
        t('freeIncompleteSetsMessage', { count: incomplete }),
        [
          { text: t('Cancel'), style: 'cancel' },
          { text: t('finishAnyway'), onPress: confirmDialog },
        ],
      );
    } else {
      confirmDialog();
    }
  };

  if (savedSummary !== null) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: theme.background }]}>
        <Text
          maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          style={[styles.completedTitle, { color: theme.text }]}
        >
          {t('sessionSavedTitle')}
        </Text>
        <Text style={[styles.savedMessage, { color: theme.text }]}>
          {t('sessionSavedMessage', {
            session: t('freeSessionName'),
            sets: t('runnerSetsCount', { count: savedSummary.sets }),
            exercises: t('runnerExercisesCount', { count: savedSummary.exercises }),
          })}
        </Text>
        <Text style={[styles.helper, { color: theme.text }]}>{t('sessionSavedWhere')}</Text>
        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            styles.savedButton,
            { backgroundColor: theme.buttonBackground },
            pressed && styles.pressed,
          ]}
          onPress={() => navigation.getParent()?.navigate('Progress')}
        >
          <Text style={[styles.primaryButtonText, { color: theme.buttonText }]}>
            {t('sessionSavedSeeProgress')}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <Text style={[styles.screenTitle, { color: theme.text }]}>{t('freeLogging')}</Text>
        <Text style={[styles.helper, { color: theme.text }]}>{t('freeLoggingHint')}</Text>

        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: theme.buttonBackground },
            pressed && styles.pressed,
          ]}
          onPress={() => setPickerVisible(true)}
        >
          <Text style={[styles.primaryButtonText, { color: theme.buttonText }]}>
            {t('freeAddExercise')}
          </Text>
        </Pressable>

        {exercises.map((exercise) => (
          <View
            key={exercise.uid}
            style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
          >
            <View style={styles.cardHeader}>
              <Text style={[styles.exerciseName, { color: theme.text }]} numberOfLines={2}>
                {exercise.name}
              </Text>
              <View style={[styles.unitToggle, { borderColor: theme.border }]}>
                {(['kg', 'lb'] as const).map((unit) => {
                  const selected = exercise.unit === unit;
                  return (
                    <Pressable
                      key={unit}
                      hitSlop={4}
                      style={({ pressed }) => [
                        styles.unitOption,
                        selected && { backgroundColor: theme.buttonBackground },
                        pressed && styles.pressed,
                      ]}
                      onPress={() => setExerciseUnit(exercise.uid, unit)}
                      accessibilityRole="button"
                    >
                      <Text
                        maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                        style={[
                          styles.unitOptionText,
                          { color: selected ? theme.buttonText : theme.text },
                        ]}
                      >
                        {unit}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                hitSlop={8}
                accessibilityLabel={t('freeRemoveExerciseTitle')}
                onPress={() => removeExercise(exercise)}
              >
                <Ionicons name="trash-outline" size={20} color={theme.text} />
              </Pressable>
            </View>

            {exercise.sets.map((set, index) => (
              <View key={set.uid} style={styles.setRow}>
                <Text
                  maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                  style={[styles.setPosition, { color: theme.text }]}
                >
                  {t('freeSetPosition', { n: index + 1 })}
                </Text>
                <AppTextInput
                  variant="numeric"
                  style={styles.setInput}
                  value={set.repsRaw}
                  onRawChange={(value) => updateSetRaw(exercise.uid, set.uid, 'repsRaw', value)}
                  keyboardType="numeric"
                  placeholder={t('Reps')}
                />
                <AppTextInput
                  variant="numeric"
                  style={styles.setInput}
                  value={set.weightRaw}
                  onRawChange={(value) => updateSetRaw(exercise.uid, set.uid, 'weightRaw', value)}
                  keyboardType="decimal-pad"
                  placeholder={exercise.unit}
                />
                <Pressable
                  hitSlop={8}
                  accessibilityLabel={t('freeDeleteSet')}
                  onPress={() => deleteSet(exercise.uid, set.uid)}
                >
                  <Ionicons name="close-circle-outline" size={20} color={theme.text} />
                </Pressable>
              </View>
            ))}

            <Pressable
              style={({ pressed }) => [
                styles.secondaryButton,
                { borderColor: theme.border },
                pressed && styles.pressed,
              ]}
              onPress={() => addSet(exercise.uid)}
            >
              <Ionicons name="add" size={20} color={theme.text} />
              <Text style={[styles.secondaryButtonText, { color: theme.text }]}>
                {t('freeAddSet')}
              </Text>
            </Pressable>
          </View>
        ))}

        {exercises.length > 0 && (
          <>
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: theme.buttonBackground },
                pressed && styles.pressed,
              ]}
              onPress={finish}
            >
              <Text style={[styles.primaryButtonText, { color: theme.buttonText }]}>
                {t('finishSession')}
              </Text>
            </Pressable>
            <Text style={[styles.finishHelper, { color: theme.text }]}>
              {t('freeSetsReady', { count: completeSets })}
            </Text>
          </>
        )}
      </ScrollView>

      <ExerciseCatalogPicker
        visible={pickerVisible}
        catalogExerciseId={null}
        onSelect={addExercise}
        onClose={() => setPickerVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.gutter,
  },
  content: {
    padding: spacing.gutter,
    paddingBottom: spacing.section * 2,
  },
  screenTitle: {
    fontSize: fontSize.screenTitle,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: spacing.label,
  },
  helper: {
    fontSize: fontSize.helper,
    opacity: 0.7,
    textAlign: 'center',
    marginTop: spacing.label,
  },
  completedTitle: {
    fontSize: displayFontSize.completedTitle,
    fontWeight: '900',
    textAlign: 'center',
  },
  savedMessage: {
    fontSize: fontSize.body,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: spacing.section,
  },
  savedButton: {
    marginTop: spacing.section,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.card,
    padding: spacing.card,
    marginTop: spacing.cardGap,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.inline,
    marginBottom: spacing.card,
  },
  exerciseName: {
    fontSize: fontSize.cardTitle,
    fontWeight: '700',
    flex: 1,
  },
  unitToggle: {
    flexDirection: 'row',
    borderRadius: radius.control,
    borderWidth: 1,
    overflow: 'hidden',
  },
  unitOption: {
    minWidth: touchTarget.control,
    minHeight: touchTarget.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.card,
  },
  unitOptionText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
    marginBottom: spacing.cardGap,
  },
  setPosition: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    opacity: 0.7,
  },
  setInput: {
    flex: 1,
    paddingHorizontal: spacing.inline,
    paddingVertical: spacing.inline,
    minHeight: touchTarget.control,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.inline,
    borderRadius: radius.control,
    borderWidth: 1,
    minHeight: touchTarget.control,
  },
  secondaryButtonText: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
  primaryButton: {
    borderRadius: radius.control,
    paddingHorizontal: spacing.card,
    paddingVertical: spacing.card,
    minHeight: touchTarget.control,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.section,
  },
  primaryButtonText: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
  finishHelper: {
    fontSize: fontSize.caption,
    opacity: 0.7,
    textAlign: 'center',
    marginTop: spacing.card,
  },
  pressed: {
    opacity: 0.7,
  },
});
