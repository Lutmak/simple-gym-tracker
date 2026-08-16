import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import AppTextInput from '../components/AppTextInput';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import ExerciseCatalogPicker, {
  type ExercisePickerSelection,
} from '../components/ExerciseCatalogPicker';
import { ExerciseSheet } from '../components/ExerciseSheet';
import { Field } from '../components/Field';
import { NumberStepper } from '../components/NumberStepper';
import { Row } from '../components/Row';
import { Screen } from '../components/Screen';
import { ScreenTitle } from '../components/ScreenTitle';
import { Section } from '../components/Section';
import { SegmentedControl } from '../components/SegmentedControl';
import { Sheet } from '../components/Sheet';
import { Switch } from '../components/Switch';
import { fontSize, spacing, tabBar } from '../utils/scale';
import {
  BAR_PROFILES,
  defaultBarProfileForCatalogRow,
  formatWeight,
  isValidCustomBarWeight,
  type BarProfileKey,
} from '../utils/barProfiles';
import {
  DEFAULT_TARGET_REPS,
  DEFAULT_TARGET_SETS,
  EditRoutineValidationError,
  saveRoutineEdit,
  type EditRoutine,
  type EditRoutineError,
} from '../utils/editRoutine';
import {
  loadRoutineSourceById,
  warmupsEnabledFor,
  type ExerciseSource,
  type RoutineDatabase,
  type RoutineLoadSource,
  type RoutineProgressionRule,
  type RoutineRole,
  type RoutineUnit,
} from '../utils/routineActions';
import {
  BLANK_REST_ACCESSORY_SECONDS,
  BLANK_REST_MAIN_SECONDS,
} from '../utils/routineLibrary';
import {
  assignWeekday,
  firstFreeWeekday,
  orderByWeekday,
  weekdayOrder,
} from '../utils/trainingDays';
import {
  defaultRoundingIncrement,
  ROUNDING_INCREMENT_OPTIONS,
  WAVE_MAX_PLANNED_JOKERS,
} from '../utils/waveSetup';
import type { RootTabParamList, RoutinesStackParamList } from '../App';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';

type Props = NativeStackScreenProps<RoutinesStackParamList, 'EditRoutine'>;

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

const BAR_PROFILE_LABEL_KEYS: Record<BarProfileKey, string> = {
  olympic: 'runnerBarProfileOlympic',
  'semi-olympic': 'runnerBarProfileSemiOlympic',
  smith: 'runnerBarProfileSmith',
  ez: 'runnerBarProfileEz',
  custom: 'runnerBarProfileCustom',
};

const NO_BAR = 'none';
const SAME_UNIT = 'same';
const MAX_TRAINING_DAYS = 7;

type Step = 'plan' | 'days' | 'review';

type ScreenExercise = {
  key: string;
  exerciseId: number | null;
  catalogExerciseId: string | null;
  name: string;
  role: RoutineRole;
  sets: number | null;
  reps: number | null;
  loadSource: RoutineLoadSource;
  trainingMaxWeight: number | null;
  trainingMaxPct: number | null;
  absoluteWeight: number | null;
  unitOverride: RoutineUnit | null;
  isAmrap: boolean;
  barProfile: BarProfileKey | null;
  barWeight: number | null;
  warmupsEnabled: boolean | null;
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
  progressionRule: RoutineProgressionRule;
  roundingIncrement: number;
  restMainSeconds: number | null;
  restAccessorySeconds: number | null;
  plannedJokers: number | null;
  sessions: ScreenSession[];
};

const toScreenExercise = (exercise: ExerciseSource): ScreenExercise => ({
  key: `e${exercise.exerciseId}`,
  exerciseId: exercise.exerciseId,
  catalogExerciseId: exercise.catalogExerciseId,
  name: exercise.name,
  role: exercise.role,
  sets: exercise.targetSets,
  reps: exercise.targetReps,
  loadSource: exercise.loadSource,
  trainingMaxWeight: exercise.trainingMaxWeight,
  trainingMaxPct: exercise.trainingMaxPct,
  absoluteWeight: exercise.absoluteWeight,
  unitOverride: exercise.unitOverride,
  isAmrap: exercise.isAmrap,
  barProfile: exercise.barProfile,
  barWeight: exercise.barWeight,
  warmupsEnabled: exercise.warmupsEnabled,
});

/**
 * The draft as the database wants it. **Every number falls back to a value the
 * app can supply on its own** — that is the whole of R3's "no save is ever
 * blocked by a missing number": an emptied field is not an error state, it is
 * the user saying "you decide".
 */
