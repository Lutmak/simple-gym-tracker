import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import { Button } from '../components/Button';
import { Row } from '../components/Row';
import { Screen } from '../components/Screen';
import { ScreenTitle } from '../components/ScreenTitle';
import { Section } from '../components/Section';
import { ExerciseSheet } from '../components/ExerciseSheet';
import { RoutineActionsSheet } from '../components/RoutineActionsSheet';
import { fontSize, spacing, tabBar } from '../utils/scale';
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
 * R1 — one routine, read (SPECS.md R1, §3.2).
 *
 * The same screen shows a preset and one of the user's own routines, because they are the same
 * thing at different moments: a preset is what a routine looks like before it is copied. Two
 * behaviours changed here and both are the acceptance criterion:
 *
 * - **Activation never asks for a number.** It used to branch — a `wave` preset pushed the 5/3/1
 *   setup wizard, any other preset pushed a screen that demanded a weight per exercise and refused
 *   to activate without one ("Faltan valores"). Both branches are gone with the screen that
 *   collected them; activation is now one call with an empty weight map, which writes every load
 *   as NULL for the first logged session to learn (§3.2, `utils/learnedWeights.ts`).
 * - **The four bespoke action buttons are gone**, replaced by the shared `RoutineActionsSheet` —
 *   the same sheet the Rutinas list opens.
 *
 * The 5/3/1 builder is still reachable, from `+ Nueva rutina`, where building a program is what
 * the user asked for. It is not on the path of activating a routine.
 */
export default function RoutineDetailsScreen({ navigation, route }: Props) {
  const { tokens } = useTheme();
  const { t } = useTranslation();
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

  const progressionText =
    routine.progressionRule === 'wave'
      ? t('progressionWave')
      : routine.progressionRule === 'linear'
        ? t('progressionLinear')
        : t('progressionNone');

  const loadLabel = (exercise: ExerciseSource): string => {
    const exerciseUnit: RoutineUnit = exercise.unitOverride ?? unit;
    if (exercise.loadSource === 'bodyweight') {
      return t('loadBodyweight');
    }
    if (exercise.loadSource === 'absolute') {
      return exercise.absoluteWeight !== null
        ? t('loadAbsoluteValue', {
            weight: formatWeight(exercise.absoluteWeight),
            unit: exerciseUnit,
          })
        : t('weightLearnedOnFirstSession');
    }
    if (exercise.trainingMaxWeight !== null) {
      return t('loadTrainingMaxValue', {
        weight: formatWeight(exercise.trainingMaxWeight),
        unit: exerciseUnit,
      });
    }
    return t('weightLearnedOnFirstSession');
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

  /** Nothing becomes inactive, so there is nothing to confirm — activate on the one tap (§7.5). */
  const primaryAction = () => {
    if (plan.outcome === 'activate' && plan.deactivating === null) {
      void activate(target);
      return;
    }
    setActionsFor(target);
  };

  // A preset has one action; one of the user's routines has four, and they live in the sheet.
  const presetIsActive = target.kind === 'preset' && plan.outcome === 'alreadyActive';
  const primaryLabel =
    target.kind === 'routine'
      ? t('routineActionsButton')
      : presetIsActive
        ? t('activeRoutine')
        : t('activate');

  return (
    <>
      <Screen scroll testID="routine-details-screen">
        <ScreenTitle
          title={routine.name}
          overline={plan.outcome === 'alreadyActive' ? t('routineActiveSection') : undefined}
          onBack={() => navigation.goBack()}
          testID="routine-details-title"
        />

        {routine.description !== null && (
          <Section title={t('description')}>
            <Text style={[styles.body, { color: tokens.textSecondary }]}>{routine.description}</Text>
          </Section>
        )}

        {routine.philosophy !== null && (
          <Section title={t('philosophy')}>
            <Text style={[styles.body, { color: tokens.textSecondary }]}>{routine.philosophy}</Text>
          </Section>
        )}

        <Section title={t('routineSummarySection')} testID="routine-summary">
          <Row
            label={t('sessionCount', { count: sessions.length })}
            detail={orderedWeekdays.map((weekday) => t(WEEKDAY_FULL_KEYS[weekday])).join(' · ')}
            detailBelow
            divided
          />
          <Row label={t('restMainLabel')} detail={formatRest(routine.restMainSeconds)} divided />
          <Row
            label={t('restAccessoryLabel')}
            detail={formatRest(routine.restAccessorySeconds)}
            divided
          />
          <Row label={t('progressionRule')} detail={progressionText} detailBelow divided />
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
                    detail={`${t('routineSetsByReps', {
                      sets: exercise.targetSets,
                      reps: exercise.isAmrap ? `${exercise.targetReps}+` : exercise.targetReps,
                    })} · ${loadLabel(exercise)}`}
                    detailBelow
                    right={
                      <Ionicons
                        name="information-circle-outline"
                        size={tabBar.icon}
                        color={tokens.textSecondary}
                      />
                    }
                    onPress={() => setInformation(exercise)}
                    divided
                  />
                ))}
            </View>
          ))}
        </Section>

        <Button
          label={primaryLabel}
          onPress={primaryAction}
          disabled={busy || presetIsActive}
          style={styles.primary}
          testID="routine-primary-action"
        />

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
  primary: {
    alignSelf: 'stretch',
  },
  error: {
    fontSize: fontSize.helper,
    marginTop: spacing.cardGap,
  },
});
