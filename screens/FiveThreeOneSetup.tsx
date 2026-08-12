import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import Ionicons from 'react-native-vector-icons/Ionicons';

import AppTextInput, {
  APP_TEXT_MAX_FONT_SIZE_MULTIPLIER,
  parseNumericInput,
} from '../components/AppTextInput';
import FiveThreeOneDayCard, {
  createAccessoryDraft,
  type AccessoryDraft,
  type AssistanceTemplateOption,
  type TrainingDayState,
} from '../components/FiveThreeOneDayCard';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import { useTranslation } from 'react-i18next';
import { WorkoutStackParamList } from '../App';
import {
  calcSetWeight,
  estimate1RM,
  warmupSets,
  waveForWeek,
  type LiftCategory,
  type RoundingDirection,
  type WarmupSet,
  type WeightUnit,
} from '../utils/fiveThreeOne';
import {
  DEFAULT_TRAINING_DAYS,
  assignDaySlots,
  getAssistanceInsertParams,
  getFiveThreeOneProgramInsertParams,
  orderByWeek,
  orderedWeekdays,
  validateWeeklyPlan,
  type FirstWeekday,
  type FiveThreeOneProgramSettings,
  type Weekday,
  type WeeklyPlanIssue,
  type WeeklyPlanValidationInput,
} from '../utils/fiveThreeOneSetup';
import { DEFAULT_FIVE_THREE_ONE_DEFAULTS } from '../utils/settingsStorage';

type FiveThreeOneSetupNavigationProp = StackNavigationProp<
  WorkoutStackParamList,
  'FiveThreeOneSetup'
>;

interface PersistedDay {
  liftName: string;
  category: LiftCategory;
  trainingMax: number;
  daySlot: number;
  weekday: Weekday;
  warmupEnabled: boolean;
  assistanceTemplateId: number | null;
  accessories: { name: string; sets: number; reps: number }[];
}

const TOTAL_STEPS = 3;

const WEEKDAY_TRANSLATION_KEYS: Record<Weekday, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

const UNIT_PROGRAM_DEFAULTS: Record<
  WeightUnit,
  { roundingIncrement: number; upperTmIncrement: number; lowerTmIncrement: number }
> = {
  kg: { roundingIncrement: 2.5, upperTmIncrement: 2.5, lowerTmIncrement: 5 },
  lb: { roundingIncrement: 5, upperTmIncrement: 5, lowerTmIncrement: 10 },
};

const formatWeight = (weight: number): string => Number(weight.toFixed(2)).toString();

const createDay = (
  weekday: Weekday,
  liftName: string,
  category: LiftCategory,
  warmupEnabled: boolean,
): TrainingDayState => ({
  weekday,
  liftName,
  category,
  tmMode: 'direct',
  trainingMaxText: '',
  recentWeightText: '',
  recentRepsText: '',
  warmupEnabled,
  assistanceTemplateId: null,
  accessories: [],
});

const createInitialDays = (): TrainingDayState[] =>
  DEFAULT_TRAINING_DAYS.map((day) =>
    createDay(
      day.weekday,
      day.liftName,
      day.category,
      DEFAULT_FIVE_THREE_ONE_DEFAULTS.warmupEnabled,
    ),
  );

async function saveFiveThreeOneProgram(
  db: SQLiteDatabase,
  program: FiveThreeOneProgramSettings,
  days: readonly PersistedDay[],
): Promise<void> {
  await db.withTransactionAsync(async () => {
    const programResult = await db.runAsync(
      `INSERT INTO FiveThreeOne_Programs
       (program_name, unit, rounding_increment, rounding_direction, tm_percentage,
        include_deload, upper_tm_increment, lower_tm_increment, warmup_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      getFiveThreeOneProgramInsertParams(program),
    );

    if (programResult.lastInsertRowId <= 0) {
      throw new Error('Failed to create the 5/3/1 program.');
    }

    for (const day of days) {
      const liftResult = await db.runAsync(
        `INSERT INTO FiveThreeOne_Lifts
         (program_id, lift_name, lift_type, training_max, day_slot, weekday, warmup_enabled,
          assistance_template_id, suggested_training_max, suggestion_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          programResult.lastInsertRowId,
          day.liftName,
          day.category,
          day.trainingMax,
          day.daySlot,
          day.weekday,
          day.warmupEnabled ? 1 : 0,
          day.assistanceTemplateId,
          null,
          null,
        ],
      );

      if (liftResult.lastInsertRowId <= 0) {
        throw new Error(`Failed to create the training day for ${day.liftName}.`);
      }

      for (const params of getAssistanceInsertParams(
        liftResult.lastInsertRowId,
        day.accessories,
      )) {
        await db.runAsync(
          `INSERT INTO FiveThreeOne_LiftAssistance
           (lift_id, exercise_name, sets, reps, sort_order)
           VALUES (?, ?, ?, ?, ?);`,
          params,
        );
      }
    }
  });
}

