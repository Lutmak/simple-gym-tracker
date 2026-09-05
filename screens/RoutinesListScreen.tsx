import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
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
import { fontSize, radius, spacing, tabBar, touchTarget } from '../utils/scale';
import {
  activateRoutineById,
  deleteRoutine,
  duplicateRoutine,
  type RoutineDatabase,
  type RoutineProgressionRule,
} from '../utils/routineActions';
import { loadCatalogExercises } from '../utils/exerciseCatalog';
import { loadRoutineDocumentText, routineDocumentFileName } from '../utils/routineDocument';
import { loadReviewEntry, type ReviewEntry } from '../utils/cycleReview';
import { loadRoutineProgress, type ProgressCycleView } from '../utils/routineProgress';
import { activeCyclePosition } from '../utils/routineOverview';
import {
  loadRoutineLibrary,
  weekdaySequence,
  type ActivationTarget,
  type ActiveRoutineRef,
  type LibraryRoutine,
} from '../utils/routineLibrary';
import type { RootTabParamList, RoutinesStackParamList } from '../App';

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
  /** The active routine's cycles, for the hero's cycle-position line (§3.4/U4). */
  const [activeCycles, setActiveCycles] = useState<ProgressCycleView[]>([]);
  const [reviewEntry, setReviewEntry] = useState<ReviewEntry | null>(null);
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
      const loaded = await loadRoutineLibrary(routineDb);
      setLibrary(loaded);
      const activeRoutine = loaded.find((routine) => routine.isActive) ?? null;
      setActiveCycles(
        activeRoutine === null
          ? []
          : (await loadRoutineProgress(routineDb, activeRoutine.routineId)).cycles,
      );
      setReviewEntry(await loadReviewEntry(routineDb));
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

  const progressionWords = (rule: RoutineProgressionRule): string =>
    rule === 'wave'
      ? t('progressionWave')
      : rule === 'linear'
        ? t('progressionLinear')
        : t('progressionNone');

  const openProgress = (routineId: number) =>
    navigation
      .getParent<BottomTabNavigationProp<RootTabParamList>>()
      ?.navigate('Progress', { routineId });

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

      const path = `${FileSystem.cacheDirectory}${routineDocumentFileName(name)}`;
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

  const reviewForActive =
    active !== null && reviewEntry !== null && reviewEntry.routineId === active.routineId
      ? reviewEntry
      : null;
  const position = activeCyclePosition(activeCycles);

  /**
   * The active routine's hero (SPEC.md U4, ADR-0047 §4.2 — one filled block per screen). It is
   * pressable to open the same details every other row opens; the overflow button and the
   * "Ver progreso" link are nested `Pressable`s that win the touch over the outer one, the same
   * pattern the row's own overflow button already relies on below.
   */
  const renderHero = (routine: LibraryRoutine) => {
    const days = weekdaySequence(routine.weekdays, firstWeekday).map((weekday) =>
      t(WEEKDAY_SHORT_KEYS[weekday]),
    );
    return (
      <Pressable
        onPress={() => navigation.navigate('RoutineDetails', { routineId: routine.routineId })}
        style={({ pressed }) => [
          styles.hero,
          { backgroundColor: tokens.surfaceRaised },
          pressed && styles.heroPressed,
        ]}
        testID="routines-hero"
      >
        <Text style={[styles.heroOverline, { color: tokens.textSecondary }]}>
          {t('routineActiveSection')}
        </Text>
        <View style={styles.heroTitleRow}>
          <Text
            style={[styles.heroTitle, { color: tokens.textPrimary }]}
            numberOfLines={2}
            maxFontSizeMultiplier={1.5}
          >
            {routine.name}
          </Text>
          <Pressable
            onPress={() =>
              setActionsFor({ kind: 'routine', routineId: routine.routineId, name: routine.name })
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
        </View>
        <Text style={[styles.heroDetail, { color: tokens.textSecondary }]}>
          {progressionWords(routine.progressionRule)}
        </Text>
        {days.length > 0 && (
          <View style={styles.chipRow}>
            {days.map((day, index) => (
              <View
                key={index}
                style={[styles.chip, { backgroundColor: tokens.inputFill }]}
              >
                <Text style={[styles.chipLabel, { color: tokens.textPrimary }]}>{day}</Text>
              </View>
            ))}
          </View>
        )}

        {reviewForActive !== null && position !== null ? (
          <Pressable
            onPress={() =>
              navigation.navigate('CycleReview', {
                routineId: reviewForActive.routineId,
                cycleId: reviewForActive.cycleId,
              })
            }
            style={({ pressed }) => [styles.heroReview, pressed && styles.heroPressed]}
            testID="routines-hero-review"
          >
            <Text style={[styles.heroDetail, { color: tokens.textPrimary }]}>
              {t('inicioReviewTitle', { cycle: reviewForActive.cycleNumber })}
            </Text>
            <Text style={[styles.heroDetail, { color: tokens.textSecondary }]}>
              {t('inicioReviewSummary', {
                completed: position.sessionsDone,
                total: position.sessionsPlanned,
                next: reviewForActive.cycleNumber + 1,
              })}
            </Text>
          </Pressable>
        ) : (
          position !== null && (
            <Text style={[styles.heroDetail, { color: tokens.textSecondary }]}>
              {t('routineCyclePosition', {
                cycle: position.cycleNumber,
                week: position.currentWeek,
                done: position.sessionsDone,
                total: position.sessionsPlanned,
              })}
            </Text>
          )
        )}

        <Pressable
          onPress={() => openProgress(routine.routineId)}
          style={({ pressed }) => [styles.heroLink, pressed && styles.heroPressed]}
          hitSlop={spacing.label}
          testID="routines-hero-progress"
        >
          <Text style={[styles.heroLinkLabel, { color: tokens.textPrimary }]}>
            {t('routineViewProgress')}
          </Text>
          <Ionicons name="chevron-forward" size={fontSize.body} color={tokens.textPrimary} />
        </Pressable>
      </Pressable>
    );
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
      <Screen fill testID="routines-screen">
        <View style={styles.container}>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
            testID="routines-scroll"
          >
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
                {active !== null && renderHero(active)}
                {others.length > 0 && (
                  <Section
                    title={active === null ? t('routineLibrarySection') : t('routineOtherSection')}
                    testID="routines-others"
                  >
                    {others.map(renderRoutine)}
                  </Section>
                )}
              </>
            )}

            {error !== null && (
              <Text style={[styles.error, { color: tokens.warning }]}>{error}</Text>
            )}
          </ScrollView>

          {library.length > 0 && (
            <View style={[styles.footer, { borderTopColor: tokens.divider }]}>
              <Button
                label={t('newRoutine')}
                onPress={() => navigation.navigate('NewRoutine')}
                style={styles.newRoutine}
                testID="routines-new"
              />
            </View>
          )}
        </View>
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
  container: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingBottom: spacing.section,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.cardGap,
  },
  overflow: {
    minWidth: touchTarget.icon,
    minHeight: touchTarget.icon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newRoutine: {
    alignSelf: 'stretch',
  },
  hero: {
    borderRadius: radius.card,
    padding: spacing.card,
    marginBottom: spacing.section,
  },
  heroPressed: {
    opacity: 0.85,
  },
  heroOverline: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: spacing.label,
  },
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
  },
  heroTitle: {
    flex: 1,
    fontSize: fontSize.screenTitle,
    fontWeight: '700',
  },
  heroDetail: {
    fontSize: fontSize.body,
    marginTop: spacing.label,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.inline,
    marginTop: spacing.cardGap,
  },
  chip: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.cardGap,
    paddingVertical: spacing.label,
  },
  chipLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  heroReview: {
    marginTop: spacing.cardGap,
  },
  heroLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.label,
    marginTop: spacing.cardGap,
    alignSelf: 'flex-start',
  },
  heroLinkLabel: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
  error: {
    fontSize: fontSize.helper,
    marginTop: spacing.cardGap,
  },
});
