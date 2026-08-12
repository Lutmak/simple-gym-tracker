import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
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
import { useTheme } from '../context/ThemeContext';
import { useTranslation } from 'react-i18next';
import { WorkoutStackParamList } from '../App';
import {
  estimate1RM,
  type LiftCategory,
  type RoundingDirection,
  type WeightUnit,
} from '../utils/fiveThreeOne';
import {
  DEFAULT_SETUP_LIFTS,
  normalizeDaySlots,
  validateSetup,
  type SetupValidationInput,
  type SetupValidationIssue,
} from '../utils/fiveThreeOneSetup';

type FiveThreeOneSetupNavigationProp = StackNavigationProp<
  WorkoutStackParamList,
  'FiveThreeOneSetup'
>;

type TrainingMaxMode = 'direct' | 'estimate';

interface SetupLiftState {
  id: string;
  name: string;
  category: LiftCategory;
  tmMode: TrainingMaxMode;
  trainingMaxText: string;
  recentWeightText: string;
  recentRepsText: string;
  daySlot: number | null;
  assistanceTemplateId: number | null;
}

interface AssistanceTemplate {
  template_id: number;
  template_name: string;
  description: string | null;
}

interface PersistedLift {
  name: string;
  category: LiftCategory;
  trainingMax: number;
  daySlot: number;
  assistanceTemplateId: number;
}

interface PersistedProgram {
  name: string;
  unit: WeightUnit;
  roundingIncrement: number;
  roundingDirection: RoundingDirection;
  tmPercentage: number;
}

const TOTAL_STEPS = 4;

const createInitialLifts = (): SetupLiftState[] =>
  DEFAULT_SETUP_LIFTS.map((lift) => ({
    ...lift,
    tmMode: 'direct',
    trainingMaxText: '',
    recentWeightText: '',
    recentRepsText: '',
    assistanceTemplateId: null,
  }));

const formatWeight = (weight: number): string => Number(weight.toFixed(2)).toString();

async function saveFiveThreeOneProgram(
  db: SQLiteDatabase,
  program: PersistedProgram,
  lifts: readonly PersistedLift[],
): Promise<void> {
  await db.withTransactionAsync(async () => {
    const programResult = await db.runAsync(
      `INSERT INTO FiveThreeOne_Programs
       (program_name, unit, rounding_increment, rounding_direction, tm_percentage,
        include_deload, upper_tm_increment, lower_tm_increment, warmup_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        program.name,
        program.unit,
        program.roundingIncrement,
        program.roundingDirection,
        program.tmPercentage,
        1,
        program.unit === 'kg' ? 2.5 : 5,
        program.unit === 'kg' ? 5 : 10,
        1,
      ],
    );

    if (programResult.lastInsertRowId <= 0) {
      throw new Error('Failed to create the 5/3/1 program.');
    }

    for (const lift of lifts) {
      await db.runAsync(
        `INSERT INTO FiveThreeOne_Lifts
         (program_id, lift_name, lift_type, training_max, day_slot, assistance_template_id,
          suggested_training_max, suggestion_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          programResult.lastInsertRowId,
          lift.name,
          lift.category,
          lift.trainingMax,
          lift.daySlot,
          lift.assistanceTemplateId,
          null,
          null,
        ],
      );
    }
  });
}

const validationMessages: Record<SetupValidationIssue, string> = {
  'program-name-required': 'programNameRequired',
  'unit-invalid': 'programUnitInvalid',
  'rounding-increment-positive': 'roundingIncrementRequired',
  'rounding-direction-invalid': 'roundingDirectionInvalid',
  'tm-percentage-invalid': 'tmPercentageInvalid',
  'lift-required': 'liftRequired',
  'lift-name-required': 'liftNameRequired',
  'duplicate-lift-name': 'duplicateLiftName',
  'lift-category-invalid': 'liftCategoryInvalid',
  'training-max-positive': 'trainingMaxRequired',
  'day-slot-positive-integer': 'daySlotRequired',
  'duplicate-day-slot': 'duplicateDaySlot',
  'assistance-template-required': 'assistanceTemplateRequired',
};