const validationMessages: Record<WeeklyPlanIssue, string> = {
  'program-name-required': 'programNameRequired',
  'unit-invalid': 'programUnitInvalid',
  'rounding-increment-positive': 'roundingIncrementRequired',
  'rounding-direction-invalid': 'roundingDirectionInvalid',
  'tm-percentage-invalid': 'tmPercentageInvalid',
  'upper-tm-increment-positive': 'upperTmIncrementRequired',
  'lower-tm-increment-positive': 'lowerTmIncrementRequired',
  'training-day-required': 'trainingDayRequired',
  'weekday-invalid': 'weekdayInvalid',
  'duplicate-weekday': 'duplicateWeekday',
  'lift-name-required': 'liftNameRequired',
  'duplicate-lift-name': 'duplicateLiftName',
  'lift-category-invalid': 'liftCategoryInvalid',
  'training-max-positive': 'trainingMaxRequired',
  'assistance-name-required': 'assistanceNameRequired',
  'assistance-sets-positive': 'assistanceSetsPositive',
  'assistance-reps-positive': 'assistanceRepsPositive',
};

const PROGRAM_ISSUES: readonly WeeklyPlanIssue[] = [
  'program-name-required',
  'unit-invalid',
  'rounding-increment-positive',
  'rounding-direction-invalid',
  'tm-percentage-invalid',
  'upper-tm-increment-positive',
  'lower-tm-increment-positive',
];

const getIssueStep = (issue: WeeklyPlanIssue): number =>
  PROGRAM_ISSUES.includes(issue) ? 0 : 1;

