import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { WorkoutStackParamList } from '../App'; // Adjust path to where WorkoutStackParamList is defined
import { Workout } from '../utils/types';
import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ScrollView, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { fontSize, radius, spacing } from '../utils/scale'; // Adjust the path to your ThemeContext
import { useTranslation } from 'react-i18next';


type WorkoutListNavigationProp = StackNavigationProp<WorkoutStackParamList, 'DifficultyList'>;

export default function DifficultyList({
}: {
  workouts: Workout[];
  deleteWorkout: (workout_id: number, workout_name: string) => Promise<void>;
}) {
  const navigation = useNavigation<WorkoutListNavigationProp>();
  const { theme } = useTheme(); // Get the current theme
  const { t } = useTranslation(); // Initialize translations
  

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Title */}
      <Text style={[styles.title, { color: theme.text }]}>{t('Difficulty')}</Text>

      <TouchableOpacity
          style={[
            styles.workoutCard,
            {
              backgroundColor: theme.card,
              borderColor: theme.border,
 
            },
          ]}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('Template', { workout_difficulty: 'Beginner' })}
>
          <Text style={[styles.workoutText, { color: theme.text }]}>{t('Beginner')}</Text>
          <Ionicons name="chevron-forward" size={20} color={theme.text} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.workoutCard,
            {
              backgroundColor: theme.card,
              borderColor: theme.border,
            },
          ]}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('Template', { workout_difficulty: 'Intermediate' })}
>
          <Text style={[styles.workoutText, { color: theme.text }]}>{t('Intermediate')}</Text>
          <Ionicons name="chevron-forward" size={20} color={theme.text} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.workoutCard,
            {
              backgroundColor: theme.card,
              borderColor: theme.border,

            },
          ]}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('Template', { workout_difficulty: 'Advanced' })}
>
          <Text style={[styles.workoutText, { color: theme.text }]}>{t('Advanced')}</Text>
          <Ionicons name="chevron-forward" size={20} color={theme.text} />
        </TouchableOpacity>


    
    </ScrollView>
  );
}

//WorkoutList.tsx

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.gutter,
    marginTop: 64, // Move everything down
  },
  title: {
    fontSize: fontSize.screenTitle, // Larger font size
    fontWeight: '900', // Extra bold
    marginBottom: spacing.section,
    textAlign: 'center', // Centered text
  
  },


  createButton: {
    borderRadius: radius.pill,
    paddingVertical: spacing.card,
    paddingHorizontal: spacing.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.card,
    marginBottom: spacing.section, // Add space below the button
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 5,
  },
  createButtonText: {
    fontSize: fontSize.button,
    fontWeight: 'bold',
    flex: 1,
  },
  plus: {
    // A decorative glyph rather than type, so it sits outside the reading scale.
    fontSize: 22,
    fontWeight: 'bold',
  },
  workoutCard: {
    backgroundColor: '#F7F7F7',
    paddingVertical: spacing.card,
    paddingHorizontal: spacing.card,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.cardGap,
  },
  workoutText: {
    fontSize: fontSize.cardTitle, // Slightly larger
    fontWeight: '700', // More bold
  },
});
