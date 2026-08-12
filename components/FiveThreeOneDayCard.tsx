import React from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import AppTextInput, { APP_TEXT_MAX_FONT_SIZE_MULTIPLIER } from './AppTextInput';
import { useTheme } from '../context/ThemeContext';
import type { LiftCategory, WarmupSet, WeightUnit } from '../utils/fiveThreeOne';
import { moveAssistanceExercise, type Weekday } from '../utils/fiveThreeOneSetup';

export type TrainingMaxMode = 'direct' | 'estimate';

export interface AccessoryDraft {
  id: string;
  name: string;
  setsText: string;
  repsText: string;
}

export interface TrainingDayState {
  weekday: Weekday;
  liftName: string;
  category: LiftCategory;
  tmMode: TrainingMaxMode;
  trainingMaxText: string;
  recentWeightText: string;
  recentRepsText: string;
  warmupEnabled: boolean;
  assistanceTemplateId: number | null;
  accessories: AccessoryDraft[];
}

export interface AssistanceTemplateOption {
  template_id: number;
  template_name: string;
  description: string | null;
}

interface FiveThreeOneDayCardProps {
  day: TrainingDayState;
  dayLabel: string;
  unit: WeightUnit;
  /** Resolved from whichever training-max mode the day is in; null while it is incomplete. */
  trainingMax: number | null;
  /** Empty when warm-ups are off or the training max is not usable yet. */
  warmupPreview: readonly WarmupSet[];
  templates: readonly AssistanceTemplateOption[];
  expanded: boolean;
  isLastDay: boolean;
  onToggleExpanded: () => void;
  onChange: (update: Partial<TrainingDayState>) => void;
  onSeedFromTemplate: (templateId: number) => void;
  onRemove: () => void;
  onDone: () => void;
}

const formatWeight = (weight: number): string => Number(weight.toFixed(2)).toString();

// Accessory rows are identified only for React's benefit: names repeat and positions shift, so
// neither is a usable key. One counter keeps template seeds and hand-added rows from colliding.
let nextAccessoryId = 1;

export function createAccessoryDraft(
  name: string,
  sets: number,
  reps: number,
): AccessoryDraft {
  const draft: AccessoryDraft = {
    id: `accessory-${nextAccessoryId}`,
    name,
    setsText: String(sets),
    repsText: String(reps),
  };
  nextAccessoryId += 1;
  return draft;
}

