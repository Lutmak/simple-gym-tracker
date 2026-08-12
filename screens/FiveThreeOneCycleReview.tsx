import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSQLiteContext } from 'expo-sqlite';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { WorkoutStackParamList } from '../App';
import AppTextInput, {
  APP_TEXT_MAX_FONT_SIZE_MULTIPLIER,
  parseNumericInput,
} from '../components/AppTextInput';
import { useTheme } from '../context/ThemeContext';
import { useTranslation } from 'react-i18next';
import {
  canGenerateFiveThreeOneNextCycle,
  type FiveThreeOneSuggestionDecision,
  type FiveThreeOneSuggestionStatus,
} from '../utils/fiveThreeOneProgression';
import {
  loadFiveThreeOneCycleReview,
  saveFiveThreeOneSuggestionDecision,
  type FiveThreeOneCycleReview,
  type FiveThreeOneReviewLift,
} from '../utils/fiveThreeOneProgressionPersistence';

type ReviewNavigationProp = StackNavigationProp<WorkoutStackParamList, 'FiveThreeOneReview'>;
type ReviewRouteProp = RouteProp<WorkoutStackParamList, 'FiveThreeOneReview'>;

const formatWeight = (value: number): string => Number(value.toFixed(2)).toString();

const suggestionStatusLabel = (
  status: FiveThreeOneSuggestionStatus,
  translate: (key: string) => string,
): string => {
  switch (status) {
    case 'accepted':
      return translate('suggestionAccepted');
    case 'edited':
      return translate('suggestionEdited');
    case 'declined':
      return translate('suggestionDeclined');
    case 'pending':
      return translate('suggestionPending');
  }
};

