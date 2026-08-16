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
import { formatWeight } from '../utils/barProfiles';
import {
  ASSISTANCE_BIAS_DEFAULTS,
  DEFAULT_TRAINING_DAYS,
  derivedCategory,
  buildWaveRoutineRows,
  defaultRoundingIncrement,
  estimateTrainingMax,
  isRecommendedWaveAdvanced,
  recommendedWaveAdvanced,
  ROUNDING_INCREMENT_OPTIONS,
  warmupRampFor,
  WAVE_MAX_PLANNED_JOKERS,
  writeWaveRoutine,
  WaveSetupValidationError,
  type AssistanceBias,
  type WaveAdvanced,
  type WaveSetupDraft,
  type WaveSetupError,
} from '../utils/waveSetup';
import {
  getActiveRoutine,
  loadPresetRoutineSource,
  type RoutineDatabase,
  type RoutineUnit,
} from '../utils/routineActions';
import {
  assignWeekday,
  firstFreeWeekday,
  orderByWeekday,
  weekdayOrder,
} from '../utils/trainingDays';
import type { RoundingDirection, WarmupSet } from '../utils/fiveThreeOne';
import type { RoutinesStackParamList } from '../App';

type Props = NativeStackScreenProps<RoutinesStackParamList, 'FiveThreeOneSetup'>;

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

const ROUNDING_DIRECTION_LABEL_KEYS: Record<RoundingDirection, string> = {
  nearest: 'roundNearest',
  up: 'roundUp',
  down: 'roundDown',
};

/** The two training-max conventions 5/3/1 is actually run at. */
const TM_PERCENTAGE_OPTIONS = [85, 90] as const;

const MAX_TRAINING_DAYS = 7;

type Step = 'plan' | 'days' | 'review';

type ScreenAssistance = {
  key: string;
  catalogExerciseId: string | null;
  name: string;
  equipment: string | null;
  sets: number | null;
  reps: number | null;
  warmupsEnabled: boolean | null;
};

type ScreenDay = {
  key: string;
  weekday: number;
  liftName: string;
  catalogExerciseId: string | null;
  equipment: string | null;
  category: 'upper' | 'lower';
  trainingMax: number | null;
  estimateWeight: number | null;
  estimateReps: number | null;
  assistanceStartWeight: number | null;
  assistance: ScreenAssistance[];
};

type ScreenDraft = {
  name: string;
  unit: RoutineUnit;
  roundingIncrement: number;
  includeDeload: boolean;
  warmupsEnabled: boolean;
  advanced: WaveAdvanced;
  days: ScreenDay[];
};

type PickerTarget = {
  dayKey: string;
  mode: 'main' | 'assistance';
  exerciseKey: string | null;
  catalogExerciseId: string | null;
};

const errorKey = (detail: WaveSetupError): string =>
  `waveError${detail.code.charAt(0).toUpperCase()}${detail.code.slice(1)}`;

/**
 * R3 — the 5/3/1 builder, rebuilt (SPECS.md R3, §3.2, §3.4, §3.6, §7).
 *
 * **The defect:** *"No se pudo guardar: introduce un máximo de entrenamiento para Squat."* The
 * headline feature refused to produce a routine until the user typed four training maxes — numbers
 * the app learns from the first logged set (§3.2, `utils/learnedWeights.ts`).
 *
 * The rebuild is three deliberate steps — **el programa · los días · revisar** — and the acceptance
 * criterion is structural rather than careful:
 *
 * - **Every number on this screen has a value before the user arrives.** The main path offers only
 *   choices (unit, increment, deload, warm-ups); `Opciones avanzadas` is the last thing on the
 *   first step, opens with every recommendation applied, and each option states in one line what it
 *   changes and what the recommended value is. `sesgo de volumen de asistencia` is gone as a name:
 *   the option now says the sets and reps it produces.
 * - **No weight is asked for anywhere.** Training maxes live behind an optional *pesos de inicio*
 *   disclosure per day, with the estimator kept for the user who knows their numbers. Left alone,
 *   they are written NULL and the first session learns them.
 * - **The weekday picker is a weekday picker** (utils/trainingDays.ts): seven days, one selected,
 *   and choosing a day another lift holds swaps the two instead of refusing.
 * - **The review is a checkout**, and every card on it returns to the section it summarises.
 */