export default function FiveThreeOneDayCard({
  day,
  dayLabel,
  unit,
  trainingMax,
  warmupPreview,
  templates,
  expanded,
  isLastDay,
  onToggleExpanded,
  onChange,
  onSeedFromTemplate,
  onRemove,
  onDone,
}: FiveThreeOneDayCardProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();

  const liftName = day.liftName.trim() || t('unnamedLift');
  const isReady = day.liftName.trim().length > 0 && trainingMax !== null;

  const updateAccessory = (id: string, update: Partial<AccessoryDraft>) => {
    onChange({
      accessories: day.accessories.map((accessory) =>
        accessory.id === id ? { ...accessory, ...update } : accessory,
      ),
    });
  };

  const renderChoice = (label: string, selected: boolean, onPress: () => void) => (
    <TouchableOpacity
      key={label}
      style={[
        styles.choice,
        {
          backgroundColor: selected ? theme.buttonBackground : theme.background,
          borderColor: theme.border,
        },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <Text
        maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        style={{ color: selected ? theme.buttonText : theme.text }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  const renderSummary = () => (
    <View style={styles.summary}>
      <Text
        maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        style={[styles.summaryLine, { color: theme.text }]}
      >
        {liftName}
        {trainingMax === null ? '' : ` · ${formatWeight(trainingMax)} ${unit}`}
      </Text>
      <Text style={[styles.summaryDetail, { color: theme.text }]}>
        {t('accessoriesCount', { count: day.accessories.length })}
        {' · '}
        {isReady ? t('dayReady') : t('dayNeedsTrainingMax')}
      </Text>
    </View>
  );

  const renderTrainingMax = () => (
    <View>
      <Text
        maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        style={[styles.label, { color: theme.text }]}
      >
        {t('trainingMax')}
      </Text>
      <View style={styles.choiceRow}>
        {renderChoice(t('enterDirectly'), day.tmMode === 'direct', () =>
          onChange({ tmMode: 'direct' }),
        )}
        {renderChoice(t('estimateFromRecentSet'), day.tmMode === 'estimate', () =>
          onChange({ tmMode: 'estimate' }),
        )}
      </View>

      {day.tmMode === 'direct' ? (
        <AppTextInput
          variant="numeric"
          placeholder={t('trainingMaxPlaceholder', { unit })}
          value={day.trainingMaxText}
          onRawChange={(value) => onChange({ trainingMaxText: value })}
          keyboardType="decimal-pad"
        />
      ) : (
        <View>
          <View style={styles.inputRow}>
            <AppTextInput
              variant="numeric"
              style={[styles.halfInput, styles.inputSpacing]}
              placeholder={t('recentWeight')}
              value={day.recentWeightText}
              onRawChange={(value) => onChange({ recentWeightText: value })}
              keyboardType="decimal-pad"
            />
            <AppTextInput
              variant="numeric"
              style={styles.halfInput}
              placeholder={t('recentReps')}
              value={day.recentRepsText}
              onRawChange={(value) => onChange({ recentRepsText: value })}
              keyboardType="number-pad"
            />
          </View>
          <Text style={[styles.helperText, { color: theme.text }]}>
            {trainingMax === null
              ? t('enterRecentSet')
              : `${t('estimatedTrainingMax')}: ${formatWeight(trainingMax)} ${unit}`}
          </Text>
        </View>
      )}
    </View>
  );

  const renderWarmup = () => (
    <View>
      <View style={[styles.toggleRow, { backgroundColor: theme.background, borderColor: theme.border }]}>
        <Text
          maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          style={[styles.toggleText, { color: theme.text }]}
        >
          {t('warmupForThisDay')}
        </Text>
        <Switch
          value={day.warmupEnabled}
          onValueChange={(value) => onChange({ warmupEnabled: value })}
          trackColor={{ false: '#767577', true: '#FFFFFF' }}
          thumbColor={day.warmupEnabled ? '#ffffff' : '#f4f3f4'}
        />
      </View>

      {!day.warmupEnabled ? (
        <Text style={[styles.helperText, { color: theme.text }]}>{t('warmupDisabledForDay')}</Text>
      ) : warmupPreview.length === 0 ? (
        <Text style={[styles.helperText, { color: theme.text }]}>
          {t('warmupNeedsTrainingMax')}
        </Text>
      ) : (
        <View>
          {warmupPreview.map((warmup) => (
            <Text
              key={warmup.percent}
              maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              style={[styles.rampLine, { color: theme.text }]}
            >
              {`${warmup.percent}% · ${formatWeight(warmup.weight)} ${warmup.unit} × ${warmup.reps}`}
            </Text>
          ))}
          <Text style={[styles.helperText, { color: theme.text }]}>
            {t('warmupForThisDayDescription')}
          </Text>
        </View>
      )}
    </View>
  );

  const renderTemplates = () => (
    <View>
      <Text style={[styles.helperText, { color: theme.text }]}>
        {t('assistanceTemplatesDescription')}
      </Text>
      <View style={styles.choiceRow}>
        {templates.map((template) =>
          renderChoice(
            template.template_name,
            day.assistanceTemplateId === template.template_id,
            () => onSeedFromTemplate(template.template_id),
          ),
        )}
      </View>
    </View>
  );

  const renderAccessory = (accessory: AccessoryDraft, index: number) => (
    <View
      key={accessory.id}
      style={[styles.accessory, { backgroundColor: theme.background, borderColor: theme.border }]}
    >
      <AppTextInput
        variant="text"
        placeholder={t('accessoryNamePlaceholder')}
        value={accessory.name}
        onChangeText={(value) => updateAccessory(accessory.id, { name: value })}
        autoCapitalize="words"
      />
      <View style={styles.accessoryControls}>
        <AppTextInput
          variant="numeric"
          style={[styles.countInput, styles.inputSpacing]}
          placeholder={t('Sets')}
          value={accessory.setsText}
          onRawChange={(value) => updateAccessory(accessory.id, { setsText: value })}
          keyboardType="number-pad"
        />
        <AppTextInput
          variant="numeric"
          style={[styles.countInput, styles.inputSpacing]}
          placeholder={t('Reps')}
          value={accessory.repsText}
          onRawChange={(value) => updateAccessory(accessory.id, { repsText: value })}
          keyboardType="number-pad"
        />
        <View style={styles.accessoryActions}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() =>
              onChange({ accessories: moveAssistanceExercise(day.accessories, index, -1) })
            }
            disabled={index === 0}
            accessibilityRole="button"
            accessibilityLabel={t('moveAccessoryUp', {
              name: accessory.name || t('unnamedAccessory'),
            })}
          >
            <Ionicons name="chevron-up" size={21} color={index === 0 ? theme.border : theme.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() =>
              onChange({ accessories: moveAssistanceExercise(day.accessories, index, 1) })
            }
            disabled={index === day.accessories.length - 1}
            accessibilityRole="button"
            accessibilityLabel={t('moveAccessoryDown', {
              name: accessory.name || t('unnamedAccessory'),
            })}
          >
            <Ionicons
              name="chevron-down"
              size={21}
              color={index === day.accessories.length - 1 ? theme.border : theme.text}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() =>
              onChange({
                accessories: day.accessories.filter((entry) => entry.id !== accessory.id),
              })
            }
            accessibilityRole="button"
            accessibilityLabel={t('removeAccessory', {
              name: accessory.name || t('unnamedAccessory'),
            })}
          >
            <Ionicons name="trash-outline" size={20} color={theme.text} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  const addAccessory = () => {
    onChange({ accessories: [...day.accessories, createAccessoryDraft('', 3, 10)] });
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <TouchableOpacity
        style={styles.header}
        onPress={onToggleExpanded}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={
          expanded ? t('closeTrainingDay', { day: dayLabel }) : t('openTrainingDay', { day: dayLabel })
        }
      >
        <View style={styles.headerText}>
          <Text
            maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
            style={[styles.dayName, { color: theme.text }]}
          >
            {dayLabel}
          </Text>
          {!expanded && renderSummary()}
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={24}
          color={theme.text}
        />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.body}>
          <Text style={[styles.sectionLabel, { color: theme.text }]}>{t('mainLiftSection')}</Text>
          <AppTextInput
            variant="text"
            placeholder={t('liftNamePlaceholder')}
            value={day.liftName}
            onChangeText={(value) => onChange({ liftName: value })}
            autoCapitalize="words"
          />
          <View style={[styles.choiceRow, styles.categoryRow]}>
            {renderChoice(t('upper'), day.category === 'upper', () =>
              onChange({ category: 'upper' }),
            )}
            {renderChoice(t('lower'), day.category === 'lower', () =>
              onChange({ category: 'lower' }),
            )}
          </View>

          {renderTrainingMax()}
          {renderWarmup()}

          <Text style={[styles.sectionLabel, { color: theme.text }]}>
            {t('accessoriesSection')}
          </Text>
          {renderTemplates()}
          {day.accessories.length === 0 ? (
            <Text style={[styles.helperText, { color: theme.text }]}>{t('noAccessories')}</Text>
          ) : (
            day.accessories.map(renderAccessory)
          )}
          <TouchableOpacity
            style={[styles.secondaryButton, { borderColor: theme.border }]}
            onPress={addAccessory}
            accessibilityRole="button"
            accessibilityLabel={t('addAccessory')}
          >
            <Ionicons name="add" size={21} color={theme.text} />
            <Text
              maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              style={[styles.secondaryButtonText, { color: theme.text }]}
            >
              {t('addAccessory')}
            </Text>
          </TouchableOpacity>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.secondaryButton, styles.footerButton, { borderColor: theme.border }]}
              onPress={onRemove}
              accessibilityRole="button"
              accessibilityLabel={t('removeTrainingDay', { day: dayLabel })}
            >
              <Ionicons name="trash-outline" size={19} color={theme.text} />
              <Text
                maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                style={[styles.secondaryButtonText, { color: theme.text }]}
              >
                {t('Delete')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.primaryButton,
                styles.footerButton,
                { backgroundColor: theme.buttonBackground },
              ]}
              onPress={onDone}
              accessibilityRole="button"
              accessibilityLabel={isLastDay ? t('dayDone') : t('dayDoneNext')}
            >
              <Text
                maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                style={[styles.primaryButtonText, { color: theme.buttonText }]}
              >
                {isLastDay ? t('dayDone') : t('dayDoneNext')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 14,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerText: {
    flex: 1,
    marginRight: 10,
  },
  dayName: {
    fontSize: 19,
    fontWeight: '800',
  },
  summary: {
    marginTop: 4,
  },
  summaryLine: {
    fontSize: 15,
    fontWeight: '600',
  },
  summaryDetail: {
    fontSize: 13,
    opacity: 0.7,
    marginTop: 2,
  },
  body: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  sectionLabel: {
    fontSize: 17,
    fontWeight: '800',
    marginTop: 16,
    marginBottom: 10,
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 14,
    marginBottom: 8,
  },
  categoryRow: {
    marginTop: 10,
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
  helperText: {
    fontSize: 13,
    lineHeight: 19,
    opacity: 0.7,
    marginTop: 8,
    marginBottom: 6,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 14,
    marginTop: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  toggleText: {
    flex: 1,
    marginRight: 12,
    fontSize: 15,
    fontWeight: '600',
  },
  rampLine: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6,
  },
  accessory: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 10,
  },
  accessoryControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  countInput: {
    flex: 1,
  },
  accessoryActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    minWidth: 38,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
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
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 6,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 16,
  },
  footerButton: {
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
    fontSize: 16,
    fontWeight: '800',
  },
});
