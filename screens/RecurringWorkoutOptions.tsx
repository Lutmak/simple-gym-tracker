// screens/RecurringWorkoutOptions.tsx

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { fontSize, radius, spacing } from '../utils/scale';
import { useTranslation } from 'react-i18next';
import { WorkoutLogStackParamList } from '../App';

type RecurringWorkoutNavigationProp = StackNavigationProp<
  WorkoutLogStackParamList,
  'RecurringWorkoutOptions'
>;

export default function RecurringWorkoutOptions() {
  const navigation = useNavigation<RecurringWorkoutNavigationProp>();
  const { theme } = useTheme();
  const { t } = useTranslation();

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Back Button */}
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Ionicons name="arrow-back" size={24} color={theme.text} />
      </TouchableOpacity>

      {/* Title */}
      <Text style={[styles.title, { color: theme.text }]}>
        {t('recurringWorkouts')}
      </Text>

      {/* Create Button */}
      <TouchableOpacity
        style={[styles.button, { backgroundColor: theme.buttonBackground }]}
        onPress={() => navigation.navigate('CreateRecurringWorkout')}
      >
        <Ionicons
          name="add-circle"
          size={24}
          color={theme.buttonText}
          style={styles.icon}
        />
        <Text style={[styles.buttonText, { color: theme.buttonText }]}>
          {t('createRecurringWorkout')}
        </Text>
      </TouchableOpacity>

      {/* Manage Button */}
      <TouchableOpacity
        style={[styles.button, { backgroundColor: theme.buttonBackground }]}
        onPress={() => navigation.navigate('ManageRecurringWorkouts')}
      >
        <Ionicons
          name="settings"
          size={24}
          color={theme.buttonText}
          style={styles.icon}
        />
        <Text style={[styles.buttonText, { color: theme.buttonText }]}>
          {t('manageRecurringWorkouts')}
        </Text>
      </TouchableOpacity>

      {/* Explanation Text */}
      <Text style={[styles.explanation, { color: theme.text }]}>
        {t('recurringWorkoutsExplanation', 
          'Set up workouts that automatically schedule themselves on your calendar at regular intervals.')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.gutter,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    position: 'absolute',
    top: 20,
    left: 10,
    padding: spacing.inline,
    zIndex: 10,
  },
  title: {
    fontSize: fontSize.screenTitle,
    fontWeight: '900',
    marginBottom: spacing.section,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#000000',
    borderRadius: radius.card,
    paddingVertical: spacing.gutter,
    paddingHorizontal: spacing.section,
    width: '90%',
    maxWidth: 400,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 5,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: fontSize.button,
  },
  icon: {
    marginRight: spacing.label,
  },
  explanation: {
    textAlign: 'center',
    fontSize: fontSize.body,
    marginTop: spacing.section,
    paddingHorizontal: spacing.gutter,
    opacity: 0.7,
  },
});
