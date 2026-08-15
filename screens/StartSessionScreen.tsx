import React, { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { displayFontSize, fontSize, radius, spacing, touchTarget } from '../utils/scale';
import AppTextInput, {
  APP_TEXT_MAX_FONT_SIZE_MULTIPLIER,
  parseNumericInput,
} from '../components/AppTextInput';
import {
  belowTarget,
  loadRunnerSession,
  runnerTargetWeight,
  saveSessionLog,
  sessionTotals,
  warmupSetsFor,
  type LoggedSet,
  type RunnerExercise,
  type RunnerSession,
} from '../utils/sessionRunner';
import { dayStampOf } from '../utils/today';
import type { RoutineDatabase } from '../utils/routineActions';
import type { InicioStackParamList } from '../App';

type Props = NativeStackScreenProps<InicioStackParamList, 'StartSession'>;

interface RestState {
  remaining: number;
  running: boolean;
}

interface SavedSummary {
  sets: number;
  exercises: number;
}

const formatWeight = (value: number): string => String(Number(value.toFixed(1)));

export default function StartSessionScreen({ navigation, route }: Props) {
  const { weekSessionId } = route.params;
  const { theme } = useTheme();
  const { t } = useTranslation();
  const db = useSQLiteContext();

  const [session, setSession] = useState<RunnerSession | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState<(LoggedSet | null)[][]>([]);
  const [showWarmups, setShowWarmups] = useState(true);
  const [warmupDone, setWarmupDone] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [rest, setRest] = useState<RestState | null>(null);
  const [savedSummary, setSavedSummary] = useState<SavedSummary | null>(null);

  const routineDb: RoutineDatabase = {
    run: (sql, params) => db.runAsync(sql, (params ?? []) as never[]),
    get: async (sql, params) =>
      (await db.getFirstAsync<Record<string, unknown>>(
        sql,
        (params ?? []) as never[],
      )) ?? undefined,
    getAll: async (sql, params) =>
      db.getAllAsync<Record<string, unknown>>(sql, (params ?? []) as never[]),
  };

  useEffect(() => {
    let cancelled = false;
    loadRunnerSession(routineDb, weekSessionId, dayStampOf(new Date()))
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setSession(loaded);
        setDraft(
          loaded.exercises.map((exercise) =>
            Array.from({ length: exercise.targetSets }, () => null),
          ),
        );
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Error loading session:', error);
          setLoadError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [db, weekSessionId]);

  const loggedCount =
    session === null
      ? 0
      : session.exercises.reduce(
          (total, exercise, index) =>
            total + (draft[index] ?? []).filter((set) => set !== null).length,
          0,
        );

  useEffect(() => {
    if (savedSummary !== null || loggedCount === 0) {
      return;
    }
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      event.preventDefault();
      Alert.alert(t('runnerExitTitle'), t('runnerExitMessage'), [
        { text: t('runnerStay'), style: 'cancel' },
        {
          text: t('runnerExit'),
          style: 'destructive',
          onPress: () => navigation.dispatch(event.data.action),
        },
      ]);
    });
    return unsubscribe;
  }, [navigation, savedSummary, loggedCount, t]);

  const running = rest?.running ?? false;
  useEffect(() => {
    if (!running) {
      return;
    }
    const interval = setInterval(() => {
      setRest((current) => {
        if (current === null || !current.running) {
          return current;
        }
        const remaining = current.remaining - 1;
        return remaining <= 0
          ? { remaining: 0, running: false }
          : { ...current, remaining };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [running]);

  const startRest = (role: RunnerExercise['role']) => {
    if (session === null) {
      return;
    }
    const seconds =
      role === 'main' ? session.restMainSeconds : session.restAccessorySeconds;
    if (seconds <= 0) {
      return;
    }
    setRest({ remaining: seconds, running: true });
  };

  const adjustRest = (delta: number) => {
    setRest((current) =>
      current === null
        ? current
        : { ...current, remaining: Math.max(0, current.remaining + delta) },
    );
  };

  const logSet = (exerciseIndex: number, setIndex: number, set: LoggedSet) => {
    setDraft((current) => {
      const next = current.map((exercise) => [...exercise]);
      next[exerciseIndex][setIndex] = set;
      return next;
    });
    if (session !== null) {
      startRest(session.exercises[exerciseIndex].role);
    }
  };

  const handleRowPress = (exerciseIndex: number, setIndex: number) => {
    if (session === null) {
      return;
    }
    const exercise = session.exercises[exerciseIndex];
    const logged = draft[exerciseIndex]?.[setIndex];
    if (logged !== null && logged !== undefined) {
      setEditing(`${exerciseIndex}:${setIndex}`);
      return;
    }
    if (exercise.isAmrap) {
      setEditing(`${exerciseIndex}:${setIndex}`);
      return;
    }
    logSet(exerciseIndex, setIndex, {
      reps: exercise.targetReps,
      weight: runnerTargetWeight(exercise, session.roundingIncrement),
    });
  };

  const finishSession = () => {
    if (session === null) {
      return;
    }
    const totals = sessionTotals(session, draft);
    const setsText = t('runnerSetsCount', { count: totals.loggedSets });
    const exercisesText = t('runnerExercisesCount', { count: totals.loggedExercises });
    const confirmAndSave = () => {
      saveSessionLog(routineDb, weekSessionId, session, draft)
        .then(() => {
          setSavedSummary({
            sets: totals.loggedSets,
            exercises: totals.loggedExercises,
          });
          setRest(null);
        })
        .catch((error) => {
          console.error('Error saving session:', error);
          Alert.alert(t('errorTitle'), t('runnerSaveFailed'));
        });
    };
    if (totals.loggedSets === 0) {
      Alert.alert(t('runnerNothingSavedTitle'), t('runnerNothingSavedMessage'), [
        { text: t('runnerStay'), style: 'cancel' },
        {
          text: t('runnerExit'),
          style: 'destructive',
          onPress: () => navigation.goBack(),
        },
      ]);
      return;
    }
    const confirmDialog = () => {
      Alert.alert(
        t('finishConfirmTitle'),
        t('finishConfirmMessage', {
          session: session.sessionName,
          sets: setsText,
          exercises: exercisesText,
        }),
        [
          { text: t('Cancel'), style: 'cancel' },
          { text: t('finishSession'), onPress: confirmAndSave },
        ],
      );
    };
    const unlogged = totals.totalSets - totals.loggedSets;
    if (unlogged > 0) {
      Alert.alert(
        t('finishUnloggedTitle'),
        t('finishUnloggedMessage', { count: unlogged }),
        [
          { text: t('Cancel'), style: 'cancel' },
          { text: t('finishAnyway'), onPress: confirmDialog },
        ],
      );
    } else {
      confirmDialog();
    }
  };

  const buildNote = (exercise: RunnerExercise, set: LoggedSet): string | null => {
    if (session === null) {
      return null;
    }
    const { repsShort, weightShort } = belowTarget(
      exercise,
      set,
      session.roundingIncrement,
    );
    const unit = exercise.unitOverride ?? session.unit;
    const parts: string[] = [];
    if (repsShort > 0) {
      parts.push(t('runnerBelowReps', { count: repsShort }));
    }
    if (weightShort !== null) {
      parts.push(
        t('runnerBelowWeight', {
          weight: formatWeight(weightShort),
          unit,
        }),
      );
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  };

  if (loadError) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: theme.background }]}>
        <Text style={[styles.screenTitle, { color: theme.text }]}>{t('errorTitle')}</Text>
        <Text style={[styles.helper, { color: theme.text }]}>{t('runnerLoadFailed')}</Text>
        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: theme.buttonBackground },
            pressed && styles.pressed,
          ]}
          onPress={() => navigation.goBack()}
        >
          <Text style={[styles.primaryButtonText, { color: theme.buttonText }]}>
            {t('ok')}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (session === null) {
    return <View style={[styles.container, { backgroundColor: theme.background }]} />;
  }

  if (savedSummary !== null) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: theme.background }]}>
        <Text
          maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          style={[styles.completedTitle, { color: theme.text }]}
        >
          {t('sessionSavedTitle')}
        </Text>
        <Text style={[styles.savedMessage, { color: theme.text }]}>
          {t('sessionSavedMessage', {
            session: session.sessionName,
            sets: t('runnerSetsCount', { count: savedSummary.sets }),
            exercises: t('runnerExercisesCount', { count: savedSummary.exercises }),
          })}
        </Text>
        <Text style={[styles.helper, { color: theme.text }]}>{t('sessionSavedWhere')}</Text>
        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            styles.savedButton,
            { backgroundColor: theme.buttonBackground },
            pressed && styles.pressed,
          ]}
          onPress={() => navigation.getParent()?.navigate('Progress')}
        >
          <Text style={[styles.primaryButtonText, { color: theme.buttonText }]}>
            {t('sessionSavedSeeProgress')}
          </Text>
        </Pressable>
      </View>
    );
  }

  const totals = sessionTotals(session, draft);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <Text style={[styles.screenTitle, { color: theme.text }]}>
          {session.sessionName}
        </Text>
        <Text style={[styles.helper, { color: theme.text }]}>{session.workoutName}</Text>

        <View style={[styles.warmupToggleRow, { borderColor: theme.border }]}>
          <Text style={[styles.warmupToggleLabel, { color: theme.text }]}>
            {t('runnerWarmups')}
          </Text>
          <Switch
            value={showWarmups}
            onValueChange={setShowWarmups}
            trackColor={{
              true: theme.buttonBackground,
              false: theme.inactivetint,
            }}
          />
        </View>

        {rest !== null && (
          <View
            style={[
              styles.card,
              styles.restCard,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <Text
              maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              style={[styles.restTimer, { color: theme.text }]}
            >
              {rest.remaining}
              <Text style={[styles.restTimerUnit, { color: theme.text }]}>
                {' '}
                {t('sec')}
              </Text>
            </Text>
            {rest.remaining === 0 ? (
              <>
                <Text style={[styles.helper, { color: theme.text }]}>{t('runnerRestDone')}</Text>
                <Pressable
                  style={({ pressed }) => [
                    styles.restButton,
                    styles.restDoneButton,
                    { borderColor: theme.border },
                    pressed && styles.pressed,
                  ]}
                  onPress={() => setRest(null)}
                >
                  <Text style={[styles.restButtonText, { color: theme.text }]}>
                    {t('skipRest')}
                  </Text>
                </Pressable>
              </>
            ) : (
              <View style={styles.restControls}>
                <Pressable
                  style={({ pressed }) => [
                    styles.restButton,
                    { borderColor: theme.border },
                    pressed && styles.pressed,
                  ]}
                  onPress={() => adjustRest(-15)}
                >
                  <Text style={[styles.restButtonText, { color: theme.text }]}>
                    {t('runnerSubtractTime')}
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.restButton,
                    { borderColor: theme.border },
                    pressed && styles.pressed,
                  ]}
                  onPress={() =>
                    setRest((current) =>
                      current === null ? current : { ...current, running: !current.running },
                    )
                  }
                >
                  <Text style={[styles.restButtonText, { color: theme.text }]}>
                    {rest.running ? t('runnerRestPause') : t('runnerRestResume')}
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.restButton,
                    { borderColor: theme.border },
                    pressed && styles.pressed,
                  ]}
                  onPress={() => adjustRest(15)}
                >
                  <Text style={[styles.restButtonText, { color: theme.text }]}>
                    {t('addTime')}
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.restButton,
                    { borderColor: theme.border },
                    pressed && styles.pressed,
                  ]}
                  onPress={() => setRest(null)}
                >
                  <Text style={[styles.restButtonText, { color: theme.text }]}>
                    {t('skipRest')}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {session.exercises.map((exercise, exerciseIndex) => {
          const unit = exercise.unitOverride ?? session.unit;
          const targetWeight = runnerTargetWeight(exercise, session.roundingIncrement);
          const warmups = warmupSetsFor(exercise, session);
          return (
            <View
              key={exercise.sessionExerciseId}
              style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
            >
              <View style={styles.cardHeader}>
                <Text style={[styles.exerciseName, { color: theme.text }]} numberOfLines={2}>
                  {exercise.name}
                </Text>
                <View style={styles.badgeRow}>
                  <View style={[styles.roleBadge, { borderColor: theme.border }]}>
                    <Text style={[styles.roleBadgeText, { color: theme.text }]}>
                      {t(exercise.role === 'main' ? 'roleMain' : 'roleAccessory')}
                    </Text>
                  </View>
                  <Text style={[styles.unitLabel, { color: theme.text }]}>{unit}</Text>
                </View>
              </View>

              {showWarmups &&
                warmups.map((warmup, warmupIndex) => {
                  const key = `${exerciseIndex}:w${warmupIndex}`;
                  const done = warmupDone.has(key);
                  return (
                    <Pressable
                      key={key}
                      style={({ pressed }) => [
                        styles.warmupRow,
                        pressed && styles.pressed,
                        done && { opacity: 0.5 },
                      ]}
                      onPress={() =>
                        setWarmupDone((current) => {
                          const next = new Set(current);
                          if (next.has(key)) {
                            next.delete(key);
                          } else {
                            next.add(key);
                          }
                          return next;
                        })
                      }
                    >
                      <Ionicons
                        name={done ? 'checkmark-circle' : 'ellipse-outline'}
                        size={20}
                        color={theme.text}
                      />
                      <Text style={[styles.warmupLabel, { color: theme.text }]}>
                        {`${t('runnerWarmup')} ${warmupIndex + 1}`}
                      </Text>
                      <Text style={[styles.warmupTarget, { color: theme.text }]}>
                        {`${formatWeight(warmup.weight)} ${unit} × ${warmup.reps}`}
                      </Text>
                    </Pressable>
                  );
                })}

              {Array.from({ length: exercise.targetSets }, (_, setIndex) => {
                const logged = draft[exerciseIndex]?.[setIndex] ?? null;
                const editingKey = `${exerciseIndex}:${setIndex}`;
                if (editing === editingKey) {
                  return (
                    <SetEditor
                      key={editingKey}
                      unit={unit}
                      targetWeight={targetWeight}
                      initial={logged ?? {
                        reps: exercise.targetReps,
                        weight: targetWeight,
                      }}
                      onCommit={(set) => {
                        setEditing(null);
                        logSet(exerciseIndex, setIndex, set);
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  );
                }
                const note = logged === null ? null : buildNote(exercise, logged);
                return (
                  <Pressable
                    key={editingKey}
                    style={({ pressed }) => [
                      styles.setRow,
                      { borderColor: theme.border },
                      pressed && styles.pressed,
                    ]}
                    onPress={() => handleRowPress(exerciseIndex, setIndex)}
                  >
                    <View style={styles.setRowText}>
                      <Text style={[styles.setPosition, { color: theme.text }]}>
                        {t('setPosition', { n: setIndex + 1, total: exercise.targetSets })}
                      </Text>
                      <Text style={[styles.setTarget, { color: theme.text }]}>
                        {exercise.isAmrap
                          ? `${exercise.targetReps}+`
                          : `${exercise.targetSets} × ${exercise.targetReps}`}
                        {targetWeight === null
                          ? ` · ${t('loadBodyweight')}`
                          : ` · ${formatWeight(targetWeight)} ${unit}`}
                      </Text>
                      {logged !== null && (
                        <Text style={[styles.setLogged, { color: theme.text }]}>
                          {`${logged.reps} ${t('Reps')}`}
                          {logged.weight !== null
                            ? ` · ${formatWeight(logged.weight)} ${unit}`
                            : ''}
                        </Text>
                      )}
                      {note !== null && (
                        <Text style={[styles.belowTargetNote, { color: theme.text }]}>
                          {note}
                        </Text>
                      )}
                    </View>
                    <View style={styles.setRowActions}>
                      {logged !== null && (
                        <Ionicons name="checkmark-circle" size={20} color={theme.text} />
                      )}
                      <Pressable
                        hitSlop={8}
                        accessibilityLabel={t('runnerEditSet')}
                        onPress={() => setEditing(editingKey)}
                      >
                        <Ionicons name="create-outline" size={20} color={theme.text} />
                      </Pressable>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          );
        })}

        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: theme.buttonBackground },
            pressed && styles.pressed,
          ]}
          onPress={finishSession}
        >
          <Text style={[styles.primaryButtonText, { color: theme.buttonText }]}>
            {t('finishSession')}
          </Text>
        </Pressable>
        <Text style={[styles.finishHelper, { color: theme.text }]}>
          {t('finishHelper', {
            logged: totals.loggedSets,
            total: totals.totalSets,
          })}
        </Text>
      </ScrollView>
    </View>
  );
}

interface SetEditorProps {
  unit: string;
  targetWeight: number | null;
  initial: LoggedSet;
  onCommit: (set: LoggedSet) => void;
  onCancel: () => void;
}

const SetEditor = ({
  unit,
  targetWeight,
  initial,
  onCommit,
  onCancel,
}: SetEditorProps) => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [repsRaw, setRepsRaw] = useState(String(initial.reps));
  const [weightRaw, setWeightRaw] = useState(
    initial.weight === null ? '' : String(initial.weight),
  );

  const commit = () => {
    const reps = parseNumericInput(repsRaw);
    if (reps === null || reps < 1 || !Number.isInteger(reps)) {
      return;
    }
    const bodyweight = targetWeight === null;
    const weight = bodyweight ? null : parseNumericInput(weightRaw);
    if (!bodyweight && (weight === null || weight <= 0)) {
      return;
    }
    onCommit({ reps, weight });
  };

  return (
    <View style={[styles.setRow, { borderColor: theme.buttonBackground }]}>
      <View style={styles.editorRow}>
        <View style={styles.editorField}>
          <Text
            maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
            style={[styles.editorLabel, { color: theme.text }]}
          >
            {t('runnerActualReps')}
          </Text>
          <AppTextInput
            variant="numeric"
            value={repsRaw}
            onRawChange={setRepsRaw}
            onSubmitEditing={commit}
            keyboardType="numeric"
            style={styles.editorInput}
          />
        </View>
        {targetWeight !== null && (
          <View style={styles.editorField}>
            <Text
              maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              style={[styles.editorLabel, { color: theme.text }]}
            >
              {t('weightLabel', { unit })}
            </Text>
            <AppTextInput
              variant="numeric"
              value={weightRaw}
              onRawChange={setWeightRaw}
              onSubmitEditing={commit}
              keyboardType="numeric"
              style={styles.editorInput}
            />
          </View>
        )}
      </View>
      <View style={styles.editorActions}>
        <Pressable
          hitSlop={8}
          accessibilityLabel={t('Cancel')}
          onPress={onCancel}
        >
          <Ionicons name="close-circle-outline" size={24} color={theme.text} />
        </Pressable>
        <Pressable
          hitSlop={8}
          accessibilityLabel={t('confirm')}
          onPress={commit}
        >
          <Ionicons name="checkmark-circle" size={24} color={theme.text} />
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.gutter,
  },
  content: {
    padding: spacing.gutter,
    paddingBottom: spacing.section * 2,
  },
  screenTitle: {
    fontSize: fontSize.screenTitle,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: spacing.label,
  },
  helper: {
    fontSize: fontSize.helper,
    opacity: 0.7,
    textAlign: 'center',
    marginTop: spacing.label,
  },
  completedTitle: {
    fontSize: displayFontSize.completedTitle,
    fontWeight: '900',
    textAlign: 'center',
  },
  savedMessage: {
    fontSize: fontSize.body,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: spacing.section,
  },
  savedButton: {
    marginTop: spacing.section,
  },
  warmupToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: radius.card,
    paddingHorizontal: spacing.card,
    paddingVertical: spacing.label,
    marginTop: spacing.card,
  },
  warmupToggleLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.card,
    padding: spacing.card,
    marginTop: spacing.cardGap,
  },
  restCard: {
    alignItems: 'center',
  },
  restTimer: {
    fontSize: displayFontSize.restTimer,
    fontWeight: '800',
  },
  restTimerUnit: {
    fontSize: displayFontSize.displayUnit,
    fontWeight: '600',
  },
  restControls: {
    flexDirection: 'row',
    gap: spacing.inline,
    marginTop: spacing.card,
  },
  restButton: {
    borderRadius: radius.control,
    borderWidth: 1,
    paddingHorizontal: spacing.card,
    minHeight: touchTarget.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restButtonText: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
  restDoneButton: {
    marginTop: spacing.card,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.inline,
    marginBottom: spacing.card,
  },
  exerciseName: {
    fontSize: fontSize.cardTitle,
    fontWeight: '700',
    flex: 1,
  },
  badgeRow: {
    alignItems: 'flex-end',
    gap: spacing.label,
  },
  roleBadge: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.card,
    paddingVertical: 2,
  },
  roleBadgeText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  unitLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  warmupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
    paddingVertical: spacing.label,
  },
  warmupLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
    flex: 1,
  },
  warmupTarget: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.inline,
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: spacing.card,
    paddingVertical: spacing.card,
    marginTop: spacing.cardGap,
  },
  setRowText: {
    flex: 1,
  },
  setPosition: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    opacity: 0.7,
  },
  setTarget: {
    fontSize: fontSize.body,
    fontWeight: '700',
    marginTop: 2,
  },
  setLogged: {
    fontSize: fontSize.body,
    fontWeight: '700',
    marginTop: 2,
  },
  belowTargetNote: {
    fontSize: fontSize.helper,
    fontWeight: '600',
    marginTop: spacing.label,
  },
  setRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
  },
  editorRow: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.inline,
  },
  editorField: {
    flex: 1,
  },
  editorLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    marginBottom: spacing.label,
  },
  editorInput: {
    paddingHorizontal: spacing.inline,
    paddingVertical: spacing.inline,
    minHeight: touchTarget.control,
  },
  editorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
  },
  primaryButton: {
    borderRadius: radius.control,
    paddingHorizontal: spacing.card,
    paddingVertical: spacing.card,
    minHeight: touchTarget.control,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.section,
  },
  primaryButtonText: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
  finishHelper: {
    fontSize: fontSize.caption,
    opacity: 0.7,
    textAlign: 'center',
    marginTop: spacing.card,
  },
  pressed: {
    opacity: 0.7,
  },
});
