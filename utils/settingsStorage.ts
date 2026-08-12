import * as FileSystem from 'expo-file-system/legacy';
import type { RoundingDirection } from './fiveThreeOne';

// Make sure to use backticks here:
const SETTINGS_FILE = `${FileSystem.documentDirectory}userSettings.json`;

export interface FiveThreeOneDefaults {
  roundingIncrement: number;
  roundingDirection: RoundingDirection;
  tmPercentage: number;
  includeDeload: boolean;
  upperTmIncrement: number;
  lowerTmIncrement: number;
  warmupEnabled: boolean;
}

export const DEFAULT_FIVE_THREE_ONE_DEFAULTS: Readonly<FiveThreeOneDefaults> = {
  roundingIncrement: 2.5,
  roundingDirection: 'nearest',
  tmPercentage: 0.9,
  includeDeload: true,
  upperTmIncrement: 2.5,
  lowerTmIncrement: 5,
  warmupEnabled: true,
};

export interface StoredSettings {
  language?: string;
  dateFormat?: string;
  timeFormat?: string;
  weightFormat?: string;
  firstWeekday?: string;
  notificationPermissionGranted?: boolean;
  fiveThreeOneDefaults?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPositiveFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const isRoundingDirection = (value: unknown): value is RoundingDirection =>
  value === 'up' || value === 'down' || value === 'nearest';

const isTmPercentage = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0.85 &&
  value <= 0.9;

export function mergeFiveThreeOneDefaults(
  savedDefaults: unknown,
): FiveThreeOneDefaults {
  const saved = isRecord(savedDefaults) ? savedDefaults : {};

  return {
    roundingIncrement: isPositiveFiniteNumber(saved.roundingIncrement)
      ? saved.roundingIncrement
      : DEFAULT_FIVE_THREE_ONE_DEFAULTS.roundingIncrement,
    roundingDirection: isRoundingDirection(saved.roundingDirection)
      ? saved.roundingDirection
      : DEFAULT_FIVE_THREE_ONE_DEFAULTS.roundingDirection,
    tmPercentage: isTmPercentage(saved.tmPercentage)
      ? saved.tmPercentage
      : DEFAULT_FIVE_THREE_ONE_DEFAULTS.tmPercentage,
    includeDeload:
      typeof saved.includeDeload === 'boolean'
        ? saved.includeDeload
        : DEFAULT_FIVE_THREE_ONE_DEFAULTS.includeDeload,
    upperTmIncrement: isPositiveFiniteNumber(saved.upperTmIncrement)
      ? saved.upperTmIncrement
      : DEFAULT_FIVE_THREE_ONE_DEFAULTS.upperTmIncrement,
    lowerTmIncrement: isPositiveFiniteNumber(saved.lowerTmIncrement)
      ? saved.lowerTmIncrement
      : DEFAULT_FIVE_THREE_ONE_DEFAULTS.lowerTmIncrement,
    warmupEnabled:
      typeof saved.warmupEnabled === 'boolean'
        ? saved.warmupEnabled
        : DEFAULT_FIVE_THREE_ONE_DEFAULTS.warmupEnabled,
  };
}

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
