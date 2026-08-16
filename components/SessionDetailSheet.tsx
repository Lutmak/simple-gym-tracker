import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { Button } from './Button';
import { Field } from './Field';
import { NumberStepper } from './NumberStepper';
import { Row } from './Row';
import { SegmentedControl } from './SegmentedControl';
import { Sheet } from './Sheet';
import { fontSize, spacing, tabBar } from '../utils/scale';
import {
  loadFreeLogDetail,
  loadWeekDetail,
  sessionDetailsOfWeek,
  sessionExercises,
  type LoggedSet,
  type SessionDetail,
  type SessionDetailStatus,
  type SessionExerciseView,
} from '../utils/routineProgress';
import { updateLoggedSet } from '../utils/sessionLogEdit';
import type { RoutineDatabase, RoutineUnit } from '../utils/routineActions';

/**
 * A week, a day, and the set you got wrong — one sheet (SPECS.md P1, P2).
 *
 * Both entry points into history end here, because they are the same question asked from two
 * places: a week tile asks "how did that week go?", a calendar day asks "what happened that day?".
 * The app has one motion language (ENGINEERING.md §3.5) and a bottom sheet means *a decision about
 * the thing you touched*, so both slide up the same panel rather than pushing a screen or raising
 * the dead-end dialog the calendar used to.
 *
 * Three steps, back-linked: the **week** lists its sessions with what became of each; a **session**
 * shows the plan and what was logged against it, exercise by exercise; a **set** can be corrected
 * with the app's steppers, because the user reports reality and reality is sometimes mistyped
 * (§7.3). Tapping an exercise anywhere here opens R2's shared exercise sheet — the caller owns that
 * swap, so there is never a sheet inside a sheet.
 */

export type SessionDetailTarget =
  | {
      kind: 'week';
      routineId: number;
      cycleId: number;
      cycleNumber: number;
      weekNumber: number;
    }
  | {
      kind: 'session';
      routineId: number;
      cycleId: number;
      cycleNumber: number;
      weekNumber: number;
      sessionId: number;
    }
  | { kind: 'freeLog'; workoutLogId: number };

export type SessionDetailSheetProps = {
  /** Null closes the sheet; a target opens it. */
  target: SessionDetailTarget | null;
  /** The caller hides the sheet while another one is open, never stacks them. */
  visible: boolean;
  onClose: () => void;
  /** Opens R2's exercise sheet for the exercise that was tapped. */
  onOpenExercise: (exerciseName: string) => void;
  /** A set was corrected — the screen reloads what it derives from the logs. */
  onEdited: () => void;
  formatDate: (stamp: number) => string;
  testID?: string;
};

interface EditingSet {
  exerciseName: string;
  set: LoggedSet;
  position: number;
  total: number;
}

const formatWeight = (value: number): string => String(Number(value.toFixed(1)));

const statusKey = (status: SessionDetailStatus): string => {
  switch (status) {
    case 'completed':
      return 'progressStatusCompleted';
    case 'moved':
      return 'progressStatusMoved';
    case 'discarded':
      return 'progressStatusDiscarded';
    case 'pending':
      return 'progressStatusPending';
    case 'free':
      return 'progressStatusFree';
  }
};