const toEditRoutine = (
  draft: ScreenDraft,
  fallback: { routineName: string; weekdayName: (weekday: number) => string },
): EditRoutine => ({
  name: draft.name.trim() === '' ? fallback.routineName : draft.name,
  unit: draft.unit,
  roundingIncrement:
    draft.roundingIncrement > 0 ? draft.roundingIncrement : defaultRoundingIncrement(draft.unit),
  restMainSeconds: draft.restMainSeconds ?? BLANK_REST_MAIN_SECONDS,
  restAccessorySeconds: draft.restAccessorySeconds ?? BLANK_REST_ACCESSORY_SECONDS,
  plannedJokers: draft.plannedJokers ?? 0,
  sessions: draft.sessions.map((session) => ({
    sessionId: session.sessionId,
    weekday: session.weekday,
    name: session.name.trim() === '' ? fallback.weekdayName(session.weekday) : session.name,
    exercises: session.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      catalogExerciseId: exercise.catalogExerciseId,
      name: exercise.name,
      role: exercise.role,
      targetSets: exercise.sets ?? DEFAULT_TARGET_SETS,
      targetReps: exercise.reps ?? DEFAULT_TARGET_REPS,
      loadSource: exercise.loadSource,
      trainingMaxPct: exercise.trainingMaxPct,
      trainingMaxWeight: exercise.trainingMaxWeight,
      absoluteWeight: exercise.absoluteWeight,
      unitOverride: exercise.unitOverride,
      isAmrap: exercise.isAmrap,
      barProfile: exercise.barProfile,
      barWeight: exercise.barWeight,
      warmupsEnabled: exercise.warmupsEnabled,
    })),
  })),
});

const errorKey = (detail: EditRoutineError): string =>
  `editError${detail.code.charAt(0).toUpperCase()}${detail.code.slice(1)}`;

/**
 * R3 — editing a routine (SPECS.md R3, §3.2, §3.6, §7).
 *
 * **The defect:** *"Uf, en serio, no me agrada este workflow. No se pudo guardar: introduce un
 * máximo de entrenamiento para Squat."* The old screen was one endless form of cards inside cards
 * that demanded a weight it could have learned, reordered training days with a pair of up/down
 * arrows, and refused a weekday that was taken.
 *
 * What replaced it, and why each piece is where it is:
 *
 * - **Three deliberate steps — la rutina · los días · revisar.** The review is a checkout at the
 *   end of a flow, not a card at the bottom of a form, and every card on it returns to exactly the
 *   section it summarises (the plan step, the advanced block opened, or one specific day expanded).
 * - **`Opciones avanzadas` is the last thing on the first step.** Training days used to sit below
 *   it, which is the specific defect R3 names. Advanced holds only what the app can decide on its
 *   own: rest between sets and planned jokers. Each states its recommended value and opens with the
 *   recommendation already applied.
 * - **The weekday picker is a weekday picker** (utils/trainingDays.ts). No arrows: seven days, one
 *   selected, and choosing a day another session holds **swaps the two** rather than refusing.
 * - **Nothing here blocks on a number.** Every numeric field falls back to a default at save time,
 *   so `saveRoutineEdit` cannot fail for an empty field; starting weights live behind an optional
 *   disclosure in the exercise editor, in plain words (§3.2).
 * - **Editing affects future sessions only.** `saveRoutineEdit` updates kept rows in place so ids
 *   survive, and history tables copy their values at log time and are never touched.
 */
