import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';
import i18n from './i18n';
import { expoWeekday, type TrainingDayReminder } from './notificationSchedule';

/**
 * The only place a reminder reaches the OS (S3). Everything about *what* should
 * be scheduled is decided by `utils/notificationSchedule.ts`, which is pure and
 * tested; this file just carries the result across the boundary.
 *
 * Reminders are **local** notifications, one weekly trigger per training day.
 * Remote push does not exist in this app — it is impossible offline.
 *
 * `expo-notifications` is loaded lazily, and never in Expo Go: since SDK 57 the
 * package throws from module scope there on Android (push was removed from Expo
 * Go in SDK 53), so a static import would take the whole app down in
 * development. In Expo Go reminders simply do not exist — every function below
 * answers "not granted", which every caller already handles. A build gets the
 * real module.
 */

type NotificationsModule = typeof import('expo-notifications');

export const WORKOUT_CHANNEL_ID = 'workout-reminders';

/**
 * Whether reminders can exist at all in this runtime — false in Expo Go (see the module doc
 * above). Ajustes uses this to disable the switch and explain why, rather than offering a
 * control that silently ignores the tap (U6).
 */
export const notificationsAvailable = (): boolean => !isRunningInExpoGo();

let notificationsModule: NotificationsModule | null | undefined;

const notifications = (): NotificationsModule | null => {
  if (notificationsModule !== undefined) {
    return notificationsModule;
  }
  if (isRunningInExpoGo()) {
    notificationsModule = null;
    return notificationsModule;
  }
  const loaded: NotificationsModule = require('expo-notifications');
  loaded.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  notificationsModule = loaded;
  return notificationsModule;
};

export const requestNotificationPermissions = async (): Promise<boolean> => {
  const api = notifications();
  if (!api) {
    return false;
  }

  if (Platform.OS === 'android') {
    await api.setNotificationChannelAsync(WORKOUT_CHANNEL_ID, {
      name: 'Workout Reminders',
      importance: api.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  const { status: existingStatus } = await api.getPermissionsAsync();
  if (existingStatus === 'granted') {
    return true;
  }

  const { status } = await api.requestPermissionsAsync();
  return status === 'granted';
};

export const cancelAllReminders = async (): Promise<void> => {
  await notifications()?.cancelAllScheduledNotificationsAsync();
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
  const api = notifications();
  if (!api) {
    return 0;
  }

  await api.cancelAllScheduledNotificationsAsync();

  if (reminders.length === 0) {
    return 0;
  }

  const granted = await requestNotificationPermissions();
  if (!granted) {
    return 0;
  }

  for (const reminder of reminders) {
    await api.scheduleNotificationAsync({
      content: {
        title: i18n.t('workoutReminderTitle', { workoutName: reminder.sessionName }),
        body: i18n.t('dailyReminderBody'),
        data: { kind: 'training-day-reminder', weekday: reminder.weekday },
      },
      trigger: {
        type: api.SchedulableTriggerInputTypes.WEEKLY,
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
  const api = notifications();
  if (!api) {
    setNotificationPermissionGranted(false);
    return;
  }
  const { status } = await api.getPermissionsAsync();
  if (status !== 'granted') {
    setNotificationPermissionGranted(false);
  }
};
