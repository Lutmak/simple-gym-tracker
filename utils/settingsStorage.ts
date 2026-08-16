import * as FileSystem from 'expo-file-system/legacy';

// Make sure to use backticks here:
const SETTINGS_FILE = `${FileSystem.documentDirectory}userSettings.json`;

export interface StoredSettings {
  language?: string;
  dateFormat?: string;
  timeFormat?: string;
  weightFormat?: string;
  /** The default rounding increment for new routines, in the stored unit (S2). */
  roundingIncrement?: number;
  /** The default bar profile for new barbell exercises (S2). */
  barProfile?: string;
  firstWeekday?: string;
  notificationPermissionGranted?: boolean;
  notificationTime?: string;
  /** Weekday (0 = Sunday) → `HH:MM`, for the days that disagree with the default (S3). */
  notificationDayTimes?: Record<string, string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const saveSettings = async (settings: object) => {
  try {
    await FileSystem.writeAsStringAsync(SETTINGS_FILE, JSON.stringify(settings));
  } catch (error) {
    console.error('Error saving settings:', error);
  }
};

export const loadSettings = async (): Promise<StoredSettings | null> => {
  try {
    const fileInfo = await FileSystem.getInfoAsync(SETTINGS_FILE);
    if (!fileInfo.exists) {
      return null;
    }

    const settings = await FileSystem.readAsStringAsync(SETTINGS_FILE);
    const parsedSettings: unknown = JSON.parse(settings);
    return isRecord(parsedSettings) ? parsedSettings : null;
  } catch (error) {
    console.error('Error loading settings:', error);
    return null;
  }
};
