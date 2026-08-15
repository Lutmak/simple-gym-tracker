import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import { fontSize, radius, spacing, touchTarget } from '../utils/scale';
import AppTextInput, { parseNumericInput } from '../components/AppTextInput';
import ExerciseCatalogPicker from '../components/ExerciseCatalogPicker';
import {
  EditRoutineValidationError,
  saveRoutineEdit,
  type EditRoutine,
  type EditRoutineError,
} from '../utils/editRoutine';
import {
  loadRoutineSourceById,
  type ExerciseSource,
  type RoutineDatabase,
  type RoutineLoadSource,
  type RoutineRole,
  type RoutineUnit,
} from '../utils/routineActions';
import type { BarProfileKey } from '../utils/barProfiles';
import type { RoutinesStackParamList } from '../App';

type Props = NativeStackScreenProps<RoutinesStackParamList, 'EditRoutine'>;

type ScreenExercise = {
  key: string;
  exerciseId: number | null;
  catalogExerciseId: string | null;
  name: string;
  role: RoutineRole;
  sets: string;
  reps: string;
  loadSource: RoutineLoadSource;
  trainingMaxWeight: string;
  trainingMaxPct: number | null;
  absoluteWeight: string;
  unitOverride: RoutineUnit | null;
  isAmrap: boolean;
  barProfile: BarProfileKey | null;
  barWeight: number | null;
};

type ScreenSession = {
  key: string;
  sessionId: number | null;
  weekday: number;
  name: string;
  exercises: ScreenExercise[];
};

type ScreenDraft = {
  name: string;
  unit: RoutineUnit;
  roundingIncrement: string;
  restMainSeconds: string;
  restAccessorySeconds: string;
  sessions: ScreenSession[];
};

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

const LOAD_SOURCES: readonly RoutineLoadSource[] = [
  'absolute',
  'training_max_pct',
  'bodyweight',
];

const UNIT_OVERRIDES: readonly (RoutineUnit | null)[] = [null, 'kg', 'lb'];

const toScreenExercise = (exercise: ExerciseSource): ScreenExercise => ({
  key: `e${exercise.exerciseId}`,
  exerciseId: exercise.exerciseId,
  catalogExerciseId: exercise.catalogExerciseId,
  name: exercise.name,
  role: exercise.role,
  sets: String(exercise.targetSets),
  reps: String(exercise.targetReps),
  loadSource: exercise.loadSource,
  trainingMaxWeight:
    exercise.trainingMaxWeight === null ? '' : String(exercise.trainingMaxWeight),
  trainingMaxPct: exercise.trainingMaxPct,
  absoluteWeight: exercise.absoluteWeight === null ? '' : String(exercise.absoluteWeight),
  unitOverride: exercise.unitOverride,
  isAmrap: exercise.isAmrap,
  barProfile: exercise.barProfile,
  barWeight: exercise.barWeight,
});

const toEditRoutine = (draft: ScreenDraft): EditRoutine => ({
  name: draft.name,
  unit: draft.unit,
  roundingIncrement: parseNumericInput(draft.roundingIncrement) ?? NaN,
  restMainSeconds: parseNumericInput(draft.restMainSeconds) ?? NaN,
  restAccessorySeconds: parseNumericInput(draft.restAccessorySeconds) ?? NaN,
  sessions: draft.sessions.map((session) => ({
    sessionId: session.sessionId,
    weekday: session.weekday,
    name: session.name,
    exercises: session.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      catalogExerciseId: exercise.catalogExerciseId,
      name: exercise.name,
      role: exercise.role,
      targetSets: parseNumericInput(exercise.sets) ?? NaN,
      targetReps: parseNumericInput(exercise.reps) ?? NaN,
      loadSource: exercise.loadSource,
      trainingMaxPct: exercise.trainingMaxPct,
      trainingMaxWeight:
        exercise.loadSource === 'training_max_pct'
          ? parseNumericInput(exercise.trainingMaxWeight)
          : null,
      absoluteWeight:
        exercise.loadSource === 'absolute'
          ? parseNumericInput(exercise.absoluteWeight)
          : null,
      unitOverride: exercise.unitOverride,
      isAmrap: exercise.isAmrap,
      barProfile: exercise.barProfile,
      barWeight: exercise.barWeight,
    })),
  })),
});

