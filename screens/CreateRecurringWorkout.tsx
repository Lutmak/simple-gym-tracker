import React, { useState, useEffect, useCallback } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ScrollView, 
  Switch, 
  Platform,
  Modal,
  Alert,
  Keyboard,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';

import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { fontSize, radius, spacing } from '../utils/scale';
import { useTranslation } from 'react-i18next';
import { WorkoutLogStackParamList } from '../App';
import { useSQLiteContext } from 'expo-sqlite';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRecurringWorkouts } from '../utils/recurringWorkoutUtils';
import { useSettings } from '../context/SettingsContext';
import AppTextInput, {
  APP_TEXT_MAX_FONT_SIZE_MULTIPLIER,
  parseNumericInput,
} from '../components/AppTextInput';

type NavigationProp = StackNavigationProp<
  WorkoutLogStackParamList,
  'CreateRecurringWorkout'
>;

type Workout = {
  workout_id: number;
  workout_name: string;
};

type Day = {
  day_id: number;
  day_name: string;
};

const hasPositiveIntegerPart = (value: string): boolean =>
  /^[0-9]*[1-9][0-9]*$/.test(value.split('.')[0]);

export default function CreateRecurringWorkout() {
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const db = useSQLiteContext();
  const { createRecurringWorkout } = useRecurringWorkouts();
  const { notificationPermissionGranted, timeFormat } = useSettings();

  // Using t() for day names inside the component
  const DAYS_OF_WEEK = [
    { id: 1, name: t('Monday') },
    { id: 2, name: t('Tuesday') },
    { id: 3, name: t('Wednesday') },
    { id: 4, name: t('Thursday') },
    { id: 5, name: t('Friday') },
    { id: 6, name: t('Saturday') },
    { id: 0, name: t('Sunday') },
  ];

  // State for form elements
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [days, setDays] = useState<Day[]>([]);
  const [selectedWorkout, setSelectedWorkout] = useState<number | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedWorkoutName, setSelectedWorkoutName] = useState<string>('');
  const [selectedDayName, setSelectedDayName] = useState<string>('');
  
  // Interval selection states
  const [intervalType, setIntervalType] = useState<'everyday'|'custom'|'weekly'>('everyday');
  const [customDaysInterval, setCustomDaysInterval] = useState<string>('2');
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([]);
  const [showWeekdaySelector, setShowWeekdaySelector] = useState<boolean>(false);
  
  // Notification states
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(false);
  const [notificationTime, setNotificationTime] = useState<Date>(() => {
    const date = new Date();
    date.setHours(8, 0, 0, 0); // Default 08:00
    return date;
  });
  const [showTimePicker, setShowTimePicker] = useState<boolean>(false);
  
  // UI states
  const [showWorkoutList, setShowWorkoutList] = useState<boolean>(false);
  const [showDayList, setShowDayList] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Fetch workouts on component mount
  useEffect(() => {
    fetchWorkouts();
  }, []);

  // Fetch workouts from database
  const fetchWorkouts = async () => {
    try {
      const result = await db.getAllAsync<Workout>(
        'SELECT workout_id, workout_name FROM Workouts ORDER BY workout_name;'
      );
      setWorkouts(result);
    } catch (error) {
      console.error('Error fetching workouts:', error);
    }
  };

  // Fetch days for selected workout
  const fetchDays = useCallback(async (workoutId: number) => {
    try {
      const result = await db.getAllAsync<Day>(
        'SELECT day_id, day_name FROM Days WHERE workout_id = ? ORDER BY day_id;',
        [workoutId]
      );
      setDays(result);
    } catch (error) {
      console.error('Error fetching days:', error);
    }
  }, [db]);

  // When workout selection changes, fetch days and reset day selection
  useEffect(() => {
    if (selectedWorkout) {
      fetchDays(selectedWorkout);
      setSelectedDay(null);
      setSelectedDayName('');
      
      // Find and set selected workout name
      const workout = workouts.find(w => w.workout_id === selectedWorkout);
      if (workout) {
        setSelectedWorkoutName(workout.workout_name);
      }
    }
  }, [selectedWorkout, fetchDays, workouts]);

  // Update selected day name when selected day changes
  useEffect(() => {
    if (selectedDay) {
      const day = days.find(d => d.day_id === selectedDay);
      if (day) {
        setSelectedDayName(day.day_name);
      }
    }
  }, [selectedDay, days]);

  // Format time for display
  const formatTime = (date: Date): string => {
    if (timeFormat === 'AM/PM') {
      return date.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });
    }
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  // Toggle weekday selection
  const toggleWeekday = (dayId: number) => {
    if (selectedWeekdays.includes(dayId)) {
      setSelectedWeekdays(selectedWeekdays.filter(d => d !== dayId));
    } else {
      setSelectedWeekdays([...selectedWeekdays, dayId]);
    }
  };

  // Handle time change from picker
  const handleTimeChange = (event: any, selectedTime?: Date) => {
    setShowTimePicker(Platform.OS === 'ios');
    if (selectedTime) {
      setNotificationTime(selectedTime);
    }
  };

  // Calculate recurring interval based on selection
  const getRecurringInterval = (): number => {
    switch (intervalType) {
      case 'everyday':
        return 1; // Everyday = 1 day interval
      case 'custom':
        {
          const interval = parseNumericInput(customDaysInterval);
          return interval === null ? 0 : Math.trunc(interval);
        }
      case 'weekly':
        return 0; // 0 indicates to use recurring_days instead
      default:
        return 1;
    }
  };

  // Get recurring days string for weekly selection
  const getRecurringDays = (): string | undefined => {
    if (intervalType === 'weekly' && selectedWeekdays.length > 0) {
      return selectedWeekdays.sort().join(',');
    }
    return undefined;
  };

  // Save recurring workout
  const saveRecurringWorkout = async () => {
    if (!selectedWorkout || !selectedDay) {
      console.log('DEBUG: Missing workout or day selection');
      return;
    }

    try {
      const existing = await db.getFirstAsync(
        'SELECT 1 FROM Recurring_Workouts WHERE workout_id = ? AND day_name = ?',
        [selectedWorkout, selectedDayName]
      );
      
      if (existing) {
        Alert.alert(
          t('duplicateRecurringWorkout'),
          t('recurringWorkoutExists'),
          [{ text: t('OK') }]
        );
        return;
      }
    } catch (e) {
        console.error("error checking for duplicates", e);
    }

    setIsLoading(true);
    console.log('DEBUG: Starting recurring workout creation process');
    console.log(`DEBUG: Selected Workout ID: ${selectedWorkout}, Name: ${selectedWorkoutName}`);
    console.log(`DEBUG: Selected Day ID: ${selectedDay}, Name: ${selectedDayName}`);
    
    try {
      // Calculate interval and days
      const recurringInterval = getRecurringInterval();
      const recurringDays = getRecurringDays();
      
      console.log(`DEBUG: Interval Type: ${intervalType}`);
      console.log(`DEBUG: Recurring Interval Value: ${recurringInterval}`);
      
      if (intervalType === 'weekly') {
        console.log(`DEBUG: Selected Weekdays: ${selectedWeekdays.join(',')}`);
        console.log(`DEBUG: Recurring Days String: ${recurringDays}`);
      } else if (intervalType === 'custom') {
        console.log(`DEBUG: Custom Days Interval: ${customDaysInterval}`);
      }

      // Format notification time as string (HH:MM)
      const timeString = notificationsEnabled 
        ? `${String(notificationTime.getHours()).padStart(2, '0')}:${String(notificationTime.getMinutes()).padStart(2, '0')}` 
        : undefined;
      
      console.log(`DEBUG: Notifications Enabled: ${notificationsEnabled}`);
      if (notificationsEnabled) {
        console.log(`DEBUG: Notification Time: ${timeString}`);
      }
      
      console.log('DEBUG: Creating recurring workout with parameters:', {
        workout_id: selectedWorkout,
        workout_name: selectedWorkoutName,
        day_name: selectedDayName,
        recurring_interval: recurringInterval,
        recurring_days: recurringDays,
        notification_enabled: notificationsEnabled,
        notification_time: timeString
      });
      
      // Create recurring workout
      const success = await createRecurringWorkout({
        workout_id: selectedWorkout,
        workout_name: selectedWorkoutName,
        day_name: selectedDayName,
        recurring_interval: recurringInterval,
        recurring_days: recurringDays,
        notification_enabled: notificationsEnabled,
        notification_time: timeString
      });

      if (success) {
        console.log('DEBUG: Successfully created recurring workout');
        navigation.navigate('MyCalendar', {refresh: true});
      } else {
        console.error('DEBUG: Failed to create recurring workout - returned false');
      }
    } catch (error) {
      console.error('DEBUG: Error creating recurring workout:', error);
    } finally {
      console.log('DEBUG: Finished recurring workout creation process');
      setIsLoading(false);
    }
  };

  // Check if form is valid and can be submitted
  const isFormValid = (): boolean => {
    if (!selectedWorkout || !selectedDay) return false;
    
    if (intervalType === 'custom') {
      if (!hasPositiveIntegerPart(customDaysInterval)) return false;
    }

    if (intervalType === 'weekly' && selectedWeekdays.length === 0) {
      return false;
    }

    return true;
  };

  const handleNotificationToggle = (value: boolean) => {
    if (value && !notificationPermissionGranted) {
      // User is trying to enable notifications but doesn't have permission
      Alert.alert(
        t('notificationPermissions'),
        t('notificationPermissionsRequired'),
        [
          {
            text: t('cancel'),
            style: 'cancel'
          },
          {
            text: t('goToSettings'),
            onPress: () => navigation.navigate('Settings' as never)
          }
        ]
      );
    } else {
      // Either turning off notifications or has permission
      setNotificationsEnabled(value);
    }
  };

  return (
    <ScrollView 
      style={[styles.container, { backgroundColor: theme.background }]}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 40 }}
      onScrollBeginDrag={Keyboard.dismiss}
    >
      {/* Back Button */}
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Ionicons name="arrow-back" size={24} color={theme.text} />
      </TouchableOpacity>

      <Text style={[styles.title, { color: theme.text }]}>
        {t('createRecurringWorkout')}
      </Text>
      
      <View style={styles.formContainer}>
        {/* Workout Selection */}
        <View style={[styles.selectionSection, { backgroundColor: theme.card }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>
            {t('selectWorkout')}
          </Text>
          <TouchableOpacity 
            style={styles.selector}
            onPress={() => setShowWorkoutList(!showWorkoutList)}
          >
            <Text maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={[styles.selectorText, { color: theme.text }]}>
              {selectedWorkoutName || t('selectWorkout')}
            </Text>
            <Ionicons 
              name={showWorkoutList ? "chevron-up" : "chevron-down"} 
              size={22} 
              color={theme.text} 
            />
          </TouchableOpacity>
          
          {showWorkoutList && (
            <View style={styles.dropdownList}>
              {workouts.map(workout => (
                <TouchableOpacity
                  key={workout.workout_id}
                  style={[
                    styles.dropdownItem,
                    selectedWorkout === workout.workout_id && 
                    {backgroundColor: theme.buttonBackground}
                  ]}
                  onPress={() => {
                    setSelectedWorkout(workout.workout_id);
                    setShowWorkoutList(false);
                  }}
                >
                  <View style={styles.dropdownItemContent}>
                    <Text
                      style={[
                        styles.dropdownText,
                        { color: theme.text },
                        selectedWorkout === workout.workout_id && {color: theme.buttonText}
                      ]}
                    >
                      {workout.workout_name}
                    </Text>
                    {selectedWorkout === workout.workout_id && (
                      <Ionicons name="checkmark" size={22} color={theme.buttonText} />
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
        
        {/* Day Selection - only show if workout is selected */}
        {selectedWorkout && (
          <View style={[styles.selectionSection, { backgroundColor: theme.card }]}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              {t('selectDay')}
            </Text>
            <TouchableOpacity 
              style={styles.selector}
              onPress={() => setShowDayList(!showDayList)}
            >
              <Text maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={[styles.selectorText, { color: theme.text }]}>
                {selectedDayName || t('selectDay')}
              </Text>
              <Ionicons 
                name={showDayList ? "chevron-up" : "chevron-down"} 
                size={22} 
                color={theme.text} 
              />
            </TouchableOpacity>
            
            {showDayList && (
              <View style={styles.dropdownList}>
                {days.map(day => (
                  <TouchableOpacity
                    key={day.day_id}
                    style={[
                      styles.dropdownItem,
                      selectedDay === day.day_id && 
                      {backgroundColor: theme.buttonBackground}
                    ]}
                    onPress={() => {
                      setSelectedDay(day.day_id);
                      setShowDayList(false);
                    }}
                  >
                    <View style={styles.dropdownItemContent}>
                      <Text
                        maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                        style={[
                          styles.dropdownText,
                          { color: theme.text },
                          selectedDay === day.day_id && {color: theme.buttonText}
                        ]}
                      >
                        {day.day_name}
                      </Text>
                      {selectedDay === day.day_id && (
                        <Ionicons name="checkmark" size={22} color={theme.buttonText} />
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}
        
        {/* Recurring Interval Selection - only show if day is selected */}
        {selectedDay && (
          <View style={[styles.selectionSection, { backgroundColor: theme.card }]}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              {t('recurringInterval')}
            </Text>
            
            {/* Everyday option */}
            <TouchableOpacity
              style={[
                styles.intervalOption,
                intervalType === 'everyday' && 
                {backgroundColor: theme.buttonBackground, borderColor: theme.buttonBackground}
              ]}
              onPress={() => setIntervalType('everyday')}
            >
              <Text
                maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                style={[
                  styles.intervalText,
                  { color: theme.text },
                  intervalType === 'everyday' && {color: theme.buttonText}
                ]}
              >
                {t('everyday')}
              </Text>
              {intervalType === 'everyday' && (
                <Ionicons name="checkmark" size={22} color={theme.buttonText} />
              )}
            </TouchableOpacity>
            
            {/* Custom interval option */}
            <TouchableOpacity
              style={[
                styles.intervalOptionWithInput,
                intervalType === 'custom' && 
                {backgroundColor: theme.buttonBackground, borderColor: theme.buttonBackground}
              ]}
              onPress={() => setIntervalType('custom')}
            >
              <View style={styles.customIntervalRow}>
                <Text
                  maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                  style={[
                    styles.intervalText,
                    { color: intervalType === 'custom' ? theme.buttonText : theme.text },
                  ]}
                >
                  {t('everyXDays')}
                </Text>
                <AppTextInput
                  variant="numeric"
                  style={[
                    styles.dayInput,
                    { 
                      color: intervalType === 'custom' ? theme.buttonText : theme.text,
                      borderColor: intervalType === 'custom' ? theme.buttonText : 'rgba(0, 0, 0, 0.1)',
                    }
                  ]}
                  value={customDaysInterval}
                  onRawChange={setCustomDaysInterval}
                  keyboardType="numeric"
                  onFocus={() => setIntervalType('custom')}
                  maxLength={3}
                />
                <Text
                  maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                  style={[
                    styles.intervalText,
                    { color: intervalType === 'custom' ? theme.buttonText : theme.text },
                  ]}
                >
                 {t('days')}
                </Text>
              </View>
              {intervalType === 'custom' && (
                <Ionicons name="checkmark" size={22} color={theme.buttonText} />
              )}
            </TouchableOpacity>
            
            {/* Weekly selection option */}
            <TouchableOpacity
              style={[
                styles.intervalOption,
                intervalType === 'weekly' && 
                {backgroundColor: theme.buttonBackground, borderColor: theme.buttonBackground}
              ]}
              onPress={() => {
                setIntervalType('weekly');
                setShowWeekdaySelector(true);
              }}
            >
              <Text
                maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                style={[
                  styles.intervalText,
                  { color: theme.text },
                  intervalType === 'weekly' && {color: theme.buttonText}
                ]}
              >
                {t('specificDaysOfWeek')}
              </Text>
              {intervalType === 'weekly' && (
                <Ionicons name="checkmark" size={22} color={theme.buttonText} />
              )}
            </TouchableOpacity>
            
            {/* Show selected days summary if weekly is selected */}
            {intervalType === 'weekly' && selectedWeekdays.length > 0 && (
              <TouchableOpacity 
                style={styles.selectedDaysSummary}
                onPress={() => setShowWeekdaySelector(true)}
              >
                <Text style={{ color: theme.text }}>
                  {selectedWeekdays
                    .sort()
                    .map(dayId => t(DAYS_OF_WEEK.find(d => d.id === dayId)?.name || ''))
                    .join(', ')}
                </Text>
              </TouchableOpacity>
            )}
            
            {/* Days of week selector modal */}
            <Modal
              visible={showWeekdaySelector}
              transparent={true}
              animationType="fade"
            >
              <View style={styles.modalOverlay}>
                <View style={[styles.weekdaySelectorModal, { backgroundColor: theme.card }]}>
                  <Text style={[styles.modalTitle, { color: theme.text }]}>
                    {t('selectDaysOfWeek')}
                  </Text>
                  
                  {DAYS_OF_WEEK.map(day => (
                    <TouchableOpacity
                      key={day.id}
                      style={[
                        styles.weekdayOption,
                        selectedWeekdays.includes(day.id) && 
                        { backgroundColor: theme.buttonBackground }
                      ]}
                      onPress={() => toggleWeekday(day.id)}
                    >
                      <Text
                        maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                        style={[
                          styles.weekdayText, 
                          { color: selectedWeekdays.includes(day.id) ? theme.buttonText : theme.text }
                        ]}
                      >
                        {t(day.name)}
                      </Text>
                      {selectedWeekdays.includes(day.id) && (
                        <Ionicons name="checkmark" size={22} color={theme.buttonText} />
                      )}
                    </TouchableOpacity>
                  ))}
                  
                  <TouchableOpacity
                    style={[styles.saveButton, { backgroundColor: theme.buttonBackground }]}
                    onPress={() => setShowWeekdaySelector(false)}
                  >
                    <Text style={[styles.saveButtonText, { color: theme.buttonText }]}>
                      {t('done')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>
          </View>
        )}
        
        {/* Notification Settings - only show if interval is selected */}
        {selectedDay && (
          <View style={[styles.notificationSection, { backgroundColor: theme.card }]}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              {t('notifications')}
            </Text>
            
            <View style={styles.switchRow}>
              <Text maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={[styles.switchLabel, { color: theme.text }]}>
                {t('enableNotifications')}
              </Text>
              <Switch
                value={notificationsEnabled}
                onValueChange={handleNotificationToggle}
                trackColor={{ false: '#767577', true: theme.buttonBackground }}
                thumbColor={'#f4f3f4'}
              />
            </View>
            
            {notificationsEnabled && (
              <TouchableOpacity 
                style={styles.timeSelector}
                onPress={() => setShowTimePicker(true)}
              >
                <Text maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={[styles.timeSelectorText, { color: theme.text }]}>
                  {t('notificationTime')}: {formatTime(notificationTime)}
                </Text>
                <Ionicons name="time-outline" size={22} color={theme.text} />
              </TouchableOpacity>
            )}
            
            {showTimePicker && (
              <DateTimePicker
                value={notificationTime}
                mode="time"
                is24Hour={timeFormat === '24h'}
                display="default"
                onChange={handleTimeChange}
              />
            )}
          </View>
        )}

        {/* Create Button - only enable if all selections are made */}
        {isFormValid() && (
          <TouchableOpacity
            style={[
              styles.createButton, 
              { backgroundColor: theme.buttonBackground },
              isLoading && { opacity: 0.7 }
            ]}
            onPress={saveRecurringWorkout}
            disabled={isLoading}
          >
            <Text style={[styles.createButtonText, { color: theme.buttonText }]}>
              {isLoading ? t('creating') : t('createRecurringWorkout')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.gutter,
  },
  backButton: {
    marginTop: spacing.label,
    marginBottom: spacing.card,
    padding: spacing.inline,
    zIndex: 10,
    alignSelf: 'flex-start',
  },
  title: {
    fontSize: fontSize.screenTitle,
    fontWeight: '900',
    marginBottom: spacing.card,
    textAlign: 'center',
  },
  formContainer: {
    marginTop: spacing.label,
  },
  selectionSection: {
    padding: spacing.card,
    borderRadius: radius.card,
    marginBottom: spacing.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  notificationSection: {
    padding: spacing.card,
    borderRadius: radius.card,
    marginBottom: spacing.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: fontSize.cardTitle,
    fontWeight: 'bold',
    marginBottom: spacing.label,
  },
  selector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.label,
    paddingHorizontal: spacing.card,
    borderWidth: 0,
    borderColor: 'rgba(0, 0, 0, 0.1)',
    borderRadius: 8,
  },
  selectorText: {
    fontSize: fontSize.body,
  },
  dropdownList: {
    marginTop: spacing.inline,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
    borderRadius: 8,
  },
  dropdownItem: {
    paddingVertical: spacing.label,
    paddingHorizontal: spacing.card,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
  },
  dropdownItemContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  dropdownText: {
    fontSize: fontSize.body,
  },
  intervalOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.label,
    paddingHorizontal: spacing.card,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
    borderRadius: 8,
    marginBottom: spacing.inline,
  },
  intervalOptionWithInput: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.label,
    paddingHorizontal: spacing.card,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
    borderRadius: 8,
    marginBottom: spacing.inline,
  },
  customIntervalRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  intervalText: {
    fontSize: fontSize.body,
  },
  dayInput: {
    width: 40,
    minHeight: 30,
    borderWidth: 1,
    borderRadius: 4,
    marginHorizontal: spacing.inline,
    textAlign: 'center',
    fontSize: fontSize.body,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.card,
  },
  switchLabel: {
    fontSize: fontSize.body,
  },
  timeSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.label,
    paddingHorizontal: spacing.card,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
    borderRadius: 8,
  },
  timeSelectorText: {
    fontSize: fontSize.body,
  },
  selectedDaysSummary: {
    padding: spacing.inline,
    marginTop: spacing.inline,
    marginBottom: spacing.inline,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  weekdaySelectorModal: {
    width: '80%',
    borderRadius: radius.card,
    padding: spacing.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  modalTitle: {
    fontSize: fontSize.cardTitle,
    fontWeight: 'bold',
    marginBottom: spacing.card,
    textAlign: 'center',
  },
  weekdayOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.label,
    paddingHorizontal: spacing.card,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
    borderRadius: 8,
    marginBottom: spacing.inline,
  },
  weekdayText: {
    fontSize: fontSize.body,
  },
  createButton: {
    backgroundColor: '#000000',
    borderRadius: radius.card,
    paddingVertical: spacing.card,
    alignItems: 'center',
    marginTop: spacing.card,
    marginBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 5,
  },
  createButtonText: {
    fontSize: fontSize.button,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  saveButton: {
    borderRadius: 8,
    paddingVertical: spacing.label,
    alignItems: 'center',
    marginTop: spacing.label,
  },
  saveButtonText: {
    fontSize: fontSize.body,
    fontWeight: 'bold',
  },
});
