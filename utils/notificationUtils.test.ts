/**
 * `expo-notifications` cannot be imported in Expo Go: since SDK 57 it throws
 * from module scope there (push was removed from Expo Go in SDK 53). This is the
 * one place the app touches the OS for reminders, so it alone decides whether
 * the module is loaded at all. Everything else only ever sees "not granted".
 */
import type { TrainingDayReminder } from './notificationSchedule';

const reminder = (
  sessionName: string,
  weekday: number,
  hour: number,
  minute: number,
): TrainingDayReminder => {
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { sessionName, weekday, hour, minute, time, custom: false };
};

const mockNotifications = {
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  AndroidImportance: { MAX: 5 },
  SchedulableTriggerInputTypes: { WEEKLY: 'weekly' },
};
const mockState = { loads: 0 };
jest.mock('expo-notifications', () => {
  mockState.loads += 1;
  return mockNotifications;
});
jest.mock('./i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }));

const mockInExpoGo = jest.fn<boolean, []>();
jest.mock('expo', () => ({ isRunningInExpoGo: () => mockInExpoGo() }));

const load = () => {
  jest.resetModules();
  mockState.loads = 0;
  return require('./notificationUtils') as typeof import('./notificationUtils');
};

describe('notificationUtils in Expo Go', () => {
  beforeEach(() => mockInExpoGo.mockReturnValue(true));

  it('never loads expo-notifications', async () => {
    const utils = load();
    await utils.requestNotificationPermissions();
    await utils.applyTrainingDayReminders([reminder('A', 1, 8, 0)]);
    await utils.cancelAllReminders();
    expect(mockState.loads).toBe(0);
  });

  it('reports permission as not granted and schedules nothing', async () => {
    const utils = load();
    const granted = jest.fn();
    await expect(utils.requestNotificationPermissions()).resolves.toBe(false);
    await expect(
      utils.applyTrainingDayReminders([reminder('A', 1, 8, 0)]),
    ).resolves.toBe(0);
    await utils.checkAndSyncPermissions(granted);
    expect(granted).toHaveBeenCalledWith(false);
  });
});

describe('notificationUtils in a build', () => {
  beforeEach(() => {
    mockInExpoGo.mockReturnValue(false);
    jest.clearAllMocks();
  });

  it('installs the foreground handler once and forwards to expo-notifications', async () => {
    const utils = load();
    await expect(utils.requestNotificationPermissions()).resolves.toBe(true);
    await utils.requestNotificationPermissions();
    expect(mockState.loads).toBe(1);
    expect(mockNotifications.setNotificationHandler).toHaveBeenCalledTimes(1);
  });

  it('replaces the device schedule with the given reminders', async () => {
    const utils = load();
    const count = await utils.applyTrainingDayReminders([
      reminder('A', 1, 8, 0),
      reminder('B', 3, 18, 30),
    ]);
    expect(count).toBe(2);
    expect(mockNotifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });
});
