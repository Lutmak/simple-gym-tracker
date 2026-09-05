import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import * as DocumentPicker from 'expo-document-picker';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import { pickLocalizedText } from '../utils/i18n';
import { Row } from '../components/Row';
import { Screen } from '../components/Screen';
import { ScreenTitle } from '../components/ScreenTitle';
import { Section } from '../components/Section';
import { fontSize, spacing, tabBar } from '../utils/scale';
import { type RoutineDatabase } from '../utils/routineActions';
import { loadCatalogExercises } from '../utils/exerciseCatalog';
import { readPickedFileAsText } from '../utils/pickedFile';
import {
  parseRoutineDocumentText,
  writeRoutineDocument,
  type RoutineDocumentError,
} from '../utils/routineDocument';
import {
  loadPresetLibrary,
  loadRoutineLibrary,
  weekdaySequence,
  type PresetEntry,
  type PresetLevelGroup,
  type RoutineLevel,
} from '../utils/routineLibrary';
import type { RoutinesStackParamList } from '../App';

const IMPORT_PICKER_TYPES = ['application/json', 'text/plain', 'application/octet-stream'];

/**
 * One line per problem `parseRoutineDocument` found, in the user's language. `detail` is only
 * ever a raw value (a version number, an unresolved reference) — never itself localised — so it
 * is passed through as an interpolation, never concatenated into the reason string here.
 */
const describeImportError = (
  issue: RoutineDocumentError,
  t: (key: string, options?: Record<string, unknown>) => string,
): string => {
  const reason = t(
    `importRoutineReason_${issue.code}`,
    issue.detail !== null ? { detail: issue.detail } : undefined,
  );
  if (issue.session !== null && issue.exercise !== null) {
    return t('routineImportErrorLineFull', {
      session: issue.session.index + 1,
      sessionName: issue.session.name,
      exercise: issue.exercise.index + 1,
      exerciseName: issue.exercise.name,
      reason,
    });
  }
  if (issue.session !== null) {
    return t('routineImportErrorLineSession', {
      session: issue.session.index + 1,
      sessionName: issue.session.name,
      reason,
    });
  }
  return t('routineImportErrorLineTop', { reason });
};

type Props = NativeStackScreenProps<RoutinesStackParamList, 'NewRoutine'>;

const WEEKDAY_SHORT_KEYS = [
  'weekdayShortSun',
  'weekdayShortMon',
  'weekdayShortTue',
  'weekdayShortWed',
  'weekdayShortThu',
  'weekdayShortFri',
  'weekdayShortSat',
] as const;

/** The 5/3/1 preset is the headline feature's own door; the builder starts from it. */
const WAVE_PRESET_KEY = '531';

/**
 * R1 — the one door to a new routine (SPECS.md R1).
 *
 * The 22 presets used to sit in the Rutinas tab competing with the user's own. They live here
 * instead, behind `+ Nueva rutina`, alongside the two other ways a routine can start: from scratch
 * and as a 5/3/1 program. Choosing a level is an **in-place accordion**, not a screen — picking a
 * difficulty is not going somewhere, and making it a push would put a transition between the user
 * and a list they are skimming (§7.5).
 *
 * Nothing on this screen asks for a number, and neither does anything it opens: a preset leads to
 * its description and a single Activar, which copies the routine with its weights left NULL for
 * the first session to learn (§3.2).
 */
