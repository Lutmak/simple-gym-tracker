import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  type LayoutChangeEvent,
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
import { ExerciseSheet } from '../components/ExerciseSheet';
import {
  ASSISTANCE_BIAS_DEFAULTS,
  DEFAULT_TRAINING_DAYS,
  derivedCategory,
  buildWaveRoutineRows,
  estimateTrainingMax,
  warmupRampFor,
  WAVE_UNIT_DEFAULTS,
  writeWaveRoutine,
  WaveSetupValidationError,
  type AssistanceBias,
  type WaveSetupDraft,
  type WaveSetupError,
} from '../utils/waveSetup';
import {
  getActiveRoutine,
  loadPresetRoutineSource,
  type RoutineDatabase,
  type RoutineUnit,
} from '../utils/routineActions';
import type { RoundingDirection, WarmupSet } from '../utils/fiveThreeOne';
import type { RoutinesStackParamList } from '../App';

type Props = NativeStackScreenProps<RoutinesStackParamList, 'FiveThreeOneSetup'>;

type ScreenAssistance = {
  key: string;
  catalogExerciseId: string | null;
  name: string;
  sets: string;
  reps: string;
};

type ScreenDay = {
  key: string;
  weekday: number;
  liftName: string;
  catalogExerciseId: string | null;
  category: 'upper' | 'lower';
  trainingMaxText: string;
  estimatorOpen: boolean;
  estimateWeight: string;
  estimateReps: string;
  assistanceStartWeightText: string;
  assistance: ScreenAssistance[];
};

type ScreenDraft = {
  name: string;
  unit: RoutineUnit;
  roundingIncrementText: string;
  roundingDirection: RoundingDirection;
  tmPercentageText: string;
  includeDeload: boolean;
  warmupsEnabled: boolean;
  upperTmIncrementText: string;
  lowerTmIncrementText: string;
  assistanceBias: AssistanceBias;
  days: ScreenDay[];
};