export function SessionDetailSheet({
  target,
  visible,
  onClose,
  onOpenExercise,
  onEdited,
  formatDate,
  testID,
}: SessionDetailSheetProps) {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const db = useSQLiteContext();

  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<SessionDetail[]>([]);
  const [weekTitle, setWeekTitle] = useState<string | null>(null);
  const [roundingIncrement, setRoundingIncrement] = useState(2.5);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [editing, setEditing] = useState<EditingSet | null>(null);
  const [reps, setReps] = useState<number | null>(null);
  const [weight, setWeight] = useState<number | null>(null);
  const [unit, setUnit] = useState<RoutineUnit>('kg');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const routineDb: RoutineDatabase = {
    run: (sql, params) => db.runAsync(sql, (params ?? []) as never[]),
    get: async (sql, params) =>
      (await db.getFirstAsync<Record<string, unknown>>(sql, (params ?? []) as never[])) ??
      undefined,
    getAll: async (sql, params) =>
      db.getAllAsync<Record<string, unknown>>(sql, (params ?? []) as never[]),
  };

  const reload = React.useCallback(async () => {
    if (target === null) {
      return;
    }
    setLoading(true);
    try {
      if (target.kind === 'freeLog') {
        const detail = await loadFreeLogDetail(routineDb, target.workoutLogId);
        setSessions(detail === null ? [] : [detail]);
        setWeekTitle(null);
        setRoundingIncrement(2.5);
      } else {
        const week = await loadWeekDetail(
          routineDb,
          target.routineId,
          target.cycleId,
          target.weekNumber,
        );
        setSessions(sessionDetailsOfWeek(week));
        setWeekTitle(
          t('progressWeekDetailTitle', {
            week: week.weekNumber,
            cycle: week.cycleNumber,
          }),
        );
        setRoundingIncrement(week.roundingIncrement);
      }
    } catch (loadError: unknown) {
      console.error('Error loading the session detail:', loadError);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [db, t, target]);

  useEffect(() => {
    if (target === null) {
      setSessions([]);
      setSelectedSessionId(null);
      setEditing(null);
      setError(null);
      return;
    }
    setSelectedSessionId(target.kind === 'session' ? target.sessionId : null);
    setEditing(null);
    setError(null);
    void reload();
  }, [reload, target]);

  const isFreeLog = target?.kind === 'freeLog';
  const selected: SessionDetail | null = isFreeLog
    ? (sessions[0] ?? null)
    : (sessions.find((session) => session.sessionId === selectedSessionId) ?? null);

  const openSet = (exerciseName: string, set: LoggedSet, position: number, total: number) => {
    setEditing({ exerciseName, set, position, total });
    setReps(set.reps);
    setWeight(set.weight);
    setUnit(set.unit);
    setError(null);
  };

  const saveSet = async () => {
    if (editing === null || saving) {
      return;
    }
    if (reps === null || weight === null) {
      setError(t('progressEditInvalid'));
      return;
    }
    setSaving(true);
    try {
      await updateLoggedSet(routineDb, editing.set.weightLogId, {
        reps: Math.round(reps),
        weight,
        unit,
      });
      setEditing(null);
      setError(null);
      await reload();
      onEdited();
    } catch {
      setError(t('progressEditInvalid'));
    } finally {
      setSaving(false);
    }
  };

  const title = (): string | undefined => {
    if (editing !== null) {
      return t('progressEditSetTitle', {
        position: editing.position,
        total: editing.total,
      });
    }
    if (selected !== null) {
      return selected.name;
    }
    return weekTitle ?? undefined;
  };

  const back = (): (() => void) | undefined => {
    if (editing !== null) {
      return () => {
        setEditing(null);
        setError(null);
      };
    }
    if (selected !== null && !isFreeLog) {
      return () => setSelectedSessionId(null);
    }
    return undefined;
  };

  const renderWeek = () => (
    <>
      {sessions.length === 0 && !loading && (
        <Text style={[styles.helper, { color: tokens.textSecondary }]}>
          {t('progressWeekEmpty')}
        </Text>
      )}
      {sessions.map((session) => (
        <Row
          key={session.sessionId ?? session.name}
          label={session.name}
          detail={`${session.date === null ? '' : `${formatDate(session.date)} · `}${t(
            statusKey(session.status),
          )}`}
          detailBelow
          right={
            <Ionicons name="chevron-forward" size={tabBar.icon} color={tokens.textSecondary} />
          }
          onPress={() => setSelectedSessionId(session.sessionId)}
          divided
          testID={`session-detail-week-row-${session.sessionId ?? 0}`}
        />
      ))}
    </>
  );

  const renderExercise = (view: SessionExerciseView) => {
    const planned = view.planned;
    const planLine =
      planned === null
        ? t('progressAddedExercise')
        : t('progressPlanLine', {
            sets: planned.targetSets,
            reps: planned.isAmrap ? `${planned.targetReps}+` : planned.targetReps,
            load:
              planned.targetWeight === null
                ? t('loadBodyweight')
                : `${formatWeight(planned.targetWeight)} ${planned.unit}`,
          });

    return (
      <View key={view.name} style={styles.exercise}>
        <Row
          label={view.name}
          detail={planLine}
          detailBelow
          right={
            <Ionicons
              name="information-circle-outline"
              size={tabBar.icon}
              color={tokens.textSecondary}
            />
          }
          onPress={() => onOpenExercise(view.name)}
          divided
        />
        {view.sets.length === 0 ? (
          <Text style={[styles.helper, { color: tokens.textSecondary }]}>
            {t('progressNothingLogged')}
          </Text>
        ) : (
          view.sets.map((set, index) => (
            <Row
              key={set.weightLogId}
              label={t('progressSetPosition', {
                position: index + 1,
                total: view.sets.length,
              })}
              detail={t('progressSetLogged', {
                reps: set.reps,
                weight: formatWeight(set.weight),
                unit: set.unit,
              })}
              onPress={() => openSet(view.name, set, index + 1, view.sets.length)}
              divided
              testID={`session-detail-set-${set.weightLogId}`}
            />
          ))
        )}
      </View>
    );
  };

  const renderSession = (session: SessionDetail) => (
    <>
      <Text style={[styles.subtitle, { color: tokens.textSecondary }]}>
        {`${session.date === null ? '' : `${formatDate(session.date)} · `}${t(
          statusKey(session.status),
        )}`}
      </Text>
      {sessionExercises(session).map(renderExercise)}
    </>
  );

  const renderEditor = (edit: EditingSet) => (
    <>
      <Text style={[styles.subtitle, { color: tokens.textSecondary }]}>
        {t('progressEditSetSubtitle', {
          exercise: edit.exerciseName,
          reps: edit.set.reps,
          weight: formatWeight(edit.set.weight),
          unit: edit.set.unit,
        })}
      </Text>
      <Field label={t('progressEditReps')}>
        <NumberStepper
          value={reps}
          onChange={setReps}
          step={1}
          min={1}
          disabled={saving}
          testID="session-detail-reps"
        />
      </Field>
      <Field
        label={t('progressEditWeight', { unit })}
        hint={t('progressEditWeightHint', { step: formatWeight(roundingIncrement) })}
      >
        <NumberStepper
          value={weight}
          onChange={setWeight}
          step={roundingIncrement}
          min={0}
          disabled={saving}
          testID="session-detail-weight"
        />
      </Field>
      <Field label={t('progressEditUnit')}>
        <SegmentedControl<RoutineUnit>
          options={[
            { value: 'kg', label: t('kg') },
            { value: 'lb', label: t('lbs') },
          ]}
          value={unit}
          onChange={setUnit}
          disabled={saving}
          testID="session-detail-unit"
        />
      </Field>
      {error !== null && (
        <Text style={[styles.error, { color: tokens.warning }]}>{error}</Text>
      )}
      <Button
        label={t('progressEditSave')}
        onPress={saveSet}
        disabled={saving}
        style={styles.save}
        testID="session-detail-save"
      />
    </>
  );

  return (
    <Sheet
      visible={visible && target !== null}
      onClose={onClose}
      title={title()}
      onBack={back()}
      testID={testID ?? 'session-detail-sheet'}
    >
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {loading && sessions.length === 0 ? (
          <ActivityIndicator color={tokens.accent} />
        ) : editing !== null ? (
          renderEditor(editing)
        ) : selected !== null ? (
          renderSession(selected)
        ) : (
          renderWeek()
        )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    flexShrink: 1,
  },
  bodyContent: {
    paddingBottom: spacing.card,
  },
  subtitle: {
    fontSize: fontSize.helper,
    marginBottom: spacing.cardGap,
  },
  helper: {
    fontSize: fontSize.helper,
    marginBottom: spacing.cardGap,
  },
  exercise: {
    marginBottom: spacing.cardGap,
  },
  error: {
    fontSize: fontSize.helper,
    marginBottom: spacing.cardGap,
  },
  save: {
    alignSelf: 'stretch',
    marginTop: spacing.cardGap,
  },
});