export default function FiveThreeOneCycleReview() {
  const navigation = useNavigation<ReviewNavigationProp>();
  const route = useRoute<ReviewRouteProp>();
  const db = useSQLiteContext();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [review, setReview] = useState<FiveThreeOneCycleReview | null>(null);
  const [editedTMText, setEditedTMText] = useState<Record<number, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [savingLiftId, setSavingLiftId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadReview = useCallback(async () => {
    setIsLoading(true);
    try {
      const loadedReview = await loadFiveThreeOneCycleReview(
        db,
        route.params.programId,
        route.params.cycleId,
      );
      const nextEditedTMText: Record<number, string> = {};
      for (const lift of loadedReview.lifts) {
        if (lift.suggestion.status === 'pending') {
          nextEditedTMText[lift.liftId] = formatWeight(lift.suggestion.suggestedTM);
        }
      }
      setReview(loadedReview);
      setEditedTMText(nextEditedTMText);
      setError(null);
    } catch (loadError) {
      console.error('Error loading 5/3/1 cycle review:', loadError);
      setError(
        loadError instanceof Error ? loadError.message : t('failedToLoadCycleReview'),
      );
    } finally {
      setIsLoading(false);
    }
  }, [db, route.params.cycleId, route.params.programId, t]);

  useEffect(() => {
    void loadReview();
  }, [loadReview]);

  const handleDecision = async (
    lift: FiveThreeOneReviewLift,
    decision: FiveThreeOneSuggestionDecision,
  ) => {
    if (!review || savingLiftId !== null) {
      return;
    }

    const editedTM =
      decision === 'edit' ? parseNumericInput(editedTMText[lift.liftId] ?? '') : undefined;
    if (decision === 'edit' && (editedTM === null || editedTM === undefined || editedTM <= 0)) {
      setError(t('positiveEditedTrainingMax'));
      return;
    }

    setSavingLiftId(lift.liftId);
    setError(null);
    try {
      await saveFiveThreeOneSuggestionDecision(db, {
        programId: review.programId,
        cycleId: review.cycleId,
        liftId: lift.liftId,
        decision,
        editedTM,
      });
      await loadReview();
    } catch (decisionError) {
      console.error('Error saving 5/3/1 suggestion decision:', decisionError);
      setError(
        decisionError instanceof Error ? decisionError.message : t('failedToSaveCycleReview'),
      );
    } finally {
      setSavingLiftId(null);
    }
  };

  const handleGenerateNextCycle = () => {
    if (!review) {
      return;
    }

    const allSuggestionsResolved = canGenerateFiveThreeOneNextCycle(
      review.lifts.map((lift) => ({
        suggestedTM: lift.suggestion.suggestedTM,
        status: lift.suggestion.status,
      })),
    );
    if (!allSuggestionsResolved) {
      setError(t('resolveSuggestionsBeforeGeneration'));
      return;
    }

    navigation.navigate('FiveThreeOneGeneration', { programId: review.programId });
  };

  const renderAmrapResults = (lift: FiveThreeOneReviewLift) => {
    if (lift.results.length === 0) {
      return null;
    }

    return lift.results.map((result, index) => (
      <View
        key={`${lift.liftId}-${result.weekNumber}-${index}`}
        style={[styles.resultRow, { borderTopColor: theme.border }]}
      >
        <Text
          maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          style={[styles.resultWeek, { color: theme.text }]}
        >
          {t('cycleReviewWeek', { week: result.weekNumber })}
        </Text>
        <Text style={[styles.resultDetail, { color: theme.text }]}>
          {t('cycleReviewActual')}: {formatWeight(result.weight)} {review?.unit} × {result.actualReps}{' '}
          {t('reps')}
        </Text>
        <Text style={[styles.resultDetail, { color: theme.text }]}>
          {t('cycleReviewTarget')}: {result.targetReps ?? t('cycleReviewTargetUnavailable')}
        </Text>
        <Text style={[styles.resultDetail, { color: theme.text }]}>
          {t('cycleReviewEstimated1RM')}: {formatWeight(result.estimated1RM)} {review?.unit}
        </Text>
      </View>
    ));
  };

  const renderSuggestion = (lift: FiveThreeOneReviewLift) => {
    const suggestion = lift.suggestion;
    const isSaving = savingLiftId === lift.liftId;

    return (
      <>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>
          {t('cycleReviewSuggestion')}
        </Text>
        <Text style={[styles.detailText, { color: theme.text }]}>
          {t('currentTrainingMax')}: {formatWeight(suggestion.currentTM)} {suggestion.unit}
        </Text>
        <Text style={[styles.detailText, { color: theme.text }]}>
          {t('suggestedTrainingMax')}: {formatWeight(suggestion.suggestedTM)} {suggestion.unit}
        </Text>

        {suggestion.advisory === 'no-amrap' && (
          <Text style={[styles.advisoryText, { color: theme.text }]}>
            {t('noAmrapResult')}
          </Text>
        )}
        {suggestion.advisory === 'repeated-underperformance' && (
          <Text style={[styles.advisoryText, { color: theme.text }]}>
            {t('repeatedUnderperformance')}
          </Text>
        )}

        {suggestion.status === 'pending' ? (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: theme.buttonBackground }]}
              onPress={() => void handleDecision(lift, 'accept')}
              disabled={isSaving || savingLiftId !== null}
              accessibilityRole="button"
              accessibilityLabel={`${t('acceptSuggestion')}: ${lift.name}`}
            >
              {isSaving ? (
                <ActivityIndicator color={theme.buttonText} />
              ) : (
                <>
                  <Ionicons name="checkmark" size={20} color={theme.buttonText} />
                  <Text
                    maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                    style={[styles.primaryButtonText, { color: theme.buttonText }]}
                  >
                    {t('acceptSuggestion')}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <Text
              maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              style={[styles.inputLabel, { color: theme.text }]}
            >
              {t('editTrainingMax')}
            </Text>
            <View style={styles.editRow}>
              <AppTextInput
                variant="numeric"
                value={editedTMText[lift.liftId] ?? ''}
                onRawChange={(value) =>
                  setEditedTMText((current) => ({ ...current, [lift.liftId]: value }))
                }
                keyboardType="decimal-pad"
                placeholder={t('editTrainingMaxPlaceholder', { unit: suggestion.unit })}
                accessibilityLabel={`${t('editTrainingMax')}: ${lift.name}`}
                style={styles.editInput}
              />
              <TouchableOpacity
                style={[styles.secondaryButton, { borderColor: theme.border }]}
                onPress={() => void handleDecision(lift, 'edit')}
                disabled={isSaving || savingLiftId !== null}
                accessibilityRole="button"
                accessibilityLabel={`${t('saveEditedTrainingMax')}: ${lift.name}`}
              >
                <Text
                  maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                  style={[styles.secondaryButtonText, { color: theme.text }]}
                >
                  {t('saveEditedTrainingMax')}
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.declineButton, { borderColor: theme.border }]}
              onPress={() => void handleDecision(lift, 'decline')}
              disabled={isSaving || savingLiftId !== null}
              accessibilityRole="button"
              accessibilityLabel={`${t('declineSuggestion')}: ${lift.name}`}
            >
              <Text
                maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                style={[styles.secondaryButtonText, { color: theme.text }]}
              >
                {t('declineSuggestion')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={[styles.statusText, { color: theme.text }]}>
            {t('cycleReviewDecision')}: {suggestionStatusLabel(suggestion.status, t)}
          </Text>
        )}
      </>
    );
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={t('back')}
        >
          <Ionicons name="arrow-back" size={28} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }]}>{t('cycleReview')}</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color={theme.buttonBackground} />
      ) : error ? (
        <Text style={[styles.errorText, { color: theme.text }]} accessibilityRole="alert">
          {error}
        </Text>
      ) : review ? (
        <>
          <View style={[styles.summaryCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text
              maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              style={[styles.programName, { color: theme.text }]}
            >
              {review.programName}
            </Text>
            <Text style={[styles.detailText, { color: theme.text }]}>
              {t('cycleReviewNumber', { cycle: review.cycleNumber })} / {review.unit}
            </Text>
            <Text style={[styles.detailText, { color: theme.text }]}>
              {review.includeDeload ? t('deloadIncluded') : t('deloadNotIncluded')}
            </Text>
          </View>

          <Text style={[styles.description, { color: theme.text }]}>
            {t('cycleReviewDescription')}
          </Text>

          {review.lifts.map((lift) => (
            <View
              key={lift.liftId}
              style={[styles.liftCard, { backgroundColor: theme.card, borderColor: theme.border }]}
            >
              <Text
                maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                style={[styles.liftName, { color: theme.text }]}
              >
                {lift.name}
              </Text>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>
                {t('cycleReviewAmrapResults')}
              </Text>
              {renderAmrapResults(lift)}
              {renderSuggestion(lift)}
            </View>
          ))}

          {canGenerateFiveThreeOneNextCycle(
            review.lifts.map((lift) => ({
              suggestedTM: lift.suggestion.suggestedTM,
              status: lift.suggestion.status,
            })),
          ) ? (
            <TouchableOpacity
              style={[styles.generateButton, { backgroundColor: theme.buttonBackground }]}
              onPress={handleGenerateNextCycle}
              accessibilityRole="button"
              accessibilityLabel={t('generateNextCycle')}
            >
              <Ionicons name="flash" size={21} color={theme.buttonText} />
              <Text
                maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                style={[styles.primaryButtonText, { color: theme.buttonText }]}
              >
                {t('generateNextCycle')}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={[styles.pendingText, { color: theme.text }]}>
              {t('resolveSuggestionsBeforeGeneration')}
            </Text>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 50,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 28,
  },
  backButton: {
    minWidth: 44,
    minHeight: 44,
    padding: 8,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    flexShrink: 1,
  },
  summaryCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 18,
    marginBottom: 16,
  },
  programName: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
  },
  description: {
    fontSize: 15,
    lineHeight: 23,
    opacity: 0.75,
    marginBottom: 18,
  },
  liftCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 18,
    marginBottom: 16,
  },
  liftName: {
    fontSize: 23,
    fontWeight: '800',
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
    marginTop: 4,
  },
  detailText: {
    fontSize: 15,
    lineHeight: 22,
    opacity: 0.78,
  },
  resultRow: {
    borderTopWidth: 1,
    paddingVertical: 10,
  },
  resultWeek: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 3,
  },
  resultDetail: {
    fontSize: 14,
    lineHeight: 21,
    opacity: 0.78,
  },
  advisoryText: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
    marginTop: 10,
  },
  actions: {
    marginTop: 16,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '800',
    marginLeft: 8,
  },
  inputLabel: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  editInput: {
    flex: 1,
    marginRight: 8,
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  declineButton: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    marginTop: 14,
  },
  errorText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  pendingText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    marginTop: 2,
  },
  generateButton: {
    minHeight: 50,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
});