export default function FiveThreeOneSetupScreen({ navigation, route }: Props) {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const { weightFormat, firstWeekday } = useSettings();
  const db = useSQLiteContext();
  const { presetKey } = route.params;

  const unit: RoutineUnit = weightFormat === 'lbs' ? 'lb' : 'kg';

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
  const [weightsOpenFor, setWeightsOpenFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ dayKey: string; exerciseKey: string } | null>(null);
  const [pickerFor, setPickerFor] = useState<PickerTarget | null>(null);
  /** R2: the exercise whose shared sheet is open. */
  const [information, setInformation] = useState<{
    name: string;
    catalogExerciseId: string | null;
    targetSets: number | null;
    targetReps: number | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The routine that becomes inactive when this one is created (R1: activation says so). */
  const [active, setActive] = useState<{ routineId: number; name: string } | null>(null);
  const nextKey = useRef(1000);
  const presetName = useRef('');

  useEffect(() => {
    loadPresetRoutineSource(routineDb, presetKey)
      .then((source) => {
        presetName.current = source.routine.name;
        setDraft({
          name: source.routine.name,
          unit,
          roundingIncrement: defaultRoundingIncrement(unit),
          includeDeload: true,
          warmupsEnabled: true,
          advanced: recommendedWaveAdvanced(unit),
          days: DEFAULT_TRAINING_DAYS.map((trainingDay, index) => ({
            key: `d${index + 1}`,
            weekday: trainingDay.weekday,
            liftName: trainingDay.liftName,
            catalogExerciseId: null,
            equipment: null,
            category: trainingDay.category,
            trainingMax: null,
            estimateWeight: null,
            estimateReps: null,
            assistanceStartWeight: null,
            assistance: [],
          })),
        });
      })
      .catch(() => setError(t('routineLibraryError')));
    getActiveRoutine(routineDb)
      .then(setActive)
      .catch(() => setActive(null));
    // Keyed on the preset alone: re-running this would discard the user's
    // unsaved draft, and no setting change is worth that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, presetKey]);

  const patchDraft = (patch: (current: ScreenDraft) => ScreenDraft) =>
    setDraft((current) => (current === null ? current : patch(current)));

  const patchAdvanced = (patch: Partial<WaveAdvanced>) =>
    patchDraft((current) => ({ ...current, advanced: { ...current.advanced, ...patch } }));

  const patchDay = (dayKey: string, patch: (day: ScreenDay) => ScreenDay) =>
    patchDraft((current) => ({
      ...current,
      days: current.days.map((day) => (day.key === dayKey ? patch(day) : day)),
    }));

  const patchAssistance = (
    dayKey: string,
    exerciseKey: string,
    patch: Partial<ScreenAssistance>,
  ) =>
    patchDay(dayKey, (day) => ({
      ...day,
      assistance: day.assistance.map((row) =>
        row.key === exerciseKey ? { ...row, ...patch } : row,
      ),
    }));

  const changeUnit = (nextUnit: RoutineUnit) =>
    patchDraft((current) => {
      const recommended = recommendedWaveAdvanced(current.unit);
      const nextRecommended = recommendedWaveAdvanced(nextUnit);
      // Increments are plate facts, not preferences: a value the user never
      // touched follows the unit, a value they chose stays theirs.
      return {
        ...current,
        unit: nextUnit,
        roundingIncrement: ROUNDING_INCREMENT_OPTIONS[nextUnit].includes(current.roundingIncrement)
          ? current.roundingIncrement
          : defaultRoundingIncrement(nextUnit),
        advanced: {
          ...current.advanced,
          upperTmIncrement:
            current.advanced.upperTmIncrement === recommended.upperTmIncrement
              ? nextRecommended.upperTmIncrement
              : current.advanced.upperTmIncrement,
          lowerTmIncrement:
            current.advanced.lowerTmIncrement === recommended.lowerTmIncrement
              ? nextRecommended.lowerTmIncrement
              : current.advanced.lowerTmIncrement,
        },
      };
    });

  const moveWeekday = (dayKey: string, weekday: number) =>
    patchDraft((current) => ({
      ...current,
      days: orderByWeekday(assignWeekday(current.days, dayKey, weekday), firstWeekday),
    }));

  const addDay = () => {
    if (draft === null || draft.days.length >= MAX_TRAINING_DAYS) {
      return;
    }
    const weekday = firstFreeWeekday(draft.days, firstWeekday);
    if (weekday === null) {
      return;
    }
    const key = `n${nextKey.current++}`;
    patchDraft((current) => ({
      ...current,
      days: orderByWeekday(
        [
          ...current.days,
          {
            key,
            weekday,
            liftName: t('waveNewLiftName'),
            catalogExerciseId: null,
            equipment: null,
            category: 'upper',
            trainingMax: null,
            estimateWeight: null,
            estimateReps: null,
            assistanceStartWeight: null,
            assistance: [],
          },
        ],
        firstWeekday,
      ),
    }));
    setOpenDayKey(key);
  };

  const removeDay = (dayKey: string) =>
    patchDraft((current) => ({
      ...current,
      days: current.days.filter((day) => day.key !== dayKey),
    }));

  const applyPickerSelection = (selection: ExercisePickerSelection) => {
    if (pickerFor === null || draft === null) {
      return;
    }
    if (pickerFor.mode === 'main') {
      patchDay(pickerFor.dayKey, (day) => ({
        ...day,
        liftName: selection.name,
        catalogExerciseId: selection.catalogExerciseId,
        equipment: selection.equipment,
        // Upper or lower comes from the catalog's own primary muscles — the
        // picker already has them, so the app never asks (§7.5).
        category:
          selection.primaryMuscles.length > 0
            ? derivedCategory([...selection.primaryMuscles])
            : day.category,
      }));
    } else if (pickerFor.exerciseKey === null) {
      const defaults = ASSISTANCE_BIAS_DEFAULTS[draft.advanced.assistanceBias];
      patchDay(pickerFor.dayKey, (day) => ({
        ...day,
        assistance: [
          ...day.assistance,
          {
            key: `n${nextKey.current++}`,
            catalogExerciseId: selection.catalogExerciseId,
            name: selection.name,
            equipment: selection.equipment,
            sets: defaults.sets,
            reps: defaults.reps,
            warmupsEnabled: null,
          },
        ],
      }));
    } else {
      patchAssistance(pickerFor.dayKey, pickerFor.exerciseKey, {
        catalogExerciseId: selection.catalogExerciseId,
        name: selection.name,
        equipment: selection.equipment,
      });
    }
    setPickerFor(null);
  };

  const removeAssistance = (dayKey: string, exerciseKey: string) => {
    setEditing(null);
    patchDay(dayKey, (day) => ({
      ...day,
      assistance: day.assistance.filter((row) => row.key !== exerciseKey),
    }));
  };

  const moveAssistance = (dayKey: string, exerciseKey: string, direction: -1 | 1) =>
    patchDay(dayKey, (day) => {
      const index = day.assistance.findIndex((row) => row.key === exerciseKey);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= day.assistance.length) {
        return day;
      }
      const assistance = [...day.assistance];
      [assistance[index], assistance[target]] = [assistance[target], assistance[index]];
      return { ...day, assistance };
    });

  const applyEstimate = (day: ScreenDay, estimate: number) =>
    patchDay(day.key, (current) => ({ ...current, trainingMax: estimate }));

  /**
   * The draft as the writer wants it. Every advanced number falls back to its
   * recommendation, every accessory count to its bias default, and the name to
   * the preset's — so `buildWaveRoutineRows` cannot reject this screen for a
   * field the user left alone. Weights stay null on purpose (§3.2).
   */
  const toWaveDraft = (current: ScreenDraft): WaveSetupDraft => {
    const recommended = recommendedWaveAdvanced(current.unit);
    const biasDefaults = ASSISTANCE_BIAS_DEFAULTS[current.advanced.assistanceBias];
    return {
      name: current.name.trim() === '' ? presetName.current : current.name,
      unit: current.unit,
      roundingIncrement:
        current.roundingIncrement > 0
          ? current.roundingIncrement
          : defaultRoundingIncrement(current.unit),
      roundingDirection: current.advanced.roundingDirection,
      tmPercentage: current.advanced.tmPercentage,
      includeDeload: current.includeDeload,
      warmupsEnabled: current.warmupsEnabled,
      upperTmIncrement:
        current.advanced.upperTmIncrement > 0
          ? current.advanced.upperTmIncrement
          : recommended.upperTmIncrement,
      lowerTmIncrement:
        current.advanced.lowerTmIncrement > 0
          ? current.advanced.lowerTmIncrement
          : recommended.lowerTmIncrement,
      assistanceBias: current.advanced.assistanceBias,
      plannedJokers: current.advanced.plannedJokers,
      days: current.days.map((day) => ({
        key: day.key,
        weekday: day.weekday,
        liftName: day.liftName.trim() === '' ? t('waveNewLiftName') : day.liftName,
        catalogExerciseId: day.catalogExerciseId,
        equipment: day.equipment,
        category: day.category,
        trainingMax: day.trainingMax,
        assistanceStartWeight: day.assistanceStartWeight,
        assistance: day.assistance.map((row) => ({
          key: row.key,
          catalogExerciseId: row.catalogExerciseId,
          name: row.name,
          equipment: row.equipment,
          sets: row.sets ?? biasDefaults.sets,
          reps: row.reps ?? biasDefaults.reps,
          warmupsEnabled: row.warmupsEnabled,
        })),
      })),
    };
  };

  const showFailure = (failure: unknown) => {
    if (failure instanceof WaveSetupValidationError) {
      const { detail } = failure;
      setError(
        t(errorKey(detail), {
          lift: 'lift' in detail ? detail.lift : undefined,
          day: 'day' in detail ? detail.day : undefined,
          exercise: 'exercise' in detail ? detail.exercise : undefined,
        }),
      );
    } else {
      setError(t('errorActivatingRoutine'));
    }
  };

  const handleCreate = async () => {
    if (draft === null || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const waveDraft = toWaveDraft(draft);
      buildWaveRoutineRows(waveDraft);
      await writeWaveRoutine(routineDb, waveDraft);
      navigation.popToTop();
    } catch (failure) {
      showFailure(failure);
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
      <Screen testID="wave-setup-screen">
        <ScreenTitle title={t('fiveThreeOneSetupTitle')} onBack={() => navigation.goBack()} />
        {error !== null && <Text style={[styles.error, { color: tokens.warning }]}>{error}</Text>}
      </Screen>
    );
  }

  const biasDefaults = ASSISTANCE_BIAS_DEFAULTS[draft.advanced.assistanceBias];
  const editingDay =
    editing === null ? null : (draft.days.find((day) => day.key === editing.dayKey) ?? null);
  const editingRow =
    editingDay === null || editing === null
      ? null
      : (editingDay.assistance.find((row) => row.key === editing.exerciseKey) ?? null);

  const rampFor = (day: ScreenDay): WarmupSet[] | null =>
    warmupRampFor(
      {
        key: day.key,
        weekday: day.weekday,
        liftName: day.liftName,
        catalogExerciseId: day.catalogExerciseId,
        category: day.category,
        trainingMax: day.trainingMax,
        assistanceStartWeight: null,
        assistance: [],
      },
      draft.unit,
      draft.roundingIncrement,
      draft.advanced.roundingDirection,
      draft.advanced.tmPercentage,
    );

  const rampLine = (day: ScreenDay): string => {
    if (!draft.warmupsEnabled) {
      return t('rampOff');
    }
    const ramp = rampFor(day);
    if (ramp === null) {
      return t('rampNeedsTm');
    }
    return ramp
      .map((set) => `${set.percent}% · ${formatWeight(set.weight)} ${set.unit} × ${set.reps}`)
      .join('   ');
  };

  const advancedSummary = (): string => {
    if (isRecommendedWaveAdvanced(draft.advanced, draft.unit)) {
      return t('advancedAllRecommended');
    }
    const parts = [
      t('tmPercentageSummary', { pct: Math.round(draft.advanced.tmPercentage * 100) }),
      t(ROUNDING_DIRECTION_LABEL_KEYS[draft.advanced.roundingDirection]),
      t('assistanceVolumeSummary', { sets: biasDefaults.sets, reps: biasDefaults.reps }),
    ];
    if (draft.advanced.plannedJokers > 0) {
      parts.push(t('plannedJokersSummary', { count: draft.advanced.plannedJokers }));
    }
    return parts.join(' · ');
  };

  const daySummary = (day: ScreenDay): string => {
    const lines = [
      `${t(day.category === 'lower' ? 'categoryLower' : 'categoryUpper')} · ${
        day.trainingMax === null
          ? t('waveTrainingMaxLearned')
          : t('waveTrainingMaxValue', {
              weight: formatWeight(day.trainingMax),
              unit: draft.unit,
            })
      }`,
    ];
    if (day.assistance.length > 0) {
      lines.push(
        day.assistance
          .map(
            (row) =>
              `${row.name} · ${t('routineSetsByReps', {
                sets: row.sets ?? biasDefaults.sets,
                reps: row.reps ?? biasDefaults.reps,
              })}`,
          )
          .join('\n'),
      );
    }
    return lines.join('\n');
  };

  const renderPlanStep = () => (
    <>
      <Section title={t('programSectionTitle')} testID="wave-plan">
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
            onChange={changeUnit}
            testID="wave-unit"
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
            testID="wave-rounding"
          />
        </Field>
        <Row
          label={t('includeDeload')}
          detail={t('includeDeloadDetail')}
          detailBelow
          right={
            <Switch
              value={draft.includeDeload}
              onValueChange={(includeDeload) =>
                patchDraft((current) => ({ ...current, includeDeload }))
              }
              testID="wave-deload"
            />
          }
          divided
        />
        <Row
          label={t('warmupsToggle')}
          detail={t('warmupsToggleDetail')}
          detailBelow
          right={
            <Switch
              value={draft.warmupsEnabled}
              onValueChange={(warmupsEnabled) =>
                patchDraft((current) => ({ ...current, warmupsEnabled }))
              }
              testID="wave-warmups"
            />
          }
        />
      </Section>

      {/* Advanced is the LAST thing on this step — training days used to sit
          below it, which is the defect R3 names. */}
      <Section testID="wave-advanced">
        <Row
          label={t('advancedHeader')}
          detail={advancedSummary()}
          detailBelow
          right={chevron(advancedOpen ? 'chevron-up' : 'chevron-down')}
          onPress={() => setAdvancedOpen(!advancedOpen)}
          divided
          testID="wave-advanced-toggle"
        />
        {advancedOpen && (
          <View style={styles.advancedBody}>
            <Field
              label={t('tmPercentage')}
              hint={t('tmPercentageHint', {
                pct: Math.round(recommendedWaveAdvanced(draft.unit).tmPercentage * 100),
              })}
            >
              <SegmentedControl<string>
                options={TM_PERCENTAGE_OPTIONS.map((percentage) => ({
                  value: String(percentage),
                  label: `${percentage}%`,
                }))}
                value={String(Math.round(draft.advanced.tmPercentage * 100))}
                onChange={(value) => patchAdvanced({ tmPercentage: Number(value) / 100 })}
                testID="wave-tm-percentage"
              />
            </Field>
            <Field label={t('roundingDirection')} hint={t('roundingDirectionHint')}>
              <SegmentedControl<RoundingDirection>
                options={[
                  { value: 'nearest', label: t('roundNearest') },
                  { value: 'up', label: t('roundUp') },
                  { value: 'down', label: t('roundDown') },
                ]}
                value={draft.advanced.roundingDirection}
                onChange={(roundingDirection) => patchAdvanced({ roundingDirection })}
                testID="wave-rounding-direction"
              />
            </Field>
            <Field
              label={t('upperTmIncrement')}
              hint={t('tmIncrementHint', {
                value: formatWeight(recommendedWaveAdvanced(draft.unit).upperTmIncrement),
                unit: draft.unit,
              })}
            >
              <NumberStepper
                value={draft.advanced.upperTmIncrement}
                onChange={(value) =>
                  patchAdvanced({
                    upperTmIncrement:
                      value ?? recommendedWaveAdvanced(draft.unit).upperTmIncrement,
                  })
                }
                step={ROUNDING_INCREMENT_OPTIONS[draft.unit][0]}
                min={ROUNDING_INCREMENT_OPTIONS[draft.unit][0]}
                testID="wave-upper-increment"
              />
            </Field>
            <Field
              label={t('lowerTmIncrement')}
              hint={t('tmIncrementHint', {
                value: formatWeight(recommendedWaveAdvanced(draft.unit).lowerTmIncrement),
                unit: draft.unit,
              })}
            >
              <NumberStepper
                value={draft.advanced.lowerTmIncrement}
                onChange={(value) =>
                  patchAdvanced({
                    lowerTmIncrement:
                      value ?? recommendedWaveAdvanced(draft.unit).lowerTmIncrement,
                  })
                }
                step={ROUNDING_INCREMENT_OPTIONS[draft.unit][0]}
                min={ROUNDING_INCREMENT_OPTIONS[draft.unit][0]}
                testID="wave-lower-increment"
              />
            </Field>
            <Field
              label={t('assistanceVolumeLabel')}
              hint={t('assistanceVolumeHint', {
                sets: biasDefaults.sets,
                reps: biasDefaults.reps,
                recommendedSets: ASSISTANCE_BIAS_DEFAULTS.hybrid.sets,
                recommendedReps: ASSISTANCE_BIAS_DEFAULTS.hybrid.reps,
              })}
            >
              <SegmentedControl<AssistanceBias>
                options={[
                  { value: 'hypertrophy', label: t('biasHypertrophy') },
                  { value: 'strength', label: t('biasStrength') },
                  { value: 'hybrid', label: t('biasHybrid') },
                ]}
                value={draft.advanced.assistanceBias}
                onChange={(assistanceBias) => patchAdvanced({ assistanceBias })}
                testID="wave-assistance-bias"
              />
            </Field>
            <Field label={t('plannedJokersLabel')} hint={t('plannedJokersHint')}>
              <NumberStepper
                value={draft.advanced.plannedJokers}
                onChange={(value) => patchAdvanced({ plannedJokers: value ?? 0 })}
                step={1}
                min={0}
                max={WAVE_MAX_PLANNED_JOKERS}
                testID="wave-planned-jokers"
              />
            </Field>
          </View>
        )}
      </Section>

      <Button
        label={t('editContinueToDays')}
        onPress={() => setStep('days')}
        style={styles.primary}
        testID="wave-to-days"
      />
    </>
  );

  const renderDaysStep = () => (
    <>
      <Section hint={t('editWeekdayHint')} testID="wave-days">
        {draft.days.map((day) => {
          const open = openDayKey === day.key;
          const estimate =
            day.estimateWeight !== null &&
            day.estimateWeight > 0 &&
            day.estimateReps !== null &&
            Number.isInteger(day.estimateReps) &&
            day.estimateReps > 0
              ? estimateTrainingMax(
                  day.estimateWeight,
                  day.estimateReps,
                  draft.advanced.tmPercentage,
                  draft.roundingIncrement,
                  draft.advanced.roundingDirection,
                )
              : null;
          return (
            <View key={day.key}>
              <Row
                label={`${t(WEEKDAY_FULL_KEYS[day.weekday])} · ${day.liftName}`}
                detail={daySummary(day)}
                detailBelow
                right={chevron(open ? 'chevron-up' : 'chevron-down')}
                onPress={() => setOpenDayKey(open ? null : day.key)}
                divided
                testID={`wave-day-${day.key}`}
              />
              {open && (
                <View style={styles.dayBody}>
                  <Field label={t('editWeekdayLabel')}>
                    <SegmentedControl<string>
                      options={weekdayOrder(firstWeekday).map((weekday) => ({
                        value: String(weekday),
                        label: t(WEEKDAY_SHORT_KEYS[weekday]),
                      }))}
                      value={String(day.weekday)}
                      onChange={(value) => moveWeekday(day.key, Number(value))}
                      testID={`wave-weekday-${day.key}`}
                    />
                  </Field>

                  <Row
                    label={day.liftName}
                    detail={`${t('waveMainLift')} · ${t(
                      day.category === 'lower' ? 'categoryLower' : 'categoryUpper',
                    )}`}
                    detailBelow
                    right={chevron('swap-horizontal')}
                    onPress={() =>
                      setPickerFor({
                        dayKey: day.key,
                        mode: 'main',
                        exerciseKey: 'main',
                        catalogExerciseId: day.catalogExerciseId,
                      })
                    }
                    divided
                    testID={`wave-lift-${day.key}`}
                  />
                  <Row
                    label={t('exerciseInfoAction')}
                    right={chevron('information-circle-outline')}
                    onPress={() =>
                      setInformation({
                        name: day.liftName,
                        catalogExerciseId: day.catalogExerciseId,
                        targetSets: null,
                        targetReps: null,
                      })
                    }
                    divided
                    testID={`wave-lift-info-${day.key}`}
                  />
                  <Row
                    label={t('rampPreviewLabel')}
                    detail={rampLine(day)}
                    detailBelow
                    divided
                    testID={`wave-ramp-${day.key}`}
                  />

                  {day.assistance.map((row) => (
                    <Row
                      key={row.key}
                      label={row.name}
                      detail={t('routineSetsByReps', {
                        sets: row.sets ?? biasDefaults.sets,
                        reps: row.reps ?? biasDefaults.reps,
                      })}
                      detailBelow
                      right={chevron('chevron-forward')}
                      onPress={() => setEditing({ dayKey: day.key, exerciseKey: row.key })}
                      divided
                      testID={`wave-assistance-${row.key}`}
                    />
                  ))}
                  <Row
                    label={t('addAccessory')}
                    detail={t('assistanceVolumeSummary', {
                      sets: biasDefaults.sets,
                      reps: biasDefaults.reps,
                    })}
                    detailBelow
                    right={chevron('add')}
                    onPress={() =>
                      setPickerFor({
                        dayKey: day.key,
                        mode: 'assistance',
                        exerciseKey: null,
                        catalogExerciseId: null,
                      })
                    }
                    divided
                    testID={`wave-add-accessory-${day.key}`}
                  />

                  <Row
                    label={t('startingWeightSection')}
                    detail={t('startingWeightHint')}
                    detailBelow
                    right={chevron(weightsOpenFor === day.key ? 'chevron-up' : 'chevron-down')}
                    onPress={() => setWeightsOpenFor(weightsOpenFor === day.key ? null : day.key)}
                    divided
                    testID={`wave-weights-${day.key}`}
                  />
                  {weightsOpenFor === day.key && (
                    <View style={styles.advancedBody}>
                      <Field
                        label={t('trainingMaxLabel', { unit: draft.unit })}
                        hint={t('startingWeightLearnedHint')}
                      >
                        <NumberStepper
                          value={day.trainingMax}
                          onChange={(trainingMax) =>
                            patchDay(day.key, (current) => ({ ...current, trainingMax }))
                          }
                          step={draft.roundingIncrement}
                          min={0}
                          testID={`wave-tm-${day.key}`}
                        />
                      </Field>
                      <Field label={t('recentWeight')}>
                        <NumberStepper
                          value={day.estimateWeight}
                          onChange={(estimateWeight) =>
                            patchDay(day.key, (current) => ({ ...current, estimateWeight }))
                          }
                          step={draft.roundingIncrement}
                          min={0}
                          testID={`wave-estimate-weight-${day.key}`}
                        />
                      </Field>
                      <Field label={t('recentReps')}>
                        <NumberStepper
                          value={day.estimateReps}
                          onChange={(estimateReps) =>
                            patchDay(day.key, (current) => ({ ...current, estimateReps }))
                          }
                          step={1}
                          min={1}
                          max={30}
                          testID={`wave-estimate-reps-${day.key}`}
                        />
                      </Field>
                      <Row
                        label={t('estimateApply')}
                        detail={
                          estimate === null
                            ? t('enterRecentSet')
                            : t('estimatedTrainingMaxValue', {
                                weight: formatWeight(estimate),
                                unit: draft.unit,
                              })
                        }
                        detailBelow
                        right={chevron('arrow-forward')}
                        onPress={estimate === null ? undefined : () => applyEstimate(day, estimate)}
                        divided
                        testID={`wave-estimate-apply-${day.key}`}
                      />
                      <Field
                        label={t('assistanceStartWeightLabel', { unit: draft.unit })}
                        hint={t('assistanceStartWeightHint')}
                      >
                        <NumberStepper
                          value={day.assistanceStartWeight}
                          onChange={(assistanceStartWeight) =>
                            patchDay(day.key, (current) => ({ ...current, assistanceStartWeight }))
                          }
                          step={draft.roundingIncrement}
                          min={0}
                          testID={`wave-assistance-weight-${day.key}`}
                        />
                      </Field>
                    </View>
                  )}

                  <Row
                    label={t('removeDayTitle')}
                    detail={t('editRemoveDayDetail')}
                    detailBelow
                    right={chevron('trash-outline')}
                    onPress={() => removeDay(day.key)}
                    testID={`wave-remove-day-${day.key}`}
                  />
                </View>
              )}
            </View>
          );
        })}
        {draft.days.length < MAX_TRAINING_DAYS && (
          <Row label={t('addDay')} right={chevron('add')} onPress={addDay} testID="wave-add-day" />
        )}
      </Section>

      <Button
        label={t('editContinueToReview')}
        onPress={() => setStep('review')}
        style={styles.primary}
        testID="wave-to-review"
      />
    </>
  );

  const renderReviewStep = () => (
    <>
      <Section title={t('programSectionTitle')} hint={t('reviewTapHint')} testID="wave-review-plan">
        <Row
          label={draft.name.trim() === '' ? presetName.current : draft.name}
          detail={`${draft.unit} · ${t('roundingIncrement')} ${formatWeight(
            draft.roundingIncrement,
          )} ${draft.unit} · ${t(draft.includeDeload ? 'deloadOn' : 'deloadOff')} · ${t(
            draft.warmupsEnabled ? 'rampOn' : 'rampOff',
          )}`}
          detailBelow
          right={chevron('chevron-forward')}
          onPress={() => {
            setAdvancedOpen(false);
            setStep('plan');
          }}
          divided
          testID="wave-review-basics"
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
          testID="wave-review-advanced"
        />
      </Section>

      <Section title={t('trainingDaysSection')} testID="wave-review-days">
        {draft.days.map((day) => (
          <Row
            key={day.key}
            label={`${t(WEEKDAY_FULL_KEYS[day.weekday])} · ${day.liftName}`}
            detail={daySummary(day)}
            detailBelow
            right={chevron('chevron-forward')}
            onPress={() => {
              setOpenDayKey(day.key);
              setStep('days');
            }}
            divided
            testID={`wave-review-day-${day.key}`}
          />
        ))}
      </Section>

      <Text style={[styles.note, { color: tokens.textSecondary }]} maxFontSizeMultiplier={1.5}>
        {t('waveLearnedWeightsNote')}
      </Text>
      {active !== null && (
        <Text style={[styles.note, { color: tokens.textSecondary }]} maxFontSizeMultiplier={1.5}>
          {t('waveReplacesActive', { name: active.name })}
        </Text>
      )}

      <Button
        label={t('createWaveRoutine')}
        onPress={() => void handleCreate()}
        disabled={busy}
        style={styles.primary}
        testID="wave-create"
      />
    </>
  );

  return (
    <>
      <Screen scroll testID="wave-setup-screen">
        <ScreenTitle
          overline={step === 'plan' ? t('fiveThreeOneSetupTitle') : draft.name}
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

      {editingRow !== null && editingDay !== null && (
        <AssistanceSheet
          day={editingDay}
          row={editingRow}
          fallback={biasDefaults}
          onClose={() => setEditing(null)}
          onPatch={(patch) => patchAssistance(editingDay.key, editingRow.key, patch)}
          onReplace={() => {
            // Two Modals must never be open at once: the editor closes, the
            // picker opens, and the changed row waits in the day list.
            setEditing(null);
            setPickerFor({
              dayKey: editingDay.key,
              mode: 'assistance',
              exerciseKey: editingRow.key,
              catalogExerciseId: editingRow.catalogExerciseId,
            });
          }}
          onMove={(direction) => moveAssistance(editingDay.key, editingRow.key, direction)}
          onRemove={() => removeAssistance(editingDay.key, editingRow.key)}
          onInformation={() => {
            setEditing(null);
            setInformation({
              name: editingRow.name,
              catalogExerciseId: editingRow.catalogExerciseId,
              targetSets: editingRow.sets ?? biasDefaults.sets,
              targetReps: editingRow.reps ?? biasDefaults.reps,
            });
          }}
        />
      )}

      <ExerciseCatalogPicker
        visible={pickerFor !== null}
        catalogExerciseId={pickerFor?.catalogExerciseId ?? null}
        onSelect={applyPickerSelection}
        onClose={() => setPickerFor(null)}
      />

      {/* R2: the shared exercise sheet. */}
      <ExerciseSheet
        exercise={
          information === null
            ? null
            : { name: information.name, catalogExerciseId: information.catalogExerciseId }
        }
        plan={
          information === null ||
          information.targetSets === null ||
          information.targetReps === null
            ? null
            : {
                role: 'accessory',
                targetSets: information.targetSets,
                targetReps: information.targetReps,
              }
        }
        onClose={() => setInformation(null)}
      />
    </>
  );
}

type AssistanceSheetProps = {
  day: ScreenDay;
  row: ScreenAssistance;
  fallback: { sets: number; reps: number };
  onClose: () => void;
  onPatch: (patch: Partial<ScreenAssistance>) => void;
  onReplace: () => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onInformation: () => void;
};

/** One accessory of a 5/3/1 day, in the app's one "decision about what you touched" surface. */
function AssistanceSheet({
  day,
  row,
  fallback,
  onClose,
  onPatch,
  onReplace,
  onMove,
  onRemove,
  onInformation,
}: AssistanceSheetProps) {
  const { tokens } = useTheme();
  const { t } = useTranslation();

  const index = day.assistance.findIndex((candidate) => candidate.key === row.key);
  const chevron = (name: string) => (
    <Ionicons name={name} size={tabBar.icon} color={tokens.textSecondary} />
  );

  return (
    <Sheet visible onClose={onClose} title={row.name} testID="wave-assistance-sheet">
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
          testID="wave-assistance-replace"
        />
        <Row
          label={t('exerciseInfoAction')}
          right={chevron('information-circle-outline')}
          onPress={onInformation}
          divided
          testID="wave-assistance-info"
        />
        <Field label={t('Sets')}>
          <NumberStepper
            value={row.sets ?? fallback.sets}
            onChange={(sets) => onPatch({ sets })}
            step={1}
            min={1}
            max={20}
            testID="wave-assistance-sets"
          />
        </Field>
        <Field label={t('Reps')}>
          <NumberStepper
            value={row.reps ?? fallback.reps}
            onChange={(reps) => onPatch({ reps })}
            step={1}
            min={1}
            max={100}
            testID="wave-assistance-reps"
          />
        </Field>
        <Row
          label={t('runnerWarmups')}
          detail={row.warmupsEnabled === true ? t('editWarmupsOnDetail') : t('editWarmupsOffDetail')}
          detailBelow
          right={
            <Switch
              value={row.warmupsEnabled === true}
              onValueChange={(value) => onPatch({ warmupsEnabled: value })}
              testID="wave-assistance-warmups"
            />
          }
          divided
        />
        <Row
          label={t('moveExerciseUp')}
          onPress={() => onMove(-1)}
          disabled={index <= 0}
          right={chevron('arrow-up')}
          divided
          testID="wave-assistance-up"
        />
        <Row
          label={t('moveExerciseDown')}
          onPress={() => onMove(1)}
          disabled={index < 0 || index >= day.assistance.length - 1}
          right={chevron('arrow-down')}
          divided
          testID="wave-assistance-down"
        />
        <Row
          label={t('removeExerciseTitle')}
          detail={t('editRemoveExerciseDetail')}
          detailBelow
          right={chevron('trash-outline')}
          onPress={onRemove}
          testID="wave-assistance-remove"
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
