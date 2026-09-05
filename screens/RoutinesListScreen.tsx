import React, { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Row } from '../components/Row';
import { Screen } from '../components/Screen';
import { ScreenTitle } from '../components/ScreenTitle';
import { Section } from '../components/Section';
import { RoutineActionsSheet } from '../components/RoutineActionsSheet';
import { fontSize, spacing, tabBar, touchTarget } from '../utils/scale';
import {
  activateRoutineById,
  deleteRoutine,
  duplicateRoutine,
  type RoutineDatabase,
} from '../utils/routineActions';
import { loadCatalogExercises } from '../utils/exerciseCatalog';
import { loadRoutineDocumentText } from '../utils/routineDocument';
import {
  loadRoutineLibrary,
  weekdaySequence,
  type ActivationTarget,
  type ActiveRoutineRef,
  type LibraryRoutine,
} from '../utils/routineLibrary';
import type { RoutinesStackParamList } from '../App';

/** The document's own filename convention (ADR-0048): ASCII-safe, no path separators. */
const slugifyFileName = (name: string): string => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'routine' : slug;
};

type Props = NativeStackScreenProps<RoutinesStackParamList, 'RoutinesList'>;

const WEEKDAY_SHORT_KEYS = [
  'weekdayShortSun',
  'weekdayShortMon',
  'weekdayShortTue',
  'weekdayShortWed',
  'weekdayShortThu',
  'weekdayShortFri',
  'weekdayShortSat',
] as const;

/**
 * R1 — the Rutinas tab (SPECS.md R1).
 *
 * *"¿Por qué en la pestaña de rutinas están las predefinidas mezcladas con las mías?"* The tab
 * listed the user's routines and then the 22 presets, in cards of the same shape, so twenty-two
 * things the user had not chosen outranked the one thing they train. It now shows **only the
 * user's routines**, the active one alone under its own heading — the heading is the mark, so no
 * badge has to be invented — and everything else below it.
 *
 * The presets are not gone, they are behind a door: `+ Nueva rutina` (screens/NewRoutineScreen).
 * A routine's four actions live in one shared `Sheet` (components/RoutineActionsSheet), opened
 * from the row's own button; tapping the row itself opens the routine, because a push means "a
 * different place" and a sheet means "a decision about this thing" (§3.5).
 */