type PickerTarget = {
  dayKey: string;
  mode: 'main' | 'assistance';
  exerciseKey: string | null;
  catalogExerciseId: string | null;
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

const formatWeight = (value: number): string => String(Number(value.toFixed(1)));

const errorKey = (detail: WaveSetupError): string =>
  `waveError${detail.code.charAt(0).toUpperCase()}${detail.code.slice(1)}`;

export default function FiveThreeOneSetupScreen({ navigation, route }: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { weightFormat, firstWeekday } = useSettings();
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

  const [draft, setDraft] = useState<ScreenDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [weekdayPickerFor, setWeekdayPickerFor] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<PickerTarget | null>(null);
  /** R2: the exercise whose shared sheet is open, with the plan row it was opened from. */
  const [information, setInformation] = useState<{
    name: string;
    catalogExerciseId: string | null;
    targetSets: number | null;
    targetReps: number | null;
  } | null>(null);
  const nextKey = useRef(1000);
  const scrollRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef<Record<string, number>>({});

  useEffect(() => {
    loadPresetRoutineSource(routineDb, presetKey)
      .then((source) => {
        const defaults = WAVE_UNIT_DEFAULTS[unit];
        setDraft({
          name: source.routine.name,
          unit,
          roundingIncrementText: String(defaults.roundingIncrement),
          roundingDirection: 'nearest',
          tmPercentageText: '90',
          includeDeload: true,
          warmupsEnabled: true,
          upperTmIncrementText: String(defaults.upperTmIncrement),
          lowerTmIncrementText: String(defaults.lowerTmIncrement),
          assistanceBias: 'hybrid',
          days: DEFAULT_TRAINING_DAYS.map((trainingDay, index) => ({
            key: `d${index + 1}`,
            weekday: trainingDay.weekday,
            liftName: trainingDay.liftName,
            catalogExerciseId: null,
            category: trainingDay.category,
            trainingMaxText: '',
            estimatorOpen: false,
            estimateWeight: '',
            estimateReps: '',
            assistanceStartWeightText: '',
            assistance: [],
          })),
        });
      })
      .catch((error: unknown) => {
        console.error('Error loading the 5/3/1 preset:', error);
      });
  }, [db, presetKey, unit]);

  const recordSectionOffset = useCallback(
    (key: string) => (event: LayoutChangeEvent) => {
      sectionOffsets.current[key] = event.nativeEvent.layout.y;
    },
    [],
  );

  const scrollToSection = (key: string) => {
    const y = sectionOffsets.current[key];
    if (y !== undefined) {
      scrollRef.current?.scrollTo({ y, animated: true });
    }
  };

  const patchDay = useCallback(
    (dayKey: string, patch: (day: ScreenDay) => ScreenDay) => {
      setDraft((current) => {
        if (current === null) {
          return current;
        }
        return {
          ...current,
          days: current.days.map((day) => (day.key === dayKey ? patch(day) : day)),
        };
      });
    },
    [],
  );

  const patchAssistance = useCallback(
    (
      dayKey: string,
      exerciseKey: string,
      patch: (row: ScreenAssistance) => ScreenAssistance,
    ) => {
      patchDay(dayKey, (day) => ({
        ...day,
        assistance: day.assistance.map((row) =>
          row.key === exerciseKey ? patch(row) : row,
        ),
      }));
    },
    [patchDay],
  );

  const handleUnitChange = (nextUnit: RoutineUnit) => {
    setDraft((current) => {
      if (current === null) {
        return current;
      }
      const swap = (text: string, oldDefault: number, newDefault: number): string =>
        parseNumericInput(text) === oldDefault ? String(newDefault) : text;
      const oldDefaults = WAVE_UNIT_DEFAULTS[current.unit];
      const newDefaults = WAVE_UNIT_DEFAULTS[nextUnit];
      return {
        ...current,
        unit: nextUnit,
        roundingIncrementText: swap(
          current.roundingIncrementText,
          oldDefaults.roundingIncrement,
          newDefaults.roundingIncrement,
        ),
        upperTmIncrementText: swap(
          current.upperTmIncrementText,
          oldDefaults.upperTmIncrement,
          newDefaults.upperTmIncrement,
        ),
        lowerTmIncrementText: swap(
          current.lowerTmIncrementText,
          oldDefaults.lowerTmIncrement,
          newDefaults.lowerTmIncrement,
        ),
      };
    });
  };

  const tmPercentageFraction = (): number => {
    if (draft === null) {
      return 0.9;
    }
    return (parseNumericInput(draft.tmPercentageText) ?? 90) / 100;
  };

  const roundingIncrement = (): number => {
    if (draft === null) {
      return WAVE_UNIT_DEFAULTS[unit].roundingIncrement;
    }
    return (
      parseNumericInput(draft.roundingIncrementText) ??
      WAVE_UNIT_DEFAULTS[draft.unit].roundingIncrement
    );
  };

  const rampFor = (day: ScreenDay): WarmupSet[] | null =>
    warmupRampFor(
      {
        key: day.key,
        weekday: day.weekday,
        liftName: day.liftName,
        catalogExerciseId: day.catalogExerciseId,
        category: day.category,
        trainingMax: parseNumericInput(day.trainingMaxText),
        assistanceStartWeight: null,
        assistance: [],
      },
      draft?.unit ?? unit,
      roundingIncrement(),
      draft?.roundingDirection ?? 'nearest',
      tmPercentageFraction(),
    );

  const weekdayTakenBy = (dayKey: string, weekday: number): ScreenDay | null => {
    const day = draft?.days.find(
      (candidate) => candidate.key !== dayKey && candidate.weekday === weekday,
    );
    return day ?? null;
  };

  const pickWeekday = (weekday: number) => {
    if (weekdayPickerFor === null || draft === null) {
      return;
    }
    const day = draft.days.find((candidate) => candidate.key === weekdayPickerFor);
    if (day === undefined) {
      setWeekdayPickerFor(null);
      return;
    }
    if (day.weekday === weekday) {
      setWeekdayPickerFor(null);
      return;
    }
    const conflict = weekdayTakenBy(weekdayPickerFor, weekday);
    if (conflict !== null) {
      Alert.alert(
        t('dayTakenTitle'),
        t('dayTakenMessage', {
          weekday: t(WEEKDAY_FULL_KEYS[weekday]),
          name: conflict.liftName,
        }),
      );
      return;
    }
    patchDay(day.key, (current) => ({ ...current, weekday }));
    setWeekdayPickerFor(null);
  };

  const removeDay = (dayKey: string) => {
    const day = draft?.days.find((candidate) => candidate.key === dayKey);
    if (day === undefined) {
      return;
    }
    Alert.alert(
      t('removeDayTitle'),
      t('removeDayMessage', { name: day.liftName }),
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
                    days: current.days.filter((candidate) => candidate.key !== dayKey),
                  },
            ),
        },
      ],
    );
  };

  const openMainLiftPicker = (dayKey: string) => {
    const day = draft?.days.find((candidate) => candidate.key === dayKey);
    if (day === undefined) {
      return;
    }
    setPickerFor({
      dayKey,
      mode: 'main',
      exerciseKey: 'main',
      catalogExerciseId: day.catalogExerciseId,
    });
  };

  const openAssistancePicker = (dayKey: string, row: ScreenAssistance | null) => {
    setPickerFor({
      dayKey,
      mode: 'assistance',
      exerciseKey: row?.key ?? null,
      catalogExerciseId: row?.catalogExerciseId ?? null,
    });
  };

  const applyPickerSelection = (selection: {
    catalogExerciseId: string | null;
    name: string;
  }) => {
    if (pickerFor === null || draft === null) {
      return;
    }
    if (pickerFor.mode === 'main') {
      if (selection.catalogExerciseId === null) {
        patchDay(pickerFor.dayKey, (day) => ({
          ...day,
          liftName: selection.name,
          catalogExerciseId: null,
        }));
      } else {
        db.getAllAsync<{ muscle_name: string }>(
          `SELECT DISTINCT muscle_name FROM Catalog_Exercise_Muscles
           WHERE exercise_key = ? AND is_primary = 1;`,
          [selection.catalogExerciseId],
        )
          .then((rows) => {
            const muscles = rows.map((row) => row.muscle_name);
            patchDay(pickerFor.dayKey, (day) => ({
              ...day,
              liftName: selection.name,
              catalogExerciseId: selection.catalogExerciseId,
              category: muscles.length > 0 ? derivedCategory(muscles) : day.category,
            }));
          })
          .catch((error: unknown) => {
            console.error('Error deriving the lift category:', error);
          });
      }
    } else if (pickerFor.exerciseKey === null) {
      const defaults = ASSISTANCE_BIAS_DEFAULTS[draft.assistanceBias];
      patchDay(pickerFor.dayKey, (day) => ({
        ...day,
        assistance: [
          ...day.assistance,
          {
            key: `n${nextKey.current++}`,
            catalogExerciseId: selection.catalogExerciseId,
            name: selection.name,
            sets: String(defaults.sets),
            reps: String(defaults.reps),
          },
        ],
      }));
    } else {
      patchAssistance(pickerFor.dayKey, pickerFor.exerciseKey, (row) => ({
        ...row,
        catalogExerciseId: selection.catalogExerciseId,
        name: selection.name,
      }));
    }
    setPickerFor(null);
  };

  const removeAssistance = (dayKey: string, exerciseKey: string) => {
    const row = draft?.days
      .find((day) => day.key === dayKey)
      ?.assistance.find((candidate) => candidate.key === exerciseKey);
    if (row === undefined) {
      return;
    }
    Alert.alert(
      t('removeExerciseTitle'),
      t('removeExerciseMessage', { name: row.name }),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Delete'),
          style: 'destructive',
          onPress: () =>
            patchDay(dayKey, (day) => ({
              ...day,
              assistance: day.assistance.filter(
                (candidate) => candidate.key !== exerciseKey,
              ),
            })),
        },
      ],
    );
  };

  const applyEstimate = (dayKey: string) => {
    if (draft === null) {
      return;
    }
    const day = draft.days.find((candidate) => candidate.key === dayKey);
    if (day === undefined) {
      return;
    }
    const weight = parseNumericInput(day.estimateWeight);
    const reps = parseNumericInput(day.estimateReps);
    if (weight === null || weight <= 0 || reps === null || !Number.isInteger(reps) || reps < 1) {
      Alert.alert(t('errorTitle'), t('enterRecentSet'));
      return;
    }
    const estimated = estimateTrainingMax(
      weight,
      reps,
      tmPercentageFraction(),
      roundingIncrement(),
      draft.roundingDirection,
    );
    patchDay(dayKey, (current) => ({
      ...current,
      trainingMaxText: String(estimated),
      estimatorOpen: false,
    }));
  };

  const toWaveDraft = (current: ScreenDraft): WaveSetupDraft => ({
    name: current.name,
    unit: current.unit,
    roundingIncrement: parseNumericInput(current.roundingIncrementText) ?? NaN,
    roundingDirection: current.roundingDirection,
    tmPercentage: (parseNumericInput(current.tmPercentageText) ?? NaN) / 100,
    includeDeload: current.includeDeload,
    warmupsEnabled: current.warmupsEnabled,
    upperTmIncrement: parseNumericInput(current.upperTmIncrementText) ?? NaN,
    lowerTmIncrement: parseNumericInput(current.lowerTmIncrementText) ?? NaN,
    assistanceBias: current.assistanceBias,
    days: current.days.map((day) => ({
      key: day.key,
      weekday: day.weekday,
      liftName: day.liftName,
      catalogExerciseId: day.catalogExerciseId,
      category: day.category,
      trainingMax: parseNumericInput(day.trainingMaxText),
      assistanceStartWeight: parseNumericInput(day.assistanceStartWeightText),
      assistance: day.assistance.map((row) => ({
        key: row.key,
        catalogExerciseId: row.catalogExerciseId,
        name: row.name,
        sets: parseNumericInput(row.sets) ?? NaN,
        reps: parseNumericInput(row.reps) ?? NaN,
      })),
    })),
  });

  const showWaveError = (error: unknown) => {
    if (error instanceof WaveSetupValidationError) {
      const { detail } = error;
      Alert.alert(
        t('saveFailedTitle'),
        t(errorKey(detail), {
          lift: 'lift' in detail ? detail.lift : undefined,
          day: 'day' in detail ? detail.day : undefined,
          exercise: 'exercise' in detail ? detail.exercise : undefined,
        }),
      );
    } else {
      console.error('Error creating the 5/3/1 routine:', error);
      Alert.alert(t('errorTitle'), t('errorActivatingRoutine'));
    }
  };

  const handleCreate = () => {
    if (draft === null) {
      return;
    }
    setBusy(true);
    let waveDraft: WaveSetupDraft;
    try {
      waveDraft = toWaveDraft(draft);
      buildWaveRoutineRows(waveDraft);
    } catch (error) {
      setBusy(false);
      showWaveError(error);
      return;
    }
    getActiveRoutine(routineDb)
      .then((active) => {
        if (active) {
          Alert.alert(
            t('switchRoutineTitle'),
            t('switchRoutineMessage', { name: active.name }),
            [
              { text: t('Cancel'), style: 'cancel', onPress: () => setBusy(false) },
              { text: t('confirm'), onPress: () => writeWave(waveDraft) },
            ],
          );
        } else {
          return writeWave(waveDraft);
        }
      })
      .catch((error: unknown) => {
        setBusy(false);
        showWaveError(error);
      });
  };

  const writeWave = (waveDraft: WaveSetupDraft) => {
    writeWaveRoutine(routineDb, waveDraft)
      .then(() => {
        setBusy(false);
        Alert.alert(
          t('routineActivated'),
          t('routineActivatedMessage', { name: waveDraft.name }),
          [{ text: t('ok'), onPress: () => navigation.popToTop() }],
        );
      })
      .catch((error: unknown) => {
        setBusy(false);
        showWaveError(error);
      });
  };

  if (draft === null) {
    return <View style={[styles.container, { backgroundColor: theme.background }]} />;
  }

  const weekStart = firstWeekday === 'Monday' ? 1 : 0;
  const orderedWeekdays = Array.from({ length: 7 }, (_, index) => (weekStart + index) % 7);

  const renderRamp = (day: ScreenDay) => {
    if (!draft.warmupsEnabled) {
      return null;
    }
    const ramp = rampFor(day);
    if (ramp === null) {
      return (
        <Text style={[styles.helper, { color: theme.text }]} maxFontSizeMultiplier={1.5}>
          {t('rampNeedsTm')}
        </Text>
      );
    }
    return (
      <View>
        <Text style={[styles.helper, { color: theme.text }]} maxFontSizeMultiplier={1.5}>
          {t('rampPreviewLabel')}
        </Text>
        <Text style={[styles.rampLine, { color: theme.text }]} maxFontSizeMultiplier={1.5}>
          {ramp
            .map(
              (set) =>
                `${set.percent}% ×${set.reps} · ${formatWeight(set.weight)} ${set.unit}`,
            )
            .join('   ')}
        </Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps='handled'
      >
        <View onLayout={recordSectionOffset('program')}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>
            {t('programSectionTitle')}
          </Text>
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
              onSelect={handleUnitChange}
              theme={theme}
            />
            <Text style={[styles.helper, { color: theme.text }]} maxFontSizeMultiplier={1.5}>
              {t('unitNote')}
            </Text>
            <Text style={[styles.fieldLabel, { color: theme.text }]}>{t('roundingIncrement')}</Text>
            <AppTextInput
              variant='numeric'
              value={draft.roundingIncrementText}
              onRawChange={(roundingIncrementText) =>
                setDraft((current) => (current === null ? current : { ...current, roundingIncrementText }))
              }
              keyboardType='decimal-pad'
            />
            <ToggleRow
              label={t('includeDeload')}
              value={draft.includeDeload}
              onValueChange={(includeDeload) =>
                setDraft((current) => (current === null ? current : { ...current, includeDeload }))
              }
              theme={theme}
            />
            <ToggleRow
              label={t('warmupsToggle')}
              value={draft.warmupsEnabled}
              onValueChange={(warmupsEnabled) =>
                setDraft((current) => (current === null ? current : { ...current, warmupsEnabled }))
              }
              theme={theme}
            />
          </View>
        </View>

        <View onLayout={recordSectionOffset('advanced')}>
          <Pressable
            onPress={() => setAdvancedOpen((open) => !open)}
            style={styles.advancedHeader}
            accessibilityRole='button'
          >
            <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('advancedHeader')}</Text>
            <Ionicons
              name={advancedOpen ? 'chevron-up' : 'chevron-down'}
              size={24}
              color={theme.text}
            />
          </Pressable>
          {advancedOpen && (
            <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Text style={[styles.fieldLabel, { color: theme.text }]}>{t('tmPercentage')}</Text>
              <AppTextInput
                variant='numeric'
                value={draft.tmPercentageText}
                onRawChange={(tmPercentageText) =>
                  setDraft((current) => (current === null ? current : { ...current, tmPercentageText }))
                }
                keyboardType='number-pad'
              />
              <Text style={[styles.helper, { color: theme.text }]} maxFontSizeMultiplier={1.5}>
                {t('tmPercentageDescription')}
              </Text>
              <Text style={[styles.fieldLabel, { color: theme.text }]}>{t('roundingDirection')}</Text>
              <ChipGroup<RoundingDirection>
                options={[
                  { value: 'up', label: t('roundUp') },
                  { value: 'down', label: t('roundDown') },
                  { value: 'nearest', label: t('roundNearest') },
                ]}
                selected={draft.roundingDirection}
                onSelect={(roundingDirection) =>
                  setDraft((current) => (current === null ? current : { ...current, roundingDirection }))
                }
                theme={theme}
              />
              <View style={styles.pairRow}>
                <View style={styles.pairField}>
                  <Text style={[styles.fieldLabel, { color: theme.text }]}>{t('upperTmIncrement')}</Text>
                  <AppTextInput
                    variant='numeric'
                    value={draft.upperTmIncrementText}
                    onRawChange={(upperTmIncrementText) =>
                      setDraft((current) => (current === null ? current : { ...current, upperTmIncrementText }))
                    }
                    keyboardType='decimal-pad'
                  />
                </View>
                <View style={styles.pairField}>
                  <Text style={[styles.fieldLabel, { color: theme.text }]}>{t('lowerTmIncrement')}</Text>
                  <AppTextInput
                    variant='numeric'
                    value={draft.lowerTmIncrementText}
                    onRawChange={(lowerTmIncrementText) =>
                      setDraft((current) => (current === null ? current : { ...current, lowerTmIncrementText }))
                    }
                    keyboardType='decimal-pad'
                  />
                </View>
              </View>
              <Text style={[styles.fieldLabel, { color: theme.text }]}>{t('assistanceBiasLabel')}</Text>
              <ChipGroup<AssistanceBias>
                options={[
                  { value: 'hypertrophy', label: t('biasHypertrophy') },
                  { value: 'strength', label: t('biasStrength') },
                  { value: 'hybrid', label: t('biasHybrid') },
                ]}
                selected={draft.assistanceBias}
                onSelect={(assistanceBias) =>
                  setDraft((current) => (current === null ? current : { ...current, assistanceBias }))
                }
                theme={theme}
              />
            </View>
          )}
        </View>

        <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('trainingDaysSection')}</Text>

        {draft.days.map((day) => {
          const estimateWeight = parseNumericInput(day.estimateWeight);
          const estimateReps = parseNumericInput(day.estimateReps);
          const estimatorEstimate =
            estimateWeight !== null &&
            estimateWeight > 0 &&
            estimateReps !== null &&
            Number.isInteger(estimateReps) &&
            estimateReps > 0
              ? estimateTrainingMax(
                  estimateWeight,
                  estimateReps,
                  tmPercentageFraction(),
                  roundingIncrement(),
                  draft.roundingDirection,
                )
              : null;
          return (
            <View
              key={day.key}
              onLayout={recordSectionOffset(day.key)}
              style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
            >
              <View style={styles.dayHeader}>
                <Pressable
                  onPress={() => setWeekdayPickerFor(day.key)}
                  style={({ pressed }) => [styles.dayHeaderMain, pressed && styles.pressed]}
                  accessibilityRole='button'
                >
                  <Text style={[styles.dayTitle, { color: theme.text }]}>
                    {t(WEEKDAY_FULL_KEYS[day.weekday])}
                  </Text>
                  <Ionicons name='swap-horizontal' size={16} color={theme.text} />
                </Pressable>
                <Pressable
                  onPress={() => removeDay(day.key)}
                  style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                  accessibilityRole='button'
                  accessibilityLabel={t('removeDayTitle')}
                >
                  <Ionicons name='trash-outline' size={18} color='#B00020' />
                </Pressable>
              </View>

              <Pressable
                onPress={() => openMainLiftPicker(day.key)}
                style={({ pressed }) => [styles.liftRow, pressed && styles.pressed]}
                accessibilityRole='button'
              >
                <Text style={[styles.liftName, { color: theme.text }]} numberOfLines={1}>
                  {day.liftName}
                </Text>
                <Ionicons name='swap-horizontal' size={16} color={theme.text} />
              </Pressable>
              {/* R2: the main lift is one tap from its full description too. */}
              <Pressable
                onPress={() =>
                  setInformation({
                    name: day.liftName,
                    catalogExerciseId: day.catalogExerciseId,
                    targetSets: null,
                    targetReps: null,
                  })
                }
                style={({ pressed }) => [styles.liftRow, pressed && styles.pressed]}
                accessibilityRole='button'
                accessibilityLabel={t('exerciseInfoAction')}
              >
                <Text style={[styles.helper, { color: theme.text }]} maxFontSizeMultiplier={1.5}>
                  {t('exerciseInfoAction')}
                </Text>
                <Ionicons name='information-circle-outline' size={16} color={theme.text} />
              </Pressable>
              <Text style={[styles.categoryBadge, { color: theme.text }]} maxFontSizeMultiplier={1.5}>
                {day.category === 'lower' ? t('categoryLower') : t('categoryUpper')}
              </Text>

              <Text style={[styles.fieldLabel, { color: theme.text }]}>
                {t('trainingMaxLabel', { unit: draft.unit })}
              </Text>
              <AppTextInput
                variant='numeric'
                value={day.trainingMaxText}
                onRawChange={(trainingMaxText) =>
                  patchDay(day.key, (current) => ({ ...current, trainingMaxText }))
                }
                keyboardType='decimal-pad'
              />
              <Pressable
                onPress={() =>
                  patchDay(day.key, (current) => ({
                    ...current,
                    estimatorOpen: !current.estimatorOpen,
                  }))
                }
                style={({ pressed }) => [styles.estimateLink, pressed && styles.pressed]}
                accessibilityRole='button'
              >
                <Text style={[styles.estimateLinkText, { color: theme.text }]} maxFontSizeMultiplier={1.5}>
                  {t('estimateFromRecentSet')}
                </Text>
              </Pressable>
              {day.estimatorOpen && (
                <View style={styles.estimatorBox}>
                  <View style={styles.pairRow}>
                    <View style={styles.pairField}>
                      <Text style={[styles.fieldLabel, { color: theme.text }]}>{t('recentWeight')}</Text>
                      <AppTextInput
                        variant='numeric'
                        value={day.estimateWeight}
                        onRawChange={(estimateWeight) =>
                          patchDay(day.key, (current) => ({ ...current, estimateWeight }))
                        }
                        keyboardType='decimal-pad'
                      />
                    </View>
                    <View style={styles.pairField}>
                      <Text style={[styles.fieldLabel, { color: theme.text }]}>{t('recentReps')}</Text>
                      <AppTextInput
                        variant='numeric'
                        value={day.estimateReps}
                        onRawChange={(estimateReps) =>
                          patchDay(day.key, (current) => ({ ...current, estimateReps }))
                        }
                        keyboardType='number-pad'
                      />
                    </View>
                  </View>
                  {estimatorEstimate !== null && (
                    <Text style={[styles.helper, { color: theme.text }]} maxFontSizeMultiplier={1.5}>
                      {t('estimatedTrainingMax')}: {formatWeight(estimatorEstimate)} {draft.unit}
                    </Text>
                  )}
                  <Pressable
                    disabled={estimatorEstimate === null}
                    onPress={() => applyEstimate(day.key)}
                    style={({ pressed }) => [
                      styles.estimateApply,
                      { backgroundColor: theme.buttonBackground },
                      pressed && styles.pressed,
                      estimatorEstimate === null && styles.disabled,
                    ]}
                    accessibilityRole='button'
                  >
                    <Text style={[styles.estimateApplyText, { color: theme.buttonText }]}>
                      {t('estimateApply')}
                    </Text>
                  </Pressable>
                </View>
              )}

              {renderRamp(day)}

              <Text style={[styles.fieldLabel, { color: theme.text }]}>
                {t('assistanceSectionHeader')}
              </Text>
              <Text style={[styles.fieldLabel, { color: theme.text }]}>
                {t('assistanceStartWeightLabel', { unit: draft.unit })}
              </Text>
              <AppTextInput
                variant='numeric'
                value={day.assistanceStartWeightText}
                onRawChange={(assistanceStartWeightText) =>
                  patchDay(day.key, (current) => ({ ...current, assistanceStartWeightText }))
                }
                keyboardType='decimal-pad'
              />
              <Text style={[styles.helper, { color: theme.text }]} maxFontSizeMultiplier={1.5}>
                {t('assistanceStartWeightHint')}
              </Text>

              {day.assistance.map((row) => (
                <View
                  key={row.key}
                  style={[styles.assistanceRow, { backgroundColor: theme.background, borderColor: theme.border }]}
                >
                  <Pressable
                    onPress={() => openAssistancePicker(day.key, row)}
                    style={({ pressed }) => [styles.assistanceNameButton, pressed && styles.pressed]}
                    accessibilityRole='button'
                  >
                    <Text style={[styles.assistanceName, { color: theme.text }]} numberOfLines={1}>
                      {row.name}
                    </Text>
                    <Ionicons name='swap-horizontal' size={16} color={theme.text} />
                  </Pressable>
                  <View style={styles.assistanceControls}>
                    <View style={styles.assistanceCount}>
                      <AppTextInput
                        variant='numeric'
                        value={row.sets}
                        onRawChange={(sets) => patchAssistance(day.key, row.key, (current) => ({ ...current, sets }))}
                        keyboardType='number-pad'
                      />
                    </View>
                    <Text style={[styles.assistanceCross, { color: theme.text }]}>×</Text>
                    <View style={styles.assistanceCount}>
                      <AppTextInput
                        variant='numeric'
                        value={row.reps}
                        onRawChange={(reps) => patchAssistance(day.key, row.key, (current) => ({ ...current, reps }))}
                        keyboardType='number-pad'
                      />
                    </View>
                    {/* R2: every exercise is one tap from its full description. */}
                    <Pressable
                      onPress={() =>
                        setInformation({
                          name: row.name,
                          catalogExerciseId: row.catalogExerciseId,
                          targetSets: parseNumericInput(row.sets) ?? 0,
                          targetReps: parseNumericInput(row.reps) ?? 0,
                        })
                      }
                      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                      accessibilityRole='button'
                      accessibilityLabel={t('exerciseInfoAction')}
                    >
                      <Ionicons
                        name='information-circle-outline'
                        size={18}
                        color={theme.text}
                      />
                    </Pressable>
                    <Pressable
                      onPress={() => removeAssistance(day.key, row.key)}
                      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                      accessibilityRole='button'
                      accessibilityLabel={t('removeExerciseTitle')}
                    >
                      <Ionicons name='trash-outline' size={18} color='#B00020' />
                    </Pressable>
                  </View>
                </View>
              ))}

              <Pressable
                onPress={() => openAssistancePicker(day.key, null)}
                style={({ pressed }) => [
                  styles.addButton,
                  { borderColor: theme.border },
                  pressed && styles.pressed,
                ]}
                accessibilityRole='button'
              >
                <Ionicons name='add' size={20} color={theme.text} />
                <Text style={[styles.addButtonText, { color: theme.text }]}>{t('addAccessory')}</Text>
              </Pressable>
            </View>
          );
        })}

        <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('reviewHeader')}</Text>
        <Text style={[styles.helper, { color: theme.text }]} maxFontSizeMultiplier={1.5}>
          {t('reviewTapHint')}
        </Text>

        <Pressable
          onPress={() => scrollToSection('program')}
          style={({ pressed }) => [styles.card, { backgroundColor: theme.card, borderColor: theme.border }, pressed && styles.pressed]}
          accessibilityRole='button'
        >
          <Text style={[styles.reviewCardTitle, { color: theme.text }]}>{t('programSectionTitle')}</Text>
          <Text style={[styles.reviewLine, { color: theme.text }]} maxFontSizeMultiplier={1.5}>
            {draft.name} · {draft.unit} · {t('roundingIncrement')} {formatWeight(roundingIncrement())}
          </Text>
          <Text style={[styles.reviewLine, { color: theme.text }]} maxFontSizeMultiplier={1.5}>
            {t('includeDeload')}: {t(draft.includeDeload ? 'amrapOn' : 'amrapOff')} · {t('warmupsToggle')}: {t(draft.warmupsEnabled ? 'amrapOn' : 'amrapOff')} · {t('assistanceBiasLabel')}: {t(`bias${draft.assistanceBias.charAt(0).toUpperCase()}${draft.assistanceBias.slice(1)}`)}
          </Text>
        </Pressable>

        {draft.days.map((day) => {
          const ramp = rampFor(day);
          return (
            <Pressable
              key={`review-${day.key}`}
              onPress={() => scrollToSection(day.key)}
              style={({ pressed }) => [styles.card, { backgroundColor: theme.card, borderColor: theme.border }, pressed && styles.pressed]}
              accessibilityRole='button'
            >
              <Text style={[styles.reviewCardTitle, { color: theme.text }]}>
                {t(WEEKDAY_FULL_KEYS[day.weekday])} · {day.liftName}
              </Text>
              <Text style={[styles.reviewLine, { color: theme.text }]} maxFontSizeMultiplier={1.5}>
                {day.category === 'lower' ? t('categoryLower') : t('categoryUpper')} ·{' '}
                {t('trainingMaxLabel', { unit: draft.unit })}:{' '}
                {parseNumericInput(day.trainingMaxText) !== null
                  ? formatWeight(parseNumericInput(day.trainingMaxText) as number)
                  : '—'}{' '}
                {draft.unit} · {t(draft.warmupsEnabled ? (ramp === null ? 'rampNeedsTm' : 'rampOn') : 'rampOff')}
              </Text>
              {day.assistance.length > 0 && (
                <Text style={[styles.reviewLine, { color: theme.text }]} maxFontSizeMultiplier={1.5}>
                  {day.assistance.map((row) => `${row.name} ${row.sets}×${row.reps}`).join(' · ')}
                </Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Pressable
          disabled={busy}
          onPress={handleCreate}
          style={({ pressed }) => [
            styles.createButton,
            { backgroundColor: theme.buttonBackground },
            pressed && styles.pressed,
            busy && styles.disabled,
          ]}
          accessibilityRole='button'
        >
          <Text style={[styles.createText, { color: theme.buttonText }]}>{t('createWaveRoutine')}</Text>
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
            <Text style={[styles.modalTitle, { color: theme.text }]}>{t('pickDayTitle')}</Text>
            <View style={styles.weekdayGrid}>
              {orderedWeekdays.map((weekday) => {
                const isOwn = draft.days.some(
                  (day) => day.key === weekdayPickerFor && day.weekday === weekday,
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
    </KeyboardAvoidingView>
  );
}

type Theme = ReturnType<typeof useTheme>['theme'];

type ChipGroupProps<T extends string> = {
  options: readonly { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
  theme: Theme;
};

const ChipGroup = <T extends string>({ options, selected, onSelect, theme }: ChipGroupProps<T>) => (
  <View style={styles.chipRow}>
    {options.map((option) => {
      const isSelected = option.value === selected;
      return (
        <Pressable
          key={option.value}
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
            style={[styles.chipText, { color: isSelected ? theme.buttonText : theme.text }]}
            maxFontSizeMultiplier={1.5}
          >
            {option.label}
          </Text>
        </Pressable>
      );
    })}
  </View>
);

type ToggleRowProps = {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  theme: Theme;
};

const ToggleRow = ({ label, value, onValueChange, theme }: ToggleRowProps) => (
  <View style={[styles.toggleRow, { borderColor: theme.border }]}>
    <Text style={[styles.toggleText, { color: theme.text }]} maxFontSizeMultiplier={1.5}>
      {label}
    </Text>
    <Switch
      value={value}
      onValueChange={onValueChange}
      trackColor={{ false: '#767577', true: '#FFFFFF' }}
      thumbColor={value ? '#ffffff' : '#f4f3f4'}
    />
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.gutter,
    paddingBottom: spacing.section,
  },
  sectionTitle: {
    fontSize: fontSize.sectionTitle,
    fontWeight: '900',
    marginTop: spacing.card,
    marginBottom: spacing.card,
  },
  advancedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: touchTarget.row,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.control,
    padding: spacing.card,
    marginBottom: spacing.cardGap,
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
    marginTop: spacing.label,
    marginBottom: spacing.label,
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
  dayTitle: {
    fontSize: fontSize.cardTitle,
    fontWeight: '700',
  },
  iconButton: {
    minHeight: touchTarget.icon,
    minWidth: touchTarget.icon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
    marginTop: spacing.card,
    minHeight: touchTarget.control,
  },
  liftName: {
    fontSize: fontSize.cardTitle,
    fontWeight: '700',
    flexShrink: 1,
  },
  categoryBadge: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    opacity: 0.7,
  },
  estimateLink: {
    alignSelf: 'flex-start',
    minHeight: touchTarget.control,
    justifyContent: 'center',
  },
  estimateLinkText: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
  estimatorBox: {
    borderWidth: 1,
    borderRadius: radius.control,
    borderColor: 'rgba(125, 125, 125, 0.3)',
    padding: spacing.card,
    marginBottom: spacing.card,
  },
  pairRow: {
    flexDirection: 'row',
    gap: spacing.card,
  },
  pairField: {
    flex: 1,
  },
  estimateApply: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    minHeight: touchTarget.control,
    marginTop: spacing.card,
  },
  estimateApplyText: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
  rampLine: {
    fontSize: fontSize.body,
    lineHeight: 19,
    marginBottom: spacing.card,
  },
  assistanceRow: {
    borderWidth: 1,
    borderRadius: radius.control,
    padding: spacing.label,
    marginBottom: spacing.label,
  },
  assistanceNameButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
    minHeight: touchTarget.control,
  },
  assistanceName: {
    fontSize: fontSize.body,
    fontWeight: '700',
    flexShrink: 1,
  },
  assistanceControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
  },
  assistanceCount: {
    flex: 1,
  },
  assistanceCross: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.inline,
    borderWidth: 1,
    borderRadius: radius.control,
    minHeight: touchTarget.control,
    marginTop: spacing.card,
  },
  addButtonText: {
    fontSize: fontSize.button,
    fontWeight: '700',
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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: touchTarget.row,
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: spacing.card,
    marginTop: spacing.card,
  },
  toggleText: {
    flex: 1,
    fontSize: fontSize.body,
    fontWeight: '600',
    marginRight: spacing.card,
  },
  reviewCardTitle: {
    fontSize: fontSize.cardTitle,
    fontWeight: '700',
    marginBottom: spacing.label,
  },
  reviewLine: {
    fontSize: fontSize.body,
    lineHeight: 19,
    marginBottom: 2,
  },
  footer: {
    borderTopWidth: 1,
    padding: spacing.gutter,
  },
  createButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: touchTarget.control,
    borderRadius: radius.control,
  },
  createText: {
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