export default function NewRoutineScreen({ navigation }: Props) {
  const { tokens } = useTheme();
  const { t, i18n } = useTranslation();
  const { firstWeekday } = useSettings();
  const db = useSQLiteContext();

  const [groups, setGroups] = useState<PresetLevelGroup[]>([]);
  const [openLevel, setOpenLevel] = useState<RoutineLevel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const routineDb: RoutineDatabase = {
    run: (sql, params) => db.runAsync(sql, (params ?? []) as never[]),
    get: async (sql, params) =>
      (await db.getFirstAsync<Record<string, unknown>>(sql, (params ?? []) as never[])) ?? undefined,
    getAll: async (sql, params) =>
      db.getAllAsync<Record<string, unknown>>(sql, (params ?? []) as never[]),
  };

  useFocusEffect(
    useCallback(() => {
      const load = async () => {
        try {
          const library = await loadRoutineLibrary(routineDb);
          setGroups(await loadPresetLibrary(routineDb, library));
        } catch {
          setError(t('routineLibraryError'));
        }
      };
      void load();
    }, [db, t]),
  );

  /**
   * F8: nothing is written yet — the editor holds an unsaved draft entirely
   * in memory (§7.5) and only creates the Routines row on the user's first
   * explicit save (a changed name, an added day, or "Continuar"). Backing
   * out of an untouched draft leaves nothing behind.
   */
  const startFromScratch = () => {
    if (busy) {
      return;
    }
    navigation.replace('EditRoutine', { routineId: null });
  };

  /**
   * X2 — the fourth door to a new routine: a hand-authored or exported `.sgtroutine.json` file
   * (ADR-0048). Validates the whole document in memory before any write, mirroring
   * `databaseImport.ts`'s bar; every problem reaches the user as a line naming its session,
   * exercise and field, never a crash or a silent no-op. The import always lands inactive.
   */
  const importRoutine = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // `copyToCacheDirectory: false` is deliberate: the picker's own copy under
      // `cache/DocumentPicker/` fails Expo Go's scoped-permission check (it sits outside this
      // experience's scoped cache). The raw `content://` URI it returns instead cannot be read
      // directly either — `readPickedFileAsText` stages it into a path this app owns first
      // (`utils/pickedFile.ts`).
      const picked = await DocumentPicker.getDocumentAsync({
        type: IMPORT_PICKER_TYPES,
        copyToCacheDirectory: false,
      });
      if (picked.canceled) {
        return;
      }
      const asset = picked.assets?.[0];
      if (asset === undefined) {
        Alert.alert(t('importRoutineFailedTitle'), t('fileNotSelectedError'));
        return;
      }

      let catalog;
      try {
        const rows = await loadCatalogExercises(routineDb);
        catalog = new Map(rows.map((row) => [row.exerciseKey, row]));
      } catch {
        Alert.alert(t('importRoutineFailedTitle'), t('importRoutineCatalogError'));
        return;
      }

      const text = await readPickedFileAsText(asset.uri, asset.name);
      const result = parseRoutineDocumentText(text, catalog);
      if (!result.ok) {
        const lines = result.errors.map((issue) => describeImportError(issue, t)).join('\n');
        const message = `${t('importRoutineProblemsFound', { count: result.errors.length })}\n${lines}`;
        Alert.alert(t('importRoutineFailedTitle'), message);
        return;
      }

      const { customExerciseCount } = await writeRoutineDocument(
        routineDb,
        result.rows,
        result.newCustomExercises,
      );

      const successMessage = [
        t('importRoutineSuccessMessage', {
          name: result.rows.routine.name,
          sessionCount: t('sessionCount', { count: result.rows.sessions.length }),
        }),
        customExerciseCount > 0
          ? t('importRoutineCustomExercisesCreated', { count: customExerciseCount })
          : null,
      ]
        .filter((line): line is string => line !== null)
        .join('\n');

      Alert.alert(t('importRoutineSuccessTitle'), successMessage, [
        { text: t('ok'), onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      console.error('Routine import error:', err);
      Alert.alert(t('importRoutineFailedTitle'), t('importRoutineErrorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const presetDetail = (entry: PresetEntry): string => {
    const days = weekdaySequence(entry.weekdays, firstWeekday).map((weekday) =>
      t(WEEKDAY_SHORT_KEYS[weekday]),
    );
    const plan = `${t('sessionCount', { count: days.length })} · ${days.join(' · ')}`;
    const description = pickLocalizedText(i18n.language, entry.description, entry.descriptionEs);
    return entry.copyRoutineId === null
      ? `${plan}\n${description}`
      : `${plan} · ${t('presetAlreadyInLibrary')}\n${description}`;
  };

  const chevron = (name: string) => (
    <Ionicons name={name} size={tabBar.icon} color={tokens.textSecondary} />
  );

  return (
    <Screen scroll testID="new-routine-screen">
      <ScreenTitle title={t('newRoutineTitle')} onBack={() => navigation.goBack()} />

      <Section title={t('newRoutineBuildSection')} testID="new-routine-build">
        <Row
          label={t('newRoutineScratch')}
          detail={t('newRoutineScratchDetail')}
          detailBelow
          right={chevron('chevron-forward')}
          onPress={() => void startFromScratch()}
          disabled={busy}
          divided
          testID="new-routine-scratch"
        />
        <Row
          label={t('newRoutineWave')}
          detail={t('newRoutineWaveDetail')}
          detailBelow
          right={chevron('chevron-forward')}
          onPress={() =>
            navigation.navigate('FiveThreeOneSetup', { presetKey: WAVE_PRESET_KEY })
          }
          disabled={busy}
          divided
          testID="new-routine-wave"
        />
        <Row
          label={t('newRoutineImport')}
          detail={t('newRoutineImportDetail')}
          detailBelow
          right={chevron('chevron-forward')}
          onPress={() => void importRoutine()}
          disabled={busy}
          divided
          testID="new-routine-import"
        />
      </Section>

      <Section
        title={t('newRoutinePresetSection')}
        hint={t('newRoutinePresetHint')}
        testID="new-routine-presets"
      >
        {groups.map((group) => {
          const open = openLevel === group.level;
          return (
            <View key={group.level}>
              <Row
                label={t(group.level)}
                detail={t('presetLevelCount', { count: group.entries.length })}
                right={chevron(open ? 'chevron-up' : 'chevron-down')}
                onPress={() => setOpenLevel(open ? null : group.level)}
                divided
                testID={`preset-level-${group.level}`}
              />
              {open && (
                // The indent is the only thing saying these belong to the level above them —
                // a filled surface would be a card inside a screen (§3.5).
                <View style={styles.levelBody} testID={`preset-level-body-${group.level}`}>
                  {group.entries.map((entry) => (
                    <Row
                      key={entry.routineKey}
                      label={entry.name}
                      detail={presetDetail(entry)}
                      detailBelow
                      right={chevron('chevron-forward')}
                      onPress={() =>
                        navigation.navigate('RoutineDetails', { presetKey: entry.routineKey })
                      }
                      divided
                      testID={`preset-${entry.routineKey}`}
                    />
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </Section>

      {error !== null && <Text style={[styles.error, { color: tokens.warning }]}>{error}</Text>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  levelBody: {
    paddingLeft: spacing.gutter,
  },
  error: {
    fontSize: fontSize.helper,
    marginTop: spacing.cardGap,
  },
});
