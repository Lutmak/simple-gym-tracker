import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import { pickLocalizedText } from '../utils/i18n';
import { Row } from '../components/Row';
import { Screen } from '../components/Screen';
import { ScreenTitle } from '../components/ScreenTitle';
import { Section } from '../components/Section';
import { ExerciseSheet } from '../components/ExerciseSheet';
import { RoutineActionsSheet } from '../components/RoutineActionsSheet';
import { dataMark, fontSize, spacing, tabBar } from '../utils/scale';
import {
  activatePresetRoutine,
  activateRoutineById,
  deleteRoutine,
  duplicateRoutine,
  getActiveRoutine,
  loadPresetRoutineSource,
  loadRoutineSourceById,
  type ExerciseSource,
  type RoutineDatabase,
  type RoutineSourceBundle,
  type RoutineUnit,
} from '../utils/routineActions';
import { loadReviewEntry, type ReviewEntry } from '../utils/cycleReview';
import { loadCatalogExercises } from '../utils/exerciseCatalog';
import { loadRoutineDocumentText, routineDocumentFileName } from '../utils/routineDocument';
import { mainLiftColours } from '../utils/liftColours';
import { buildRoutineConfigView } from '../utils/routineOverview';
import {
  planActivation,
  weekdaySequence,
  type ActivationTarget,
  type ActiveRoutineRef,
} from '../utils/routineLibrary';
import type { RoutinesStackParamList } from '../App';

type Props = NativeStackScreenProps<RoutinesStackParamList, 'RoutineDetails'>;

const WEEKDAY_FULL_KEYS = [
  'weekdayFullSun',
  'weekdayFullMon',
  'weekdayFullTue',
  'weekdayFullWed',
  'weekdayFullThu',
  'weekdayFullFri',
  'weekdayFullSat',
] as const;

