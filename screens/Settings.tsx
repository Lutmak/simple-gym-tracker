import React, { useState } from 'react';
import { Alert, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
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
import { useNotifications } from '../utils/useNotifications';
import { replaceDatabaseFile } from '../utils/databaseImport';
import { DatabaseImportValidationError } from '../utils/databaseSchema';
import { loadDemoData, removeDemoData, type DemoDatabase } from '../utils/demoData';
import type { BarProfileKey } from '../utils/barProfiles';
import {
  ImagePackValidationError,
  IMAGE_PACK_RELEASE_URL,
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
  } = useSettings();
  const { theme, tokens, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const db = useSQLiteContext();
  const {
    requestNotificationPermission,
    cancelAllNotifications,
    scheduleDailyReminder,
  } = useNotifications();

  const [showTimePicker, setShowTimePicker] = useState(false);

  const unit = routineUnitFor(weightFormat);

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

  const handleNotificationToggle = async (value: boolean) => {
    if (value) {
      const granted = await requestNotificationPermission();
      setNotificationPermissionGranted(granted);
      if (granted) {
        await scheduleDailyReminder(notificationTime);
      }
    } else {
      Alert.alert(
        t('notificationsDisableTitle'),
        t('notificationsDisableMessage'),
        [
          { text: t('Cancel'), style: 'cancel' },
          {
            text: t('confirm'),
            onPress: async () => {
              await cancelAllNotifications();
              setNotificationPermissionGranted(false);
            },
          },
        ],
        { cancelable: true },
      );
    }
  };

  const handleNotificationTimeChange = (
    event: DateTimePickerEvent,
    selectedTime?: Date,
  ) => {
    setShowTimePicker(Platform.OS === 'ios');
    if (selectedTime) {
      const time = `${String(selectedTime.getHours()).padStart(2, '0')}:${String(
        selectedTime.getMinutes(),
      ).padStart(2, '0')}`;
      setNotificationTime(time);
      if (notificationPermissionGranted) {
        void cancelAllNotifications().then(() => scheduleDailyReminder(time));
      }
    }
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
          <Row
            label={t('notificationTime')}
            detail={formatTimeOfDay(notificationTime, timeFormat)}
            right={chevron}
            onPress={() => setShowTimePicker(true)}
            testID="settings-notification-time"
          />
        )}
        {showTimePicker && (
          <DateTimePicker
            value={(() => {
              const [hours, minutes] = notificationTime.split(':').map(Number);
              const date = new Date();
              date.setHours(hours, minutes, 0, 0);
              return date;
            })()}
            mode="time"
            is24Hour={timeFormat === '24h'}
            display="default"
            onChange={handleNotificationTimeChange}
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
          detail={t('imagePackDownloadHint')}
          detailBelow
          right={chevron}
          onPress={downloadImagePack}
          divided
          testID="settings-download-image-pack"
        />
        <Row
          label={t('installImagePack')}
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
