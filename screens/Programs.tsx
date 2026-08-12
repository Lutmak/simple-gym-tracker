import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useSQLiteContext } from 'expo-sqlite';

import { WorkoutStackParamList } from '../App';
import { APP_TEXT_MAX_FONT_SIZE_MULTIPLIER } from '../components/AppTextInput';
import { useTheme } from '../context/ThemeContext';
import { useTranslation } from 'react-i18next';

type ProgramsNavigationProp = StackNavigationProp<WorkoutStackParamList, 'Programs'>;

interface SavedProgram {
  program_id: number;
  program_name: string;
  unit: 'kg' | 'lb';
  include_deload: number;
  latest_cycle_id: number | null;
  latest_cycle_status: 'planned' | 'active' | 'complete' | null;
}

export default function Programs() {
  const navigation = useNavigation<ProgramsNavigationProp>();
  const db = useSQLiteContext();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [programs, setPrograms] = useState<SavedProgram[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const loadPrograms = async () => {
        setIsLoading(true);
        try {
          const savedPrograms = await db.getAllAsync<SavedProgram>(
            `SELECT p.program_id, p.program_name, p.unit, p.include_deload,
                    c.cycle_id AS latest_cycle_id,
                    c.status AS latest_cycle_status
             FROM FiveThreeOne_Programs p
             LEFT JOIN FiveThreeOne_Cycles c
               ON c.cycle_id = (
                 SELECT latest.cycle_id
                 FROM FiveThreeOne_Cycles latest
                 WHERE latest.program_id = p.program_id
                 ORDER BY latest.cycle_number DESC
                 LIMIT 1
               )
             ORDER BY p.program_id;`,
           );
          if (isMounted) {
            setPrograms(savedPrograms);
            setError(null);
          }
        } catch (loadError) {
          console.error('Error loading saved 5/3/1 programs:', loadError);
          if (isMounted) {
            setError(t('failedToLoadPrograms'));
          }
        } finally {
          if (isMounted) {
            setIsLoading(false);
          }
        }
      };

      loadPrograms();
      return () => {
        isMounted = false;
      };
    }, [db, t]),
  );

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
        <Text style={[styles.title, { color: theme.text }]}>{t('programs')}</Text>
      </View>

      <TouchableOpacity
        style={[styles.programCard, { backgroundColor: theme.card, borderColor: theme.border }]}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('FiveThreeOneSetup')}
        accessibilityRole="button"
        accessibilityLabel={t('fiveThreeOne')}
      >
        <View style={[styles.programIcon, { backgroundColor: theme.buttonBackground }]}>
          <Ionicons name="barbell" size={28} color={theme.buttonText} />
        </View>
        <View style={styles.programInfo}>
          <Text
            maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
            style={[styles.programName, { color: theme.text }]}
          >
            {t('fiveThreeOne')}
          </Text>
          <Text style={[styles.programDescription, { color: theme.text }]}>
            {t('fiveThreeOneDescription')}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color={theme.text} />
      </TouchableOpacity>

      <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('savedFiveThreeOnePrograms')}</Text>
      {isLoading ? (
        <ActivityIndicator size="large" color={theme.buttonBackground} />
      ) : error ? (
        <Text style={[styles.emptyText, { color: theme.text }]} accessibilityRole="alert">
          {error}
        </Text>
      ) : programs.length === 0 ? (
        <Text style={[styles.emptyText, { color: theme.text }]}>
          {t('noSavedFiveThreeOnePrograms')}
        </Text>
      ) : (
        programs.map((program) => (
          <View
            key={program.program_id}
            style={[styles.savedProgramCard, { backgroundColor: theme.card, borderColor: theme.border }]}
          >
            <View style={styles.savedProgramInfo}>
              <Text
                maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                style={[styles.savedProgramName, { color: theme.text }]}
              >
                {program.program_name}
              </Text>
              <Text style={[styles.savedProgramDetails, { color: theme.text }]}>
                {program.unit} / {program.include_deload === 1 ? t('deloadIncluded') : t('deloadNotIncluded')}
              </Text>
            </View>
            {program.latest_cycle_status === 'complete' && program.latest_cycle_id !== null ? (
              <TouchableOpacity
                style={[styles.generateButton, { backgroundColor: theme.buttonBackground }]}
                onPress={() =>
                  navigation.navigate('FiveThreeOneReview', {
                    programId: program.program_id,
                    cycleId: program.latest_cycle_id as number,
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`${t('reviewCycle')}: ${program.program_name}`}
              >
                <Ionicons name="document-text" size={19} color={theme.buttonText} />
                <Text
                  maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                  style={[styles.generateButtonText, { color: theme.buttonText }]}
                >
                  {t('reviewCycle')}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.generateButton, { backgroundColor: theme.buttonBackground }]}
                onPress={() =>
                  navigation.navigate('FiveThreeOneGeneration', { programId: program.program_id })
                }
                accessibilityRole="button"
                accessibilityLabel={`${t('generateCycle')}: ${program.program_name}`}
              >
                <Ionicons name="flash" size={19} color={theme.buttonText} />
                <Text
                  maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                  style={[styles.generateButtonText, { color: theme.buttonText }]}
                >
                  {t('generateCycle')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
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
    fontSize: 34,
    fontWeight: '800',
  },
  programCard: {
    minHeight: 92,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  programIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  programInfo: {
    flex: 1,
    marginRight: 12,
  },
  programName: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 4,
  },
  programDescription: {
    fontSize: 14,
    opacity: 0.7,
    lineHeight: 20,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '800',
    marginTop: 18,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 15,
    lineHeight: 22,
    opacity: 0.7,
    marginBottom: 16,
  },
  savedProgramCard: {
    minHeight: 116,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 14,
  },
  savedProgramInfo: {
    marginBottom: 12,
  },
  savedProgramName: {
    fontSize: 19,
    fontWeight: '800',
    marginBottom: 4,
  },
  savedProgramDetails: {
    fontSize: 14,
    opacity: 0.7,
  },
  generateButton: {
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  generateButtonText: {
    fontSize: 15,
    fontWeight: '800',
    marginLeft: 7,
  },
});
