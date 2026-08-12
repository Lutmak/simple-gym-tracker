import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { WorkoutStackParamList } from '../App';
import { APP_TEXT_MAX_FONT_SIZE_MULTIPLIER } from '../components/AppTextInput';
import { useTheme } from '../context/ThemeContext';
import { useTranslation } from 'react-i18next';

type ProgramsNavigationProp = StackNavigationProp<WorkoutStackParamList, 'Programs'>;

export default function Programs() {
  const navigation = useNavigation<ProgramsNavigationProp>();
  const { theme } = useTheme();
  const { t } = useTranslation();

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
});
