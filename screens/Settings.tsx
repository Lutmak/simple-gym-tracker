import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../context/ThemeContext';
import { Field } from '../components/Field';
import { Row } from '../components/Row';
import { Screen } from '../components/Screen';
import { Section } from '../components/Section';
import { SegmentedControl } from '../components/SegmentedControl';
import { Switch } from '../components/Switch';
import { fontSize, spacing, tabBar } from '../utils/scale';
import {
  applyTrainingDayReminders,
  cancelAllReminders,
  requestNotificationPermissions,
} from '../utils/notificationUtils';
import {
  WEEKDAY_LABEL_KEYS,
  loadActiveRoutineTrainingDays,
  notificationSchedule,
  pruneDayTimes,
  setDayTime,
  type ActiveRoutineDays,
} from '../utils/notificationSchedule';
import { replaceDatabaseFile } from '../utils/databaseImport';
import { DatabaseImportValidationError } from '../utils/databaseSchema';
import { loadDemoData, removeDemoData, type DemoDatabase } from '../utils/demoData';
import type { BarProfileKey } from '../utils/barProfiles';
import {
  ImagePackValidationError,
  IMAGE_PACK_RELEASE_PUBLISHED,
  IMAGE_PACK_RELEASE_URL,
  imagePackFlowCopy,
  installImagePackFromUri,
} from '../utils/imagePackInstaller';
import {
  LANGUAGE_OPTIONS,
  WEIGHT_FORMAT_OPTIONS,
  barProfileOptions,
  dateFormatOptions,
  firstWeekdayOptions,
  formatTimeOfDay,
  roundingIncrementOptions,
  routineUnitFor,
  timeFormatOptions,
  type SettingOption,
} from '../utils/settingsOptions';

const ISSUES_URL = 'https://github.com/Lutmak/simple-gym-tracker/issues';
const REPOSITORY_URL = 'https://github.com/Lutmak/simple-gym-tracker';

const IMAGE_PACK_PICKER_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
];

const imagePackErrorMessageKey = (reason: ImagePackValidationError['reason']): string => {
  switch (reason) {
    case 'too-large':
      return 'imagePackTooLarge';
    case 'unknown-exercise':
    case 'foreign-file':
      return 'imagePackForeign';
    default:
      return 'imagePackInvalid';
  }
};

