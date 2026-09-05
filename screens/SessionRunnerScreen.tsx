import React, { useEffect, useRef, useState } from 'react';
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
import { useSettings } from '../context/SettingsContext';
import { useQueueRevision } from '../context/QueueRevision';
import { Button } from '../components/Button';
import AppTextInput from '../components/AppTextInput';
import ExerciseCatalogPicker from '../components/ExerciseCatalogPicker';
import { ExerciseSheet } from '../components/ExerciseSheet';
import { Field } from '../components/Field';
import { NumberStepper } from '../components/NumberStepper';
import { PlatePicker } from '../components/PlatePicker';
import { Row } from '../components/Row';
import { Screen } from '../components/Screen';
import { Section } from '../components/Section';
import { SegmentedControl } from '../components/SegmentedControl';
import { Sheet } from '../components/Sheet';
import { Timer } from '../components/Timer';
import { dataMark, fontSize, spacing, tabBar, touchTarget } from '../utils/scale';
import { mainLiftColours } from '../utils/liftColours';
import {
  BAR_PROFILES,
  STANDARD_PLATES,
  barWeightFor,
  canSaveBarProfile,
  composeLoad,
  defaultBarProfileForCatalogRow,
  formatWeight,
  suggestPlates,
  type BarProfileKey,
} from '../utils/barProfiles';
import {
  belowTarget,
  buildPlannedDraft,
  isUnlearnedSet,
  loadRunnerSession,
  nextExtraSet,
  formatRunnerPlanLine,
  runnerTargetForSet,
  runnerTargetsFor,
  saveRunnerBarProfile,
  saveSessionLog,
  stampMissingSetTimes,
  type LoggedSet,
  type RunnerExercise,
  type RunnerSession,
  type RunnerTargetSet,
  type RunnerDraft,
  warmupSetsFor,
} from '../utils/sessionRunner';
import {
  addFreeSet,
  buildFreeDraft,
  buildFreeLogExercises,
  buildFreeRunnerExercise,
  buildFreeRunnerSession,
  findExerciseIndexByName,
  saveFreeSession,
} from '../utils/freeLogging';
import { buildSessionSummary } from '../utils/sessionSummary';
import { dayStampOf } from '../utils/today';
import { warmupsEnabledFor } from '../utils/routineActions';
import type { RoutineDatabase, RoutineUnit } from '../utils/routineActions';
import type { InicioStackParamList, RootTabParamList } from '../App';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';

type PlannedProps = NativeStackScreenProps<InicioStackParamList, 'StartSession'>;
type FreeProps = NativeStackScreenProps<InicioStackParamList, 'FreeLogging'>;

type RunnerProps =
  | { mode: 'planned'; navigation: PlannedProps['navigation']; route: PlannedProps['route'] }
  | { mode: 'free'; navigation: FreeProps['navigation']; route: FreeProps['route'] };

interface RestState {
  remaining: number;
  running: boolean;
}

interface EditingSet {
  exerciseIndex: number;
  setIndex: number;
}

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