const getIssueStep = (issue: SetupValidationIssue): number => {
  switch (issue) {
    case 'program-name-required':
    case 'unit-invalid':
    case 'rounding-increment-positive':
    case 'rounding-direction-invalid':
    case 'tm-percentage-invalid':
      return 0;
    case 'assistance-template-required':
      return 2;
    default:
      return 1;
  }
};

export default function FiveThreeOneSetup() {
  const navigation = useNavigation<FiveThreeOneSetupNavigationProp>();
  const db = useSQLiteContext();
  const { theme } = useTheme();
  const { t } = useTranslation();

  const [step, setStep] = useState(0);
  const [programName, setProgramName] = useState('');
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [roundingIncrementText, setRoundingIncrementText] = useState('2.5');
  const [roundingDirection, setRoundingDirection] = useState<RoundingDirection>('nearest');
  const [tmPercentage, setTmPercentage] = useState(0.9);
  const [lifts, setLifts] = useState<SetupLiftState[]>(createInitialLifts);
  const [templates, setTemplates] = useState<AssistanceTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextLiftId = useRef(1);

  useEffect(() => {
    let isMounted = true;

    const loadTemplates = async () => {
      try {
        const result = await db.getAllAsync<AssistanceTemplate>(
          `SELECT template_id, template_name, description
           FROM FiveThreeOne_AssistanceTemplates
           WHERE is_builtin = 1
           ORDER BY template_name;`,
        );

        if (!isMounted) {
          return;
        }

        setTemplates(result);
        if (result[0]) {
          setLifts((currentLifts) =>
            currentLifts.map((lift) => ({
              ...lift,
              assistanceTemplateId: lift.assistanceTemplateId ?? result[0].template_id,
            })),
          );
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

  const getTrainingMax = (lift: SetupLiftState): number | null => {
    if (lift.tmMode === 'direct') {
      return parseNumericInput(lift.trainingMaxText);
    }

    const recentWeight = parseNumericInput(lift.recentWeightText);
    const recentReps = parseNumericInput(lift.recentRepsText);
    if (
      recentWeight === null ||
      recentReps === null ||
      !Number.isInteger(recentReps) ||
      recentReps <= 0
    ) {
      return null;
    }

    try {
      return estimate1RM(recentWeight, recentReps) * tmPercentage;
    } catch {
      return null;
    }
  };

  const getValidationInput = (): SetupValidationInput => ({
    programName,
    unit,
    roundingIncrement: parseNumericInput(roundingIncrementText),
    roundingDirection,
    tmPercentage,
    lifts: lifts.map((lift) => ({
      name: lift.name,
      category: lift.category,
      trainingMax: getTrainingMax(lift),
      daySlot: lift.daySlot,
      assistanceTemplateId: lift.assistanceTemplateId,
    })),
  });

  const showValidationError = (issue: SetupValidationIssue) => {
    setError(t(validationMessages[issue]));
  };

  const validateCurrentStep = (): SetupValidationIssue | null => {
    const input = getValidationInput();

    if (step === 0) {
      return validateSetup({
        ...input,
        lifts: [
          {
            name: 'Lift',
            category: 'upper',
            trainingMax: 1,
            daySlot: 1,
            assistanceTemplateId: 1,
          },
        ],
      });
    }

    if (step === 1) {
      return validateSetup({
        ...input,
        lifts: input.lifts.map((lift) => ({
          ...lift,
          assistanceTemplateId: lift.assistanceTemplateId ?? 1,
        })),
      });
    }

    return validateSetup(input);
  };

  const updateLift = (id: string, update: Partial<SetupLiftState>) => {
    setLifts((currentLifts) =>
      currentLifts.map((lift) => (lift.id === id ? { ...lift, ...update } : lift)),
    );
    setError(null);
  };

  const addLift = () => {
    const id = `custom-${nextLiftId.current}`;
    nextLiftId.current += 1;
    setLifts((currentLifts) =>
      normalizeDaySlots([
        ...currentLifts,
        {
          id,
          name: '',
          category: 'upper',
          tmMode: 'direct',
          trainingMaxText: '',
          recentWeightText: '',
          recentRepsText: '',
          daySlot: null,
          assistanceTemplateId: templates[0]?.template_id ?? null,
        },
      ]),
    );
    setError(null);
  };

  const removeLift = (id: string) => {
    setLifts((currentLifts) =>
      normalizeDaySlots(currentLifts.filter((lift) => lift.id !== id)),
    );
    setError(null);
  };

  const moveLift = (index: number, direction: -1 | 1) => {
    setLifts((currentLifts) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= currentLifts.length) {
        return currentLifts;
      }

      const reordered = [...currentLifts];
      [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
      return normalizeDaySlots(reordered);
    });
    setError(null);
  };

  const handleUnitChange = (nextUnit: WeightUnit) => {
    setUnit(nextUnit);
    if (
      (unit === 'kg' && roundingIncrementText === '2.5') ||
      (unit === 'lb' && roundingIncrementText === '5')
    ) {
      setRoundingIncrementText(nextUnit === 'kg' ? '2.5' : '5');
    }
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
    const issue = validateSetup(input);
    if (issue) {
      setStep(getIssueStep(issue));
      showValidationError(issue);
      return;
    }

    const program: PersistedProgram = {
      name: input.programName.trim(),
      unit: input.unit as WeightUnit,
      roundingIncrement: input.roundingIncrement as number,
      roundingDirection: input.roundingDirection as RoundingDirection,
      tmPercentage: input.tmPercentage,
    };
    const persistedLifts: PersistedLift[] = input.lifts.map((lift) => ({
      name: lift.name.trim(),
      category: lift.category as LiftCategory,
      trainingMax: lift.trainingMax as number,
      daySlot: lift.daySlot as number,
      assistanceTemplateId: lift.assistanceTemplateId as number,
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

      await saveFiveThreeOneProgram(db, program, persistedLifts);
      Alert.alert(t('programCreated'), t('programCreatedMessage'));
      navigation.navigate('Programs');
    } catch (saveError) {
      console.error('Error saving 5/3/1 program:', saveError);
      setError(t('failedToCreateProgram'));
    } finally {
      setIsSaving(false);
    }
  };

  const templateName = (templateId: number | null): string =>
    templates.find((template) => template.template_id === templateId)?.template_name ??
    t('noAssistanceTemplate');

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
        onChangeText={(value) => {
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
        onRawChange={(value) => {
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
          () => setRoundingDirection('up'),
          t('roundUp'),
        )}
        {renderChoice(
          t('roundDown'),
          roundingDirection === 'down',
          () => setRoundingDirection('down'),
          t('roundDown'),
        )}
        {renderChoice(
          t('roundNearest'),
          roundingDirection === 'nearest',
          () => setRoundingDirection('nearest'),
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
      <View style={styles.choiceRow}>
        {renderChoice('85%', tmPercentage === 0.85, () => setTmPercentage(0.85), '85%')}
        {renderChoice('90%', tmPercentage === 0.9, () => setTmPercentage(0.9), '90%')}
      </View>

      <Text style={[styles.helperText, { color: theme.text }]}>
        {t('programSetupNoProgression')}
      </Text>
    </View>
  );

  const renderLift = (lift: SetupLiftState, index: number) => {
    const estimatedTrainingMax = getTrainingMax({ ...lift, tmMode: 'estimate' });

    return (
      <View
        key={lift.id}
        style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
      >
        <View style={styles.cardHeader}>
          <Text
            maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
            style={[styles.cardTitle, { color: theme.text }]}
          >
            {t('liftNumber', { number: index + 1 })}
          </Text>
          <View style={styles.cardActions}>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => moveLift(index, -1)}
              disabled={index === 0}
              accessibilityRole="button"
              accessibilityLabel={t('moveLiftUp', { name: lift.name || t('unnamedLift') })}
            >
              <Ionicons
                name="chevron-up"
                size={22}
                color={index === 0 ? theme.border : theme.text}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => moveLift(index, 1)}
              disabled={index === lifts.length - 1}
              accessibilityRole="button"
              accessibilityLabel={t('moveLiftDown', { name: lift.name || t('unnamedLift') })}
            >
              <Ionicons
                name="chevron-down"
                size={22}
                color={index === lifts.length - 1 ? theme.border : theme.text}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => removeLift(lift.id)}
              accessibilityRole="button"
              accessibilityLabel={t('removeLift', { name: lift.name || t('unnamedLift') })}
            >
              <Ionicons name="trash-outline" size={21} color={theme.text} />
            </TouchableOpacity>
          </View>
        </View>

        <Text
          maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          style={[styles.label, { color: theme.text }]}
        >
          {t('liftName')}
        </Text>
        <AppTextInput
          variant="text"
          style={styles.fullInput}
          placeholder={t('liftNamePlaceholder')}
          value={lift.name}
          onChangeText={(value) => updateLift(lift.id, { name: value })}
          autoCapitalize="words"
        />

        <Text
          maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          style={[styles.label, { color: theme.text }]}
        >
          {t('liftCategory')}
        </Text>
        <View style={styles.choiceRow}>
          {renderChoice(
            t('upper'),
            lift.category === 'upper',
            () => updateLift(lift.id, { category: 'upper' }),
            t('upper'),
          )}
          {renderChoice(
            t('lower'),
            lift.category === 'lower',
            () => updateLift(lift.id, { category: 'lower' }),
            t('lower'),
          )}
        </View>

        <Text
          maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          style={[styles.label, { color: theme.text }]}
        >
          {t('trainingMax')}
        </Text>
        <View style={styles.choiceRow}>
          {renderChoice(
            t('enterDirectly'),
            lift.tmMode === 'direct',
            () => updateLift(lift.id, { tmMode: 'direct' }),
            t('enterDirectly'),
          )}
          {renderChoice(
            t('estimateFromRecentSet'),
            lift.tmMode === 'estimate',
            () => updateLift(lift.id, { tmMode: 'estimate' }),
            t('estimateFromRecentSet'),
          )}
        </View>

        {lift.tmMode === 'direct' ? (
          <AppTextInput
            variant="numeric"
            style={styles.fullInput}
            placeholder={t('trainingMaxPlaceholder', { unit })}
            value={lift.trainingMaxText}
            onRawChange={(value) => updateLift(lift.id, { trainingMaxText: value })}
            keyboardType="decimal-pad"
          />
        ) : (
          <View>
            <View style={styles.inputRow}>
              <AppTextInput
                variant="numeric"
                style={[styles.halfInput, styles.inputSpacing]}
                placeholder={t('recentWeight')}
                value={lift.recentWeightText}
                onRawChange={(value) => updateLift(lift.id, { recentWeightText: value })}
                keyboardType="decimal-pad"
              />
              <AppTextInput
                variant="numeric"
                style={styles.halfInput}
                placeholder={t('recentReps')}
                value={lift.recentRepsText}
                onRawChange={(value) => updateLift(lift.id, { recentRepsText: value })}
                keyboardType="number-pad"
              />
            </View>
            <Text style={[styles.helperText, { color: theme.text }]}>
              {estimatedTrainingMax === null
                ? t('enterRecentSet')
                : `${t('estimatedTrainingMax')}: ${formatWeight(estimatedTrainingMax)} ${unit}`}
            </Text>
          </View>
        )}

        <Text
          maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          style={[styles.label, { color: theme.text }]}
        >
          {t('daySlot')}
        </Text>
        <AppTextInput
          variant="numeric"
          style={styles.slotInput}
          placeholder={t('daySlotPlaceholder')}
          value={lift.daySlot === null ? '' : String(lift.daySlot)}
          onRawChange={(value) => updateLift(lift.id, { daySlot: parseNumericInput(value) })}
          keyboardType="number-pad"
        />
      </View>
    );
  };

  const renderLifts = () => (
    <View>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('trainingMaxes')}</Text>
      <Text style={[styles.helperText, { color: theme.text }]}>{t('trainingMaxesDescription')}</Text>
      {lifts.map(renderLift)}
      <TouchableOpacity
        style={[styles.secondaryButton, { borderColor: theme.border }]}
        onPress={addLift}
        accessibilityRole="button"
        accessibilityLabel={t('addLift')}
      >
        <Ionicons name="add" size={22} color={theme.text} />
        <Text
          maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          style={[styles.secondaryButtonText, { color: theme.text }]}
        >
          {t('addLift')}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderAssistance = () => (
    <View>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('assistanceTemplates')}</Text>
      <Text style={[styles.helperText, { color: theme.text }]}>
        {t('assistanceTemplatesDescription')}
      </Text>
      {isLoadingTemplates ? (
        <ActivityIndicator size="large" color={theme.buttonBackground} />
      ) : templates.length === 0 ? (
        <Text style={[styles.helperText, { color: theme.text }]}>
          {t('noAssistanceTemplates')}
        </Text>
      ) : (
        lifts.map((lift) => (
          <View
            key={lift.id}
            style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
          >
            <Text style={[styles.cardTitle, { color: theme.text }]}>
              {lift.name || t('unnamedLift')} - {t('daySlot')} {lift.daySlot ?? '?'}
            </Text>
            {templates.map((template) => {
              const selected = lift.assistanceTemplateId === template.template_id;
              return (
                <TouchableOpacity
                  key={template.template_id}
                  style={[
                    styles.templateChoice,
                    {
                      backgroundColor: selected ? theme.buttonBackground : theme.card,
                      borderColor: theme.border,
                    },
                  ]}
                  onPress={() =>
                    updateLift(lift.id, { assistanceTemplateId: template.template_id })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={template.template_name}
                >
                  <View style={styles.templateInfo}>
                    <Text
                      maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                      style={{ color: selected ? theme.buttonText : theme.text, fontWeight: '700' }}
                    >
                      {template.template_name}
                    </Text>
                    {template.description && (
                      <Text
                        style={{
                          color: selected ? theme.buttonText : theme.text,
                          opacity: selected ? 0.8 : 0.65,
                          marginTop: 3,
                        }}
                      >
                        {template.description}
                      </Text>
                    )}
                  </View>
                  {selected && (
                    <Ionicons name="checkmark-circle" size={22} color={theme.buttonText} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
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
          {t('tmPercentage')}: {tmPercentage * 100}%
        </Text>
      </View>

      {lifts.map((lift) => (
        <View
          key={lift.id}
          style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
        >
          <Text style={[styles.cardTitle, { color: theme.text }]}>
            {lift.name || t('unnamedLift')}
          </Text>
          <Text style={[styles.reviewLine, { color: theme.text }]}>
            {t('daySlot')}: {lift.daySlot ?? '?'} / {t(lift.category)}
          </Text>
          <Text style={[styles.reviewLine, { color: theme.text }]}>
            {t('trainingMax')}: {getTrainingMax(lift) === null ? '?' : formatWeight(getTrainingMax(lift) as number)}{' '}
            {unit}
          </Text>
          <Text style={[styles.reviewLine, { color: theme.text }]}>
            {t('assistanceTemplate')}: {templateName(lift.assistanceTemplateId)}
          </Text>
        </View>
      ))}
    </View>
  );

  const stepNames = [
    t('programBasics'),
    t('trainingMaxes'),
    t('assistanceTemplates'),
    t('review'),
  ];

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
        {step === 1 && renderLifts()}
        {step === 2 && renderAssistance()}
        {step === 3 && renderReview()}

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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    flexShrink: 1,
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  halfInput: {
    flex: 1,
  },
  inputSpacing: {
    marginRight: 10,
  },
  slotInput: {
    maxWidth: 120,
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
  templateChoice: {
    minHeight: 58,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  templateInfo: {
    flex: 1,
    marginRight: 8,
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
