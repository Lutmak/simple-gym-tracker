import React, { useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
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
import { fontSize, radius, spacing } from '../utils/scale';
import { useNotifications } from '../utils/useNotifications';
import { replaceDatabaseFile } from '../utils/databaseImport';
import { DatabaseImportValidationError } from '../utils/databaseSchema';
import { loadDemoData, removeDemoData, type DemoDatabase } from '../utils/demoData';
import {
  ImagePackValidationError,
  IMAGE_PACK_RELEASE_URL,
  installImagePackFromUri,
} from '../utils/imagePackInstaller';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
] as const;

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
    firstWeekday,
    setFirstWeekday,
    language,
    setLanguage,
    notificationPermissionGranted,
    setNotificationPermissionGranted,
    notificationTime,
    setNotificationTime,
  } = useSettings();
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const db = useSQLiteContext();
  const {
    requestNotificationPermission,
    cancelAllNotifications,
    scheduleDailyReminder,
  } = useNotifications();

  const [languageDropdownVisible, setLanguageDropdownVisible] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

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

  const formatTime = (time: string): string => {
    const [hours, minutes] = time.split(':').map(Number);
    if (timeFormat === 'AM/PM') {
      const date = new Date();
      date.setHours(hours, minutes, 0, 0);
      return date.toLocaleString('en-US', {
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
      });
    }
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
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

  const renderChoice = (
    label: string,
    active: boolean,
    onPress: () => void,
  ) => (
    <Pressable
      style={({ pressed }) => [
        styles.choiceButton,
        {
          borderColor: theme.border,
          backgroundColor: active ? theme.buttonBackground : theme.card,
        },
        pressed && styles.pressed,
      ]}
      onPress={onPress}
    >
      <Text
        style={[
          styles.choiceButtonText,
          { color: active ? theme.buttonText : theme.text },
        ]}
      >
        {label}
      </Text>
      {active && (
        <Ionicons
          name='checkmark'
          size={16}
          color={theme.buttonText}
          style={styles.choiceTick}
        />
      )}
    </Pressable>
  );

  const renderChoiceGroup = (
    choices: { label: string; active: boolean; onPress: () => void }[],
  ) => (
    <View style={styles.choiceGroup}>
      {choices.map((choice, index) => (
        <View key={choice.label} style={styles.choiceSlot}>
          {renderChoice(choice.label, choice.active, choice.onPress)}
        </View>
      ))}
    </View>
  );

  const renderSectionTitle = (label: string) => (
    <Text style={[styles.sectionTitle, { color: theme.text }]}>{label}</Text>
  );

  const renderSettingLabel = (label: string) => (
    <Text style={[styles.settingLabel, { color: theme.text }]}>{label}</Text>
  );

  const renderDivider = () => (
    <View style={[styles.settingDivider, { backgroundColor: theme.border }]} />
  );

  const renderActionRow = (
    icon: React.ComponentProps<typeof Ionicons>['name'],
    label: string,
    onPress: () => void,
    hint?: string,
  ) => (
    <Pressable
      style={({ pressed }) => [
        styles.actionRow,
        { borderColor: theme.border, backgroundColor: theme.card },
        pressed && styles.pressed,
      ]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={20} color={theme.text} />
      <View style={styles.actionRowText}>
        <Text style={[styles.actionRowLabel, { color: theme.text }]}>
          {label}
        </Text>
        {hint !== undefined && (
          <Text style={[styles.actionRowHint, { color: theme.text }]}>
            {hint}
          </Text>
        )}
      </View>
    </Pressable>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <Text style={[styles.title, { color: theme.text }]}>
          {t('settingsTitle')}
        </Text>

        {renderSectionTitle(t('settingsAppearance'))}

        <View style={styles.card}>
          {renderSettingLabel(t('settingsLanguage'))}
          <Pressable
            style={({ pressed }) => [
              styles.dropdownButton,
              { borderColor: theme.border, backgroundColor: theme.card },
              pressed && styles.pressed,
            ]}
            onPress={() => setLanguageDropdownVisible((visible) => !visible)}
          >
            <Text style={[styles.dropdownButtonText, { color: theme.text }]}>
              {LANGUAGES.find((lang) => lang.code === language)?.label ??
                language}
            </Text>
            <Ionicons
              name={languageDropdownVisible ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={theme.text}
            />
          </Pressable>
          {languageDropdownVisible && (
            <View style={[styles.dropdownList, { borderColor: theme.border }]}>
              {LANGUAGES.map((item) => (
                <Pressable
                  key={item.code}
                  style={({ pressed }) => [
                    styles.dropdownItem,
                    language === item.code && {
                      backgroundColor: theme.buttonBackground,
                    },
                    pressed && styles.pressed,
                  ]}
                  onPress={() => {
                    setLanguage(item.code);
                    setLanguageDropdownVisible(false);
                  }}
                >
                  <Text
                    style={[
                      styles.dropdownItemText,
                      {
                        color:
                          language === item.code
                            ? theme.buttonText
                            : theme.text,
                      },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {renderDivider()}

          {renderSettingLabel(t('settingsTheme'))}
          {renderChoice(
            theme.type === 'light' ? t('settingsSwitchDark') : t('settingsSwitchLight'),
            false,
            toggleTheme,
          )}

          {renderDivider()}

          {renderSettingLabel(t('settingsWeightFormat'))}
          {renderChoiceGroup([
            { label: 'kg', active: weightFormat === 'kg', onPress: () => setWeightFormat('kg') },
            { label: 'lbs', active: weightFormat === 'lbs', onPress: () => setWeightFormat('lbs') },
          ])}

          {renderDivider()}

          {renderSettingLabel(t('settingsDateFormat'))}
          {renderChoiceGroup([
            {
              label: 'dd-mm-yyyy',
              active: dateFormat === 'dd-mm-yyyy',
              onPress: () => setDateFormat('dd-mm-yyyy'),
            },
            {
              label: 'mm-dd-yyyy',
              active: dateFormat === 'mm-dd-yyyy',
              onPress: () => setDateFormat('mm-dd-yyyy'),
            },
          ])}

          {renderDivider()}

          {renderSettingLabel(t('settingsTimeFormat'))}
          {renderChoiceGroup([
            {
              label: '24h',
              active: timeFormat === '24h',
              onPress: () => setTimeFormat('24h'),
            },
            {
              label: 'AM/PM',
              active: timeFormat === 'AM/PM',
              onPress: () => setTimeFormat('AM/PM'),
            },
          ])}

          {renderDivider()}

          {renderSettingLabel(t('settingsFirstWeekday'))}
          {renderChoiceGroup([
            {
              label: t('Monday'),
              active: firstWeekday === 'Monday',
              onPress: () => setFirstWeekday('Monday'),
            },
            {
              label: t('Sunday'),
              active: firstWeekday === 'Sunday',
              onPress: () => setFirstWeekday('Sunday'),
            },
          ])}
        </View>

        {renderSectionTitle(t('notifications'))}

        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <Text style={[styles.toggleText, { color: theme.text }]}>
              {t('remindScheduledWorkouts')}
            </Text>
            <Switch
              value={notificationPermissionGranted}
              onValueChange={handleNotificationToggle}
              trackColor={{ false: theme.border, true: theme.buttonBackground }}
              thumbColor={theme.buttonText}
            />
          </View>
          {notificationPermissionGranted && (
            <Pressable
              style={({ pressed }) => [
                styles.timeRow,
                { borderColor: theme.border, backgroundColor: theme.card },
                pressed && styles.pressed,
              ]}
              onPress={() => setShowTimePicker(true)}
            >
              <Ionicons name='time-outline' size={20} color={theme.text} />
              <Text style={[styles.timeRowLabel, { color: theme.text }]}>
                {t('notificationTime')}
              </Text>
              <Text style={[styles.timeRowValue, { color: theme.text }]}>
                {formatTime(notificationTime)}
              </Text>
            </Pressable>
          )}
          {showTimePicker && (
            <DateTimePicker
              value={(() => {
                const [hours, minutes] = notificationTime.split(':').map(Number);
                const date = new Date();
                date.setHours(hours, minutes, 0, 0);
                return date;
              })()}
              mode='time'
              is24Hour={timeFormat === '24h'}
              display='default'
              onChange={handleNotificationTimeChange}
            />
          )}
        </View>

        {renderSectionTitle(t('dataManagement'))}

        <View style={styles.card}>
          {renderActionRow('share-outline', t('exportDatabase'), exportDatabase)}
          {renderActionRow('download-outline', t('restoreFromBackup'), importDatabase)}
          {renderActionRow('flask-outline', t('loadDemoData'), handleLoadDemoData)}
          {renderActionRow(
            'trash-outline',
            t('removeDemoData'),
            handleRemoveDemoData,
            t('removeDemoDataConfirm'),
          )}
        </View>

        <View style={styles.card}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>
            {t('imagePackTitle')}
          </Text>
          <Text style={[styles.cardHint, { color: theme.text }]}>
            {t('imagePackDownloadHint')}
          </Text>
          {renderActionRow('open-outline', t('downloadImagePack'), downloadImagePack)}
          {renderActionRow('file-tray-full-outline', t('installImagePack'), installImagePack)}
        </View>

        {renderSectionTitle(t('settingsAbout'))}

        <View style={styles.card}>
          {renderActionRow(
            'bug',
            t('reportIssue'),
            () =>
              Linking.openURL(
                'https://github.com/Lutmak/simple-gym-tracker/issues',
              ),
          )}
          {renderActionRow('logo-github', t('GitHub'), () =>
            Linking.openURL('https://github.com/Lutmak/simple-gym-tracker'),
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.gutter,
    paddingBottom: spacing.section * 2,
  },
  title: {
    fontSize: fontSize.screenTitle,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: spacing.section,
  },
  sectionTitle: {
    fontSize: fontSize.sectionTitle,
    fontWeight: '900',
    marginTop: spacing.section,
    marginBottom: spacing.card,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.card,
    padding: spacing.card,
    marginBottom: spacing.cardGap,
  },
  cardTitle: {
    fontSize: fontSize.cardTitle,
    fontWeight: '700',
  },
  cardHint: {
    fontSize: fontSize.helper,
    opacity: 0.7,
    marginTop: spacing.label,
    marginBottom: spacing.card,
  },
  settingLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
    marginBottom: spacing.label,
  },
  settingDivider: {
    height: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    marginVertical: spacing.card,
    opacity: 0.4,
  },
  dropdownButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: spacing.card,
    paddingVertical: spacing.label,
    minHeight: 44,
  },
  dropdownButtonText: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
  dropdownList: {
    marginTop: spacing.label,
    borderWidth: 1,
    borderRadius: radius.control,
    overflow: 'hidden',
  },
  dropdownItem: {
    paddingHorizontal: spacing.card,
    paddingVertical: spacing.card,
    minHeight: 44,
    justifyContent: 'center',
  },
  dropdownItemText: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
  choiceGroup: {
    flexDirection: 'row',
    gap: spacing.inline,
  },
  choiceSlot: {
    flex: 1,
  },
  choiceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: spacing.card,
    paddingVertical: spacing.label,
    minHeight: 44,
  },
  choiceButtonText: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
  choiceTick: {
    marginLeft: spacing.label,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
  },
  toggleText: {
    fontSize: fontSize.body,
    fontWeight: '600',
    flex: 1,
    marginRight: spacing.card,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: spacing.card,
    paddingVertical: spacing.label,
    minHeight: 44,
    marginTop: spacing.card,
  },
  timeRowLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
    marginLeft: spacing.label,
    flex: 1,
  },
  timeRowValue: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: spacing.card,
    paddingVertical: spacing.card,
    minHeight: 46,
    marginBottom: spacing.cardGap,
  },
  actionRowText: {
    flex: 1,
    marginLeft: spacing.card,
  },
  actionRowLabel: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
  actionRowHint: {
    fontSize: fontSize.helper,
    opacity: 0.7,
    marginTop: spacing.label,
  },
  pressed: {
    opacity: 0.7,
  },
});