export default function SessionRunnerScreen({ mode, navigation, route }: RunnerProps) {
  const weekSessionId = mode === 'planned' ? route.params.weekSessionId : null;
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const { weightFormat, barProfile: settingsBarProfile } = useSettings();
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
  const [finishSheetVisible, setFinishSheetVisible] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [runnerStartedAt] = useState(() => Date.now());
  const nextTransientExerciseId = useRef(-1);

  const defaultUnit: RoutineUnit = weightFormat === 'lbs' ? 'lb' : 'kg';

  const routineDb: RoutineDatabase = {
    run: (sql, params) => db.runAsync(sql, (params ?? []) as never[]),
    get: async (sql, params) =>
      (await db.getFirstAsync<Record<string, unknown>>(sql, (params ?? []) as never[])) ??
      undefined,
    getAll: async (sql, params) =>
      db.getAllAsync<Record<string, unknown>>(sql, (params ?? []) as never[]),
  };

  const defaultUnitRef = useRef(defaultUnit);
  const translateRef = useRef(t);
  useEffect(() => {
    defaultUnitRef.current = defaultUnit;
    translateRef.current = t;
  });

  /**
   * Loads exactly once per (db, mode, weekSessionId). `defaultUnit` and `t` are
   * read through refs on purpose: both change identity when the user toggles
   * kg/lb or the language in Settings, and the runner stays mounted in the
   * Inicio stack — re-running this would reset `session`/`draft` and silently
   * throw away every logged set. Do not widen these dependencies.
   */
  useEffect(() => {
    let cancelled = false;
    if (mode === 'free') {
      const freeSession = buildFreeRunnerSession(
        translateRef.current('freeSessionName'),
        dayStampOf(new Date()),
        defaultUnitRef.current,
      );
      setSession(freeSession);
      setDraft(buildFreeDraft(freeSession.exercises));
      setWarmupEnabled([]);
      setWarmupDone(new Set());
      setWarmupCollapsed(new Set());
      return () => {
        cancelled = true;
      };
    }

    if (weekSessionId === null) {
      setLoadError(true);
      return () => {
        cancelled = true;
      };
    }

    loadRunnerSession(routineDb, weekSessionId, dayStampOf(new Date()))
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setSession(loaded);
        setDraft(buildPlannedDraft(loaded));
        setWarmupEnabled(
          loaded.exercises.map((exercise) =>
            warmupsEnabledFor(exercise.role, exercise.warmupsEnabled),
          ),
        );
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
  }, [db, mode, weekSessionId]);

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

  const hasLoggedSets = draft.some((sets) => sets.some((set) => set !== null));

  useEffect(() => {
    if (session === null || !hasLoggedSets || saving) {
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
  }, [hasLoggedSets, navigation, saving, session, t]);

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

  /**
   * R2's link to the full chart. The tab navigator keeps this stack mounted, so the session in
   * progress is still here when the user comes back — but the sheet closes first, because a sheet
   * left open over a screen the user has navigated away from is a ghost.
   */
  const openExerciseHistory = (exerciseName: string) => {
    setInformationExercise(null);
    navigation
      .getParent<BottomTabNavigationProp<RootTabParamList>>()
      ?.navigate('Progress', { exercise: exerciseName });
  };

  const addExercise = async (selection: {
    catalogExerciseId: string | null;
    name: string;
  }): Promise<void> => {
    if (session === null) {
      return;
    }
    const existingIndex = findExerciseIndexByName(session.exercises, selection.name);
    if (existingIndex >= 0) {
      setExerciseIndex(existingIndex);
      setPickerVisible(false);
      return;
    }
    try {
      let barProfile: RunnerExercise['barProfile'] = null;
      if (selection.catalogExerciseId !== null) {
        const catalogRow = await db.getFirstAsync<{
          equipment: string | null;
          uses_bar: number | null;
        }>(
          'SELECT equipment, uses_bar FROM Catalog_Exercises WHERE exercise_key = ?;',
          [selection.catalogExerciseId],
        );
        barProfile = defaultBarProfileForCatalogRow(
          catalogRow?.equipment ?? null,
          catalogRow?.uses_bar === null || catalogRow?.uses_bar === undefined
            ? null
            : catalogRow.uses_bar === 1,
          settingsBarProfile,
        );
      }
      const exercise = buildFreeRunnerExercise(
        nextTransientExerciseId.current,
        selection.name,
        // One session logs one unit (§3.7), free or planned. The session's unit
        // is fixed at load, so reading the app's current one here would mix
        // units inside a single log whenever Settings is touched mid-session.
        session.unit,
        barProfile,
      );
      nextTransientExerciseId.current -= 1;
      const nextIndex = session.exercises.length;
      setSession({ ...session, exercises: [...session.exercises, exercise] });
      setDraft((current) => [...current, ...buildFreeDraft([exercise])]);
      setWarmupEnabled((current) => [...current, false]);
      setExerciseIndex(nextIndex);
      setPickerVisible(false);
    } catch {
      Alert.alert(t('errorTitle'), t('runnerLoadFailed'));
    }
  };

  const commitSet = (value: LoggedSet | null) => {
    if (editing === null || session === null) {
      return;
    }
    const { exerciseIndex: selectedExercise, setIndex } = editing;
    const completedAt = Date.now();
    const timestampedValue =
      value === null
        ? null
        : {
            ...value,
            startedAt: value.startedAt ?? completedAt,
            completedAt: value.completedAt ?? completedAt,
          };
    setDraft((current) => {
      const next = current.map((sets) => [...sets]);
      const exerciseSets = next[selectedExercise] ?? [];
      exerciseSets[setIndex] = timestampedValue;
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
      if (exercise.isPlanned !== false && exercise.sessionExerciseId > 0) {
        await saveRunnerBarProfile(routineDb, exercise.sessionExerciseId, barProfile, barWeight);
      }
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
    const extra =
      currentExercise.isPlanned === false
        ? null
        : nextExtraSet(currentExercise, session, currentSets);
    setDraft((current) => {
      const next = current.map((sets) => [...sets]);
      const sets = next[exerciseIndex] ?? [];
      next[exerciseIndex] =
        currentExercise.isPlanned === false ? addFreeSet(sets) : [...sets, extra];
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
    setFinishSheetVisible(false);
    setSaving(true);
    try {
      const completedAt = Date.now();
      const finalDraft = stampMissingSetTimes(draft, runnerStartedAt, completedAt);
      const summary = buildSessionSummary(session, finalDraft);
      if (mode === 'free') {
        const freeExercises = buildFreeLogExercises(session, finalDraft);
        const loggedSets = freeExercises.reduce(
          (total, exercise) => total + exercise.sets.length,
          0,
        );
        if (loggedSets === 0) {
          setSaving(false);
          Alert.alert(t('runnerNothingSavedTitle'), t('runnerNothingSavedMessage'));
          return;
        }
        const saved = await saveFreeSession(
          routineDb,
          t('freeSessionName'),
          session.workoutDate,
          freeExercises,
        );
        bump();
        navigation.navigate('SessionSummary', {
          sessionName: saved.workoutName,
          routineName: '',
          workoutDate: session.workoutDate,
          sessionKind: 'free',
          summary,
          finishContext: null,
        });
      } else {
        if (weekSessionId === null) {
          throw new Error('Planned runner has no week session');
        }
        const saved = await saveSessionLog(routineDb, weekSessionId, session, finalDraft);
        bump();
        navigation.navigate('SessionSummary', {
          sessionName: session.sessionName,
          routineName: session.workoutName,
          workoutDate: session.workoutDate,
          sessionKind: 'planned',
          summary,
          finishContext: {
            routineId: saved.finishContext.routineId,
            cycleId: saved.finishContext.cycleId,
            weekNumber: saved.finishContext.weekNumber,
            reviewAvailable: saved.finishContext.reviewAvailable,
          },
        });
      }
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

  if (session === null) {
    return (
      <Screen fill testID="runner-loading">
        <View style={styles.runner} />
      </Screen>
    );
  }

  const planUnit = currentExercise?.unitOverride ?? session.unit;
  // U5: the main lift's own series colour, so its header row reads the same identity as its hero
  // row on Inicio and its line in Progreso's chart (ADR-0047). `session.mainLiftNames` is the
  // ROUTINE's main lifts (every session's, not just today's) in the routine's own `sort_order` —
  // ranking a lift within today's session alone would give every day's first main lift the same
  // colour, which is exactly the cross-day identity this exists to avoid.
  const mainLiftColourByName = mainLiftColours(
    session.mainLiftNames.map((name) => ({ name, role: 'main' as const })),
  );
  const currentExerciseColourIndex =
    currentExercise === undefined ? undefined : mainLiftColourByName.get(currentExercise.name);
  const currentExerciseColour =
    currentExerciseColourIndex === undefined
      ? undefined
      : tokens.data.series[currentExerciseColourIndex];
  const totalRows =
    currentExercise === undefined
      ? 0
      : currentExercise.isPlanned === false
        ? Math.max(1, currentSets.length)
        : Math.max(currentExercise.targetSets, currentSets.length);
  const isLastExercise =
    session.exercises.length === 0 || exerciseIndex === session.exercises.length - 1;
  const isWarmupOn = warmupEnabled[exerciseIndex] === true;
  const isWarmupCollapsed = warmupCollapsed.has(exerciseIndex);
  const confirmationSummary = buildSessionSummary(
    session,
    stampMissingSetTimes(draft, runnerStartedAt, Date.now()),
  );
  const confirmationDuration =
    confirmationSummary.durationSeconds === null
      ? t('sessionSummaryTimingUnavailable')
      : confirmationSummary.durationSeconds < 60
        ? t('sessionSummaryLessThanMinute')
        : t('sessionSummaryMinutes', {
            count: Math.max(1, Math.round(confirmationSummary.durationSeconds / 60)),
          });
  const confirmationStats = t('finishConfirmStats', {
    exercises: t('runnerExercisesCount', { count: confirmationSummary.exerciseCount }),
    sets: t('runnerSetsCount', { count: confirmationSummary.workSetCount }),
    duration: confirmationDuration,
  });

  const planLineFor = (exercise: RunnerExercise): string => {
    if (exercise.isPlanned === false) {
      return t('runnerFreeSetHint');
    }
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
  const loggedFreeSets = currentSets.filter((set) => set !== null).length;
  const planLine =
    currentExercise === undefined
      ? null
      : currentExercise.isPlanned === false && loggedFreeSets > 0
        ? t('runnerFreeRegisteredSets', { count: loggedFreeSets })
        : planLineFor(currentExercise);
  const informationPlanLine =
    informationExercise === null ? null : planLineFor(informationExercise);

  const formatTargetLoad = (target: RunnerTargetSet): string => {
    if (target.targetWeight !== null) {
      return `${formatWeight(target.targetWeight)} ${planUnit}`;
    }
    return currentExercise?.loadSource === 'bodyweight'
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
    if (currentExercise === undefined || currentExercise.isPlanned === false) {
      return null;
    }
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
    if (currentExercise === undefined) {
      return null;
    }
    const logged = currentSets[setIndex] ?? null;
    const target = runnerTargetForSet(currentExercise, session, currentSets, setIndex);
    const extra = currentExercise.isPlanned !== false && setIndex >= currentExercise.targetSets;
    const position =
      currentExercise.isPlanned === false
        ? t('freeSetPosition', { n: setIndex + 1 })
        : extra
          ? session.progressionRule === 'wave'
            ? t('runnerJoker', { n: setIndex - currentExercise.targetSets + 1 })
            : t('runnerExtraSetPosition', {
                n: setIndex - currentExercise.targetSets + 1,
              })
          : t('setPosition', { n: setIndex + 1, total: currentExercise.targetSets });
    const warning = logged === null ? null : belowTargetNote(setIndex, logged);
    // F1: the runner's own default for a first-ever exercise is "already
    // done, weight to learn" — say which one of these blanks will fix the
    // baseline, since it will be the heaviest logged, not the first.
    const learningNote =
      logged !== null && currentExercise.isPlanned !== false && isUnlearnedSet(currentExercise, logged)
        ? t('runnerHeaviestSetsMax')
        : null;
    const detail =
      logged === null ? (
        <Text
          style={[styles.rowDetail, { color: tokens.textSecondary }]}
        >
          {currentExercise.isPlanned === false ? t('runnerFreeSetEmpty') : t('runnerNotDone')}
        </Text>
      ) : (
        <View>
          <Text
            style={[styles.rowDetail, { color: tokens.textSecondary }]}
          >
            {currentExercise.isPlanned === false
              ? `${logged.reps} ${t('Reps')} · ${
                  logged.weight === null
                    ? t('loadBodyweight')
                    : `${formatWeight(logged.weight)} ${logged.unit ?? planUnit}`
                }`
              : formatSetDetail(target, logged)}
          </Text>
          {warning !== null && (
            <Text style={[styles.warning, { color: tokens.warning }]}>{warning}</Text>
          )}
          {learningNote !== null && (
            <Text style={[styles.warning, { color: tokens.textSecondary }]}>{learningNote}</Text>
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
            <Text
              style={[styles.position, { color: tokens.textSecondary }]}
            >
              {mode === 'free' || currentExercise === undefined
                ? t('freeLogging')
                : t('runnerExercisePosition', {
                    n: exerciseIndex + 1,
                    total: session.exercises.length,
                    role: t(currentExercise.role === 'main' ? 'roleMain' : 'roleAccessory'),
                  })}
            </Text>
            <View style={styles.elapsed}>
              <Text style={[styles.elapsedLabel, { color: tokens.textSecondary }]}>
                {t('runnerSessionElapsed')}
              </Text>
              <Timer mode="elapsed" size="header" />
            </View>
          </View>
          {currentExercise === undefined ? (
            <View style={styles.exerciseHeader}>
              {/*
                The name row is what gives `exerciseName` a horizontal main axis
                to flex along. Dropped into the column directly, its `flex: 1`
                collapses the text's height and clips the heading.
              */}
              <View style={styles.exerciseNameRow}>
                <Text
                  style={[styles.exerciseName, { color: tokens.textPrimary }]}
                >
                  {t('runnerFreeChooseExercise')}
                </Text>
              </View>
              <Text
                style={[styles.planSummary, { color: tokens.textSecondary }]}
              >
                {t('runnerFreeAddFirstExercise')}
              </Text>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.exerciseHeader, pressStyle(pressed)]}
              onPress={() => openExerciseInformation(currentExercise)}
              accessibilityRole="button"
              accessibilityLabel={t('runnerOpenExerciseInfo')}
              testID="runner-exercise-information"
            >
              <View style={styles.exerciseNameRow}>
                {currentExerciseColour !== undefined && (
                  <View
                    style={[styles.liftSwatch, { backgroundColor: currentExerciseColour }]}
                    testID="runner-exercise-lift-colour"
                  />
                )}
                <Text style={[styles.exerciseName, { color: tokens.textPrimary }]} numberOfLines={2}>
                  {currentExercise.name}
                </Text>
                <Ionicons name="information-circle-outline" size={tabBar.icon} color={tokens.textSecondary} />
              </View>
              <Text
                style={[styles.planSummary, { color: tokens.textSecondary }]}
              >
                {planLine}
              </Text>
            </Pressable>
          )}
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {currentExercise === undefined ? (
            /*
             * Nothing here on purpose. The header already states the empty case, and the footer
             * button below is the runner's standing primary-action slot — in this state it reads
             * "add exercise". A row saying the same thing gave the empty screen two identical
             * affordances for one action.
             */
            null
          ) : (
            <>
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
              ) : !isWarmupOn && currentExercise.role === 'accessory' && currentExercise.isPlanned !== false ? (
                <Section testID="runner-warmup-off">
                  <Row label={t('runnerAddWarmup')} onPress={enableWarmups} divided />
                </Section>
              ) : null}

              <Section title={t('runnerWorkSets')} testID="runner-work-sets">
                {Array.from({ length: totalRows }, (_, setIndex) => renderSetRow(setIndex))}
                <Row
                  label={
                    currentExercise.isPlanned === false
                      ? t('runnerAddSet')
                      : session.progressionRule === 'wave'
                        ? t('runnerAddJoker')
                        : t('runnerAddSet')
                  }
                  onPress={addExtraSet}
                  right={<Ionicons name="add" size={tabBar.icon} color={tokens.textPrimary} />}
                  divided
                  testID="runner-add-set"
                />
              </Section>
              <Section testID="runner-add-exercise-section">
                <Row
                  label={t('runnerAddExercise')}
                  onPress={() => setPickerVisible(true)}
                  right={<Ionicons name="add" size={tabBar.icon} color={tokens.textPrimary} />}
                  divided
                  testID="runner-add-exercise"
                />
              </Section>
            </>
          )}
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
            label={
              currentExercise === undefined
                ? t('runnerAddExercise')
                : isLastExercise
                  ? t('finishSession')
                  : t('runnerNextExercise')
            }
            onPress={() => {
              if (currentExercise === undefined) {
                setPickerVisible(true);
              } else if (isLastExercise) {
                setFinishSheetVisible(true);
              } else {
                startRest(currentExercise.role);
                setExerciseIndex((current) => current + 1);
              }
            }}
            disabled={saving}
            style={styles.footerButton}
            testID={
              currentExercise === undefined
                ? 'runner-add-exercise-footer'
                : isLastExercise
                  ? 'runner-finish'
                  : 'runner-next'
            }
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
             draft[editing.exerciseIndex]?.[editing.setIndex] ??
             (session.exercises[editing.exerciseIndex]?.isPlanned === false
               ? null
               : {
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
                 })
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
        visible={finishSheetVisible}
        title={t('runnerFinishConfirmTitle', { session: session.sessionName })}
        onClose={() => setFinishSheetVisible(false)}
        testID="runner-finish-confirmation"
      >
        <Text style={[styles.finishSummaryLine, { color: tokens.textPrimary }]}>
          {confirmationStats}
        </Text>
        {confirmationSummary.notDoneSets > 0 && (
          <Text style={[styles.finishInfo, { color: tokens.textSecondary }]}>
            {t('sessionSummaryNotDone', { count: confirmationSummary.notDoneSets })}
          </Text>
        )}
        {confirmationSummary.unsavedSets > 0 && (
          <Text style={[styles.finishInfo, { color: tokens.textSecondary }]}>
            {t('finishConfirmUnsavedSets', { count: confirmationSummary.unsavedSets })}
          </Text>
        )}
        <Button
          label={t('finishSession')}
          onPress={() => void finishSession()}
          disabled={saving}
          testID="runner-finish-confirm"
        />
        <Row
          label={t('finishStay')}
          onPress={() => setFinishSheetVisible(false)}
          divided
          testID="runner-finish-stay"
        />
      </Sheet>

      {/* R2: the same sheet every other surface opens, with the runner's own plan line inside it. */}
      <ExerciseSheet
        exercise={
          informationExercise === null ? null : { name: informationExercise.name }
        }
        plan={
          informationExercise === null || informationExercise.isPlanned === false
            ? null
            : {
                role: informationExercise.role,
                targetSets: informationExercise.targetSets,
                targetReps: informationExercise.targetReps,
                isAmrap: informationExercise.isAmrap,
                line: informationPlanLine ?? undefined,
              }
        }
        onClose={() => setInformationExercise(null)}
        onOpenHistory={openExerciseHistory}
        testID="runner-exercise-information-sheet"
      >
        {informationExercise?.isPlanned === false ? (
          <Text style={[styles.infoPlan, { color: tokens.textSecondary }]}>
            {t('runnerFreeInfo')}
          </Text>
        ) : (
          <Row
            label={t('runnerInfoWeek')}
            detail={t('runnerInfoWeekValue', { week: session.weekNumber })}
            divided
          />
        )}
      </ExerciseSheet>

      <ExerciseCatalogPicker
        visible={pickerVisible}
        catalogExerciseId={null}
        onSelect={(selection) => void addExercise(selection)}
        onClose={() => setPickerVisible(false)}
      />
    </Screen>
  );
}

interface RunnerSetEditorProps {
  visible: boolean;
  exercise: RunnerExercise;
  session: RunnerSession;
  setIndex: number;
  initial: LoggedSet | null;
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
  const [reps, setReps] = useState<number | null>(initial?.reps ?? null);
  const [weight, setWeight] = useState<number | null>(initial?.weight ?? null);
  const planUnit = exercise.unitOverride ?? session.unit;
  const [unit, setUnit] = useState<RoutineUnit>(initial?.unit ?? planUnit);
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
    if (initial?.weight === null || initial?.weight === undefined || initialBarWeight === null) {
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
  const canSaveComposer =
    barProfile !== null &&
    canSaveBarProfile(barProfile, barProfile === 'custom' ? customBarWeight : null);

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
    if (barProfile === null || !canSaveComposer || savingProfile) {
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
      startedAt: initial?.startedAt,
      completedAt: initial?.completedAt,
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
    exercise.isPlanned === false
      ? t('freeSetPosition', { n: setIndex + 1 })
      : setIndex >= exercise.targetSets
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
          <View style={styles.composerLayout}>
            <ScrollView
              style={styles.composerScroll}
              contentContainerStyle={styles.composerContent}
              keyboardShouldPersistTaps="handled"
            >
              <Section
                title={t('runnerBarProfileLabel')}
                hint={t('runnerBarProfileFuture')}
                testID="editor-bar-profiles"
              >
                <SegmentedControl
                  options={BAR_PROFILE_KEYS.map((profile) => ({
                    value: profile,
                    label: t(barProfileLabelKey(profile)),
                  }))}
                  value={barProfile}
                  onChange={chooseBarProfile}
                  wrap
                  testID="editor-bar-profile-options"
                />
                <Text
                  style={[styles.composition, { color: tokens.textPrimary }]}
                >
                  {barSummary}
                </Text>
              </Section>

              {barProfile === 'custom' && (
                <Field
                  label={t('runnerCustomBarWeight', { unit })}
                  hint={t('runnerCustomBarWeightHint')}
                >
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
                <Text
                  style={[styles.composition, { color: tokens.textPrimary }]}
                >
                  {t('runnerPlatesPerSide')}:{' '}
                  {plates.length === 0
                    ? t('runnerNoPlates')
                    : plates.map((plate) => `${formatWeight(plate)} ${unit}`).join(' + ')}
                </Text>
                <PlatePicker
                  options={STANDARD_PLATES[unit].map((plate) => ({
                    value: plate,
                    label: `+${formatWeight(plate)} ${unit}`,
                  }))}
                  onPress={addPlate}
                  onLongPress={removePlate}
                  longPressHint={t('runnerPlateHoldToRemove')}
                  testID="editor-plate-picker"
                />
                {weight !== null && (currentBarWeight === null || composition === null) && (
                  <Text
                    style={[styles.compositionHint, { color: tokens.textSecondary }]}
                  >
                    {t('runnerCompositionUnavailable')}
                  </Text>
                )}
              </Section>
            </ScrollView>

            <View style={styles.composerFooter}>
              <View style={styles.composerTotal}>
                <Text
                  style={[styles.composerTotalLabel, { color: tokens.textSecondary }]}
                >
                  {t('runnerTotalLabel')}
                </Text>
                <Text
                  style={[styles.composerTotalValue, { color: tokens.textPrimary }]}
                >
                  {weight === null
                    ? t('runnerWeightToLearn')
                    : `${formatWeight(weight)} ${unit}`}
                </Text>
              </View>
              <Button
                label={t('runnerDone')}
                onPress={() => void saveComposer()}
                disabled={savingProfile || !canSaveComposer}
                testID="editor-composer-done"
              />
            </View>
          </View>
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
            <Text
              style={[styles.editorTarget, { color: tokens.textSecondary }]}
            >
              {exercise.isPlanned === false
                ? t('runnerFreeEditorHint')
                : t('runnerTargetDescription', { reps: targetReps, weight: targetWeight })}
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
                <View style={styles.unitControl}>
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
            {exercise.isPlanned !== false && (
              <Row
                label={t('runnerMarkNotDone')}
                onPress={() => onCommit(null)}
                divided
                testID="editor-not-done"
              />
            )}
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
  /**
   * The marker that says where you are: a position in a planned session, or the mode when there
   * is no plan. It is neither a heading nor an action, so it wears `ScreenTitle`'s overline — the
   * one idiom this app already has for "what kind of thing this is". At caption size it shares a
   * baseline with the elapsed label opposite it instead of floating against the 44pt back control.
   */
  position: {
    flex: 1,
    fontSize: fontSize.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
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
  liftSwatch: {
    width: dataMark.dot,
    height: dataMark.dot,
    borderRadius: dataMark.dot / 2,
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
  composerLayout: {
    flexShrink: 1,
  },
  composerScroll: {
    flexShrink: 1,
  },
  composerFooter: {
    gap: spacing.cardGap,
  },
  unitControl: {
    gap: spacing.label,
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
  finishSummaryLine: {
    fontSize: fontSize.body,
    marginBottom: spacing.cardGap,
  },
  finishInfo: {
    fontSize: fontSize.helper,
    marginBottom: spacing.cardGap,
  },
  pressed: {
    opacity: 0.7,
  },
});
