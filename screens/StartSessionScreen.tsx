import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { useQueueRevision } from '../context/QueueRevision';
import { Button } from '../components/Button';
import AppTextInput from '../components/AppTextInput';
import { Field } from '../components/Field';
import { NumberStepper } from '../components/NumberStepper';
import { Row } from '../components/Row';
import { Screen } from '../components/Screen';
import { Section } from '../components/Section';
import { SegmentedControl } from '../components/SegmentedControl';
import { Sheet } from '../components/Sheet';
import { Timer } from '../components/Timer';
import { fontSize, spacing, tabBar, touchTarget } from '../utils/scale';
import {
  BAR_PROFILES,
  STANDARD_PLATES,
  barWeightFor,
  composeLoad,
  suggestPlates,
  type BarProfileKey,
} from '../utils/barProfiles';
import {
  belowTarget,
  buildPlannedDraft,
  loadRunnerSession,
  nextExtraSet,
  formatRunnerPlanLine,
  runnerTargetForSet,
  runnerTargetsFor,
  saveRunnerBarProfile,
  saveSessionLog,
  type LoggedSet,
  type RunnerExercise,
  type RunnerSession,
  type RunnerTargetSet,
  type RunnerDraft,
  warmupSetsFor,
} from '../utils/sessionRunner';
import { dayStampOf } from '../utils/today';
import type { RoutineDatabase, RoutineUnit } from '../utils/routineActions';
import type { InicioStackParamList } from '../App';

type Props = NativeStackScreenProps<InicioStackParamList, 'StartSession'>;

interface RestState {
  remaining: number;
  running: boolean;
}

interface EditingSet {
  exerciseIndex: number;
  setIndex: number;
}

const formatWeight = (value: number): string => String(Number(value.toFixed(1)));

const pressStyle = (pressed: boolean) => (pressed ? styles.pressed : null);

const BAR_PROFILE_KEYS = Object.keys(BAR_PROFILES) as BarProfileKey[];

const barProfileLabelKey = (profile: BarProfileKey): string => {
  switch (profile) {
    case 'olympic':
      return 'runnerBarProfileOlympic';
    case 'semi-olympic':
      return 'runnerBarProfileSemiOlympic';
    case 'smith':
      return 'runnerBarProfileSmith';
    case 'ez':
      return 'runnerBarProfileEz';
    case 'custom':
      return 'runnerBarProfileCustom';
  }
};

