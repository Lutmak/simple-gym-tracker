import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react';
import {
  DEFAULT_FIVE_THREE_ONE_DEFAULTS,
  loadSettings,
  mergeFiveThreeOneDefaults,
  saveSettings,
  type FiveThreeOneDefaults,
} from '../utils/settingsStorage';
import i18n from '../utils/i18n';
import * as Localization from 'expo-localization';
import { requestNotificationPermissions } from '../utils/notificationUtils';

// Helper to get device's preferred time format
const getDeviceTimeFormat = (): '24h' | 'AM/PM' => {
  const locale = Localization.getLocales()[0];
  if (locale?.regionCode === 'US') {
    return 'AM/PM';
  }
  return '24h';
};

// NEW HELPER: Get device's preferred date format based on region
const getDeviceDateFormat = (): 'mm-dd-yyyy' | 'dd-mm-yyyy' => {
  const locale = Localization.getLocales()[0];
  // US & Canada are primary regions using MM-DD-YYYY
  if (locale?.regionCode === 'US' || locale?.regionCode === 'CA') {
    return 'mm-dd-yyyy';
  }
  // Default to DD-MM-YYYY for most other regions
  return 'dd-mm-yyyy';
};

// NEW HELPER: Get device's preferred measurement system for weight
const getDeviceWeightFormat = (): 'lbs' | 'kg' => {
  const locale = Localization.getLocales()[0];
  // 'imperial' is used in regions like the US
  if (locale?.measurementSystem === 'us') {
    return 'lbs';
  }
  // Default to 'metric' (kg)
  return 'kg';
};

// NEW HELPER: Get device's first day of the week based on region
const getDeviceFirstWeekday = (): 'Sunday' | 'Monday' => {
  const locale = Localization.getLocales()[0];
  const sundayFirstRegions = ['JP', 'US', 'CA', 'BR', 'KR'];
  if (
    locale?.regionCode &&
    sundayFirstRegions.includes(locale.regionCode.toUpperCase())
  ) {
    return 'Sunday';
  }
  return 'Monday';
};

// 1) Create the type for your context values:
type SettingsContextType = {
  language: string;
  setLanguage: (lang: string) => void;
  dateFormat: string;
  setDateFormat: (fmt: string) => void;
  timeFormat: '24h' | 'AM/PM';
  setTimeFormat: (fmt: '24h' | 'AM/PM') => void;
  weightFormat: string;
  setWeightFormat: (fmt: string) => void;
  firstWeekday: 'Sunday' | 'Monday';
  setFirstWeekday: (day: 'Sunday' | 'Monday') => void;
  notificationPermissionGranted: boolean;
  setNotificationPermissionGranted: (granted: boolean) => void;
  requestNotificationPermission: () => Promise<boolean>;
  fiveThreeOneDefaults: FiveThreeOneDefaults;
  setFiveThreeOneDefaults: (defaults: FiveThreeOneDefaults) => void;
};

// 2) Declare the actual context:
const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined,
);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [isInitialized, setIsInitialized] = useState(false);

  const [language, setLanguage] = useState('en');
  const [dateFormat, setDateFormat] = useState('dd-mm-yyyy');
  const [timeFormat, setTimeFormat] = useState<'24h' | 'AM/PM'>('24h');
  const [weightFormat, setWeightFormat] = useState('kg');
  const [firstWeekday, setFirstWeekday] = useState<'Sunday' | 'Monday'>(
    'Monday',
  );
  const [notificationPermissionGranted, setNotificationPermissionGranted] =
    useState(false);
  const [fiveThreeOneDefaults, setFiveThreeOneDefaults] =
    useState<FiveThreeOneDefaults>(() => ({ ...DEFAULT_FIVE_THREE_ONE_DEFAULTS }));

  // Function to request notification permission
  const requestNotificationPermission = async (): Promise<boolean> => {
    const granted = await requestNotificationPermissions();
    setNotificationPermissionGranted(granted);
    return granted;
  };

  // Load settings on mount
  useEffect(() => {
    const initializeSettings = async () => {
      const savedSettings = await loadSettings();
      // MODIFIED: Get all device formats at once
      const deviceTimeFormat = getDeviceTimeFormat();
      const deviceDateFormat = getDeviceDateFormat();
      const deviceWeightFormat = getDeviceWeightFormat();
      const deviceFirstWeekday = getDeviceFirstWeekday();

      if (savedSettings) {
        setLanguage(savedSettings.language || 'en');
        const savedDateFormat =
          savedSettings.dateFormat === 'mm-dd-yyyy' ||
          savedSettings.dateFormat === 'dd-mm-yyyy'
            ? savedSettings.dateFormat
            : deviceDateFormat;
        const savedWeightFormat =
          savedSettings.weightFormat === 'lbs' ||
          savedSettings.weightFormat === 'kg'
            ? savedSettings.weightFormat
            : deviceWeightFormat;
        const savedFirstWeekday =
          savedSettings.firstWeekday === 'Sunday' ||
          savedSettings.firstWeekday === 'Monday'
            ? savedSettings.firstWeekday
            : deviceFirstWeekday;
        const savedTimeFormat =
          savedSettings.timeFormat === '24-Hour'
            ? '24h'
            : savedSettings.timeFormat === '24h' ||
                savedSettings.timeFormat === 'AM/PM'
              ? savedSettings.timeFormat
              : deviceTimeFormat;

        setDateFormat(savedDateFormat);
        setWeightFormat(savedWeightFormat);
        setFirstWeekday(savedFirstWeekday);
        setTimeFormat(savedTimeFormat);

        setNotificationPermissionGranted(
          Boolean(savedSettings.notificationPermissionGranted),
        );
        setFiveThreeOneDefaults(
          mergeFiveThreeOneDefaults(savedSettings.fiveThreeOneDefaults),
        );
      } else {
        const fallbackLng = 'en';
        const defaultLocale =
          Localization.getLocales()[0]?.languageCode || fallbackLng;
        setLanguage(defaultLocale);
        setTimeFormat(deviceTimeFormat);
        // ADDED: Initialize state based on device format
        setDateFormat(deviceDateFormat);
        setWeightFormat(deviceWeightFormat);
        setFirstWeekday(deviceFirstWeekday);
        setFiveThreeOneDefaults({ ...DEFAULT_FIVE_THREE_ONE_DEFAULTS });
      }
      setIsInitialized(true);
    };
    initializeSettings();
  }, []);

  // Keep i18n in sync with context
  useEffect(() => {
    i18n.changeLanguage(language);
  }, [language]);

  // Save settings only after initial load
  useEffect(() => {
    if (!isInitialized) return;
    const persistSettings = async () => {
      await saveSettings({
        language,
        dateFormat,
        timeFormat,
        weightFormat,
        firstWeekday,
        notificationPermissionGranted,
        fiveThreeOneDefaults,
      });
    };
    persistSettings();
  }, [
    language,
    dateFormat,
    timeFormat,
    weightFormat,
    firstWeekday,
    notificationPermissionGranted,
    fiveThreeOneDefaults,
    isInitialized,
  ]);

  return (
    <SettingsContext.Provider
      value={{
        language,
        setLanguage,
        dateFormat,
        setDateFormat,
        timeFormat,
        setTimeFormat,
        weightFormat,
        setWeightFormat,
        firstWeekday,
        setFirstWeekday,
        notificationPermissionGranted,
        setNotificationPermissionGranted,
        requestNotificationPermission,
        fiveThreeOneDefaults,
        setFiveThreeOneDefaults,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

// Export a custom hook so consumers can read from our SettingsContext
export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