export default function FiveThreeOneSetup() {
  const navigation = useNavigation<FiveThreeOneSetupNavigationProp>();
  const db = useSQLiteContext();
  const { theme } = useTheme();
  const { fiveThreeOneDefaults, firstWeekday } = useSettings();
  const { t } = useTranslation();

  const [step, setStep] = useState(0);
  const [programName, setProgramName] = useState('');
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [roundingIncrementText, setRoundingIncrementText] = useState(() =>
    formatWeight(DEFAULT_FIVE_THREE_ONE_DEFAULTS.roundingIncrement),
  );
  const [roundingDirection, setRoundingDirection] = useState<RoundingDirection>('nearest');
  const [tmPercentageText, setTmPercentageText] = useState(() =>
    formatWeight(DEFAULT_FIVE_THREE_ONE_DEFAULTS.tmPercentage * 100),
  );
  const [includeDeload, setIncludeDeload] = useState(
    DEFAULT_FIVE_THREE_ONE_DEFAULTS.includeDeload,
  );
  const [upperTmIncrementText, setUpperTmIncrementText] = useState(() =>
    formatWeight(DEFAULT_FIVE_THREE_ONE_DEFAULTS.upperTmIncrement),
  );
  const [lowerTmIncrementText, setLowerTmIncrementText] = useState(() =>
    formatWeight(DEFAULT_FIVE_THREE_ONE_DEFAULTS.lowerTmIncrement),
  );
  const [warmupEnabled, setWarmupEnabled] = useState(
    DEFAULT_FIVE_THREE_ONE_DEFAULTS.warmupEnabled,
  );
  const [days, setDays] = useState<TrainingDayState[]>(createInitialDays);
  const [expandedWeekday, setExpandedWeekday] = useState<Weekday | null>(null);
  const [templates, setTemplates] = useState<AssistanceTemplateOption[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasEditedWizard = useRef(false);

  const markWizardEdited = () => {
    hasEditedWizard.current = true;
  };

  useEffect(() => {
    if (hasEditedWizard.current) {
      return;
    }

    setRoundingIncrementText(formatWeight(fiveThreeOneDefaults.roundingIncrement));
    setRoundingDirection(fiveThreeOneDefaults.roundingDirection);
    setTmPercentageText(formatWeight(fiveThreeOneDefaults.tmPercentage * 100));
    setIncludeDeload(fiveThreeOneDefaults.includeDeload);
    setUpperTmIncrementText(formatWeight(fiveThreeOneDefaults.upperTmIncrement));
    setLowerTmIncrementText(formatWeight(fiveThreeOneDefaults.lowerTmIncrement));
    setWarmupEnabled(fiveThreeOneDefaults.warmupEnabled);
    setDays((currentDays) =>
      currentDays.map((day) => ({
        ...day,
        warmupEnabled: fiveThreeOneDefaults.warmupEnabled,
      })),
    );
  }, [fiveThreeOneDefaults]);

  useEffect(() => {
    let isMounted = true;

    const loadTemplates = async () => {
      try {
        const result = await db.getAllAsync<AssistanceTemplateOption>(
          `SELECT template_id, template_name, description
           FROM FiveThreeOne_AssistanceTemplates
           WHERE is_builtin = 1
           ORDER BY template_name;`,
        );

        if (isMounted) {
          setTemplates(result);
        }
      } catch (loadError) {
        console.error('Error loading 5/3/1 assistance templates:', loadError);
        if (isMounted) {
          setError(t('assistanceTemplatesLoadError'));
        }
      } finally {
        if (isMounted) {
          setIsLoadingTemplates(false);
        }
      }
    };

    loadTemplates();

    return () => {
      isMounted = false;
    };
  }, [db]);

  const weekStart: FirstWeekday = firstWeekday === 'Sunday' ? 'Sunday' : 'Monday';
  const weekdayLabel = (weekday: Weekday): string => t(WEEKDAY_TRANSLATION_KEYS[weekday]);
  const orderedDays = orderByWeek(days, weekStart);

  const getTmPercentage = (): number | null => {
    const percentage = parseNumericInput(tmPercentageText);
    return percentage === null ? null : percentage / 100;
  };

  const getTrainingMax = (day: TrainingDayState): number | null => {
    if (day.tmMode === 'direct') {
      return parseNumericInput(day.trainingMaxText);
    }

    const recentWeight = parseNumericInput(day.recentWeightText);
    const recentReps = parseNumericInput(day.recentRepsText);
    const tmPercentage = getTmPercentage();
    if (
      recentWeight === null ||
      recentReps === null ||
      !Number.isInteger(recentReps) ||
      recentReps <= 0 ||
      tmPercentage === null
    ) {
      return null;
    }

    try {
      return estimate1RM(recentWeight, recentReps) * tmPercentage;
    } catch {
      return null;
    }
  };

  const getWarmupPreview = (day: TrainingDayState): WarmupSet[] => {
    const trainingMax = getTrainingMax(day);
    const increment = parseNumericInput(roundingIncrementText);
    if (!day.warmupEnabled || trainingMax === null || increment === null || increment <= 0) {
      return [];
    }

    try {
      return warmupSets(trainingMax, { unit, increment, direction: roundingDirection });
    } catch {
      return [];
    }
  };

  const getWorkSetPreview = (
    day: TrainingDayState,
  ): { percent: number; weight: number; reps: number; isAmrap: boolean }[] => {
    const trainingMax = getTrainingMax(day);
    const increment = parseNumericInput(roundingIncrementText);
    if (trainingMax === null || increment === null || increment <= 0) {
      return [];
    }

    try {
      return waveForWeek(1).sets.map((set) => ({
        percent: set.percent,
        weight: calcSetWeight(trainingMax, set.percent, increment, roundingDirection),
        reps: set.targetReps,
        isAmrap: set.isAmrap,
      }));
    } catch {
      return [];
    }
  };

  const getValidationInput = (): WeeklyPlanValidationInput => ({
    programName,
    unit,
    roundingIncrement: parseNumericInput(roundingIncrementText),
    roundingDirection,
    tmPercentage: getTmPercentage(),
    includeDeload,
    upperTmIncrement: parseNumericInput(upperTmIncrementText),
    lowerTmIncrement: parseNumericInput(lowerTmIncrementText),
    warmupEnabled,
    days: orderedDays.map((day) => ({
      weekday: day.weekday,
      liftName: day.liftName,
      category: day.category,
      trainingMax: getTrainingMax(day),
      warmupEnabled: day.warmupEnabled,
      assistanceTemplateId: day.assistanceTemplateId,
      assistance: day.accessories.map((accessory) => ({
        name: accessory.name,
        sets: parseNumericInput(accessory.setsText),
        reps: parseNumericInput(accessory.repsText),
      })),
    })),
  });

  const showValidationError = (issue: WeeklyPlanIssue) => {
    setError(t(validationMessages[issue]));
  };

  const validateCurrentStep = (): WeeklyPlanIssue | null => {
    const input = getValidationInput();

    // Step 0 owns the program settings only, so it is checked against a stand-in week.
    if (step === 0) {
      return validateWeeklyPlan({
        ...input,
        days: [
          {
            weekday: 1,
            liftName: 'Lift',
            category: 'upper',
            trainingMax: 1,
            warmupEnabled: true,
            assistanceTemplateId: null,
            assistance: [],
          },
        ],
      });
    }

    return validateWeeklyPlan(input);
  };

  const updateDay = (weekday: Weekday, update: Partial<TrainingDayState>) => {
    markWizardEdited();
    setDays((currentDays) =>
      currentDays.map((day) => (day.weekday === weekday ? { ...day, ...update } : day)),
    );
    setError(null);
  };

  const removeDay = (weekday: Weekday) => {
    markWizardEdited();
    setDays((currentDays) => currentDays.filter((day) => day.weekday !== weekday));
    setExpandedWeekday((current) => (current === weekday ? null : current));
    setError(null);
  };

  const confirmRemoveDay = (day: TrainingDayState) => {
    if (!day.liftName.trim() && day.accessories.length === 0) {
      removeDay(day.weekday);
      return;
    }

    Alert.alert(
      t('removeTrainingDayTitle'),
      t('removeTrainingDayMessage', {
        day: weekdayLabel(day.weekday),
        lift: day.liftName.trim() || t('unnamedLift'),
      }),
      [
        { text: t('Cancel'), style: 'cancel' },
        { text: t('Delete'), style: 'destructive', onPress: () => removeDay(day.weekday) },
      ],
    );
  };

  const toggleWeekday = (weekday: Weekday) => {
    const existing = days.find((day) => day.weekday === weekday);
    if (existing) {
      confirmRemoveDay(existing);
      return;
    }

    markWizardEdited();
    setDays((currentDays) => [...currentDays, createDay(weekday, '', 'upper', warmupEnabled)]);
    setExpandedWeekday(weekday);
    setError(null);
  };

  const applyTemplate = (weekday: Weekday, templateId: number) => {
    const day = days.find((entry) => entry.weekday === weekday);
    if (!day) {
      return;
    }

    const seed = async () => {
      try {
        const exercises = await db.getAllAsync<{
          exercise_name: string;
          sets: number;
          reps: number;
        }>(
          `SELECT exercise_name, sets, reps
           FROM FiveThreeOne_AssistanceExercises
           WHERE template_id = ?
           ORDER BY sort_order;`,
          [templateId],
        );

        updateDay(weekday, {
          assistanceTemplateId: templateId,
          accessories: exercises.map((exercise) =>
            createAccessoryDraft(exercise.exercise_name, exercise.sets, exercise.reps),
          ),
        });
      } catch (seedError) {
        console.error('Error loading 5/3/1 assistance template exercises:', seedError);
        setError(t('assistanceTemplatesLoadError'));
      }
    };

    if (day.accessories.length === 0) {
      void seed();
      return;
    }

    const templateName =
      templates.find((template) => template.template_id === templateId)?.template_name ?? '';
    Alert.alert(
      t('replaceAccessoriesTitle'),
      t('replaceAccessoriesMessage', { template: templateName }),
      [
        { text: t('Cancel'), style: 'cancel' },
        { text: t('replace'), onPress: () => void seed() },
      ],
    );
  };

  const openNextDay = (weekday: Weekday) => {
    const position = orderedDays.findIndex((day) => day.weekday === weekday);
    const next = orderedDays[position + 1];
    setExpandedWeekday(next ? next.weekday : null);
  };

  const handleUnitChange = (nextUnit: WeightUnit) => {
    markWizardEdited();
    const currentUnitDefaults = UNIT_PROGRAM_DEFAULTS[unit];
    const nextUnitDefaults = UNIT_PROGRAM_DEFAULTS[nextUnit];

    setUnit(nextUnit);
    if (parseNumericInput(roundingIncrementText) === currentUnitDefaults.roundingIncrement) {
      setRoundingIncrementText(formatWeight(nextUnitDefaults.roundingIncrement));
    }
    if (parseNumericInput(upperTmIncrementText) === currentUnitDefaults.upperTmIncrement) {
      setUpperTmIncrementText(formatWeight(nextUnitDefaults.upperTmIncrement));
    }
    if (parseNumericInput(lowerTmIncrementText) === currentUnitDefaults.lowerTmIncrement) {
      setLowerTmIncrementText(formatWeight(nextUnitDefaults.lowerTmIncrement));
    }
    setError(null);
  };

  const handleRoundingDirectionChange = (direction: RoundingDirection) => {
    markWizardEdited();
    setRoundingDirection(direction);
    setError(null);
  };

  const handleWarmupDefaultChange = (value: boolean) => {
    markWizardEdited();
    setWarmupEnabled(value);
    setError(null);
  };

  const handleNext = () => {
    const issue = validateCurrentStep();
    if (issue) {
      showValidationError(issue);
      return;
    }

    setError(null);
    setStep((currentStep) => Math.min(currentStep + 1, TOTAL_STEPS - 1));
  };

  const handleBack = () => {
    setError(null);
    if (step === 0) {
      navigation.goBack();
      return;
    }
    setStep((currentStep) => currentStep - 1);
  };

  const handleConfirm = async () => {
    const input = getValidationInput();
    const issue = validateWeeklyPlan(input);
    if (issue) {
      setStep(getIssueStep(issue));
      showValidationError(issue);
      return;
    }

    const program: FiveThreeOneProgramSettings = {
      name: input.programName.trim(),
      unit: input.unit as WeightUnit,
      roundingIncrement: input.roundingIncrement as number,
      roundingDirection: input.roundingDirection as RoundingDirection,
      tmPercentage: input.tmPercentage as number,
      includeDeload: input.includeDeload,
      upperTmIncrement: input.upperTmIncrement as number,
      lowerTmIncrement: input.lowerTmIncrement as number,
      warmupEnabled: input.warmupEnabled,
    };
    const persistedDays: PersistedDay[] = assignDaySlots(input.days, weekStart).map((day) => ({
      liftName: day.liftName.trim(),
      category: day.category as LiftCategory,
      trainingMax: day.trainingMax as number,
      daySlot: day.daySlot,
      weekday: day.weekday as Weekday,
      warmupEnabled: day.warmupEnabled,
      assistanceTemplateId: day.assistanceTemplateId,
      accessories: day.assistance.map((accessory) => ({
        name: accessory.name,
        sets: accessory.sets as number,
        reps: accessory.reps as number,
      })),
    }));

    setIsSaving(true);
    setError(null);

    try {
      const existingProgram = await db.getFirstAsync<{ program_id: number }>(
        'SELECT program_id FROM FiveThreeOne_Programs WHERE program_name = ?;',
        [program.name],
      );
      if (existingProgram) {
        setStep(0);
        setError(t('programNameAlreadyExists'));
        return;
      }

      await saveFiveThreeOneProgram(db, program, persistedDays);
      Alert.alert(t('programCreated'), t('programCreatedMessage'));
      navigation.navigate('Programs');
    } catch (saveError) {
      console.error('Error saving 5/3/1 program:', saveError);
      setError(t('failedToCreateProgram'));
    } finally {
      setIsSaving(false);
    }
  };

  const renderChoice = (
    label: string,
    selected: boolean,
    onPress: () => void,
    accessibilityLabel: string,
  ) => (
    <TouchableOpacity
      key={label}
      style={[
        styles.choice,
        {
          backgroundColor: selected ? theme.buttonBackground : theme.card,
          borderColor: theme.border,
        },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
    >
      <Text
        maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        style={{ color: selected ? theme.buttonText : theme.text }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  const renderBasics = () => (
    <View>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('programBasics')}</Text>
      <Text
        maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        style={[styles.label, { color: theme.text }]}
      >
        {t('programName')}
      </Text>
      <AppTextInput
        variant="text"
        style={styles.fullInput}
        placeholder={t('programNamePlaceholder')}
        value={programName}
        onFocus={markWizardEdited}
        onChangeText={(value) => {
          markWizardEdited();
          setProgramName(value);
          setError(null);
        }}
        autoCapitalize="words"
      />

      <Text
        maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        style={[styles.label, { color: theme.text }]}
      >
        {t('unit')}
      </Text>
      <View style={styles.choiceRow}>
        {renderChoice(t('kilograms'), unit === 'kg', () => handleUnitChange('kg'), t('kilograms'))}
        {renderChoice(t('pounds'), unit === 'lb', () => handleUnitChange('lb'), t('pounds'))}
      </View>

      <Text
        maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        style={[styles.label, { color: theme.text }]}
      >
        {t('roundingIncrement')}
      </Text>
      <AppTextInput
        variant="numeric"
        style={styles.fullInput}
        placeholder={t('roundingIncrementPlaceholder')}
        value={roundingIncrementText}
        onFocus={markWizardEdited}
        onRawChange={(value) => {
          markWizardEdited();
          setRoundingIncrementText(value);
          setError(null);
        }}
        keyboardType="decimal-pad"
      />

      <Text
        maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        style={[styles.label, { color: theme.text }]}
      >
        {t('roundingDirection')}
      </Text>
      <View style={styles.choiceRow}>
        {renderChoice(
          t('roundUp'),
          roundingDirection === 'up',
          () => handleRoundingDirectionChange('up'),
          t('roundUp'),
        )}
        {renderChoice(
          t('roundDown'),
          roundingDirection === 'down',
          () => handleRoundingDirectionChange('down'),
          t('roundDown'),
        )}
        {renderChoice(
          t('roundNearest'),
          roundingDirection === 'nearest',
          () => handleRoundingDirectionChange('nearest'),
          t('roundNearest'),
        )}
      </View>

      <Text
        maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        style={[styles.label, { color: theme.text }]}
      >
        {t('tmPercentage')}
      </Text>
      <Text style={[styles.helperText, { color: theme.text }]}>{t('tmPercentageDescription')}</Text>
      <AppTextInput
        variant="numeric"
        style={styles.fullInput}
        placeholder={t('tmPercentagePlaceholder')}
        value={tmPercentageText}
        onFocus={markWizardEdited}
        onRawChange={(value) => {
          markWizardEdited();
          setTmPercentageText(value);
          setError(null);
        }}
        keyboardType="decimal-pad"
      />

      <View style={styles.programToggleRow}>
        <Text style={styles.programToggleText}>{t('includeDeload')}</Text>
        <Switch
          value={includeDeload}
          onValueChange={(value) => {
            markWizardEdited();
            setIncludeDeload(value);
            setError(null);
          }}
          trackColor={{ false: '#767577', true: '#FFFFFF' }}
          thumbColor={includeDeload ? '#ffffff' : '#f4f3f4'}
        />
      </View>

      <Text
        maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        style={[styles.label, { color: theme.text }]}
      >
        {t('upperTmIncrement')}
      </Text>
      <AppTextInput
        variant="numeric"
        style={styles.fullInput}
        placeholder={t('upperTmIncrement')}
        value={upperTmIncrementText}
        onFocus={markWizardEdited}
        onRawChange={(value) => {
          markWizardEdited();
          setUpperTmIncrementText(value);
          setError(null);
        }}
        keyboardType="decimal-pad"
      />

      <Text
        maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        style={[styles.label, { color: theme.text }]}
      >
        {t('lowerTmIncrement')}
      </Text>
      <AppTextInput
        variant="numeric"
        style={styles.fullInput}
        placeholder={t('lowerTmIncrement')}
        value={lowerTmIncrementText}
        onFocus={markWizardEdited}
        onRawChange={(value) => {
          markWizardEdited();
          setLowerTmIncrementText(value);
          setError(null);
        }}
        keyboardType="decimal-pad"
      />

      <View style={styles.programToggleRow}>
        <Text style={styles.programToggleText}>{t('warmupDefaultForNewDays')}</Text>
        <Switch
          value={warmupEnabled}
          onValueChange={handleWarmupDefaultChange}
          trackColor={{ false: '#767577', true: '#FFFFFF' }}
          thumbColor={warmupEnabled ? '#ffffff' : '#f4f3f4'}
        />
      </View>

      <Text style={[styles.helperText, { color: theme.text }]}>
        {t('programSetupNoProgression')}
      </Text>
    </View>
  );

  const renderWeek = () => (
    <View>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('yourWeek')}</Text>
      <Text style={[styles.helperText, { color: theme.text }]}>{t('yourWeekDescription')}</Text>

      <Text
        maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        style={[styles.label, { color: theme.text }]}
      >
        {t('trainingDays')}
      </Text>
      <View style={styles.choiceRow}>
        {orderedWeekdays(weekStart).map((weekday) => {
          const selected = days.some((day) => day.weekday === weekday);
          return renderChoice(
            weekdayLabel(weekday),
            selected,
            () => toggleWeekday(weekday),
            selected
              ? t('removeTrainingDay', { day: weekdayLabel(weekday) })
              : t('addTrainingDay', { day: weekdayLabel(weekday) }),
          );
        })}
      </View>

      {isLoadingTemplates ? (
        <ActivityIndicator size="large" color={theme.buttonBackground} />
      ) : orderedDays.length === 0 ? (
        <Text style={[styles.helperText, { color: theme.text }]}>
          {t('noTrainingDaysSelected')}
        </Text>
      ) : (
        orderedDays.map((day, index) => (
          <FiveThreeOneDayCard
            key={day.weekday}
            day={day}
            dayLabel={weekdayLabel(day.weekday)}
            unit={unit}
            trainingMax={getTrainingMax(day)}
            warmupPreview={getWarmupPreview(day)}
            templates={templates}
            expanded={expandedWeekday === day.weekday}
            isLastDay={index === orderedDays.length - 1}
            onToggleExpanded={() =>
              setExpandedWeekday((current) => (current === day.weekday ? null : day.weekday))
            }
            onChange={(update) => updateDay(day.weekday, update)}
            onSeedFromTemplate={(templateId) => applyTemplate(day.weekday, templateId)}
            onRemove={() => confirmRemoveDay(day)}
            onDone={() => openNextDay(day.weekday)}
          />
        ))
      )}
    </View>
  );

  const renderReview = () => (
    <View>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('reviewProgram')}</Text>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.reviewTitle, { color: theme.text }]}>
          {programName.trim() || t('unnamedProgram')}
        </Text>
        <Text style={[styles.reviewLine, { color: theme.text }]}>
          {t('unit')}: {unit === 'kg' ? t('kilograms') : t('pounds')}
        </Text>
        <Text style={[styles.reviewLine, { color: theme.text }]}>
          {t('rounding')}: {roundingIncrementText} /{' '}
          {roundingDirection === 'up'
            ? t('roundUp')
            : roundingDirection === 'down'
              ? t('roundDown')
              : t('roundNearest')}
        </Text>
        <Text style={[styles.reviewLine, { color: theme.text }]}>
          {t('tmPercentage')}: {tmPercentageText}%
        </Text>
        <Text style={[styles.reviewLine, { color: theme.text }]}>
          {t('includeDeload')}: {includeDeload ? t('deloadIncluded') : t('deloadNotIncluded')}
        </Text>
        <Text style={[styles.reviewLine, { color: theme.text }]}>
          {t('upperTmIncrement')}: {upperTmIncrementText} / {t('lowerTmIncrement')}:{' '}
          {lowerTmIncrementText}
        </Text>
      </View>

      <Text style={[styles.sectionSubtitle, { color: theme.text }]}>{t('weekOverview')}</Text>
      {orderedDays.map((day) => {
        const trainingMax = getTrainingMax(day);
        const workSets = getWorkSetPreview(day);

        return (
          <View
            key={day.weekday}
            style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
          >
            <Text style={[styles.cardTitle, { color: theme.text }]}>
              {weekdayLabel(day.weekday)} — {day.liftName.trim() || t('unnamedLift')}
            </Text>
            <Text style={[styles.reviewLine, { color: theme.text }]}>
              {t('trainingMax')}: {trainingMax === null ? '?' : formatWeight(trainingMax)} {unit} /{' '}
              {t(day.category)}
            </Text>
            <Text style={[styles.reviewLine, { color: theme.text }]}>
              {t('warmupForThisDay')}:{' '}
              {day.warmupEnabled ? t('warmupsIncluded') : t('warmupsNotIncluded')}
            </Text>
            {workSets.length > 0 && (
              <Text style={[styles.reviewLine, { color: theme.text }]}>
                {t('workSetsWeekOne')}:{' '}
                {workSets
                  .map(
                    (set) =>
                      `${formatWeight(set.weight)} ${unit} × ${set.reps}${
                        set.isAmrap ? '+' : ''
                      }`,
                  )
                  .join(', ')}
              </Text>
            )}
            <Text style={[styles.reviewLine, { color: theme.text }]}>
              {t('accessoriesSection')}:{' '}
              {day.accessories.length === 0
                ? t('noAccessories')
                : day.accessories
                    .map(
                      (accessory: AccessoryDraft) =>
                        `${accessory.name.trim() || t('unnamedAccessory')} ${accessory.setsText}×${
                          accessory.repsText
                        }`,
                    )
                    .join(', ')}
            </Text>
          </View>
        );
      })}
    </View>
  );

  const stepNames = [t('programBasics'), t('yourWeek'), t('review')];

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel={t('back')}
          >
            <Ionicons name="arrow-back" size={28} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: theme.text }]}>{t('setupFiveThreeOne')}</Text>
        </View>

        <View style={styles.progressHeader}>
          <Text
            maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
            style={[styles.progressText, { color: theme.text }]}
          >
            {t('stepOf', { current: step + 1, total: TOTAL_STEPS })}: {stepNames[step]}
          </Text>
          <View style={[styles.progressTrack, { backgroundColor: theme.card }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: theme.buttonBackground,
                  width: `${((step + 1) / TOTAL_STEPS) * 100}%`,
                },
              ]}
            />
          </View>
        </View>

        {error && (
          <Text style={[styles.errorText, { color: theme.text }]} accessibilityRole="alert">
            {error}
          </Text>
        )}

        {step === 0 && renderBasics()}
        {step === 1 && renderWeek()}
        {step === 2 && renderReview()}

        <View style={styles.navigationButtons}>
          {step > 0 && (
            <TouchableOpacity
              style={[styles.secondaryButton, styles.navigationButton, { borderColor: theme.border }]}
              onPress={handleBack}
              accessibilityRole="button"
              accessibilityLabel={t('back')}
            >
              <Text
                maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                style={[styles.secondaryButtonText, { color: theme.text }]}
              >
                {t('back')}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[
              styles.primaryButton,
              styles.navigationButton,
              { backgroundColor: theme.buttonBackground },
            ]}
            onPress={step === TOTAL_STEPS - 1 ? handleConfirm : handleNext}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityLabel={step === TOTAL_STEPS - 1 ? t('saveProgram') : t('next')}
          >
            {isSaving ? (
              <ActivityIndicator color={theme.buttonText} />
            ) : (
              <Text
                maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                style={[styles.primaryButtonText, { color: theme.buttonText }]}
              >
                {step === TOTAL_STEPS - 1 ? t('saveProgram') : t('next')}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 60,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 22,
  },
  backButton: {
    padding: 8,
    marginRight: 12,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    flexShrink: 1,
  },
  progressHeader: {
    marginBottom: 22,
  },
  progressText: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
  },
  sectionTitle: {
    fontSize: 25,
    fontWeight: '800',
    marginBottom: 18,
  },
  sectionSubtitle: {
    fontSize: 19,
    fontWeight: '800',
    marginTop: 6,
    marginBottom: 12,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 14,
  },
  fullInput: {
    marginBottom: 4,
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  programToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 15,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: '#121212',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#000000',
  },
  programToggleText: {
    flex: 1,
    marginRight: 12,
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  choice: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 22,
    borderWidth: 1,
    marginRight: 8,
    marginBottom: 8,
    justifyContent: 'center',
  },
  helperText: {
    fontSize: 14,
    lineHeight: 20,
    opacity: 0.7,
    marginBottom: 14,
  },
  errorText: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
    marginBottom: 16,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    flexShrink: 1,
  },
  reviewTitle: {
    fontSize: 21,
    fontWeight: '800',
    marginBottom: 8,
  },
  reviewLine: {
    fontSize: 15,
    lineHeight: 22,
    marginTop: 4,
  },
  secondaryButton: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  navigationButtons: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 8,
  },
  navigationButton: {
    flex: 1,
    marginRight: 10,
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 17,
    fontWeight: '800',
  },
});