export default function StartSessionScreen({ navigation, route }: Props) {
  const { weekSessionId } = route.params;
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const db = useSQLiteContext();
  const { bump } = useQueueRevision();

  const [session, setSession] = useState<RunnerSession | null>(null);
  const [draft, setDraft] = useState<RunnerDraft>([]);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [warmupEnabled, setWarmupEnabled] = useState<boolean[]>([]);
  const [warmupDone, setWarmupDone] = useState<Set<string>>(() => new Set());
  const [warmupCollapsed, setWarmupCollapsed] = useState<Set<number>>(() => new Set());
  const [editing, setEditing] = useState<EditingSet | null>(null);
  const [informationExercise, setInformationExercise] = useState<RunnerExercise | null>(null);
  const [rest, setRest] = useState<RestState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  const routineDb: RoutineDatabase = {
    run: (sql, params) => db.runAsync(sql, (params ?? []) as never[]),
    get: async (sql, params) =>
      (await db.getFirstAsync<Record<string, unknown>>(sql, (params ?? []) as never[])) ??
      undefined,
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
        setDraft(buildPlannedDraft(loaded));
        setWarmupEnabled(loaded.exercises.map((exercise) => exercise.role === 'main'));
        setWarmupDone(new Set());
        setWarmupCollapsed(new Set());
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

  const currentExercise = session?.exercises[exerciseIndex];
  const currentSets = draft[exerciseIndex] ?? [];
  const warmups =
    session !== null && currentExercise !== undefined
      ? warmupSetsFor(currentExercise, session)
      : [];
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
        return remaining <= 0 ? null : { ...current, remaining };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [running]);

  useEffect(() => {
    if (session === null || draft.length === 0 || saving) {
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
  }, [draft.length, navigation, saving, session, t]);

  const startRest = (role: RunnerExercise['role']) => {
    if (session === null) {
      return;
    }
    const seconds = role === 'main' ? session.restMainSeconds : session.restAccessorySeconds;
    if (seconds > 0) {
      setRest({ remaining: seconds, running: true });
    }
  };

  const adjustRest = (delta: number) => {
    setRest((current) => {
      if (current === null) {
        return null;
      }
      const remaining = Math.max(0, current.remaining + delta);
      return remaining === 0 ? null : { ...current, remaining };
    });
  };

  const handleBack = () => {
    if (exerciseIndex > 0) {
      setExerciseIndex((current) => current - 1);
      return;
    }
    navigation.goBack();
  };

  const openExerciseInformation = (exercise: RunnerExercise) => {
    setInformationExercise(exercise);
  };

  const commitSet = (value: LoggedSet | null) => {
    if (editing === null || session === null) {
      return;
    }
    const { exerciseIndex: selectedExercise, setIndex } = editing;
    setDraft((current) => {
      const next = current.map((sets) => [...sets]);
      const exerciseSets = next[selectedExercise] ?? [];
      exerciseSets[setIndex] = value;
      next[selectedExercise] = exerciseSets;
      return next;
    });
    setEditing(null);
    startRest(session.exercises[selectedExercise].role);
  };

  const commitBarProfile = async (
    exercise: RunnerExercise,
    barProfile: BarProfileKey,
    barWeight: number | null,
  ): Promise<void> => {
    try {
      await saveRunnerBarProfile(routineDb, exercise.sessionExerciseId, barProfile, barWeight);
      setSession((current) =>
        current === null
          ? current
          : {
              ...current,
              exercises: current.exercises.map((candidate) =>
                candidate.sessionExerciseId === exercise.sessionExerciseId
                  ? {
                      ...candidate,
                      barProfile,
                      barWeight: barProfile === 'custom' ? barWeight : null,
                    }
                  : candidate,
              ),
            },
      );
    } catch (error) {
      console.error('Error saving bar profile:', error);
      Alert.alert(t('errorTitle'), t('runnerBarSaveFailed'));
      throw error;
    }
  };

  const addExtraSet = () => {
    if (session === null || currentExercise === undefined) {
      return;
    }
    const extra = nextExtraSet(currentExercise, session, currentSets);
    setDraft((current) => {
      const next = current.map((sets) => [...sets]);
      next[exerciseIndex] = [...(next[exerciseIndex] ?? []), extra];
      return next;
    });
  };

  const markAllWarmups = () => {
    const next = new Set(warmupDone);
    warmups.forEach((_, index) => next.add(`${exerciseIndex}:${index}`));
    setWarmupDone(next);
    setWarmupCollapsed((current) => new Set(current).add(exerciseIndex));
  };

  const toggleWarmup = (warmupIndex: number) => {
    const key = `${exerciseIndex}:${warmupIndex}`;
    setWarmupDone((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const enableWarmups = () => {
    setWarmupEnabled((current) => {
      const next = [...current];
      next[exerciseIndex] = true;
      return next;
    });
  };

  const finishSession = async () => {
    if (session === null || saving) {
      return;
    }
    setSaving(true);
    try {
      await saveSessionLog(routineDb, weekSessionId, session, draft);
      bump();
      navigation.getParent()?.navigate('Progress');
    } catch (error) {
      console.error('Error saving session:', error);
      setSaving(false);
      Alert.alert(t('errorTitle'), t('runnerSaveFailed'));
    }
  };

  if (loadError) {
    return (
      <Screen fill testID="runner-error">
        <View style={styles.center}>
          <Text style={[styles.errorTitle, { color: tokens.textPrimary }]}>{t('errorTitle')}</Text>
          <Text style={[styles.helper, { color: tokens.textSecondary }]}>
            {t('runnerLoadFailed')}
          </Text>
          <Button label={t('ok')} onPress={() => navigation.goBack()} style={styles.errorButton} />
        </View>
      </Screen>
    );
  }

  if (session === null || currentExercise === undefined) {
    return (
      <Screen fill testID="runner-loading">
        <View style={styles.runner} />
      </Screen>
    );
  }

  const planUnit = currentExercise.unitOverride ?? session.unit;
  const totalRows = Math.max(currentExercise.targetSets, currentSets.length);
  const isLastExercise = exerciseIndex === session.exercises.length - 1;
  const isWarmupOn = warmupEnabled[exerciseIndex] === true;
  const isWarmupCollapsed = warmupCollapsed.has(exerciseIndex);

  const planLineFor = (exercise: RunnerExercise): string => {
    const exerciseUnit = exercise.unitOverride ?? session.unit;
    return formatRunnerPlanLine(runnerTargetsFor(exercise, session), {
      role: t(exercise.role === 'main' ? 'roleMain' : 'roleAccessory'),
      setsOf: t('runnerPlanSetsOf'),
      maxReps: t('runnerMaxReps'),
      unit: exerciseUnit,
      missingWeight:
        exercise.loadSource === 'bodyweight'
          ? t('loadBodyweight')
          : t('runnerWeightToLearn'),
    });
  };
  const planLine = planLineFor(currentExercise);
  const informationPlanLine =
    informationExercise === null ? null : planLineFor(informationExercise);

  const formatTargetLoad = (target: RunnerTargetSet): string => {
    if (target.targetWeight !== null) {
      return `${formatWeight(target.targetWeight)} ${planUnit}`;
    }
    return currentExercise.loadSource === 'bodyweight'
      ? t('loadBodyweight')
      : t('runnerWeightToLearn');
  };

  const formatSetDetail = (target: RunnerTargetSet, logged: LoggedSet): string => {
    const loggedUnit = logged.unit ?? planUnit;
    const weight =
      logged.weight === null
        ? formatTargetLoad(target)
        : `${formatWeight(logged.weight)} ${loggedUnit}`;
    const sameAsTarget =
      logged.reps === target.targetReps &&
      logged.weight === target.targetWeight &&
      loggedUnit === planUnit;
    if (sameAsTarget && target.isAmrap) {
      return `${t('runnerMaxReps')} · ${weight}`;
    }
    if (sameAsTarget) {
      return `${target.targetReps} ${t('Reps')} · ${weight}`;
    }
    const targetReps = `${target.targetReps}${target.isAmrap ? '+' : ''} ${t('Reps')}`;
    return `${logged.reps} ${t('Reps')} · ${t('runnerTargetWord')} ${targetReps} · ${weight}`;
  };

  const belowTargetNote = (setIndex: number, logged: LoggedSet): string | null => {
    if (setIndex >= currentExercise.targetSets) {
      return null;
    }
    const result = belowTarget(
      currentExercise,
      logged,
      session.roundingIncrement,
      session.weekNumber,
      setIndex,
    );
    const notes: string[] = [];
    if (result.repsShort > 0) {
      notes.push(t('runnerBelowReps', { count: result.repsShort }));
    }
    if (result.weightShort !== null) {
      notes.push(
        t('runnerBelowWeight', {
          weight: formatWeight(result.weightShort),
          unit: logged.unit ?? planUnit,
        }),
      );
    }
    return notes.length === 0 ? null : notes.join(' · ');
  };

  const renderSetRow = (setIndex: number) => {
    const logged = currentSets[setIndex] ?? null;
    const target = runnerTargetForSet(currentExercise, session, currentSets, setIndex);
    const extra = setIndex >= currentExercise.targetSets;
    const position = extra
      ? session.progressionRule === 'wave'
        ? t('runnerJoker', { n: setIndex - currentExercise.targetSets + 1 })
        : t('runnerExtraSetPosition', {
            n: setIndex - currentExercise.targetSets + 1,
          })
      : t('setPosition', { n: setIndex + 1, total: currentExercise.targetSets });
    const warning = logged === null ? null : belowTargetNote(setIndex, logged);
    const detail =
      logged === null ? (
        <Text style={[styles.rowDetail, { color: tokens.textSecondary }]}>
          {t('runnerNotDone')}
        </Text>
      ) : (
        <View>
          <Text style={[styles.rowDetail, { color: tokens.textSecondary }]}>
            {formatSetDetail(target, logged)}
          </Text>
          {warning !== null && (
            <Text style={[styles.warning, { color: tokens.warning }]}>{warning}</Text>
          )}
        </View>
      );

    return (
      <Row
        key={`${exerciseIndex}:${setIndex}`}
        label={position}
        detailContent={detail}
        detailBelow
        onPress={() => setEditing({ exerciseIndex, setIndex })}
        divided
        testID={`runner-set-${setIndex + 1}`}
      />
    );
  };

  return (
    <Screen fill testID="runner-screen">
      <View style={styles.runner}>
        <View style={[styles.header, { borderBottomColor: tokens.divider }]}>
          <View style={styles.headerTop}>
            <Pressable
              style={({ pressed }) => [styles.iconButton, pressStyle(pressed)]}
              onPress={handleBack}
              accessibilityRole="button"
              accessibilityLabel={t('runnerPreviousExercise')}
              testID="runner-back"
            >
              <Ionicons name="chevron-back" size={tabBar.icon} color={tokens.textPrimary} />
            </Pressable>
            <Text style={[styles.position, { color: tokens.accent }]}>
              {t('runnerExercisePosition', {
                n: exerciseIndex + 1,
                total: session.exercises.length,
              })}
            </Text>
            <View style={styles.elapsed}>
              <Text style={[styles.elapsedLabel, { color: tokens.textSecondary }]}>
                {t('runnerSessionElapsed')}
              </Text>
              <Timer mode="elapsed" size="header" />
            </View>
          </View>
          <Pressable
            style={({ pressed }) => [styles.exerciseHeader, pressStyle(pressed)]}
            onPress={() => openExerciseInformation(currentExercise)}
            accessibilityRole="button"
            accessibilityLabel={t('runnerOpenExerciseInfo')}
            testID="runner-exercise-information"
          >
            <View style={styles.exerciseNameRow}>
              <Text style={[styles.exerciseName, { color: tokens.textPrimary }]} numberOfLines={2}>
                {currentExercise.name}
              </Text>
              <Ionicons name="information-circle-outline" size={tabBar.icon} color={tokens.textSecondary} />
            </View>
            <Text style={[styles.planSummary, { color: tokens.textSecondary }]}>
              {planLine}
            </Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {isWarmupOn && warmups.length > 0 ? (
            <Section title={t('runnerWarmups')} testID="runner-warmups">
              {isWarmupCollapsed ? (
                <Row
                  label={t('runnerWarmupComplete')}
                  onPress={() =>
                    setWarmupCollapsed((current) => {
                      const next = new Set(current);
                      next.delete(exerciseIndex);
                      return next;
                    })
                  }
                  divided
                />
              ) : (
                <>
                  <Row
                    label={t('runnerWarmupAll')}
                    onPress={markAllWarmups}
                    right={<Ionicons name="checkmark-done-outline" size={tabBar.icon} color={tokens.textPrimary} />}
                    divided
                  />
                  {warmups.map((warmup, warmupIndex) => {
                    const done = warmupDone.has(`${exerciseIndex}:${warmupIndex}`);
                    return (
                      <Row
                        key={`${exerciseIndex}:warmup:${warmupIndex}`}
                        label={`${formatWeight(warmup.weight)} ${planUnit} · ${warmup.reps} ${t('Reps')}`}
                        onPress={() => toggleWarmup(warmupIndex)}
                        right={
                          <Ionicons
                            name={done ? 'checkmark-circle' : 'ellipse-outline'}
                            size={tabBar.icon}
                            color={done ? tokens.success : tokens.textSecondary}
                          />
                        }
                        divided
                        testID={`runner-warmup-${warmupIndex + 1}`}
                      />
                    );
                  })}
                </>
              )}
            </Section>
          ) : !isWarmupOn && currentExercise.role === 'accessory' ? (
            <Section testID="runner-warmup-off">
              <Row label={t('runnerAddWarmup')} onPress={enableWarmups} divided />
            </Section>
          ) : null}

          <Section title={t('runnerWorkSets')} testID="runner-work-sets">
            {Array.from({ length: totalRows }, (_, setIndex) => renderSetRow(setIndex))}
            <Row
              label={
                session.progressionRule === 'wave' ? t('runnerAddJoker') : t('runnerAddSet')
              }
              onPress={addExtraSet}
              right={<Ionicons name="add" size={tabBar.icon} color={tokens.textPrimary} />}
              divided
              testID="runner-add-set"
            />
          </Section>
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: tokens.divider }]}>
          {rest !== null && (
            <View style={styles.restFooter} testID="runner-rest">
              <View style={styles.restSummary}>
                <Text style={[styles.restLabel, { color: tokens.textPrimary }]}>
                  {t('runnerRestLabel')} ·
                </Text>
                <Timer
                  mode="countdown"
                  currentSeconds={rest.remaining}
                  paused
                  size="header"
                  testID="runner-rest-timer"
                />
              </View>
              <View style={styles.restActions}>
                <Pressable
                  style={({ pressed }) => [styles.restAction, pressStyle(pressed)]}
                  onPress={() =>
                    setRest((current) =>
                      current === null ? null : { ...current, running: !current.running },
                    )
                  }
                  accessibilityRole="button"
                >
                  <Text style={[styles.restActionLabel, { color: tokens.textPrimary }]}>
                    {rest.running ? t('runnerRestPause') : t('runnerRestResume')}
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.restAction, pressStyle(pressed)]}
                  onPress={() => adjustRest(-15)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.restActionLabel, { color: tokens.textPrimary }]}>
                    {t('runnerSubtractTime')}
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.restAction, pressStyle(pressed)]}
                  onPress={() => adjustRest(15)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.restActionLabel, { color: tokens.textPrimary }]}>
                    {t('addTime')}
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.restAction, pressStyle(pressed)]}
                  onPress={() => setRest(null)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.restActionLabel, { color: tokens.textPrimary }]}>
                    {t('runnerSkipRest')}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
          <Button
            label={isLastExercise ? t('finishSession') : t('runnerNextExercise')}
            onPress={() => {
              startRest(currentExercise.role);
              if (isLastExercise) {
                void finishSession();
              } else {
                setExerciseIndex((current) => current + 1);
              }
            }}
            disabled={saving}
            style={styles.footerButton}
            testID={isLastExercise ? 'runner-finish' : 'runner-next'}
          />
        </View>
      </View>

      {editing !== null && (
        <RunnerSetEditor
          key={`${editing.exerciseIndex}:${editing.setIndex}`}
          visible
          exercise={session.exercises[editing.exerciseIndex]}
          session={session}
          setIndex={editing.setIndex}
          initial={
            draft[editing.exerciseIndex]?.[editing.setIndex] ?? {
              reps: runnerTargetForSet(
                session.exercises[editing.exerciseIndex],
                session,
                draft[editing.exerciseIndex] ?? [],
                editing.setIndex,
              ).targetReps,
              weight: runnerTargetForSet(
                session.exercises[editing.exerciseIndex],
                session,
                draft[editing.exerciseIndex] ?? [],
                editing.setIndex,
              ).targetWeight,
            }
          }
          target={runnerTargetForSet(
            session.exercises[editing.exerciseIndex],
            session,
            draft[editing.exerciseIndex] ?? [],
            editing.setIndex,
          )}
          onClose={() => setEditing(null)}
          onCommit={commitSet}
          onBarProfileChange={(barProfile, barWeight) =>
            commitBarProfile(
              session.exercises[editing.exerciseIndex],
              barProfile,
              barWeight,
            )
          }
        />
      )}

      <Sheet
        visible={informationExercise !== null}
        title={informationExercise?.name}
        onClose={() => setInformationExercise(null)}
        testID="runner-exercise-information-sheet"
      >
        <Section title={t('runnerInfoPlan')} testID="runner-info-plan">
          <Text style={[styles.infoPlan, { color: tokens.textPrimary }]}>
            {informationPlanLine}
          </Text>
          <Row
            label={t('runnerInfoWeek')}
            detail={t('runnerInfoWeekValue', { week: session.weekNumber })}
            divided
          />
        </Section>
      </Sheet>
    </Screen>
  );
}

