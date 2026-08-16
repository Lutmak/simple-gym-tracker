import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import i18n from './i18n';
import { expoWeekday, type TrainingDayReminder } from './notificationSchedule';

/**
 * The only place a reminder reaches the OS (S3). Everything about *what* should
 * be scheduled is decided by `utils/notificationSchedule.ts`, which is pure and
 * tested; this file just carries the result across the boundary.
 *
 * Reminders are **local** notifications, one weekly trigger per training day.
 * Remote push does not exist in this app — it is impossible offline, and it was
 * removed from Expo Go in SDK 53 (`utils/suppressExpoGoLogs.ts`).
 */

export const WORKOUT_CHANNEL_ID = 'workout-reminders';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export const requestNotificationPermissions = async (): Promise<boolean> => {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(WORKOUT_CHANNEL_ID, {
      name: 'Workout Reminders',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  if (existingStatus === 'granted') {
    return true;
  }

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
};

export const cancelAllReminders = async (): Promise<void> => {
  await Notifications.cancelAllScheduledNotificationsAsync();
};

/**
 * Makes the device's scheduled reminders equal to `reminders`, and nothing else.
 * Everything is cancelled first, so turning reminders off (an empty schedule)
 * and changing one day's time both go through this one path and neither can
 * leave a stale alarm behind. Returns how many were scheduled.
 */
export const applyTrainingDayReminders = async (
  reminders: readonly TrainingDayReminder[],
): Promise<number> => {
  await cancelAllReminders();

  if (reminders.length === 0) {
    return 0;
  }

  const granted = await requestNotificationPermissions();
  if (!granted) {
    return 0;
  }

  for (const reminder of reminders) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: i18n.t('workoutReminderTitle', { workoutName: reminder.sessionName }),
        body: i18n.t('dailyReminderBody'),
        data: { kind: 'training-day-reminder', weekday: reminder.weekday },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: expoWeekday(reminder.weekday),
        hour: reminder.hour,
        minute: reminder.minute,
        channelId: WORKOUT_CHANNEL_ID,
      },
    });
  }

  return reminders.length;
};

/**
 * Permission revoked in system settings must turn the app's own switch off, or
 * Ajustes would claim reminders the device will never deliver.
 */
export const checkAndSyncPermissions = async (
  setNotificationPermissionGranted: (granted: boolean) => void,
) => {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    setNotificationPermissionGranted(false);
  }
};
