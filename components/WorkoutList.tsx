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
import { useSQLiteContext } from 'expo-sqlite';
import { exportWorkout, importWorkout } from '../utils/workoutSharingUtils';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';


type WorkoutListNavigationProp = StackNavigationProp<WorkoutStackParamList, 'WorkoutsList'>;

export default function WorkoutList({
  workouts,
  deleteWorkout,
  getWorkouts,
}: {
  workouts: Workout[];
  deleteWorkout: (workout_id: number, workout_name: string) => Promise<void>;
  getWorkouts: () => Promise<void>;
}) {
  const navigation = useNavigation<WorkoutListNavigationProp>();
  const { theme } = useTheme(); // Get the current theme
  const { t } = useTranslation(); // Initialize translations
  const db = useSQLiteContext();
  const sortedWorkouts = [...workouts].sort((a, b) => b.workout_id - a.workout_id);
  

  const handleExportWorkout = (workoutId: number) => {
    exportWorkout(db, workoutId);
  };

  const handleImportWorkout = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
      });

      if (result.assets && result.assets[0]) {
        const fileUri = result.assets[0].uri;
        const jsonString = await FileSystem.readAsStringAsync(fileUri);
        const success = await importWorkout(db, jsonString);
        if (success) {
          getWorkouts(); // Refresh the list
        }
      }
    } catch (error) {
      console.error('Error importing workout:', error);
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Title */}
      <View style={styles.titleContainer}>
        <Ionicons name="barbell" size={30} color={theme.text} style={styles.titleIcon} />
        <Text style={[styles.title, { color: theme.text }]}>{t('MyWorkouts')}</Text>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionButtonsContainer}>
        {/* Create New Workout Button */}
        <TouchableOpacity
          style={[styles.createButton, { backgroundColor: theme.buttonBackground }]}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('CreateWorkout')}
        >
          <Text style={[styles.createButtonText, { color: theme.buttonText }]}>{t('CreateAWorkoutButton')}</Text>
        </TouchableOpacity>

        {/* Import Workout Button */}
        <TouchableOpacity
          style={[styles.importButton, { backgroundColor: theme.buttonBackground }]}
          activeOpacity={0.7}
          onPress={handleImportWorkout}
        >
          <Ionicons name="download-outline" size={25} color={theme.buttonText} />
        </TouchableOpacity>
      </View>

      {/* Workout List */}
      {sortedWorkouts.map((workout) => (
        <TouchableOpacity
          key={workout.workout_id}
          style={[
            styles.workoutCard,
            {
              backgroundColor: theme.card,
              borderColor: theme.border,
            },
          ]}
          activeOpacity={0.7}
          onLongPress={() => deleteWorkout(workout.workout_id, workout.workout_name)}
          onPress={() => navigation.navigate('WorkoutDetails', { workout_id: workout.workout_id })}
        >
          <View style={styles.workoutNameWrapper}>
            <Text style={[styles.workoutText, { color: theme.text }]}>{workout.workout_name}</Text>
            <TouchableOpacity onPress={() => handleExportWorkout(workout.workout_id)}>
              <Ionicons name="share-outline" size={24} color={theme.text} style={styles.shareIcon} />
            </TouchableOpacity>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.text} />
        </TouchableOpacity>
        
      ))}
         {/* Tip Text at the Bottom */}
    <Text style={[styles.tipText, { color: theme.text }]}>
    {t('WorkoutListTip')}
    </Text>
    </ScrollView>
  );
}

//WorkoutList.tsx

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.gutter,
    marginTop: 40, // Move everything down
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.section,
  },
  titleIcon: {
    marginRight: spacing.label,
  },
  title: {
    fontSize: fontSize.screenTitle, // Larger font size
    fontWeight: '900', // Extra bold
    textAlign: 'center', // Centered text
  },
  tipText: {
    marginTop: spacing.card, // Space above the text
    textAlign: 'center', // Center align
    fontSize: fontSize.helper, // Smaller font size
    fontStyle: 'italic', // Italic for emphasis
  },
  createButton: {
    borderRadius: 50,
    paddingVertical: spacing.card,
    paddingHorizontal: spacing.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1, // Take up available space
    marginRight: spacing.label, // Add space to the right
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 2,
  },
  importButton: {
    borderRadius: 50,
    paddingTop: spacing.card,
    paddingBottom: spacing.card,
    paddingHorizontal: spacing.card,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 2,
  },
  actionButtonsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.card,
    marginBottom: spacing.card,
  },
  createButtonText: {
    fontSize: fontSize.button,
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
  workoutNameWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  shareIcon: {
    marginLeft: 10,
  }
});