export default function EditRoutineScreen({ navigation, route }: Props) {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const { firstWeekday } = useSettings();
  const db = useSQLiteContext();
  const { routineId } = route.params;

  const routineDb: RoutineDatabase = {
    run: (sql, params) => db.runAsync(sql, (params ?? []) as never[]),
    get: async (sql, params) =>
      (await db.getFirstAsync<Record<string, unknown>>(sql, (params ?? []) as never[])) ?? undefined,
    getAll: async (sql, params) =>
      db.getAllAsync<Record<string, unknown>>(sql, (params ?? []) as never[]),
  };

  const [draft, setDraft] = useState<ScreenDraft | null>(null);
  const [step, setStep] = useState<Step>('plan');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [openDayKey, setOpenDayKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ sessionKey: string; exerciseKey: string } | null>(null);
  const [pickerFor, setPickerFor] = useState<{
    sessionKey: string;
    exerciseKey: string | null;
    catalogExerciseId: string | null;
  } | null>(null);
  /** R2: the exercise whose shared sheet is open, with the plan row it was opened from. */
  const [information, setInformation] = useState<ScreenExercise | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextKey = useRef(1000);
  const originalName = useRef('');

  useEffect(() => {
    loadRoutineSourceById(routineDb, routineId)
      .then((source) => {
        originalName.current = source.routine.name;
        setDraft({
          name: source.routine.name,
          unit: (source.routine.unit ?? 'kg') as RoutineUnit,
          progressionRule: source.routine.progressionRule,
          roundingIncrement: source.routine.roundingIncrement,
          restMainSeconds: source.routine.restMainSeconds,
          restAccessorySeconds: source.routine.restAccessorySeconds,
          plannedJokers: source.routine.plannedJokers,
          sessions: orderByWeekday(
            source.sessions.map((session) => ({
              key: `s${session.sessionId}`,
              sessionId: session.sessionId,
              weekday: session.weekday,
              name: session.name,
              exercises: source.exercises
                .filter((exercise) => exercise.sessionId === session.sessionId)
                .map(toScreenExercise),
            })),
            firstWeekday,
          ),
        });
      })
      .catch(() => setError(t('routineLibraryError')));
    // Deliberately keyed on the routine alone: re-running this would discard
    // the user's unsaved draft, and neither the locale nor the week setting is
    // worth that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, routineId]);

  const patchDraft = (patch: (current: ScreenDraft) => ScreenDraft) =>
    setDraft((current) => (current === null ? current : patch(current)));

  const patchSession = (sessionKey: string, patch: (session: ScreenSession) => ScreenSession) =>
    patchDraft((current) => ({
      ...current,
      sessions: current.sessions.map((session) =>
        session.key === sessionKey ? patch(session) : session,
      ),
    }));

  const patchExercise = (
    sessionKey: string,
    exerciseKey: string,
    patch: (exercise: ScreenExercise) => ScreenExercise,
  ) =>
    patchSession(sessionKey, (session) => ({
      ...session,
      exercises: session.exercises.map((exercise) =>
        exercise.key === exerciseKey ? patch(exercise) : exercise,
      ),
    }));

  const moveWeekday = (sessionKey: string, weekday: number) =>
    patchDraft((current) => ({
      ...current,
      sessions: orderByWeekday(assignWeekday(current.sessions, sessionKey, weekday), firstWeekday),
    }));

  const addDay = () => {
    if (draft === null || draft.sessions.length >= MAX_TRAINING_DAYS) {
      return;
    }
    const weekday = firstFreeWeekday(draft.sessions, firstWeekday);
    if (weekday === null) {
      return;
    }
    const key = `n${nextKey.current++}`;
    patchDraft((current) => ({
      ...current,
      sessions: orderByWeekday(
        [
          ...current.sessions,
          {
            key,
            sessionId: null,
            weekday,
            name: t(WEEKDAY_FULL_KEYS[weekday]),
            exercises: [],
          },
        ],
        firstWeekday,
      ),
    }));
    setOpenDayKey(key);
  };

  const removeDay = (sessionKey: string) =>
    patchDraft((current) => ({
      ...current,
      sessions: current.sessions.filter((session) => session.key !== sessionKey),
    }));

  const moveExercise = (sessionKey: string, exerciseKey: string, direction: -1 | 1) =>
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

  const removeExercise = (sessionKey: string, exerciseKey: string) => {
    setEditing(null);
    patchSession(sessionKey, (session) => ({
      ...session,
      exercises: session.exercises.filter((exercise) => exercise.key !== exerciseKey),
    }));
  };

  const applyPickerSelection = (selection: ExercisePickerSelection) => {
    if (pickerFor === null) {
      return;
    }
    const barProfile = defaultBarProfileForCatalogRow(selection.equipment, selection.usesBar);
    if (pickerFor.exerciseKey === null) {
      const key = `n${nextKey.current++}`;
      patchSession(pickerFor.sessionKey, (session) => ({
        ...session,
        exercises: [
          ...session.exercises,
          {
            key,
            exerciseId: null,
            catalogExerciseId: selection.catalogExerciseId,
            name: selection.name,
            role: 'accessory',
            sets: DEFAULT_TARGET_SETS,
            reps: DEFAULT_TARGET_REPS,
            loadSource: 'absolute',
            trainingMaxWeight: null,
            trainingMaxPct: null,
            absoluteWeight: null,
            unitOverride: null,
            isAmrap: false,
            barProfile,
            barWeight: null,
            warmupsEnabled: null,
          },
        ],
      }));
    } else {
      patchExercise(pickerFor.sessionKey, pickerFor.exerciseKey, (exercise) => ({
        ...exercise,
        catalogExerciseId: selection.catalogExerciseId,
        name: selection.name,
        // The bar belongs to the exercise, so replacing the exercise replaces it.
        barProfile,
        barWeight: null,
      }));
    }
    setPickerFor(null);
  };

  /** R2's link from the exercise sheet to that exercise's full chart, on the Progreso tab. */
  const openExerciseHistory = (exerciseName: string) => {
    setInformation(null);
    navigation
      .getParent<BottomTabNavigationProp<RootTabParamList>>()
      ?.navigate('Progress', { exercise: exerciseName });
  };

  const handleSave = async () => {
    if (draft === null || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveRoutineEdit(
        routineDb,
        routineId,
        toEditRoutine(draft, {
          routineName: originalName.current || t('routineNewDefaultName'),
          weekdayName: (weekday) => t(WEEKDAY_FULL_KEYS[weekday]),
        }),
      );
      navigation.goBack();
    } catch (failure) {
      if (failure instanceof EditRoutineValidationError) {
        const { detail } = failure;
        setError(
          t(errorKey(detail), { exercise: 'exercise' in detail ? detail.exercise : undefined }),
        );
      } else {
        setError(t('saveFailedMessage'));
      }
    } finally {
      setBusy(false);
    }
  };

  const goBack = () => {
    if (step === 'review') {
      setStep('days');
    } else if (step === 'days') {
      setStep('plan');
    } else {
      navigation.goBack();
    }
  };

  const chevron = (name: string) => (
    <Ionicons name={name} size={tabBar.icon} color={tokens.textSecondary} />
  );

  if (draft === null) {
    return (
      <Screen testID="edit-routine-screen">
        <ScreenTitle title={t('editRoutineTitle')} onBack={() => navigation.goBack()} />
        {error !== null && <Text style={[styles.error, { color: tokens.warning }]}>{error}</Text>}
      </Screen>
    );
  }

  const editingExercise =
    editing === null
      ? null
      : (draft.sessions
          .find((session) => session.key === editing.sessionKey)
          ?.exercises.find((exercise) => exercise.key === editing.exerciseKey) ?? null);
  const editingSession =
    editing === null
      ? null
      : (draft.sessions.find((session) => session.key === editing.sessionKey) ?? null);

  const advancedSummary = (): string => {
    const parts = [
      t('editRestMainSummary', { seconds: draft.restMainSeconds ?? BLANK_REST_MAIN_SECONDS }),
      t('editRestAccessorySummary', {
        seconds: draft.restAccessorySeconds ?? BLANK_REST_ACCESSORY_SECONDS,
      }),
    ];
    if (draft.progressionRule === 'wave') {
      parts.push(
        (draft.plannedJokers ?? 0) === 0
          ? t('plannedJokersOff')
          : t('plannedJokersSummary', { count: draft.plannedJokers ?? 0 }),
      );
    }
    return parts.join(' · ');
  };

  const exerciseSummary = (exercise: ScreenExercise): string =>
    `${exercise.name} · ${t('routineSetsByReps', {
      sets: exercise.sets ?? DEFAULT_TARGET_SETS,
      reps: exercise.reps ?? DEFAULT_TARGET_REPS,
    })}`;

  const renderPlanStep = () => (
    <>
      <Section title={t('editPlanSection')} testID="edit-plan">
        <Field label={t('routineNameLabel')}>
          <AppTextInput
            variant="text"
            value={draft.name}
            onChangeText={(name) => patchDraft((current) => ({ ...current, name }))}
            placeholder={t('routineNameLabel')}
          />
        </Field>
        <Field label={t('unitLabel')} hint={t('unitNote')}>
          <SegmentedControl<RoutineUnit>
            options={[
              { value: 'kg', label: 'kg' },
              { value: 'lb', label: 'lb' },
            ]}
            value={draft.unit}
            onChange={(unit) =>
              patchDraft((current) => ({
                ...current,
                unit,
                // The increment is a property of the plates in the gym, so it
                // follows the unit unless the user has already chosen one that
                // exists in the new unit too.
                roundingIncrement: ROUNDING_INCREMENT_OPTIONS[unit].includes(
                  current.roundingIncrement,
                )
                  ? current.roundingIncrement
                  : defaultRoundingIncrement(unit),
              }))
            }
            testID="edit-unit"
          />
        </Field>
        <Field
          label={t('roundingIncrement')}
          hint={t('roundingIncrementHint', {
            value: formatWeight(defaultRoundingIncrement(draft.unit)),
            unit: draft.unit,
          })}
        >
          <SegmentedControl<string>
            options={ROUNDING_INCREMENT_OPTIONS[draft.unit].map((increment) => ({
              value: String(increment),
              label: `${formatWeight(increment)} ${draft.unit}`,
            }))}
            value={String(draft.roundingIncrement)}
            onChange={(value) =>
              patchDraft((current) => ({ ...current, roundingIncrement: Number(value) }))
            }
            testID="edit-rounding"
          />
        </Field>
      </Section>

      {/* Advanced is the LAST thing on this step — the specific defect R3 names. */}
      <Section testID="edit-advanced">
        <Row
          label={t('advancedHeader')}
          detail={advancedSummary()}
          detailBelow
          right={chevron(advancedOpen ? 'chevron-up' : 'chevron-down')}
          onPress={() => setAdvancedOpen(!advancedOpen)}
          divided
          testID="edit-advanced-toggle"
        />
        {advancedOpen && (
          <View style={styles.advancedBody}>
            <Field
              label={t('restMainSecondsLabel')}
              hint={t('editRestRecommended', { seconds: BLANK_REST_MAIN_SECONDS })}
            >
              <NumberStepper
                value={draft.restMainSeconds}
                onChange={(restMainSeconds) =>
                  patchDraft((current) => ({ ...current, restMainSeconds }))
                }
                step={15}
                min={0}
                max={600}
                testID="edit-rest-main"
              />
            </Field>
            <Field
              label={t('restAccessorySecondsLabel')}
              hint={t('editRestRecommended', { seconds: BLANK_REST_ACCESSORY_SECONDS })}
            >
              <NumberStepper
                value={draft.restAccessorySeconds}
                onChange={(restAccessorySeconds) =>
                  patchDraft((current) => ({ ...current, restAccessorySeconds }))
                }
                step={15}
                min={0}
                max={600}
                testID="edit-rest-accessory"
              />
            </Field>
            {draft.progressionRule === 'wave' && (
              <Field label={t('plannedJokersLabel')} hint={t('plannedJokersHint')}>
                <NumberStepper
                  value={draft.plannedJokers}
                  onChange={(plannedJokers) =>
                    patchDraft((current) => ({ ...current, plannedJokers }))
                  }
                  step={1}
                  min={0}
                  max={WAVE_MAX_PLANNED_JOKERS}
                  testID="edit-planned-jokers"
                />
              </Field>
            )}
          </View>
        )}
      </Section>

      <Button
        label={t('editContinueToDays')}
        onPress={() => setStep('days')}
        style={styles.primary}
        testID="edit-to-days"
      />
    </>
  );

  const renderDaysStep = () => (
    <>
      <Section hint={t('editWeekdayHint')} testID="edit-days">
        {draft.sessions.length === 0 && (
          <EmptyState
            icon="calendar-outline"
            title={t('routineNoTrainingDays')}
            message={t('editNoDaysMessage')}
          />
        )}
        {draft.sessions.map((session) => {
          const open = openDayKey === session.key;
          return (
            <View key={session.key}>
              <Row
                label={`${t(WEEKDAY_FULL_KEYS[session.weekday])} · ${session.name}`}
                detail={
                  session.exercises.length === 0
                    ? t('editDayNoExercises')
                    : t('editDayExerciseCount', { count: session.exercises.length })
                }
                detailBelow
                right={chevron(open ? 'chevron-up' : 'chevron-down')}
                onPress={() => setOpenDayKey(open ? null : session.key)}
                divided
                testID={`edit-day-${session.key}`}
              />
              {open && (
                // The indent is what says these belong to the day above them;
                // a filled surface would be a card inside a screen (§3.5).
                <View style={styles.dayBody}>
                  <Field label={t('sessionNamePlaceholder')}>
                    <AppTextInput
                      variant="text"
                      value={session.name}
                      onChangeText={(name) =>
                        patchSession(session.key, (current) => ({ ...current, name }))
                      }
                      placeholder={t('sessionNamePlaceholder')}
                    />
                  </Field>
                  <Field label={t('editWeekdayLabel')}>
                    <SegmentedControl<string>
                      options={weekdayOrder(firstWeekday).map((weekday) => ({
                        value: String(weekday),
                        label: t(WEEKDAY_SHORT_KEYS[weekday]),
                      }))}
                      value={String(session.weekday)}
                      onChange={(value) => moveWeekday(session.key, Number(value))}
                      testID={`edit-weekday-${session.key}`}
                    />
                  </Field>
                  {session.exercises.map((exercise) => (
                    <Row
                      key={exercise.key}
                      label={exercise.name}
                      detail={`${t(
                        exercise.role === 'main' ? 'roleMain' : 'roleAccessory',
                      )} · ${t('routineSetsByReps', {
                        sets: exercise.sets ?? DEFAULT_TARGET_SETS,
                        reps: exercise.reps ?? DEFAULT_TARGET_REPS,
                      })}`}
                      detailBelow
                      right={chevron('chevron-forward')}
                      onPress={() =>
                        setEditing({ sessionKey: session.key, exerciseKey: exercise.key })
                      }
                      divided
                      testID={`edit-exercise-${exercise.key}`}
                    />
                  ))}
                  <Row
                    label={t('addExercise')}
                    right={chevron('add')}
                    onPress={() =>
                      setPickerFor({
                        sessionKey: session.key,
                        exerciseKey: null,
                        catalogExerciseId: null,
                      })
                    }
                    divided
                    testID={`edit-add-exercise-${session.key}`}
                  />
                  <Row
                    label={t('removeDayTitle')}
                    detail={t('editRemoveDayDetail')}
                    detailBelow
                    right={chevron('trash-outline')}
                    onPress={() => removeDay(session.key)}
                    testID={`edit-remove-day-${session.key}`}
                  />
                </View>
              )}
            </View>
          );
        })}
        {draft.sessions.length < MAX_TRAINING_DAYS && (
          <Row label={t('addDay')} right={chevron('add')} onPress={addDay} testID="edit-add-day" />
        )}
      </Section>

      <Button
        label={t('editContinueToReview')}
        onPress={() => setStep('review')}
        style={styles.primary}
        testID="edit-to-review"
      />
    </>
  );

  const renderReviewStep = () => (
    <>
      <Section title={t('editPlanSection')} hint={t('reviewTapHint')} testID="edit-review-plan">
        <Row
          label={draft.name.trim() === '' ? originalName.current : draft.name}
          detail={`${draft.unit} · ${t('roundingIncrement')} ${formatWeight(
            draft.roundingIncrement,
          )} ${draft.unit}`}
          detailBelow
          right={chevron('chevron-forward')}
          onPress={() => {
            setAdvancedOpen(false);
            setStep('plan');
          }}
          divided
          testID="edit-review-basics"
        />
        <Row
          label={t('advancedHeader')}
          detail={advancedSummary()}
          detailBelow
          right={chevron('chevron-forward')}
          onPress={() => {
            setAdvancedOpen(true);
            setStep('plan');
          }}
          divided
          testID="edit-review-advanced"
        />
      </Section>

      <Section title={t('trainingDaysSection')} testID="edit-review-days">
        {draft.sessions.length === 0 && (
          <EmptyState
            icon="calendar-outline"
            title={t('routineNoTrainingDays')}
            message={t('editNoDaysMessage')}
            actionLabel={t('addDay')}
            onAction={() => {
              setStep('days');
              addDay();
            }}
          />
        )}
        {draft.sessions.map((session) => (
          <Row
            key={session.key}
            label={`${t(WEEKDAY_FULL_KEYS[session.weekday])} · ${session.name}`}
            detail={
              session.exercises.length === 0
                ? t('editDayNoExercises')
                : session.exercises.map(exerciseSummary).join('\n')
            }
            detailBelow
            right={chevron('chevron-forward')}
            onPress={() => {
              setOpenDayKey(session.key);
              setStep('days');
            }}
            divided
            testID={`edit-review-day-${session.key}`}
          />
        ))}
      </Section>

      <Text style={[styles.note, { color: tokens.textSecondary }]} maxFontSizeMultiplier={1.5}>
        {t('editHistoryNote')}
      </Text>

      <Button
        label={t('Save')}
        onPress={() => void handleSave()}
        disabled={busy}
        style={styles.primary}
        testID="edit-save"
      />
    </>
  );

  return (
    <>
      <Screen scroll testID="edit-routine-screen">
        <ScreenTitle
          overline={step === 'plan' ? t('editRoutineTitle') : draft.name}
          title={
            step === 'plan'
              ? draft.name
              : step === 'days'
                ? t('trainingDaysSection')
                : t('reviewHeader')
          }
          onBack={goBack}
        />

        {step === 'plan' && renderPlanStep()}
        {step === 'days' && renderDaysStep()}
        {step === 'review' && renderReviewStep()}

        {error !== null && <Text style={[styles.error, { color: tokens.warning }]}>{error}</Text>}
      </Screen>

      {editingExercise !== null && editingSession !== null && (
        <ExerciseEditorSheet
          session={editingSession}
          exercise={editingExercise}
          unit={draft.unit}
          roundingIncrement={draft.roundingIncrement}
          onClose={() => setEditing(null)}
          onPatch={(patch) =>
            patchExercise(editingSession.key, editingExercise.key, (current) => ({
              ...current,
              ...patch,
            }))
          }
          onReplace={() => {
            // Two Modals must never be open at once: the editor closes, the
            // picker opens, and the changed row is waiting in the day list.
            setEditing(null);
            setPickerFor({
              sessionKey: editingSession.key,
              exerciseKey: editingExercise.key,
              catalogExerciseId: editingExercise.catalogExerciseId,
            });
          }}
          onMove={(direction) => moveExercise(editingSession.key, editingExercise.key, direction)}
          onRemove={() => removeExercise(editingSession.key, editingExercise.key)}
          onInformation={() => {
            setEditing(null);
            setInformation(editingExercise);
          }}
        />
      )}

      <ExerciseCatalogPicker
        visible={pickerFor !== null}
        catalogExerciseId={pickerFor?.catalogExerciseId ?? null}
        onSelect={applyPickerSelection}
        onClose={() => setPickerFor(null)}
      />

      {/* R2: the same sheet the runner, the picker and Progreso open. */}
      <ExerciseSheet
        exercise={
          information === null
            ? null
            : { name: information.name, catalogExerciseId: information.catalogExerciseId }
        }
        plan={
          information === null
            ? null
            : {
                role: information.role,
                targetSets: information.sets ?? DEFAULT_TARGET_SETS,
                targetReps: information.reps ?? DEFAULT_TARGET_REPS,
                isAmrap: information.isAmrap,
              }
        }
        onClose={() => setInformation(null)}
        onOpenHistory={openExerciseHistory}
      />
    </>
  );
}

type ExerciseEditorSheetProps = {
  session: ScreenSession;
  exercise: ScreenExercise;
  unit: RoutineUnit;
  roundingIncrement: number;
  onClose: () => void;
  onPatch: (patch: Partial<ScreenExercise>) => void;
  onReplace: () => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onInformation: () => void;
};

/**
 * Everything one exercise of a routine is, in one `Sheet` — "a decision about the thing you
 * touched" (§3.5). It exists so the day list can stay a list of rows: the old screen printed every
 * one of these controls inline, per exercise, inside a card inside a card.
 *
 * The starting weight sits behind its own disclosure and says in plain words what the app does with
 * it (§3.2): the user who knows their numbers can enter them, and everyone else never sees a weight
 * field at all.
 */
function ExerciseEditorSheet({
  session,
  exercise,
  unit,
  roundingIncrement,
  onClose,
  onPatch,
  onReplace,
  onMove,
  onRemove,
  onInformation,
}: ExerciseEditorSheetProps) {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const [weightsOpen, setWeightsOpen] = useState(false);

  const index = session.exercises.findIndex((candidate) => candidate.key === exercise.key);
  const exerciseUnit = exercise.unitOverride ?? unit;
  const warmupsOn = warmupsEnabledFor(exercise.role, exercise.warmupsEnabled);
  const chevron = (name: string) => (
    <Ionicons name={name} size={tabBar.icon} color={tokens.textSecondary} />
  );

  const barSummary = (): string => {
    if (exercise.barProfile === null) {
      return t('editBarNone');
    }
    const label = t(BAR_PROFILE_LABEL_KEYS[exercise.barProfile]);
    const weight =
      exercise.barProfile === 'custom'
        ? exercise.barWeight
        : exerciseUnit === 'kg'
          ? BAR_PROFILES[exercise.barProfile].weightKg
          : BAR_PROFILES[exercise.barProfile].weightLb;
    return weight === null || !isValidCustomBarWeight(weight)
      ? t('runnerBarSummaryNoWeight', { profile: label })
      : t('runnerBarSummary', { profile: label, weight: formatWeight(weight), unit: exerciseUnit });
  };

  return (
    <Sheet visible onClose={onClose} title={exercise.name} testID="edit-exercise-sheet">
      <ScrollView
        style={styles.sheetBody}
        contentContainerStyle={styles.sheetBodyContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Row
          label={t('editReplaceExercise')}
          detail={t('editReplaceExerciseDetail')}
          detailBelow
          right={chevron('swap-horizontal')}
          onPress={onReplace}
          divided
          testID="edit-exercise-replace"
        />
        <Row
          label={t('exerciseInfoAction')}
          right={chevron('information-circle-outline')}
          onPress={onInformation}
          divided
          testID="edit-exercise-info"
        />

        <Field label={t('roleLabel')} hint={t('editRoleHint')}>
          <SegmentedControl<RoutineRole>
            options={[
              { value: 'main', label: t('roleMain') },
              { value: 'accessory', label: t('roleAccessory') },
            ]}
            value={exercise.role}
            onChange={(role) =>
              onPatch({ role, isAmrap: role === 'main' ? exercise.isAmrap : false })
            }
            testID="edit-exercise-role"
          />
        </Field>

        <Field label={t('Sets')}>
          <NumberStepper
            value={exercise.sets}
            onChange={(sets) => onPatch({ sets })}
            step={1}
            min={1}
            max={20}
            testID="edit-exercise-sets"
          />
        </Field>
        <Field label={t('Reps')}>
          <NumberStepper
            value={exercise.reps}
            onChange={(reps) => onPatch({ reps })}
            step={1}
            min={1}
            max={100}
            testID="edit-exercise-reps"
          />
        </Field>

        <Row
          label={t('runnerWarmups')}
          detail={warmupsOn ? t('editWarmupsOnDetail') : t('editWarmupsOffDetail')}
          detailBelow
          right={
            <Switch
              value={warmupsOn}
              onValueChange={(value) => onPatch({ warmupsEnabled: value })}
              testID="edit-exercise-warmups"
            />
          }
          divided
        />

        {exercise.role === 'main' && (
          <Row
            label={t('amrapLabel')}
            detail={t('editAmrapDetail')}
            detailBelow
            right={
              <Switch
                value={exercise.isAmrap}
                onValueChange={(isAmrap) => onPatch({ isAmrap })}
                testID="edit-exercise-amrap"
              />
            }
            divided
          />
        )}

        <Field label={t('unitOverrideLabel')} hint={t('editUnitOverrideHint', { unit })}>
          <SegmentedControl<string>
            options={[
              { value: SAME_UNIT, label: t('editUnitSameAsRoutine') },
              { value: 'kg', label: 'kg' },
              { value: 'lb', label: 'lb' },
            ]}
            value={exercise.unitOverride ?? SAME_UNIT}
            onChange={(value) =>
              onPatch({ unitOverride: value === SAME_UNIT ? null : (value as RoutineUnit) })
            }
            testID="edit-exercise-unit"
          />
        </Field>

        <Field label={t('runnerBarProfileLabel')} hint={barSummary()}>
          <SegmentedControl<string>
            wrap
            options={[
              { value: NO_BAR, label: t('editBarNone') },
              ...Object.keys(BAR_PROFILES).map((key) => ({
                value: key,
                label: t(BAR_PROFILE_LABEL_KEYS[key as BarProfileKey]),
              })),
            ]}
            value={exercise.barProfile ?? NO_BAR}
            onChange={(value) =>
              onPatch({
                barProfile: value === NO_BAR ? null : (value as BarProfileKey),
                barWeight: value === 'custom' ? exercise.barWeight : null,
              })
            }
            testID="edit-exercise-bar"
          />
        </Field>
        {exercise.barProfile === 'custom' && (
          <Field
            label={t('runnerCustomBarWeight', { unit: exerciseUnit })}
            hint={t('runnerCustomBarWeightHint')}
          >
            <NumberStepper
              value={exercise.barWeight}
              onChange={(barWeight) => onPatch({ barWeight })}
              step={roundingIncrement}
              min={0}
              testID="edit-exercise-bar-weight"
            />
          </Field>
        )}

        <Row
          label={t('startingWeightSection')}
          detail={t('startingWeightHint')}
          detailBelow
          right={chevron(weightsOpen ? 'chevron-up' : 'chevron-down')}
          onPress={() => setWeightsOpen(!weightsOpen)}
          divided
          testID="edit-exercise-weights-toggle"
        />
        {weightsOpen && (
          <View style={styles.advancedBody}>
            <Field label={t('loadSourceLabel')}>
              <SegmentedControl<RoutineLoadSource>
                wrap
                options={[
                  { value: 'absolute', label: t('loadSourceAbsolute') },
                  { value: 'training_max_pct', label: t('loadSourceTrainingMaxPct') },
                  { value: 'bodyweight', label: t('loadBodyweight') },
                ]}
                value={exercise.loadSource}
                onChange={(loadSource) => onPatch({ loadSource })}
                testID="edit-exercise-load-source"
              />
            </Field>
            {exercise.loadSource === 'absolute' && (
              <Field
                label={t('weightLabel', { unit: exerciseUnit })}
                hint={t('startingWeightLearnedHint')}
              >
                <NumberStepper
                  value={exercise.absoluteWeight}
                  onChange={(absoluteWeight) => onPatch({ absoluteWeight })}
                  step={roundingIncrement}
                  min={0}
                  testID="edit-exercise-absolute"
                />
              </Field>
            )}
            {exercise.loadSource === 'training_max_pct' && (
              <Field
                label={t('trainingMaxLabel', { unit: exerciseUnit })}
                hint={t('loadTrainingMax', {
                  pct: Math.round((exercise.trainingMaxPct ?? 0.9) * 100),
                })}
              >
                <NumberStepper
                  value={exercise.trainingMaxWeight}
                  onChange={(trainingMaxWeight) => onPatch({ trainingMaxWeight })}
                  step={roundingIncrement}
                  min={0}
                  testID="edit-exercise-training-max"
                />
              </Field>
            )}
            {exercise.loadSource === 'bodyweight' && (
              <Text
                style={[styles.note, { color: tokens.textSecondary }]}
                maxFontSizeMultiplier={1.5}
              >
                {t('startingWeightBodyweight')}
              </Text>
            )}
          </View>
        )}

        <Row
          label={t('moveExerciseUp')}
          onPress={() => onMove(-1)}
          disabled={index <= 0}
          right={chevron('arrow-up')}
          divided
          testID="edit-exercise-up"
        />
        <Row
          label={t('moveExerciseDown')}
          onPress={() => onMove(1)}
          disabled={index < 0 || index >= session.exercises.length - 1}
          right={chevron('arrow-down')}
          divided
          testID="edit-exercise-down"
        />
        <Row
          label={t('removeExerciseTitle')}
          detail={t('editRemoveExerciseDetail')}
          detailBelow
          right={chevron('trash-outline')}
          onPress={onRemove}
          testID="edit-exercise-remove"
        />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sheetBody: {
    flexShrink: 1,
  },
  sheetBodyContent: {
    paddingBottom: spacing.card,
  },
  advancedBody: {
    paddingLeft: spacing.gutter,
  },
  dayBody: {
    paddingLeft: spacing.gutter,
  },
  primary: {
    alignSelf: 'stretch',
  },
  note: {
    fontSize: fontSize.helper,
    marginBottom: spacing.cardGap,
  },
  error: {
    fontSize: fontSize.helper,
    marginTop: spacing.cardGap,
  },
});
