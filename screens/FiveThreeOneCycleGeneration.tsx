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
    padding: 8,
    marginRight: 12,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    flexShrink: 1,
  },
  card: {
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
  detail: {
    fontSize: 15,
    lineHeight: 22,
    marginTop: 3,
    opacity: 0.75,
  },
  infoCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 18,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
  },
  description: {
    fontSize: 15,
    lineHeight: 23,
    opacity: 0.75,
  },
  errorText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    marginBottom: 16,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    fontSize: 17,
    fontWeight: '800',
    marginLeft: 8,
  },
  secondaryButton: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