const formatRest = (seconds: number): string =>
  seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`;

const formatWeight = (value: number): string => String(Number(value.toFixed(1)));

/**
 * The routine's exercises in the routine's OWN order — every session by its stored
 * `sort_order`, then every exercise of that session by its own `sort_order` — never the
 * user's `firstWeekday` display order. Colour assignment (`mainLiftColours`) is built from
 * this, so a main lift's series colour never changes just because the user flips which day
 * their week starts on (§4.1 — "Squat is always the same colour across every chart").
 */
const exercisesInRoutineOrder = (
  sessions: RoutineSourceBundle['sessions'],
  exercises: RoutineSourceBundle['exercises'],
): ExerciseSource[] => {
  const bySortOrder = [...sessions].sort((a, b) => a.sortOrder - b.sortOrder);
  return bySortOrder.flatMap((session) =>
    exercises
      .filter((exercise) => exercise.sessionId === session.sessionId)
      .sort((a, b) => a.sortOrder - b.sortOrder),
  );
};

/**
 * R1 — one routine, read (SPECS.md R1, §3.2; SPEC.md U4).
 *
 * The same screen shows a preset and one of the user's own routines, because they are the same
 * thing at different moments: a preset is what a routine looks like before it is copied.
 *
 * U4 rebuilt this screen against the design system: the header's `⋯` is the one door to the
 * action sheet (no more bottom "Acciones de la rutina" button, and no more one-tap activation
 * shortcut that bypassed it — every action, including activating, is one decision in one place);
 * the week is day blocks that name exercises only, with a role marker and, on main lifts, their
 * series colour; sets, reps and weights — noise outside an actual session — live in the runner
 * and the exercise editor, not here; "Máximo de entrenamiento" never appears as a bare row; the
 * routine's settings collapse behind one "Configuración" row at the bottom.
 *
 * Activation still never asks for a number: it is one call with an empty weight map, which
 * writes every load as NULL for the first logged session to learn (§3.2, `utils/learnedWeights.ts`).
 */
export default function RoutineDetailsScreen({ navigation, route }: Props) {
  const { tokens } = useTheme();
  const { t, i18n } = useTranslation();
  const { weightFormat, firstWeekday } = useSettings();
  const db = useSQLiteContext();
  const { routineId, presetKey } = route.params;

  const routineDb: RoutineDatabase = {
    run: (sql, params) => db.runAsync(sql, (params ?? []) as never[]),
    get: async (sql, params) =>
      (await db.getFirstAsync<Record<string, unknown>>(sql, (params ?? []) as never[])) ?? undefined,
    getAll: async (sql, params) =>
      db.getAllAsync<Record<string, unknown>>(sql, (params ?? []) as never[]),
  };

  const [source, setSource] = useState<RoutineSourceBundle | null>(null);
  const [active, setActive] = useState<ActiveRoutineRef | null>(null);
  /** §3.4/F4 — set only when the review pending is for THIS routine. */
  const [reviewEntry, setReviewEntry] = useState<ReviewEntry | null>(null);
  /** The preset's copy in the library, when it has one — what activation reactivates. */
  const [copyRoutineId, setCopyRoutineId] = useState<number | null>(null);
  const [actionsFor, setActionsFor] = useState<ActivationTarget | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** R2: the exercise whose shared sheet is open. */
  const [information, setInformation] = useState<ExerciseSource | null>(null);

  useFocusEffect(
    useCallback(() => {
      const load = async () => {
        try {
          const loaded =
            presetKey !== undefined
              ? await loadPresetRoutineSource(routineDb, presetKey)
              : await loadRoutineSourceById(routineDb, routineId as number);
          setSource(loaded);
          setActive(await getActiveRoutine(routineDb));
          setReviewEntry(await loadReviewEntry(routineDb));
          if (presetKey !== undefined) {
            const copy = await routineDb.get(
              'SELECT routine_id FROM Routines WHERE routine_key = ?;',
              [presetKey],
            );
            setCopyRoutineId(copy === undefined ? null : Number(copy.routine_id));
          }
        } catch {
          setError(t('routineLibraryError'));
        }
      };
      void load();
    }, [db, routineId, presetKey, t]),
  );

  if (source === null) {
    return (
      <Screen testID="routine-details-screen">
        <ActivityIndicator color={tokens.accent} />
        {error !== null && <Text style={[styles.error, { color: tokens.warning }]}>{error}</Text>}
      </Screen>
    );
  }

  const { routine, sessions, exercises } = source;
  const unit: RoutineUnit = routine.unit ?? (weightFormat === 'lbs' ? 'lb' : 'kg');

  const target: ActivationTarget =
    presetKey !== undefined
      ? { kind: 'preset', routineKey: presetKey, name: routine.name, copyRoutineId }
      : { kind: 'routine', routineId: routineId as number, name: routine.name };
  const plan = planActivation(target, active);

  // §3.4/F4: the pending-review entry point is only this routine's if the
  // active routine it names is the one this screen is actually showing —
  // this screen's own id (a user routine) or its activated copy (a preset).
  const thisRoutineId = presetKey !== undefined ? copyRoutineId : (routineId as number);
  const reviewForThisRoutine =
    reviewEntry !== null && reviewEntry.routineId === thisRoutineId ? reviewEntry : null;

  const orderedWeekdays = weekdaySequence(
    sessions.map((session) => session.weekday),
    firstWeekday,
  );
  const orderedSessions = orderedWeekdays.flatMap((weekday) =>
    sessions.filter((session) => session.weekday === weekday),
  );

  const liftColours = mainLiftColours(
    exercisesInRoutineOrder(sessions, exercises).map((exercise) => ({
      name: exercise.name,
      role: exercise.role,
    })),
  );

  const progressionText =
    routine.progressionRule === 'wave'
      ? t('progressionWave')
      : routine.progressionRule === 'linear'
        ? t('progressionLinear')
        : t('progressionNone');

  const config = buildRoutineConfigView({
    unit,
    roundingIncrement: routine.roundingIncrement,
    restMainSeconds: routine.restMainSeconds,
    restAccessorySeconds: routine.restAccessorySeconds,
    progressionRule: routine.progressionRule,
    plannedJokers: routine.plannedJokers,
    tmIncrementUpper: routine.tmIncrementUpper,
    tmIncrementLower: routine.tmIncrementLower,
    cycleWeeks: routine.cycleWeeks,
  });

  const chevron = (name: string) => (
    <Ionicons name={name} size={tabBar.icon} color={tokens.textSecondary} />
  );

  /** The role marker (ADR-0047 §4.1): a filled dot in the lift's series colour for a main
   * lift, a plain ring for an accessory — one mark carries both the role (filled vs ring) and,
   * for a main lift, which lift it is (the hue). Colour is never the only cue. */
  const roleMarker = (exercise: ExerciseSource) => {
    const colourIndex = liftColours.get(exercise.name);
    if (colourIndex === undefined) {
      return (
        <View
          style={[styles.roleRing, { borderColor: tokens.divider }]}
          testID={`routine-exercise-marker-${exercise.exerciseId}`}
        />
      );
    }
    return (
      <View
        style={[styles.roleDot, { backgroundColor: tokens.data.series[colourIndex] }]}
        testID={`routine-exercise-marker-${exercise.exerciseId}`}
      />
    );
  };

  /** X3 — export closes nothing (this screen has no sheet open yet at that point) and mirrors
   * `RoutinesListScreen`'s own edge exactly: write the document to the cache directory, then
   * hand it to the OS share sheet. No confirmation: export creates nothing and changes nothing. */
  const exportRoutine = async (targetRoutineId: number) => {
    setActionsFor(null);
    try {
      const catalogRows = await loadCatalogExercises(routineDb);
      const catalog = new Map(catalogRows.map((row) => [row.exerciseKey, row]));
      const { name, text } = await loadRoutineDocumentText(routineDb, catalog, targetRoutineId);

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
      navigation.popToTop();
    } catch {
      setError(message);
      setBusy(false);
    }
  };

  /**
   * Zero numeric input, in one place: the weight map is always empty. A preset copies with every
   * load NULL; a routine already in the library is simply made active.
   */
  const activate = (activationTarget: ActivationTarget) =>
    runAction(
      () =>
        activationTarget.kind === 'preset'
          ? activatePresetRoutine(routineDb, activationTarget.routineKey, unit, new Map())
          : activateRoutineById(routineDb, activationTarget.routineId),
      t('errorActivatingRoutine'),
    );

  return (
    <>
      <Screen scroll testID="routine-details-screen">
        <ScreenTitle
          title={routine.name}
          overline={plan.outcome === 'alreadyActive' ? t('routineActiveSection') : undefined}
          onBack={() => navigation.goBack()}
          actionIcon="ellipsis-horizontal"
          actionAccessibilityLabel={t('routineActionsButton')}
          onAction={() => setActionsFor(target)}
          testID="routine-details-title"
        />

        {routine.description !== null && (
          <Section title={t('description')}>
            <Text style={[styles.body, { color: tokens.textSecondary }]}>
              {pickLocalizedText(i18n.language, routine.description, routine.descriptionEs)}
            </Text>
          </Section>
        )}

        {routine.philosophy !== null && (
          <Section title={t('philosophy')}>
            <Text style={[styles.body, { color: tokens.textSecondary }]}>
              {pickLocalizedText(i18n.language, routine.philosophy, routine.philosophyEs)}
            </Text>
          </Section>
        )}

        <Section title={t('routineSummarySection')} testID="routine-summary">
          <Row
            label={t('sessionCount', { count: sessions.length })}
            detail={orderedWeekdays.map((weekday) => t(WEEKDAY_FULL_KEYS[weekday])).join(' · ')}
            detailBelow
            divided
          />
        </Section>

        {reviewForThisRoutine !== null && (
          <Section testID="routine-review">
            <Row
              label={t('inicioReviewTitle', { cycle: reviewForThisRoutine.cycleNumber })}
              detail={t('sessionSummaryReview')}
              detailBelow
              right={
                <Ionicons name="chevron-forward" size={tabBar.icon} color={tokens.textSecondary} />
              }
              onPress={() =>
                navigation.navigate('CycleReview', {
                  routineId: reviewForThisRoutine.routineId,
                  cycleId: reviewForThisRoutine.cycleId,
                })
              }
              divided
            />
          </Section>
        )}

        <Section title={t('weekOverview')} testID="routine-week">
          {orderedSessions.map((session) => (
            <View key={session.sessionId}>
              <Text style={[styles.dayTitle, { color: tokens.textPrimary }]}>
                {t(WEEKDAY_FULL_KEYS[session.weekday])} · {session.name}
              </Text>
              {exercises
                .filter((exercise) => exercise.sessionId === session.sessionId)
                .map((exercise) => (
                  // R2: every exercise in the app is one tap from its full description.
                  <Row
                    key={exercise.exerciseId}
                    label={exercise.name}
                    left={roleMarker(exercise)}
                    right={
                      <Ionicons
                        name="information-circle-outline"
                        size={tabBar.icon}
                        color={tokens.textSecondary}
                      />
                    }
                    onPress={() => setInformation(exercise)}
                    divided
                    testID={`routine-exercise-${exercise.exerciseId}`}
                  />
                ))}
            </View>
          ))}
        </Section>

        <Section testID="routine-config">
          <Row
            label={t('routineConfigSection')}
            detail={[
              config.unit,
              t('routineConfigRounding', {
                value: formatWeight(config.roundingIncrement),
                unit: config.unit,
              }),
              t('routineConfigDayCount', { count: sessions.length }),
              t('routineConfigRest', {
                main: formatRest(config.restMainSeconds),
                accessory: formatRest(config.restAccessorySeconds),
              }),
            ].join(' · ')}
            detailBelow
            right={chevron(configOpen ? 'chevron-up' : 'chevron-down')}
            onPress={() => setConfigOpen(!configOpen)}
            divided
            testID="routine-config-toggle"
          />
          {configOpen && (
            <View style={styles.configBody}>
              <Row
                label={t('restMainLabel')}
                detail={formatRest(config.restMainSeconds)}
                divided
                testID="routine-config-rest-main"
              />
              <Row
                label={t('restAccessoryLabel')}
                detail={formatRest(config.restAccessorySeconds)}
                divided
                testID="routine-config-rest-accessory"
              />
              <Row label={t('progressionRule')} detail={progressionText} detailBelow divided />
              {config.progressionRule === 'wave' && (
                <>
                  <Row
                    label={t('plannedJokersLabel')}
                    detail={
                      config.plannedJokers === 0
                        ? t('plannedJokersOff')
                        : t('plannedJokersSummary', { count: config.plannedJokers })
                    }
                    detailBelow
                    divided
                    testID="routine-config-jokers"
                  />
                  <Row
                    label={t('routineConfigTmIncrementUpper')}
                    detail={t('loadAbsoluteValue', {
                      weight: formatWeight(config.tmIncrementUpper),
                      unit: config.unit,
                    })}
                    divided
                    testID="routine-config-tm-upper"
                  />
                  <Row
                    label={t('routineConfigTmIncrementLower')}
                    detail={t('loadAbsoluteValue', {
                      weight: formatWeight(config.tmIncrementLower),
                      unit: config.unit,
                    })}
                    divided
                    testID="routine-config-tm-lower"
                  />
                  <Row
                    label={t('includeDeload')}
                    detail={t(config.deloadEnabled ? 'deloadOn' : 'deloadOff')}
                    testID="routine-config-deload"
                  />
                </>
              )}
            </View>
          )}
        </Section>

        {error !== null && <Text style={[styles.error, { color: tokens.warning }]}>{error}</Text>}
      </Screen>

      <RoutineActionsSheet
        target={actionsFor}
        active={active}
        busy={busy}
        onClose={() => setActionsFor(null)}
        onActivate={(activationTarget) => void activate(activationTarget)}
        onEdit={(id) => {
          setActionsFor(null);
          navigation.navigate('EditRoutine', { routineId: id });
        }}
        onDuplicate={(id) =>
          void runAction(() => duplicateRoutine(routineDb, id), t('errorDuplicatingRoutine'))
        }
        onExport={(id) => void exportRoutine(id)}
        onDelete={(id) =>
          void runAction(() => deleteRoutine(routineDb, id), t('errorDeletingRoutine'))
        }
        testID="routine-details-actions-sheet"
      />

      {/* R2: the shared exercise sheet, the same one every other surface opens. */}
      <ExerciseSheet
        exercise={
          information === null
            ? null
            : { name: information.name, catalogExerciseId: information.catalogExerciseId }
        }
        plan={
          information === null
            ? null
            : {
                role: information.role,
                targetSets: information.targetSets,
                targetReps: information.targetReps,
                isAmrap: information.isAmrap,
              }
        }
        onClose={() => setInformation(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  body: {
    fontSize: fontSize.body,
    lineHeight: 20,
  },
  dayTitle: {
    fontSize: fontSize.cardTitle,
    fontWeight: '700',
    marginTop: spacing.card,
    marginBottom: spacing.label,
  },
  roleDot: {
    width: dataMark.dot,
    height: dataMark.dot,
    borderRadius: dataMark.dot / 2,
  },
  roleRing: {
    width: dataMark.dot,
    height: dataMark.dot,
    borderRadius: dataMark.dot / 2,
    borderWidth: 1,
  },
  configBody: {
    paddingLeft: spacing.gutter,
  },
  error: {
    fontSize: fontSize.helper,
    marginTop: spacing.cardGap,
  },
});