const errorKey = (detail: EditRoutineError): string =>
  `editError${detail.code.charAt(0).toUpperCase()}${detail.code.slice(1)}`;

export default function EditRoutineScreen({ navigation, route }: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { firstWeekday } = useSettings();
  const db = useSQLiteContext();
  const { routineId } = route.params;

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

  const [draft, setDraft] = useState<ScreenDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [weekdayPickerFor, setWeekdayPickerFor] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<{
    sessionKey: string;
    exerciseKey: string | null;
    catalogExerciseId: string | null;
  } | null>(null);
  const nextKey = useRef(1000);

  useEffect(() => {
    loadRoutineSourceById(routineDb, routineId)
      .then((source) => {
        navigation.setOptions({ title: source.routine.name });
        setDraft({
          name: source.routine.name,
          unit: source.routine.unit as RoutineUnit,
          roundingIncrement: String(source.routine.roundingIncrement),
          restMainSeconds: String(source.routine.restMainSeconds),
          restAccessorySeconds: String(source.routine.restAccessorySeconds),
          sessions: source.sessions.map((session) => ({
            key: `s${session.sessionId}`,
            sessionId: session.sessionId,
            weekday: session.weekday,
            name: session.name,
            exercises: source.exercises
              .filter((exercise) => exercise.sessionId === session.sessionId)
              .map(toScreenExercise),
          })),
        });
      })
      .catch((error: unknown) => {
        console.error('Error loading routine for editing:', error);
      });
  }, [db, routineId, navigation]);

  const patchSession = useCallback(
    (sessionKey: string, patch: (session: ScreenSession) => ScreenSession) => {
      setDraft((current) => {
        if (current === null) {
          return current;
        }
        return {
          ...current,
          sessions: current.sessions.map((session) =>
            session.key === sessionKey ? patch(session) : session,
          ),
        };
      });
    },
    [],
  );

  const patchExercise = useCallback(
    (
      sessionKey: string,
      exerciseKey: string,
      patch: (exercise: ScreenExercise) => ScreenExercise,
    ) => {
      patchSession(sessionKey, (session) => ({
        ...session,
        exercises: session.exercises.map((exercise) =>
          exercise.key === exerciseKey ? patch(exercise) : exercise,
        ),
      }));
    },
    [patchSession],
  );

  const weekStart = firstWeekday === 'Monday' ? 1 : 0;
  const orderedWeekdays = Array.from({ length: 7 }, (_, index) => (weekStart + index) % 7);

  const weekdayTakenBy = (sessionKey: string, weekday: number): ScreenSession | null => {
    const session = draft?.sessions.find(
      (candidate) => candidate.key !== sessionKey && candidate.weekday === weekday,
    );
    return session ?? null;
  };

  const pickWeekday = (weekday: number) => {
    if (weekdayPickerFor === null || draft === null) {
      return;
    }
    const session = draft.sessions.find((candidate) => candidate.key === weekdayPickerFor);
    if (session === undefined) {
      setWeekdayPickerFor(null);
      return;
    }
    if (session.weekday === weekday) {
      setWeekdayPickerFor(null);
      return;
    }
    const conflict = weekdayTakenBy(weekdayPickerFor, weekday);
    if (conflict !== null) {
      Alert.alert(
        t('dayTakenTitle'),
        t('dayTakenMessage', {
          weekday: t(WEEKDAY_FULL_KEYS[weekday]),
          name: conflict.name,
        }),
      );
      return;
    }
    patchSession(session.key, (current) => ({ ...current, weekday }));
    setWeekdayPickerFor(null);
  };

  const addDay = () => {
    if (draft === null) {
      return;
    }
    if (draft.sessions.length >= 7) {
      Alert.alert(t('maxSessionsTitle'), t('maxSessionsMessage'));
      return;
    }
    const used = new Set(draft.sessions.map((session) => session.weekday));
    let weekday = 0;
    while (used.has(weekday)) {
      weekday += 1;
    }
    setDraft({
      ...draft,
      sessions: [
        ...draft.sessions,
        {
          key: `n${nextKey.current++}`,
          sessionId: null,
          weekday,
          name: t(WEEKDAY_FULL_KEYS[weekday]),
          exercises: [],
        },
      ],
    });
  };

  const removeDay = (sessionKey: string) => {
    const session = draft?.sessions.find((candidate) => candidate.key === sessionKey);
    if (session === undefined) {
      return;
    }
    Alert.alert(
      t('removeDayTitle'),
      t('removeDayMessage', { name: session.name }),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Delete'),
          style: 'destructive',
          onPress: () =>
            setDraft((current) =>
              current === null
                ? current
                : {
                    ...current,
                    sessions: current.sessions.filter(
                      (candidate) => candidate.key !== sessionKey,
                    ),
                  },
            ),
        },
      ],
    );
  };

  const moveDay = (sessionKey: string, direction: -1 | 1) => {
    setDraft((current) => {
      if (current === null) {
        return current;
      }
      const index = current.sessions.findIndex((session) => session.key === sessionKey);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.sessions.length) {
        return current;
      }
      const sessions = [...current.sessions];
      [sessions[index], sessions[target]] = [sessions[target], sessions[index]];
      return { ...current, sessions };
    });
  };

  const openPicker = (sessionKey: string, exercise: ScreenExercise | null) => {
    setPickerFor({
      sessionKey,
      exerciseKey: exercise?.key ?? null,
      catalogExerciseId: exercise?.catalogExerciseId ?? null,
    });
  };

  const applyPickerSelection = (selection: {
    catalogExerciseId: string | null;
    name: string;
  }) => {
    if (pickerFor === null) {
      return;
    }
    if (pickerFor.exerciseKey === null) {
      patchSession(pickerFor.sessionKey, (session) => ({
        ...session,
        exercises: [
          ...session.exercises,
          {
            key: `n${nextKey.current++}`,
            exerciseId: null,
            catalogExerciseId: selection.catalogExerciseId,
            name: selection.name,
            role: 'accessory',
            sets: '3',
            reps: '10',
            loadSource: 'absolute',
            trainingMaxWeight: '',
            trainingMaxPct: null,
            absoluteWeight: '',
            unitOverride: null,
            isAmrap: false,
            barProfile: null,
            barWeight: null,
          },
        ],
      }));
    } else {
      patchExercise(pickerFor.sessionKey, pickerFor.exerciseKey, (exercise) => ({
        ...exercise,
        catalogExerciseId: selection.catalogExerciseId,
        name: selection.name,
      }));
    }
    setPickerFor(null);
  };

  const removeExercise = (sessionKey: string, exerciseKey: string) => {
    const exercise = draft?.sessions
      .find((session) => session.key === sessionKey)
      ?.exercises.find((candidate) => candidate.key === exerciseKey);
    if (exercise === undefined) {
      return;
    }
    Alert.alert(
      t('removeExerciseTitle'),
      t('removeExerciseMessage', { name: exercise.name }),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Delete'),
          style: 'destructive',
          onPress: () =>
            patchSession(sessionKey, (session) => ({
              ...session,
              exercises: session.exercises.filter(
                (candidate) => candidate.key !== exerciseKey,
              ),
            })),
        },
      ],
    );
  };

  const moveExercise = (sessionKey: string, exerciseKey: string, direction: -1 | 1) => {
    patchSession(sessionKey, (session) => {
      const index = session.exercises.findIndex((exercise) => exercise.key === exerciseKey);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= session.exercises.length) {
        return session;
      }
      const exercises = [...session.exercises];
      [exercises[index], exercises[target]] = [exercises[target], exercises[index]];
      return { ...session, exercises };
    });
  };

  const handleSave = async () => {
    if (draft === null) {
      return;
    }
    setBusy(true);
    try {
      await saveRoutineEdit(routineDb, routineId, toEditRoutine(draft));
      setBusy(false);
      Alert.alert(
        t('savedTitle'),
        t('savedMessage', { name: draft.name }),
        [{ text: t('ok'), onPress: () => navigation.goBack() }],
      );
    } catch (error) {
      setBusy(false);
      if (error instanceof EditRoutineValidationError) {
        const { detail } = error;
        Alert.alert(
          t('saveFailedTitle'),
          t(errorKey(detail), {
            exercise:
              'exercise' in detail ? detail.exercise : undefined,
          }),
        );
      } else {
        console.error('Error saving routine:', error);
        Alert.alert(t('saveFailedTitle'), t('saveFailedMessage'));
      }
    }
  };

  if (draft === null) {
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
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.fieldLabel, { color: theme.text }]}>{t('routineNameLabel')}</Text>
          <AppTextInput
            variant='text'
            value={draft.name}
            onChangeText={(name) => setDraft((current) => (current === null ? current : { ...current, name }))}
            placeholder={t('routineNameLabel')}
          />
          <Text style={[styles.fieldLabel, { color: theme.text }]}>{t('unitLabel')}</Text>
          <ChipGroup<RoutineUnit>
            options={[
              { value: 'kg', label: 'kg' },
              { value: 'lb', label: 'lb' },
            ]}
            selected={draft.unit}
            onSelect={(unit) =>
              setDraft((current) => (current === null ? current : { ...current, unit }))
            }
            theme={theme}
          />
          <Text style={[styles.fieldLabel, { color: theme.text }]}>{t('roundingIncrement')}</Text>
          <AppTextInput
            variant='numeric'
            value={draft.roundingIncrement}
            onRawChange={(roundingIncrement) =>
              setDraft((current) =>
                current === null ? current : { ...current, roundingIncrement },
              )
            }
            keyboardType='decimal-pad'
          />
          <Text style={[styles.fieldLabel, { color: theme.text }]}>
            {t('restMainSecondsLabel')}
          </Text>
          <AppTextInput
            variant='numeric'
            value={draft.restMainSeconds}
            onRawChange={(restMainSeconds) =>
              setDraft((current) =>
                current === null ? current : { ...current, restMainSeconds },
              )
            }
            keyboardType='number-pad'
          />
          <Text style={[styles.fieldLabel, { color: theme.text }]}>
            {t('restAccessorySecondsLabel')}
          </Text>
          <AppTextInput
            variant='numeric'
            value={draft.restAccessorySeconds}
            onRawChange={(restAccessorySeconds) =>
              setDraft((current) =>
                current === null ? current : { ...current, restAccessorySeconds },
              )
            }
            keyboardType='number-pad'
          />
        </View>

        <Text style={[styles.sectionTitle, { color: theme.text }]}>
          {t('trainingDaysSection')}
        </Text>

        {draft.sessions.map((session, sessionIndex) => (
          <View
            key={session.key}
            style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
          >
            <View style={styles.dayHeader}>
              <Pressable
                onPress={() => setWeekdayPickerFor(session.key)}
                style={({ pressed }) => [styles.dayHeaderMain, pressed && styles.pressed]}
                accessibilityRole='button'
              >
                <Text style={[styles.dayTitle, { color: theme.text }]}>
                  {t(WEEKDAY_FULL_KEYS[session.weekday])}
                </Text>
                <Ionicons name='swap-horizontal' size={16} color={theme.text} />
              </Pressable>
              <View style={styles.dayHeaderControls}>
                <IconButton
                  icon='arrow-up'
                  label={t('moveDayUp')}
                  disabled={sessionIndex === 0}
                  onPress={() => moveDay(session.key, -1)}
                  theme={theme}
                />
                <IconButton
                  icon='arrow-down'
                  label={t('moveDayDown')}
                  disabled={sessionIndex === draft.sessions.length - 1}
                  onPress={() => moveDay(session.key, 1)}
                  theme={theme}
                />
                <IconButton
                  icon='trash-outline'
                  label={t('removeDayTitle')}
                  danger
                  onPress={() => removeDay(session.key)}
                  theme={theme}
                />
              </View>
            </View>
            <Text
              style={[styles.helper, { color: theme.text }]}
              maxFontSizeMultiplier={1.5}
            >
              {t('reassignDayHint')}
            </Text>
            <AppTextInput
              variant='text'
              value={session.name}
              onChangeText={(name) =>
                patchSession(session.key, (current) => ({ ...current, name }))
              }
              placeholder={t('sessionNamePlaceholder')}
            />

            {session.exercises.map((exercise, exerciseIndex) => (
              <View
                key={exercise.key}
                style={[styles.exerciseCard, { borderColor: theme.border }]}
              >
                <View style={styles.exerciseHeader}>
                  <Pressable
                    onPress={() => openPicker(session.key, exercise)}
                    style={({ pressed }) => [styles.exerciseNameButton, pressed && styles.pressed]}
                    accessibilityRole='button'
                  >
                    <Text style={[styles.exerciseName, { color: theme.text }]} numberOfLines={1}>
                      {exercise.name}
                    </Text>
                    <Ionicons name='swap-horizontal' size={16} color={theme.text} />
                  </Pressable>
                  <View style={styles.exerciseControls}>
                    <IconButton
                      icon='arrow-up'
                      label={t('moveExerciseUp')}
                      disabled={exerciseIndex === 0}
                      onPress={() => moveExercise(session.key, exercise.key, -1)}
                      theme={theme}
                    />
                    <IconButton
                      icon='arrow-down'
                      label={t('moveExerciseDown')}
                      disabled={exerciseIndex === session.exercises.length - 1}
                      onPress={() => moveExercise(session.key, exercise.key, 1)}
                      theme={theme}
                    />
                    <IconButton
                      icon='trash-outline'
                      label={t('removeExerciseTitle')}
                      danger
                      onPress={() => removeExercise(session.key, exercise.key)}
                      theme={theme}
                    />
                  </View>
                </View>

                <Text style={[styles.fieldLabel, { color: theme.text }]}>{t('roleLabel')}</Text>
                <ChipGroup<RoutineRole>
                  options={[
                    { value: 'main', label: t('roleMain') },
                    { value: 'accessory', label: t('roleAccessory') },
                  ]}
                  selected={exercise.role}
                  onSelect={(role) =>
                    patchExercise(session.key, exercise.key, (current) => ({
                      ...current,
                      role,
                      isAmrap: role === 'main' ? current.isAmrap : false,
                    }))
                  }
                  theme={theme}
                />

                {exercise.role === 'main' && (
                  <>
                    <Text style={[styles.fieldLabel, { color: theme.text }]}>{t('amrapLabel')}</Text>
                    <Pressable
                      onPress={() =>
                        patchExercise(session.key, exercise.key, (current) => ({
                          ...current,
                          isAmrap: !current.isAmrap,
                        }))
                      }
                      style={[
                        styles.amrapToggle,
                        {
                          backgroundColor: exercise.isAmrap
                            ? theme.buttonBackground
                            : theme.card,
                          borderColor: theme.border,
                        },
                      ]}
                      accessibilityRole='button'
                    >
                      <Text
                        style={[
                          styles.amrapText,
                          { color: exercise.isAmrap ? theme.buttonText : theme.text },
                        ]}
                        maxFontSizeMultiplier={1.5}
                      >
                        {t('amrapLabel')} · {t(exercise.isAmrap ? 'amrapOn' : 'amrapOff')}
                      </Text>
                    </Pressable>
                  </>
                )}

                <View style={styles.pairRow}>
                  <View style={styles.pairField}>
                    <Text style={[styles.fieldLabel, { color: theme.text }]}>{t('Sets')}</Text>
                    <AppTextInput
                      variant='numeric'
                      value={exercise.sets}
                      onRawChange={(sets) =>
                        patchExercise(session.key, exercise.key, (current) => ({ ...current, sets }))
                      }
                      keyboardType='number-pad'
                    />
                  </View>
                  <View style={styles.pairField}>
                    <Text style={[styles.fieldLabel, { color: theme.text }]}>{t('Reps')}</Text>
                    <AppTextInput
                      variant='numeric'
                      value={exercise.reps}
                      onRawChange={(reps) =>
                        patchExercise(session.key, exercise.key, (current) => ({ ...current, reps }))
                      }
                      keyboardType='number-pad'
                    />
                  </View>
                </View>

                <Text style={[styles.fieldLabel, { color: theme.text }]}>
                  {t('loadSourceLabel')}
                </Text>
                <ChipGroup<RoutineLoadSource>
                  options={[
                    { value: 'absolute', label: t('loadSourceAbsolute') },
                    { value: 'training_max_pct', label: t('loadSourceTrainingMaxPct') },
                    { value: 'bodyweight', label: t('loadBodyweight') },
                  ]}
                  selected={exercise.loadSource}
                  onSelect={(loadSource) =>
                    patchExercise(session.key, exercise.key, (current) => ({
                      ...current,
                      loadSource,
                    }))
                  }
                  theme={theme}
                />

                {exercise.loadSource === 'absolute' && (
                  <>
                    <Text style={[styles.fieldLabel, { color: theme.text }]}>
                      {t('weightLabel', { unit: exercise.unitOverride ?? draft.unit })}
                    </Text>
                    <AppTextInput
                      variant='numeric'
                      value={exercise.absoluteWeight}
                      onRawChange={(absoluteWeight) =>
                        patchExercise(session.key, exercise.key, (current) => ({
                          ...current,
                          absoluteWeight,
                        }))
                      }
                      keyboardType='decimal-pad'
                    />
                  </>
                )}

                {exercise.loadSource === 'training_max_pct' && (
                  <>
                    <Text style={[styles.fieldLabel, { color: theme.text }]}>
                      {t('trainingMaxLabel', { unit: exercise.unitOverride ?? draft.unit })}
                    </Text>
                    <AppTextInput
                      variant='numeric'
                      value={exercise.trainingMaxWeight}
                      onRawChange={(trainingMaxWeight) =>
                        patchExercise(session.key, exercise.key, (current) => ({
                          ...current,
                          trainingMaxWeight,
                        }))
                      }
                      keyboardType='decimal-pad'
                    />
                    <Text
                      style={[styles.helper, { color: theme.text }]}
                      maxFontSizeMultiplier={1.5}
                    >
                      {t('loadTrainingMax', {
                        pct: Math.round((exercise.trainingMaxPct ?? 0.9) * 100),
                      })}
                    </Text>
                  </>
                )}

                <Text style={[styles.fieldLabel, { color: theme.text }]}>
                  {t('unitOverrideLabel')}
                </Text>
                <ChipGroup<RoutineUnit | null>
                  options={UNIT_OVERRIDES.map((unit) => ({
                    value: unit,
                    label: unit ?? t('unitOverrideNone'),
                  }))}
                  selected={exercise.unitOverride}
                  onSelect={(unitOverride) =>
                    patchExercise(session.key, exercise.key, (current) => ({
                      ...current,
                      unitOverride,
                    }))
                  }
                  theme={theme}
                />
              </View>
            ))}

            <Pressable
              onPress={() => openPicker(session.key, null)}
              style={({ pressed }) => [
                styles.addExerciseButton,
                { borderColor: theme.border },
                pressed && styles.pressed,
              ]}
              accessibilityRole='button'
            >
              <Ionicons name='add' size={20} color={theme.text} />
              <Text style={[styles.addExerciseText, { color: theme.text }]}>
                {t('addExercise')}
              </Text>
            </Pressable>
          </View>
        ))}

        <Pressable
          onPress={addDay}
          style={({ pressed }) => [
            styles.addDayButton,
            { borderColor: theme.border },
            pressed && styles.pressed,
          ]}
          accessibilityRole='button'
        >
          <Ionicons name='add' size={20} color={theme.text} />
          <Text style={[styles.addExerciseText, { color: theme.text }]}>{t('addDay')}</Text>
        </Pressable>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Pressable
          disabled={busy}
          onPress={handleSave}
          style={({ pressed }) => [
            styles.saveButton,
            { backgroundColor: theme.buttonBackground },
            pressed && styles.pressed,
            busy && styles.disabled,
          ]}
          accessibilityRole='button'
        >
          <Text style={[styles.saveText, { color: theme.buttonText }]}>{t('Save')}</Text>
        </Pressable>
      </View>

      <Modal
        visible={weekdayPickerFor !== null}
        animationType='fade'
        transparent
        onRequestClose={() => setWeekdayPickerFor(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: theme.background }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>
              {t('moveDayTitle', {
                name:
                  draft.sessions.find((session) => session.key === weekdayPickerFor)?.name ?? '',
              })}
            </Text>
            <View style={styles.weekdayGrid}>
              {orderedWeekdays.map((weekday) => {
                const isOwn = draft.sessions.some(
                  (session) =>
                    session.key === weekdayPickerFor && session.weekday === weekday,
                );
                const isTaken = weekdayTakenBy(weekdayPickerFor ?? '', weekday) !== null;
                return (
                  <Pressable
                    key={weekday}
                    disabled={isTaken && !isOwn}
                    onPress={() => pickWeekday(weekday)}
                    style={({ pressed }) => [
                      styles.weekdayCell,
                      {
                        borderColor: theme.border,
                        backgroundColor: isOwn ? theme.buttonBackground : theme.card,
                      },
                      isTaken && !isOwn && styles.weekdayCellTaken,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole='button'
                  >
                    <Text
                      style={[
                        styles.weekdayCellText,
                        {
                          color: isOwn ? theme.buttonText : theme.text,
                          opacity: isTaken && !isOwn ? 0.35 : 1,
                        },
                      ]}
                      maxFontSizeMultiplier={1.5}
                    >
                      {t(WEEKDAY_SHORT_KEYS[weekday])}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={() => setWeekdayPickerFor(null)}
              style={({ pressed }) => [
                styles.modalClose,
                { borderColor: theme.border },
                pressed && styles.pressed,
              ]}
              accessibilityRole='button'
            >
              <Text style={[styles.modalCloseText, { color: theme.text }]}>{t('Cancel')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <ExerciseCatalogPicker
        visible={pickerFor !== null}
        catalogExerciseId={pickerFor?.catalogExerciseId ?? null}
        onSelect={applyPickerSelection}
        onClose={() => setPickerFor(null)}
      />
    </KeyboardAvoidingView>
  );
}

type Theme = ReturnType<typeof useTheme>['theme'];

type ChipGroupProps<T extends string | null> = {
  options: readonly { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
  theme: Theme;
};

const ChipGroup = <T extends string | null>({
  options,
  selected,
  onSelect,
  theme,
}: ChipGroupProps<T>) => (
  <View style={styles.chipRow}>
    {options.map((option) => {
      const isSelected = option.value === selected;
      return (
        <Pressable
          key={option.label}
          onPress={() => onSelect(option.value)}
          style={({ pressed }) => [
            styles.chip,
            {
              backgroundColor: isSelected ? theme.buttonBackground : theme.card,
              borderColor: theme.border,
            },
            pressed && styles.pressed,
          ]}
          accessibilityRole='button'
        >
          <Text
            style={[
              styles.chipText,
              { color: isSelected ? theme.buttonText : theme.text },
            ]}
            maxFontSizeMultiplier={1.5}
          >
            {option.label}
          </Text>
        </Pressable>
      );
    })}
  </View>
);

type IconButtonProps = {
  icon: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onPress: () => void;
  theme: Theme;
};

const IconButton = ({ icon, label, disabled, danger, onPress, theme }: IconButtonProps) => {
  const color = danger ? '#B00020' : theme.text;
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
      accessibilityRole='button'
      accessibilityLabel={label}
    >
      <Ionicons name={icon as never} size={18} color={color} />
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
  card: {
    borderWidth: 1,
    borderRadius: radius.control,
    padding: spacing.card,
    marginBottom: spacing.cardGap,
  },
  sectionTitle: {
    fontSize: fontSize.sectionTitle,
    fontWeight: '900',
    marginTop: spacing.card,
    marginBottom: spacing.card,
  },
  fieldLabel: {
    fontSize: fontSize.label,
    fontWeight: '600',
    marginTop: spacing.card,
    marginBottom: spacing.label,
  },
  helper: {
    fontSize: fontSize.helper,
    opacity: 0.7,
    marginBottom: spacing.card,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.card,
  },
  dayHeaderMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
    flexShrink: 1,
    minHeight: touchTarget.control,
  },
  dayHeaderControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
  },
  dayTitle: {
    fontSize: fontSize.cardTitle,
    fontWeight: '700',
  },
  exerciseCard: {
    borderWidth: 1,
    borderRadius: radius.control,
    padding: spacing.card,
    marginTop: spacing.card,
  },
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.card,
  },
  exerciseNameButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
    flexShrink: 1,
    minHeight: touchTarget.control,
  },
  exerciseName: {
    fontSize: fontSize.body,
    fontWeight: '700',
    flexShrink: 1,
  },
  exerciseControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
  },
  iconButton: {
    minHeight: touchTarget.icon,
    minWidth: touchTarget.icon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.cardGap,
  },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.card,
    minHeight: touchTarget.control,
    justifyContent: 'center',
  },
  chipText: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
  amrapToggle: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.card,
    minHeight: touchTarget.control,
    justifyContent: 'center',
  },
  amrapText: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
  pairRow: {
    flexDirection: 'row',
    gap: spacing.card,
  },
  pairField: {
    flex: 1,
  },
  addExerciseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.inline,
    borderWidth: 1,
    borderRadius: radius.control,
    minHeight: touchTarget.control,
    marginTop: spacing.card,
  },
  addExerciseText: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
  addDayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.inline,
    borderWidth: 1,
    borderRadius: radius.control,
    minHeight: touchTarget.control,
    marginTop: spacing.label,
  },
  footer: {
    borderTopWidth: 1,
    padding: spacing.gutter,
  },
  saveButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: touchTarget.control,
    borderRadius: radius.control,
  },
  saveText: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.gutter,
  },
  modalCard: {
    width: '100%',
    borderRadius: radius.card,
    padding: spacing.gutter,
  },
  modalTitle: {
    fontSize: fontSize.sectionTitle,
    fontWeight: '900',
    marginBottom: spacing.card,
    textAlign: 'center',
  },
  weekdayGrid: {
    flexDirection: 'row',
    gap: spacing.inline,
    marginBottom: spacing.card,
  },
  weekdayCell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdayCellTaken: {
    opacity: 0.6,
  },
  weekdayCellText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  modalClose: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.control,
    minHeight: touchTarget.control,
  },
  modalCloseText: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
});