export default function RoutinesListScreen({ navigation }: Props) {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const { firstWeekday } = useSettings();
  const db = useSQLiteContext();

  const [library, setLibrary] = useState<LibraryRoutine[]>([]);
  const [actionsFor, setActionsFor] = useState<ActivationTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const routineDb: RoutineDatabase = {
    run: (sql, params) => db.runAsync(sql, (params ?? []) as never[]),
    get: async (sql, params) =>
      (await db.getFirstAsync<Record<string, unknown>>(sql, (params ?? []) as never[])) ?? undefined,
    getAll: async (sql, params) =>
      db.getAllAsync<Record<string, unknown>>(sql, (params ?? []) as never[]),
  };

  const reload = useCallback(async (): Promise<void> => {
    try {
      setLibrary(await loadRoutineLibrary(routineDb));
    } catch {
      setError(t('routineLibraryError'));
    }
  }, [db, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const active = library.find((routine) => routine.isActive) ?? null;
  const activeRef: ActiveRoutineRef | null =
    active === null ? null : { routineId: active.routineId, name: active.name };
  const others = library.filter((routine) => !routine.isActive);

  const summaryOf = (routine: LibraryRoutine): string => {
    const days = weekdaySequence(routine.weekdays, firstWeekday).map((weekday) =>
      t(WEEKDAY_SHORT_KEYS[weekday]),
    );
    if (days.length === 0) {
      return t('routineNoTrainingDays');
    }
    return `${t('sessionCount', { count: days.length })} · ${days.join(' · ')}`;
  };

  /**
   * X3 — export closes the sheet immediately (no confirmation, ADR-0048/§7.5: export creates
   * nothing and changes nothing) and writes the routine's document to the cache directory before
   * handing it to the OS share sheet, exactly like `Settings.tsx`'s `exportDatabase` does for the
   * whole-database export.
   */
  const exportRoutine = async (routineId: number) => {
    setActionsFor(null);
    try {
      const catalogRows = await loadCatalogExercises(routineDb);
      const catalog = new Map(catalogRows.map((row) => [row.exerciseKey, row]));
      const { name, text } = await loadRoutineDocumentText(routineDb, catalog, routineId);

      const path = `${FileSystem.cacheDirectory}${slugifyFileName(name)}.sgtroutine.json`;
      await FileSystem.writeAsStringAsync(path, text);

      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert(t('exportRoutineFailedTitle'), t('sharingNotAvailable'));
        return;
      }

      await Sharing.shareAsync(path, {
        mimeType: 'application/json',
        dialogTitle: t('exportRoutineDialogTitle'),
      });
    } catch (err) {
      console.error('Routine export error:', err);
      Alert.alert(t('exportRoutineFailedTitle'), t('exportRoutineErrorMessage'));
    }
  };

  const runAction = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setActionsFor(null);
      await reload();
    } catch {
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const renderRoutine = (routine: LibraryRoutine) => (
    <Row
      key={routine.routineId}
      label={routine.name}
      detail={summaryOf(routine)}
      detailBelow
      onPress={() => navigation.navigate('RoutineDetails', { routineId: routine.routineId })}
      right={
        <Pressable
          onPress={() =>
            setActionsFor({
              kind: 'routine',
              routineId: routine.routineId,
              name: routine.name,
            })
          }
          accessibilityRole="button"
          accessibilityLabel={t('routineActionsButton')}
          hitSlop={spacing.card}
          style={({ pressed }) => [
            styles.overflow,
            pressed && { backgroundColor: tokens.inputFill },
          ]}
          testID={`routine-actions-${routine.routineId}`}
        >
          <Ionicons name="ellipsis-horizontal" size={tabBar.icon} color={tokens.textPrimary} />
        </Pressable>
      }
      divided
      testID={`routine-${routine.routineId}`}
    />
  );

  return (
    <>
      <Screen scroll testID="routines-screen">
        <ScreenTitle title={t('routines')} />

        {library.length === 0 ? (
          <Section testID="routines-empty">
            <EmptyState
              icon="barbell-outline"
              title={t('routineLibraryEmptyTitle')}
              message={t('routineLibraryEmptyMessage')}
              actionLabel={t('newRoutine')}
              onAction={() => navigation.navigate('NewRoutine')}
            />
          </Section>
        ) : (
          <>
            {active !== null && (
              <Section title={t('routineActiveSection')} testID="routines-active">
                {renderRoutine(active)}
              </Section>
            )}
            {others.length > 0 && (
              <Section
                title={active === null ? t('routineLibrarySection') : t('routineOtherSection')}
                testID="routines-others"
              >
                {others.map(renderRoutine)}
              </Section>
            )}
            <Button
              label={t('newRoutine')}
              onPress={() => navigation.navigate('NewRoutine')}
              style={styles.newRoutine}
              testID="routines-new"
            />
          </>
        )}

        {error !== null && (
          <Text style={[styles.error, { color: tokens.warning }]}>{error}</Text>
        )}
      </Screen>

      <RoutineActionsSheet
        target={actionsFor}
        active={activeRef}
        busy={busy}
        onClose={() => setActionsFor(null)}
        onActivate={(target) => {
          if (target.kind !== 'routine') {
            return;
          }
          void runAction(
            () => activateRoutineById(routineDb, target.routineId),
            t('errorActivatingRoutine'),
          );
        }}
        onEdit={(routineId) => {
          setActionsFor(null);
          navigation.navigate('EditRoutine', { routineId });
        }}
        onDuplicate={(routineId) =>
          void runAction(
            () => duplicateRoutine(routineDb, routineId),
            t('errorDuplicatingRoutine'),
          )
        }
        onExport={(routineId) => void exportRoutine(routineId)}
        onDelete={(routineId) =>
          void runAction(() => deleteRoutine(routineDb, routineId), t('errorDeletingRoutine'))
        }
        testID="routines-actions-sheet"
      />
    </>
  );
}

const styles = StyleSheet.create({
  overflow: {
    minWidth: touchTarget.icon,
    minHeight: touchTarget.icon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newRoutine: {
    alignSelf: 'stretch',
  },
  error: {
    fontSize: fontSize.helper,
    marginTop: spacing.cardGap,
  },
});