interface RunnerSetEditorProps {
  visible: boolean;
  exercise: RunnerExercise;
  session: RunnerSession;
  setIndex: number;
  initial: LoggedSet;
  target: RunnerTargetSet;
  onClose: () => void;
  onCommit: (set: LoggedSet | null) => void;
  onBarProfileChange: (barProfile: BarProfileKey, barWeight: number | null) => Promise<void>;
}

function RunnerSetEditor({
  visible,
  exercise,
  session,
  setIndex,
  initial,
  target,
  onClose,
  onCommit,
  onBarProfileChange,
}: RunnerSetEditorProps) {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const [reps, setReps] = useState<number | null>(initial.reps);
  const [weight, setWeight] = useState<number | null>(initial.weight);
  const planUnit = exercise.unitOverride ?? session.unit;
  const [unit, setUnit] = useState<RoutineUnit>(initial.unit ?? planUnit);
  const [barProfile, setBarProfile] = useState<BarProfileKey | null>(
    exercise.barProfile,
  );
  const [customBarWeight, setCustomBarWeight] = useState<number | null>(
    exercise.barWeight,
  );
  const initialBarWeight =
    exercise.barProfile === null
      ? null
      : barWeightFor(exercise.barProfile, exercise.barWeight, unit);
  const [plates, setPlates] = useState<number[]>(() => {
    if (initial.weight === null || initialBarWeight === null) {
      return [];
    }
    return suggestPlates(initial.weight, initialBarWeight, STANDARD_PLATES[unit]) ?? [];
  });
  const [composerOpen, setComposerOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const canEditWeight = exercise.loadSource !== 'bodyweight';
  const currentBarWeight =
    barProfile === null
      ? null
      : barWeightFor(
          barProfile,
          barProfile === 'custom' ? customBarWeight : null,
          unit,
        );

  const changeUnit = (nextUnit: RoutineUnit) => {
    setUnit(nextUnit);
    if (barProfile === null || weight === null) {
      setPlates([]);
      return;
    }
    const nextBarWeight = barWeightFor(
      barProfile,
      barProfile === 'custom' ? customBarWeight : null,
      nextUnit,
    );
    setPlates(
      nextBarWeight === null
        ? []
        : suggestPlates(weight, nextBarWeight, STANDARD_PLATES[nextUnit]) ?? [],
    );
  };

  const chooseBarProfile = (nextProfile: BarProfileKey) => {
    setBarProfile(nextProfile);
    const nextBarWeight = barWeightFor(
      nextProfile,
      nextProfile === 'custom' ? customBarWeight : null,
      unit,
    );
    const nextTotal = weight ?? nextBarWeight;
    if (weight === null && nextTotal !== null) {
      setWeight(nextTotal);
    }
    setPlates(
      nextTotal === null || nextBarWeight === null
        ? []
        : suggestPlates(nextTotal, nextBarWeight, STANDARD_PLATES[unit]) ?? [],
    );
  };

  const changeCustomBarWeight = (nextBarWeight: number | null) => {
    setCustomBarWeight(nextBarWeight);
    if (barProfile !== 'custom') {
      return;
    }
    const nextTotal = weight ?? nextBarWeight;
    if (weight === null && nextBarWeight !== null) {
      setWeight(nextBarWeight);
    }
    setPlates(
      nextTotal === null || nextBarWeight === null
        ? []
        : suggestPlates(nextTotal, nextBarWeight, STANDARD_PLATES[unit]) ?? [],
    );
  };

  const addPlate = (plate: number) => {
    if (currentBarWeight === null) {
      return;
    }
    const nextPlates = [...plates, plate];
    setPlates(nextPlates);
    setWeight(composeLoad(currentBarWeight, nextPlates));
  };

  const removePlate = (plate: number) => {
    if (currentBarWeight === null) {
      return;
    }
    const plateIndex = plates.lastIndexOf(plate);
    if (plateIndex < 0) {
      return;
    }
    const nextPlates = plates.filter((_, index) => index !== plateIndex);
    setPlates(nextPlates);
    setWeight(composeLoad(currentBarWeight, nextPlates));
  };

  const restorePersistedBarProfile = () => {
    setBarProfile(exercise.barProfile);
    setCustomBarWeight(exercise.barWeight);
    const persistedBarWeight =
      exercise.barProfile === null
        ? null
        : barWeightFor(exercise.barProfile, exercise.barWeight, unit);
    setPlates(
      weight === null || persistedBarWeight === null
        ? []
        : suggestPlates(weight, persistedBarWeight, STANDARD_PLATES[unit]) ?? [],
    );
    setComposerOpen(false);
  };

  const saveComposer = async () => {
    if (barProfile === null || savingProfile) {
      return;
    }
    setSavingProfile(true);
    try {
      await onBarProfileChange(
        barProfile,
        barProfile === 'custom' ? customBarWeight : null,
      );
      setComposerOpen(false);
    } catch {
      // The parent reports the database error and keeps the composer open.
    } finally {
      setSavingProfile(false);
    }
  };

  const commit = () => {
    if (reps === null || !Number.isInteger(reps) || reps < 1) {
      return;
    }
    if (canEditWeight && (weight === null || weight <= 0)) {
      return;
    }
    onCommit({
      reps,
      weight: canEditWeight ? weight : null,
      unit: canEditWeight ? unit : undefined,
    });
  };

  const targetReps = target.isAmrap
    ? t('runnerMaxReps')
    : `${target.targetReps} ${t('Reps')}`;
  const targetWeight =
    target.targetWeight === null
      ? exercise.loadSource === 'bodyweight'
        ? t('loadBodyweight')
        : t('runnerWeightToLearn')
      : `${formatWeight(target.targetWeight)} ${planUnit}`;
  const position =
    setIndex >= exercise.targetSets
      ? session.progressionRule === 'wave'
        ? t('runnerJoker', { n: setIndex - exercise.targetSets + 1 })
        : t('runnerExtraSetPosition', { n: setIndex - exercise.targetSets + 1 })
      : t('setPosition', { n: setIndex + 1, total: exercise.targetSets });

  const barSummary =
    barProfile === null
      ? null
      : currentBarWeight === null
        ? t('runnerBarSummaryNoWeight', {
            profile: t(barProfileLabelKey(barProfile)),
          })
        : t('runnerBarSummary', {
            profile: t(barProfileLabelKey(barProfile)),
            weight: formatWeight(currentBarWeight),
            unit,
          });
  const composition =
    weight === null || currentBarWeight === null
      ? null
      : suggestPlates(weight, currentBarWeight, STANDARD_PLATES[unit]);
  const canCommit =
    reps !== null &&
    Number.isInteger(reps) &&
    reps >= 1 &&
    (!canEditWeight || (weight !== null && weight > 0));

  return (
    <Sheet
      visible={visible}
      title={
        composerOpen
          ? t('runnerComposeTitle', {
              total:
                weight === null
                  ? t('runnerWeightToLearn')
                  : `${formatWeight(weight)} ${unit}`,
            })
          : `${exercise.name} · ${position}`
      }
      onClose={onClose}
      onBack={composerOpen ? restorePersistedBarProfile : undefined}
      testID="runner-set-editor"
    >
      {composerOpen && barProfile !== null ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.editorKeyboard}
        >
          <ScrollView
            style={styles.editorScroll}
            contentContainerStyle={styles.composerContent}
            keyboardShouldPersistTaps="handled"
          >
            <Section
              title={t('runnerBarProfileLabel')}
              hint={t('runnerBarProfileFuture')}
              testID="editor-bar-profiles"
            >
              {BAR_PROFILE_KEYS.map((profile) => {
                const profileWeight = barWeightFor(
                  profile,
                  profile === 'custom' ? customBarWeight : null,
                  unit,
                );
                return (
                  <Row
                    key={profile}
                    label={t(barProfileLabelKey(profile))}
                    detail={
                      profileWeight === null
                        ? t('runnerBarProfileNeedsWeight')
                        : `${formatWeight(profileWeight)} ${unit}`
                    }
                    right={
                      <Ionicons
                        name={profile === barProfile ? 'checkmark-circle' : 'ellipse-outline'}
                        size={tabBar.icon}
                        color={profile === barProfile ? tokens.accent : tokens.textSecondary}
                      />
                    }
                    onPress={() => chooseBarProfile(profile)}
                    divided
                    testID={`editor-bar-profile-${profile}`}
                  />
                );
              })}
            </Section>

            {barProfile === 'custom' && (
              <Field label={t('runnerCustomBarWeight', { unit })}>
                <AppTextInput
                  variant="numeric"
                  value={customBarWeight === null ? '' : String(customBarWeight)}
                  onCommit={changeCustomBarWeight}
                  keyboardType="decimal-pad"
                  testID="editor-custom-bar"
                />
              </Field>
            )}

            <Section
              title={t('runnerPlatesTitle')}
              hint={t('runnerPlateHoldToRemove')}
              testID="editor-plates"
            >
              <Text style={[styles.composition, { color: tokens.textPrimary }]}>
                {t('runnerPlatesPerSide')}:{' '}
                {plates.length === 0
                  ? t('runnerNoPlates')
                  : plates.map((plate) => `${formatWeight(plate)} ${unit}`).join(' + ')}
              </Text>
              {STANDARD_PLATES[unit].map((plate) => (
                <Row
                  key={plate}
                  label={`+${formatWeight(plate)} ${unit}`}
                  detail={t('runnerAddPlate')}
                  right={<Ionicons name="add" size={tabBar.icon} color={tokens.textPrimary} />}
                  onPress={() => addPlate(plate)}
                  onLongPress={() => removePlate(plate)}
                  divided
                />
              ))}
              {weight !== null && (currentBarWeight === null || composition === null) && (
                <Text style={[styles.compositionHint, { color: tokens.textSecondary }]}>
                  {t('runnerCompositionUnavailable')}
                </Text>
              )}
            </Section>

            <View style={styles.composerTotal}>
              <Text style={[styles.composerTotalLabel, { color: tokens.textSecondary }]}>
                {t('runnerTotalLabel')}
              </Text>
              <Text style={[styles.composerTotalValue, { color: tokens.textPrimary }]}>
                {weight === null
                  ? t('runnerWeightToLearn')
                  : `${formatWeight(weight)} ${unit}`}
              </Text>
            </View>
            <Button
              label={t('runnerDone')}
              onPress={() => void saveComposer()}
              disabled={savingProfile}
              style={styles.editorButton}
              testID="editor-composer-done"
            />
          </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.editorKeyboard}
        >
          <ScrollView
            style={styles.editorScroll}
            contentContainerStyle={styles.editorContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.editorTarget, { color: tokens.textSecondary }]}>
              {t('runnerTargetDescription', { reps: targetReps, weight: targetWeight })}
            </Text>
            <Field label={t('runnerActualReps')}>
              <NumberStepper
                value={reps}
                onChange={setReps}
                min={1}
                step={1}
                testID="editor-reps"
              />
            </Field>
            {canEditWeight && (
              <Field label={t('runnerWeightLabel')}>
                <View style={styles.unitRow}>
                  <Text style={[styles.unitLabel, { color: tokens.textSecondary }]}>
                    {t('runnerSetUnit')}
                  </Text>
                  <SegmentedControl<RoutineUnit>
                    options={[
                      { value: 'kg', label: 'kg' },
                      { value: 'lb', label: 'lb' },
                    ]}
                    value={unit}
                    onChange={changeUnit}
                    testID="editor-unit"
                  />
                </View>
                <View style={styles.weightStepper}>
                  <NumberStepper
                    value={weight}
                    onChange={setWeight}
                    min={0}
                    step={session.roundingIncrement}
                    testID="editor-weight"
                  />
                  <Text style={[styles.weightUnit, { color: tokens.textPrimary }]}>{unit}</Text>
                </View>
              </Field>
            )}
            {canEditWeight && barSummary !== null && (
              <Row
                label={barSummary}
                detail={t('runnerBarProfileOpen')}
                right={
                  <Ionicons
                    name="chevron-forward"
                    size={tabBar.icon}
                    color={tokens.textPrimary}
                  />
                }
                onPress={() => setComposerOpen(true)}
                divided
                testID="editor-bar-composer"
              />
            )}
            <Row
              label={t('runnerMarkNotDone')}
              onPress={() => onCommit(null)}
              divided
              testID="editor-not-done"
            />
            <Button
              label={t('runnerDone')}
              onPress={commit}
              disabled={!canCommit}
              style={styles.editorButton}
              testID="editor-done"
            />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  runner: {
    flex: 1,
  },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.cardGap,
  },
  headerTop: {
    minHeight: touchTarget.control,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
  },
  iconButton: {
    width: touchTarget.control,
    height: touchTarget.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  position: {
    flex: 1,
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  elapsed: {
    alignItems: 'flex-end',
  },
  elapsedLabel: {
    fontSize: fontSize.caption,
  },
  exerciseHeader: {
    minHeight: touchTarget.row,
    paddingTop: spacing.cardGap,
  },
  exerciseNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
  },
  exerciseName: {
    flex: 1,
    fontSize: fontSize.cardTitle,
    fontWeight: '700',
  },
  planSummary: {
    fontSize: fontSize.helper,
    marginTop: spacing.label,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingBottom: spacing.section,
  },
  rowDetail: {
    fontSize: fontSize.body,
  },
  warning: {
    fontSize: fontSize.helper,
    marginTop: spacing.label,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.cardGap,
    gap: spacing.cardGap,
  },
  footerButton: {
    alignSelf: 'stretch',
  },
  restFooter: {
    gap: spacing.label,
  },
  restSummary: {
    minHeight: touchTarget.control,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.inline,
  },
  restLabel: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  restActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.inline,
  },
  restAction: {
    minHeight: touchTarget.control,
    justifyContent: 'center',
    paddingHorizontal: spacing.inline,
  },
  restActionLabel: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorTitle: {
    fontSize: fontSize.screenTitle,
    fontWeight: '700',
  },
  errorButton: {
    alignSelf: 'stretch',
    marginTop: spacing.section,
  },
  helper: {
    fontSize: fontSize.helper,
    marginTop: spacing.label,
    textAlign: 'center',
  },
  editorTarget: {
    fontSize: fontSize.body,
    marginBottom: spacing.section,
  },
  editorKeyboard: {
    flexShrink: 1,
  },
  editorScroll: {
    flexShrink: 1,
  },
  editorContent: {
    paddingBottom: spacing.cardGap,
  },
  composerContent: {
    paddingBottom: spacing.cardGap,
  },
  unitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.inline,
    marginBottom: spacing.cardGap,
  },
  unitLabel: {
    fontSize: fontSize.helper,
  },
  weightStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
  },
  weightUnit: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  composition: {
    fontSize: fontSize.body,
  },
  compositionHint: {
    fontSize: fontSize.helper,
    marginTop: spacing.label,
  },
  composerTotal: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.inline,
    marginTop: spacing.cardGap,
  },
  composerTotalLabel: {
    fontSize: fontSize.label,
  },
  composerTotalValue: {
    fontSize: fontSize.cardTitle,
    fontWeight: '700',
  },
  editorButton: {
    marginTop: spacing.cardGap,
  },
  infoPlan: {
    fontSize: fontSize.body,
    marginBottom: spacing.section,
  },
  pressed: {
    opacity: 0.7,
  },
});
