import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react';
import { loadSettings, saveSettings } from '../utils/settingsStorage';
import i18n, { SUPPORTED_LOCALES } from '../utils/i18n';
import * as Localization from 'expo-localization';
import { requestNotificationPermissions } from '../utils/notificationUtils';
import {
  DEFAULT_NOTIFICATION_TIME,
  isTimeOfDay,
  resolveDayTimes,
  type DayTimes,
} from '../utils/notificationSchedule';
import {
  resolveBarProfile,
  resolveRoundingIncrement,
  roundingIncrementOnUnitChange,
  routineUnitFor,
  type DateFormat,
  type FirstWeekday,
  type TimeFormat,
  type WeightFormat,
} from '../utils/settingsOptions';
import type { BarProfileKey } from '../utils/barProfiles';

// Helper to get device's preferred time format
const getDeviceTimeFormat = (): TimeFormat => {
  const locale = Localization.getLocales()[0];
  if (locale?.regionCode === 'US') {
    return 'AM/PM';
  }
  return '24h';
};

// NEW HELPER: Get device's preferred date format based on region
const getDeviceDateFormat = (): DateFormat => {
  const locale = Localization.getLocales()[0];
  // US & Canada are primary regions using MM-DD-YYYY
  if (locale?.regionCode === 'US' || locale?.regionCode === 'CA') {
    return 'mm-dd-yyyy';
  }
  // Default to DD-MM-YYYY for most other regions
  return 'dd-mm-yyyy';
};

// NEW HELPER: Get device's preferred measurement system for weight
const getDeviceWeightFormat = (): WeightFormat => {
  const locale = Localization.getLocales()[0];
  // 'imperial' is used in regions like the US
  if (locale?.measurementSystem === 'us') {
    return 'lbs';
  }
  // Default to 'metric' (kg)
  return 'kg';
};

// NEW HELPER: Get device's first day of the week based on region
const getDeviceFirstWeekday = (): FirstWeekday => {
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
  dateFormat: DateFormat;
  setDateFormat: (fmt: DateFormat) => void;
  timeFormat: TimeFormat;
  setTimeFormat: (fmt: TimeFormat) => void;
  /** The unit new routines start in. Changing it converts nothing (S2). */
  weightFormat: WeightFormat;
  setWeightFormat: (fmt: WeightFormat) => void;
  /** The step new routines adjust a load by. Changing it converts nothing (S2). */
  roundingIncrement: number;
  setRoundingIncrement: (increment: number) => void;
  /** The bar new barbell exercises assume. Changing it rewrites nothing (S2). */
  barProfile: BarProfileKey;
  setBarProfile: (profile: BarProfileKey) => void;
  firstWeekday: FirstWeekday;
  setFirstWeekday: (day: FirstWeekday) => void;
  notificationPermissionGranted: boolean;
  setNotificationPermissionGranted: (granted: boolean) => void;
  notificationTime: string;
  setNotificationTime: (time: string) => void;
  /**
   * Per-weekday reminder overrides (S3), keyed on the weekday rather than on a
   * session: "I train Monday mornings" survives editing a routine or activating
   * a different one, where a `session_id` would not. A weekday absent from the
   * map simply follows `notificationTime`.
   */
  notificationDayTimes: DayTimes;
  setNotificationDayTimes: (dayTimes: DayTimes) => void;
  requestNotificationPermission: () => Promise<boolean>;
};

// 2) Declare the actual context:
const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined,
);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [isInitialized, setIsInitialized] = useState(false);

  const [language, setLanguage] = useState('en');
  const [dateFormat, setDateFormat] = useState<DateFormat>('dd-mm-yyyy');
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('24h');
  const [weightFormat, setWeightFormat] = useState<WeightFormat>('kg');
  const [roundingIncrement, setRoundingIncrement] = useState(
    resolveRoundingIncrement(undefined, 'kg'),
  );
  const [barProfile, setBarProfile] = useState<BarProfileKey>(
    resolveBarProfile(undefined),
  );
  const [firstWeekday, setFirstWeekday] = useState<FirstWeekday>('Monday');
  const [notificationPermissionGranted, setNotificationPermissionGranted] =
    useState(false);
  const [notificationTime, setNotificationTime] = useState(
    DEFAULT_NOTIFICATION_TIME,
  );
  const [notificationDayTimes, setNotificationDayTimes] = useState<DayTimes>(
    resolveDayTimes(undefined),
  );

  // Changing the default unit carries the default increment with it: 2.5 kg and 5 lb are the
  // same decision expressed twice, and leaving 2.5 behind on a lb routine would silently halve
  // the step. Nothing already created is touched — this is the default for the NEXT routine.
  const changeWeightFormat = (next: WeightFormat) => {
    setRoundingIncrement((current) =>
      roundingIncrementOnUnitChange(
        current,
        routineUnitFor(weightFormat),
        routineUnitFor(next),
      ),
    );
    setWeightFormat(next);
  };

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
        const savedLanguage = savedSettings.language || 'en';
        setLanguage(
          SUPPORTED_LOCALES.includes(savedLanguage) ? savedLanguage : 'en',
        );
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
        setRoundingIncrement(
          resolveRoundingIncrement(
            savedSettings.roundingIncrement,
            routineUnitFor(savedWeightFormat),
          ),
        );
        setBarProfile(resolveBarProfile(savedSettings.barProfile));
        setFirstWeekday(savedFirstWeekday);
        setTimeFormat(savedTimeFormat);

        setNotificationPermissionGranted(
          Boolean(savedSettings.notificationPermissionGranted),
        );
        setNotificationTime(
          isTimeOfDay(savedSettings.notificationTime)
            ? savedSettings.notificationTime
            : DEFAULT_NOTIFICATION_TIME,
        );
        setNotificationDayTimes(resolveDayTimes(savedSettings.notificationDayTimes));
      } else {
        const deviceLocale =
          Localization.getLocales()[0]?.languageCode || 'en';
        setLanguage(
          SUPPORTED_LOCALES.includes(deviceLocale) ? deviceLocale : 'en',
        );
        setTimeFormat(deviceTimeFormat);
        // ADDED: Initialize state based on device format
        setDateFormat(deviceDateFormat);
        setWeightFormat(deviceWeightFormat);
        // A fresh install has no stored defaults: the increment follows the device's unit and
        // the bar is the olympic one, so nothing below ever reads an undefined default.
        setRoundingIncrement(
          resolveRoundingIncrement(undefined, routineUnitFor(deviceWeightFormat)),
        );
        setBarProfile(resolveBarProfile(undefined));
        setFirstWeekday(deviceFirstWeekday);
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
        roundingIncrement,
        barProfile,
        firstWeekday,
        notificationPermissionGranted,
        notificationTime,
        notificationDayTimes,
      });
    };
    persistSettings();
  }, [
    language,
    dateFormat,
    timeFormat,
    weightFormat,
    roundingIncrement,
    barProfile,
    firstWeekday,
    notificationPermissionGranted,
    notificationTime,
    notificationDayTimes,
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
        setWeightFormat: changeWeightFormat,
        roundingIncrement,
        setRoundingIncrement,
        barProfile,
        setBarProfile,
        firstWeekday,
        setFirstWeekday,
        notificationPermissionGranted,
        setNotificationPermissionGranted,
        notificationTime,
        setNotificationTime,
        notificationDayTimes,
        setNotificationDayTimes,
        requestNotificationPermission,
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