export default function Settings() {
  const {
    dateFormat,
    setDateFormat,
    timeFormat,
    setTimeFormat,
    weightFormat,
    setWeightFormat,
    roundingIncrement,
    setRoundingIncrement,
    barProfile,
    setBarProfile,
    firstWeekday,
    setFirstWeekday,
    language,
    setLanguage,
    notificationPermissionGranted,
    setNotificationPermissionGranted,
    notificationTime,
    setNotificationTime,
    notificationDayTimes,
    setNotificationDayTimes,
  } = useSettings();
  const { theme, tokens, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const db = useSQLiteContext();

  /**
   * Which time row the picker is editing: the global default, or one weekday.
   * One picker serves both, because they set the same kind of value and a
   * second picker would be a second idiom for one decision.
   */
  const [editingTime, setEditingTime] = useState<'default' | number | null>(null);
  const [routineDays, setRoutineDays] = useState<ActiveRoutineDays | null>(null);

  const unit = routineUnitFor(weightFormat);
  const imagePackCopy = imagePackFlowCopy(IMAGE_PACK_RELEASE_PUBLISHED);

  // The one place an option descriptor becomes words. Everything about WHICH options exist and
  // what they are called lives in utils/settingsOptions.ts; this screen only translates.
  const segments = <T extends string>(
    options: readonly SettingOption<T>[],
  ): { value: T; label: string }[] =>
    options.map((option) => ({
      value: option.value,
      label: t(option.labelKey, option.labelParams),
    }));

  const demoDb: DemoDatabase = {
    run: (sql, params) => db.runAsync(sql, (params ?? []) as never[]),
    get: async (sql, params) =>
      (await db.getFirstAsync<Record<string, unknown>>(
        sql,
        (params ?? []) as never[],
      )) ?? undefined,
  };

  const routineDb = {
    run: (sql: string, params?: readonly unknown[]) =>
      db.runAsync(sql, (params ?? []) as never[]),
    get: async (sql: string, params?: readonly unknown[]) =>
      (await db.getFirstAsync<Record<string, unknown>>(
        sql,
        (params ?? []) as never[],
      )) ?? undefined,
    getAll: async (sql: string, params?: readonly unknown[]) =>
      db.getAllAsync<Record<string, unknown>>(sql, (params ?? []) as never[]),
  };

  const handleLoadDemoData = async () => {
    try {
      await loadDemoData(demoDb);
      Alert.alert(t('demoDataTitle'), t('demoDataLoaded'));
    } catch (error) {
      console.error('Error loading demo data:', error);
      Alert.alert(t('demoDataTitle'), t('demoDataLoadFailed'));
    }
  };

  const handleRemoveDemoData = () => {
    Alert.alert(
      t('removeDemoData'),
      t('removeDemoDataConfirm'),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('confirm'),
          onPress: async () => {
            try {
              await removeDemoData(demoDb);
              Alert.alert(t('demoDataTitle'), t('demoDataRemoved'));
            } catch (error) {
              console.error('Error removing demo data:', error);
              Alert.alert(t('demoDataTitle'), t('demoDataRemoveFailed'));
            }
          },
        },
      ],
      { cancelable: true },
    );
  };

  /**
   * The active routine owns the reminder list (§3.8), so it is re-read on every
   * focus: activating a routine on the Rutinas tab must change what this screen
   * offers to remind the user about, without a restart.
   */
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadActiveRoutineTrainingDays(routineDb)
        .then((loaded) => {
          if (!cancelled) {
            setRoutineDays(loaded);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setRoutineDays(null);
          }
        });
      return () => {
        cancelled = true;
      };
      // routineDb is rebuilt each render from the one stable SQLite context.
    }, [db]),
  );

  const schedule = notificationSchedule({
    enabled: notificationPermissionGranted,
    defaultTime: notificationTime,
    dayTimes: notificationDayTimes,
    trainingDays: routineDays?.days ?? [],
    weekStartsOn: firstWeekday === 'Sunday' ? 0 : 1,
  });

  /**
   * One writer for the OS schedule. Every change — the toggle, the default
   * time, a per-day time, a routine that now trains different days — ends here,
   * so the device can never hold a reminder the screen does not show.
   */
  const applySchedule = async (reminders: typeof schedule.reminders) => {
    try {
      await applyTrainingDayReminders(reminders);
    } catch (error) {
      console.error('Error applying reminders:', error);
    }
  };

  const handleNotificationToggle = async (value: boolean) => {
    if (value) {
      const granted = await requestNotificationPermissions();
      setNotificationPermissionGranted(granted);
      if (granted) {
        await applySchedule(schedule.days);
      }
      return;
    }
    Alert.alert(
      t('notificationsDisableTitle'),
      t('notificationsDisableMessage'),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('confirm'),
          onPress: async () => {
            await cancelAllReminders();
            setNotificationPermissionGranted(false);
          },
        },
      ],
      { cancelable: true },
    );
  };

  const handleTimeChange = (
    event: DateTimePickerEvent,
    selectedTime?: Date,
  ) => {
    const target = editingTime;
    setEditingTime(Platform.OS === 'ios' ? target : null);
    if (!selectedTime || target === null) {
      return;
    }
    const time = `${String(selectedTime.getHours()).padStart(2, '0')}:${String(
      selectedTime.getMinutes(),
    ).padStart(2, '0')}`;

    if (target === 'default') {
      setNotificationTime(time);
      if (notificationPermissionGranted) {
        void applySchedule(
          notificationSchedule({
            enabled: true,
            defaultTime: time,
            dayTimes: notificationDayTimes,
            trainingDays: routineDays?.days ?? [],
            weekStartsOn: firstWeekday === 'Sunday' ? 0 : 1,
          }).reminders,
        );
      }
      return;
    }

    // A day that agrees with the default stores no override, so moving the
    // default later still moves every day that never disagreed with it.
    const nextDayTimes = setDayTime(
      notificationDayTimes,
      target,
      time,
      notificationTime,
    );
    setNotificationDayTimes(nextDayTimes);
    if (notificationPermissionGranted) {
      void applySchedule(
        notificationSchedule({
          enabled: true,
          defaultTime: notificationTime,
          dayTimes: nextDayTimes,
          trainingDays: routineDays?.days ?? [],
          weekStartsOn: firstWeekday === 'Sunday' ? 0 : 1,
        }).reminders,
      );
    }
  };

  /**
   * A routine the user edited or replaced can leave overrides behind for days
   * it no longer trains. Dropping them here keeps the stored map equal to what
   * the screen lists — "changing routine updates the list", in storage.
   */
  useEffect(() => {
    if (routineDays === null) {
      return;
    }
    const pruned = pruneDayTimes(notificationDayTimes, routineDays.days);
    if (pruned !== notificationDayTimes) {
      setNotificationDayTimes(pruned);
    }
  }, [routineDays]);

  const timePickerValue = (): Date => {
    const source =
      editingTime === null || editingTime === 'default'
        ? notificationTime
        : (schedule.days.find((day) => day.weekday === editingTime)?.time ??
          notificationTime);
    const [hours, minutes] = source.split(':').map(Number);
    const date = new Date();
    date.setHours(hours ?? 0, minutes ?? 0, 0, 0);
    return date;
  };

  const exportDatabase = async () => {
    try {
      const dbName = 'SimpleDB.db';
      const dbFilePath = `${FileSystem.documentDirectory}SQLite/${dbName}`;

      const fileInfo = await FileSystem.getInfoAsync(dbFilePath);

      if (!fileInfo.exists) {
        Alert.alert(t('exportFailedTitle'), t('databaseNotFound'), [
          { text: t('ok') },
        ]);
        return;
      }

      const today = new Date();
      const day = String(today.getDate()).padStart(2, '0');
      const month = String(today.getMonth() + 1).padStart(2, '0'); // Month is 0-indexed
      const year = today.getFullYear();

      const formattedDate =
        dateFormat === 'dd-mm-yyyy'
          ? `${day}-${month}-${year}`
          : `${month}-${day}-${year}`;

      const exportDbName = `SimpleDB-${formattedDate}.db`;

      const tempExportPath = `${FileSystem.cacheDirectory}${exportDbName}`;
      await FileSystem.copyAsync({
        from: dbFilePath,
        to: tempExportPath,
      });

      const isAvailable = await Sharing.isAvailableAsync();

      if (!isAvailable) {
        Alert.alert(t('exportFailedTitle'), t('sharingNotAvailable'), [
          { text: t('ok') },
        ]);
        return;
      }

      await Sharing.shareAsync(tempExportPath, {
        mimeType: 'application/x-sqlite3', // Standard MIME type
        dialogTitle: t('exportDatabaseTitle'),
        UTI: 'public.database',
      });
    } catch (error) {
      console.error('Error exporting database:', error);
      Alert.alert(t('exportFailedTitle'), t('exportErrorMessage'), [
        { text: t('ok') },
      ]);
    }
  };

  const importDatabase = () => {
    Alert.alert(
      t('importConfirmTitle'),
      t('importConfirmMessage'),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('confirm'),
          onPress: async () => {
            const dbName = 'SimpleDB.db';
            const dbDirectory = `${FileSystem.documentDirectory}SQLite/`;
            const dbFilePath = `${dbDirectory}${dbName}`;

            let documentPickerResult;
            try {
              documentPickerResult = await DocumentPicker.getDocumentAsync({
                type: [
                  'application/x-sqlite3',
                  'application/octet-stream',
                  'application/vnd.sqlite3',
                ],
                copyToCacheDirectory: true,
              });

              if (
                documentPickerResult.canceled ||
                !documentPickerResult.assets ||
                documentPickerResult.assets.length === 0 ||
                !documentPickerResult.assets[0].uri
              ) {
                Alert.alert(t('importFailedTitle'), t('fileNotSelectedError'));
                return;
              }
            } catch (pickerError) {
              console.error('DocumentPicker error:', pickerError);
              Alert.alert(t('importFailedTitle'), t('filePickerError'));
              return;
            }

            const sourceUri = documentPickerResult.assets[0].uri;

            try {
              await replaceDatabaseFile(sourceUri, dbFilePath);

              Alert.alert(t('importSuccessTitle'), t('importSuccessMessage'), [
                { text: t('ok') },
              ]);
            } catch (error) {
              console.error('Error during database replacement:', error);
              const finalAlertMessage =
                error instanceof DatabaseImportValidationError
                  ? error.message
                  : error instanceof Error
                    ? error.message
                    : t('importErrorMessageDefault');

              Alert.alert(t('importFailedTitle'), finalAlertMessage, [
                { text: t('ok') },
              ]);
            }
          },
        },
      ],
      { cancelable: true },
    );
  };

  const downloadImagePack = () => {
    Linking.openURL(IMAGE_PACK_RELEASE_URL);
  };

  const installImagePack = async () => {
    let documentPickerResult;
    try {
      documentPickerResult = await DocumentPicker.getDocumentAsync({
        type: IMAGE_PACK_PICKER_TYPES,
        copyToCacheDirectory: true,
      });

      if (
        documentPickerResult.canceled ||
        !documentPickerResult.assets ||
        documentPickerResult.assets.length === 0 ||
        !documentPickerResult.assets[0].uri
      ) {
        return;
      }
    } catch (pickerError) {
      console.error('DocumentPicker error:', pickerError);
      Alert.alert(t('imagePackInstallFailed'), t('filePickerError'));
      return;
    }

    try {
      const catalogRows = await db.getAllAsync<{ exercise_key: string }>(
        'SELECT exercise_key FROM Catalog_Exercises;',
      );
      const knownKeys = new Set(catalogRows.map((row) => row.exercise_key));
      const installed = await installImagePackFromUri(
        documentPickerResult.assets[0].uri,
        knownKeys,
      );
      Alert.alert(
        t('imagePackInstalled'),
        t('imagePackInstalledMessage', { count: installed }),
      );
    } catch (error) {
      console.error('Error installing image pack:', error);
      const finalAlertMessage =
        error instanceof ImagePackValidationError
          ? t(imagePackErrorMessageKey(error.reason))
          : t('imagePackInstallError');
      Alert.alert(t('imagePackInstallFailed'), finalAlertMessage);
    }
  };

  const chevron = (
    <Ionicons name="chevron-forward" size={tabBar.icon} color={tokens.textSecondary} />
  );

  return (
    <Screen scroll testID="settings-screen">
      <Text style={[styles.title, { color: tokens.textPrimary }]}>{t('settingsTitle')}</Text>

      <Section title={t('settingsAppearance')} testID="settings-appearance">
        <Row
          label={t('settingsDarkMode')}
          right={
            <Switch
              value={theme.type === 'dark'}
              onValueChange={toggleTheme}
              testID="settings-dark-mode"
            />
          }
          divided
        />
        <Field label={t('settingsLanguage')}>
          <SegmentedControl
            options={segments(LANGUAGE_OPTIONS)}
            value={language}
            onChange={setLanguage}
            testID="settings-language"
          />
        </Field>
      </Section>

      <Section title={t('settingsGroupUnits')} testID="settings-units">
        <View>
          <Field label={t('settingsWeightUnit')} hint={t('settingsWeightUnitHint')}>
            <SegmentedControl
              options={segments(WEIGHT_FORMAT_OPTIONS)}
              value={weightFormat}
              onChange={setWeightFormat}
              testID="settings-weight-unit"
            />
          </Field>
          <Field
            label={t('settingsRoundingIncrement')}
            hint={t('settingsRoundingIncrementHint')}
          >
            <SegmentedControl
              options={segments(roundingIncrementOptions(unit))}
              value={String(roundingIncrement)}
              onChange={(value) => setRoundingIncrement(Number(value))}
              testID="settings-rounding-increment"
            />
          </Field>
          <Field label={t('settingsBarProfile')} hint={t('settingsBarProfileHint')}>
            <SegmentedControl<BarProfileKey>
              options={segments(barProfileOptions(unit))}
              value={barProfile}
              onChange={setBarProfile}
              wrap
              testID="settings-bar-profile"
            />
          </Field>
          <Field label={t('settingsDateFormat')} hint={t('settingsDateFormatHint')}>
            <SegmentedControl
              options={segments(dateFormatOptions())}
              value={dateFormat}
              onChange={setDateFormat}
              testID="settings-date-format"
            />
          </Field>
          <Field label={t('settingsTimeFormat')} hint={t('settingsTimeFormatHint')}>
            <SegmentedControl
              options={segments(timeFormatOptions())}
              value={timeFormat}
              onChange={setTimeFormat}
              testID="settings-time-format"
            />
          </Field>
          <Field label={t('settingsFirstWeekday')} hint={t('settingsFirstWeekdayHint')}>
            <SegmentedControl
              options={segments(firstWeekdayOptions())}
              value={firstWeekday}
              onChange={setFirstWeekday}
              testID="settings-first-weekday"
            />
          </Field>
        </View>
      </Section>

      <Section title={t('notifications')} testID="settings-notifications">
        <Row
          label={t('remindScheduledWorkouts')}
          right={
            <Switch
              value={notificationPermissionGranted}
              onValueChange={handleNotificationToggle}
              testID="settings-notifications-toggle"
            />
          }
          divided={notificationPermissionGranted}
        />
        {notificationPermissionGranted && (
          <>
            <Row
              label={t('notificationTime')}
              detail={formatTimeOfDay(notificationTime, timeFormat)}
              right={chevron}
              onPress={() => setEditingTime('default')}
              divided={schedule.days.length > 0}
              testID="settings-notification-time"
            />
            {/*
              The active routine's own training days, each able to disagree with
              the default. A routine that trains nothing, or no routine at all,
              says so in one line instead of leaving a reminder with no owner.
            */}
            {routineDays === null ? (
              <Row label={t('notificationsNoRoutine')} />
            ) : schedule.days.length === 0 ? (
              <Row label={t('notificationsNoTrainingDays')} />
            ) : (
              schedule.days.map((day, index) => (
                <Row
                  key={day.weekday}
                  label={t(WEEKDAY_LABEL_KEYS[day.weekday] ?? 'weekdayFullMon')}
                  detail={`${day.sessionName} · ${formatTimeOfDay(day.time, timeFormat)}${
                    day.custom ? ` · ${t('notificationsCustomTime')}` : ''
                  }`}
                  right={chevron}
                  onPress={() => setEditingTime(day.weekday)}
                  divided={index < schedule.days.length - 1}
                  testID={`settings-notification-day-${day.weekday}`}
                />
              ))
            )}
          </>
        )}
        {editingTime !== null && (
          <DateTimePicker
            value={timePickerValue()}
            mode="time"
            is24Hour={timeFormat === '24h'}
            display="default"
            onChange={handleTimeChange}
          />
        )}
      </Section>

      <Section title={t('dataManagement')} testID="settings-data">
        <Row
          label={t('exportDatabase')}
          right={chevron}
          onPress={exportDatabase}
          divided
          testID="settings-export"
        />
        <Row
          label={t('restoreFromBackup')}
          right={chevron}
          onPress={importDatabase}
          divided
          testID="settings-import"
        />
        <Row
          label={t('loadDemoData')}
          onPress={handleLoadDemoData}
          divided
          testID="settings-load-demo"
        />
        <Row
          label={t('removeDemoData')}
          detail={t('removeDemoDataConfirm')}
          detailBelow
          onPress={handleRemoveDemoData}
          divided
          testID="settings-remove-demo"
        />
        <Row
          label={t('downloadImagePack')}
          detail={t(imagePackCopy.downloadHintKey)}
          detailBelow
          right={chevron}
          onPress={downloadImagePack}
          divided
          testID="settings-download-image-pack"
        />
        <Row
          label={t('installImagePack')}
          detail={t(imagePackCopy.installHintKey)}
          detailBelow
          right={chevron}
          onPress={installImagePack}
          testID="settings-install-image-pack"
        />
      </Section>

      <Section title={t('settingsAbout')} testID="settings-about">
        <Row
          label={t('reportIssue')}
          right={chevron}
          onPress={() => Linking.openURL(ISSUES_URL)}
          divided
          testID="settings-report-issue"
        />
        <Row
          label={t('GitHub')}
          right={chevron}
          onPress={() => Linking.openURL(REPOSITORY_URL)}
          testID="settings-github"
        />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize.screenTitle,
    fontWeight: '700',
    marginBottom: spacing.section,
  },
});
