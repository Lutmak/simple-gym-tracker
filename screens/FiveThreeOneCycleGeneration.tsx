import React, { useEffect, useState } from 'react';
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
import { APP_TEXT_MAX_FONT_SIZE_MULTIPLIER } from '../components/AppTextInput';
import { useTheme } from '../context/ThemeContext';
import { useTranslation } from 'react-i18next';
import { fontSize, radius, spacing, touchTarget } from '../utils/scale';
import {
  generateFiveThreeOneCycle,
  loadFiveThreeOneGenerationSource,
} from '../utils/fiveThreeOneGenerationPersistence';
import type { FiveThreeOneGenerationSource } from '../utils/fiveThreeOneGeneration';

type GenerationNavigationProp = StackNavigationProp<
  WorkoutStackParamList,
  'FiveThreeOneGeneration'
>;
type GenerationRouteProp = RouteProp<WorkoutStackParamList, 'FiveThreeOneGeneration'>;

export default function FiveThreeOneCycleGeneration() {
  const navigation = useNavigation<GenerationNavigationProp>();
  const route = useRoute<GenerationRouteProp>();
  const db = useSQLiteContext();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [source, setSource] = useState<FiveThreeOneGenerationSource | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadProgram = async () => {
      try {
        const loadedSource = await loadFiveThreeOneGenerationSource(db, route.params.programId);
        if (isMounted) {
          setSource(loadedSource);
          setError(null);
        }
      } catch (loadError) {
        console.error('Error loading 5/3/1 generation source:', loadError);
        if (isMounted) {
          setError(
            loadError instanceof Error ? loadError.message : t('failedToLoadProgramForGeneration'),
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadProgram();
    return () => {
      isMounted = false;
    };
  }, [db, route.params.programId, t]);

  const handleGenerate = async () => {
    if (!source) {
      return;
    }

    setIsGenerating(true);
    setMessage(null);
    setError(null);
    try {
      const result = await generateFiveThreeOneCycle(db, source);
      if (result.created) {
        setMessage(
          t('cycleGeneratedMessage', {
            cycle: result.cycleNumber,
            weeks: result.weekCount,
            workouts: result.workoutCount,
          }),
        );
      } else {
        setMessage(t('cycleAlreadyGeneratedMessage', { cycle: result.cycleNumber }));
      }
    } catch (generationError) {
      console.error('Error generating 5/3/1 cycle:', generationError);
      setError(generationError instanceof Error ? generationError.message : t('failedToGenerateCycle'));
    } finally {
      setIsGenerating(false);
    }
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
        <Text style={[styles.title, { color: theme.text }]}>{t('generateCycle')}</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color={theme.buttonBackground} />
      ) : error ? (
        <Text style={[styles.errorText, { color: theme.text }]} accessibilityRole="alert">
          {error}
        </Text>
      ) : source ? (
        <>
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text
              maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              style={[styles.programName, { color: theme.text }]}
            >
              {source.program.name}
            </Text>
            <Text style={[styles.detail, { color: theme.text }]}>
              {source.lifts.length} {t('configuredLifts')} / {source.program.unit}
            </Text>
            <Text style={[styles.detail, { color: theme.text }]}>
              {source.program.includeDeload ? t('deloadIncluded') : t('deloadNotIncluded')}
            </Text>
            <Text style={[styles.detail, { color: theme.text }]}>
              {t('warmupDaysCount', {
                count: source.lifts.filter((lift) => lift.warmupEnabled).length,
                total: source.lifts.length,
              })}
            </Text>
          </View>

          <View style={[styles.infoCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              {t('cycleGenerationTitle')}
            </Text>
            <Text style={[styles.description, { color: theme.text }]}>
              {t('cycleGenerationDescription')}
            </Text>
          </View>

          {message && (
            <Text style={[styles.messageText, { color: theme.text }]} accessibilityRole="alert">
              {message}
            </Text>
          )}

          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: theme.buttonBackground }]}
            onPress={handleGenerate}
            disabled={isGenerating}
            accessibilityRole="button"
            accessibilityLabel={t('generateCycle')}
          >
            {isGenerating ? (
              <ActivityIndicator color={theme.buttonText} />
            ) : (
              <>
                <Ionicons name="flash" size={21} color={theme.buttonText} />
                <Text
                  maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                  style={[styles.primaryButtonText, { color: theme.buttonText }]}
                >
                  {t('generateCycle')}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryButton, { borderColor: theme.border }]}
            onPress={() => navigation.navigate('WorkoutsList')}
            accessibilityRole="button"
            accessibilityLabel={t('viewGeneratedWorkouts')}
          >
            <Text
              maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              style={[styles.secondaryButtonText, { color: theme.text }]}
            >
              {t('viewGeneratedWorkouts')}
            </Text>
          </TouchableOpacity>
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
    paddingHorizontal: spacing.gutter,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.gutter,
    marginBottom: spacing.section,
  },
  backButton: {
    padding: spacing.inline,
    marginRight: spacing.cardGap,
  },
  title: {
    fontSize: fontSize.screenTitle,
    fontWeight: '800',
    flexShrink: 1,
  },
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.card,
    marginBottom: spacing.cardGap,
  },
  programName: {
    fontSize: fontSize.sectionTitle,
    fontWeight: '800',
    marginBottom: spacing.label,
  },
  detail: {
    fontSize: fontSize.body,
    lineHeight: 22,
    marginTop: 3,
    opacity: 0.75,
  },
  infoCard: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.card,
    marginBottom: spacing.section,
  },
  sectionTitle: {
    fontSize: fontSize.cardTitle,
    fontWeight: '800',
    marginBottom: spacing.label,
  },
  description: {
    fontSize: fontSize.helper,
    lineHeight: 23,
    opacity: 0.75,
  },
  errorText: {
    fontSize: fontSize.body,
    lineHeight: 22,
    fontWeight: '600',
  },
  messageText: {
    fontSize: fontSize.body,
    lineHeight: 22,
    fontWeight: '700',
    marginBottom: spacing.card,
  },
  primaryButton: {
    minHeight: touchTarget.row,
    borderRadius: radius.control,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.cardGap,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.cardGap,
  },
  primaryButtonText: {
    fontSize: fontSize.button,
    fontWeight: '800',
    marginLeft: spacing.inline,
  },
  secondaryButton: {
    minHeight: touchTarget.row,
    borderRadius: radius.control,
    borderWidth: 1,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.label,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
});
