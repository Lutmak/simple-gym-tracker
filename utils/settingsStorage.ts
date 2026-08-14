import * as FileSystem from 'expo-file-system/legacy';

// Make sure to use backticks here:
const SETTINGS_FILE = `${FileSystem.documentDirectory}userSettings.json`;

export interface StoredSettings {
  language?: string;
  dateFormat?: string;
  timeFormat?: string;
  weightFormat?: string;
  firstWeekday?: string;
  notificationPermissionGranted?: boolean;
  notificationTime?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const saveSettings = async (settings: object) => {
  try {
    await FileSystem.writeAsStringAsync(SETTINGS_FILE, JSON.stringify(settings));
    console.log('Settings saved successfully.');
  } catch (error) {
    console.error('Error saving settings:', error);
  }
};

export const loadSettings = async (): Promise<StoredSettings | null> => {
  try {
    const fileInfo = await FileSystem.getInfoAsync(SETTINGS_FILE);
    if (!fileInfo.exists) {
      console.log("Settings file doesn't exist, using default settings.");
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
