/**
 * D6 — The session runner (SPECS.md D6, §3.2, §3.7, §3.8).
 *
 * Pure core: `buildLogRows` turns an in-memory session draft into the history
 * rows of §3.2 — one Workout_Log row, one Logged_Exercises row per exercise
 * that got at least one logged set (sets/reps copied from the plan at log
 * time), and one Weight_Log row per logged WORK set, sequenced 1..N with no
 * gaps (the B0.3 renumbering argument: work sets only, so the
 * UNIQUE(workout_log_id, logged_exercise_id, set_number) constraint always
 * holds). A draft may carry MORE sets than the plan (§3.4 extra sets): they
 * append after the planned ones, enter history like any other set and count
 * toward volume, and never move a progression proposal — the engine reads
 * only the first `targetSets` sets (utils/progression.ts). Warm-ups never
 * reach the draft — they are a UI affordance derived from the first work
 * set's target via `warmupSetsFor` and live only in component state — so
 * they can never enter Weight_Log by construction.
 *
 * Per-set unit (§3.5): a set logged in the other unit keeps it — the row
 * stores `set.unit ?? exerciseUnit`, and nothing converts it. Per-set timing
 * (§3.9): `started_at` / `completed_at` are written from the set's
 * timestamps, epoch milliseconds.
 *
 * The write path is `saveSessionLog` (writes everything in ONE transaction,
 * marks the WeekSessions row completed with its log id, and learns the §3.2
 * baseline for every exercise whose plan weight is still NULL — never
 * overwriting a value the user set by hand; utils/learnedWeights.ts).
 */

import { warmupSets } from './fiveThreeOne';
import { inferBaselineWeight, baselineColumn } from './learnedWeights';
import { proposeJokerWeight } from './jokers';
import { canSaveBarProfile, type BarProfileKey } from './barProfiles';
import { loadSessionFinishContext, type SessionFinishContext } from './sessionFinish';
import { targetSetsFor, targetWeightFor, type PlannedTargetSet } from './today';
import type {
  RoutineDatabase,
  RoutineLoadSource,
  RoutineProgressionRule,
  RoutineUnit,
} from './routineActions';

export interface RunnerExercise {
  sessionExerciseId: number;
  name: string;
  role: 'main' | 'accessory';
  targetSets: number;
  targetReps: number;
  loadSource: RoutineLoadSource;
  absoluteWeight: number | null;
  trainingMaxWeight: number | null;
  trainingMaxPct: number | null;
  unitOverride: RoutineUnit | null;
  isAmrap: boolean;
  barProfile: BarProfileKey | null;
  barWeight: number | null;
  /** False for a free-log or transient added exercise with no routine target. */
  isPlanned?: boolean;
}

/** Everything the runner needs that is not the user's own set results. */
export interface RunnerSession {
  /** Zero is the sentinel for a runner session with no WeekSessions row. */
  weekSessionId: number;
  sessionId: number;
  sessionName: string;
  workoutName: string;
  /** The calendar day the log lands on: the resolved date, or today. */
  workoutDate: number;
  /** The 1..4 position inside the cycle; wave targets depend on it. */
  weekNumber: number;
  unit: RoutineUnit;
  progressionRule: RoutineProgressionRule;
  roundingIncrement: number;
  restMainSeconds: number;
  restAccessorySeconds: number;
  exercises: RunnerExercise[];
}

export interface LoggedSet {
  reps: number;
  /** Actual weight lifted; null for bodyweight exercises. */
  weight: number | null;
  /** The unit this set was logged in; defaults to the exercise's unit. */
  unit?: RoutineUnit;
  /** Epoch milliseconds when the set started / was completed (§3.9). */
  startedAt?: number;
  completedAt?: number;
}

/**
 * The user's session in progress: per exercise, per target set, the actual
 * result or null (not yet logged). Extra sets (§3.4) are additional entries
 * appended after the planned ones. Warm-ups have no slot here.
 */
export type RunnerDraft = (LoggedSet | null)[][];

export interface RunnerLogRows {
  workoutLog: { workoutName: string; dayName: string; workoutDate: number };
  loggedExercises: { exerciseName: string; sets: number; reps: number }[];
  weightLog: {
    /** Position into `loggedExercises` — links sets to their log row by construction. */
    loggedExerciseIndex: number;
    setNumber: number;
    weight: number;
    reps: number;
    unit: RoutineUnit;
    startedAt: number | null;
    completedAt: number | null;
  }[];
}

export interface RunnerTotals {
  loggedSets: number;
  totalSets: number;
  loggedExercises: number;
}

export type RunnerTargetSet = PlannedTargetSet;

export interface RunnerPlanLabels {
  role: string;
  setsOf: string;
  maxReps: string;
  unit: string;
  missingWeight: string;
}

const formatPlanWeight = (weight: number): string => String(Number(weight.toFixed(1)));

/** A compact, noun-bearing plan line for the fixed runner header and its interim info sheet. */
export function formatRunnerPlanLine(
  targets: readonly RunnerTargetSet[],
  labels: RunnerPlanLabels,
): string {
  const firstTarget = targets[0];
  if (firstTarget === undefined) {
    return labels.role;
  }
  const firstReps = firstTarget.targetReps;
  const repsAreUniform = targets.every((target) => target.targetReps === firstReps);
  const hasAmrap = targets.some((target) => target.isAmrap);
  const reps = repsAreUniform
    ? `${firstReps}${hasAmrap ? ` + ${labels.maxReps}` : ''}`
    : targets
        .map((target) => (target.isAmrap ? labels.maxReps : String(target.targetReps)))
        .join('/');

  const weights = targets.map((target) => target.targetWeight);
  const knownWeights = weights.filter((weight): weight is number => weight !== null);
  let load: string;
  if (knownWeights.length !== weights.length || knownWeights.length === 0) {
    load = labels.missingWeight;
  } else {
    const firstWeight = knownWeights[0];
    if (firstWeight !== undefined && knownWeights.every((weight) => weight === firstWeight)) {
      load = `${formatPlanWeight(firstWeight)} ${labels.unit}`;
    } else {
      load = `${formatPlanWeight(Math.min(...knownWeights))}-${formatPlanWeight(
        Math.max(...knownWeights),
      )} ${labels.unit}`;
    }
  }

  return `${labels.role} · ${targets.length} ${labels.setsOf} ${reps} · ${load}`;
}

/** The runner's complete target for each planned work set. */
export function runnerTargetsFor(
  exercise: RunnerExercise,
  session: RunnerSession,
): RunnerTargetSet[] {
  return targetSetsFor(exercise, session.roundingIncrement, session.weekNumber);
}

/** The session's default draft: the plan is already recorded until the user edits it. */
export function buildPlannedDraft(session: RunnerSession): RunnerDraft {
  return session.exercises.map((exercise) =>
    exercise.isPlanned === false
      ? [null]
      : runnerTargetsFor(exercise, session).map((target) => ({
          reps: target.targetReps,
          weight: target.targetWeight,
        })),
  );
}

/** Retains set timing already observed and gives untouched planned sets real finish timing. */
export function stampMissingSetTimes(
  draft: RunnerDraft,
  startedAt: number,
  completedAt: number,
): RunnerDraft {
  return draft.map((sets) =>
    sets.map((set) =>
      set === null
        ? null
        : {
            ...set,
            startedAt: set.startedAt ?? startedAt,
            completedAt: set.completedAt ?? completedAt,
          },
    ),
  );
}

/** The next extra set, using the current work weight as a wave joker when applicable. */
export function nextExtraSet(
  exercise: RunnerExercise,
  session: RunnerSession,
  currentSets: readonly (LoggedSet | null)[],
): LoggedSet {
  const targets = runnerTargetsFor(exercise, session);
  const fallback = targets[targets.length - 1] ?? {
    targetReps: exercise.targetReps,
    targetWeight: runnerTargetWeight(exercise, session.roundingIncrement, session.weekNumber),
    isAmrap: exercise.isAmrap,
  };
  const last = [...currentSets].reverse().find((set): set is LoggedSet => set !== null);
  const currentWeight = last?.weight ?? fallback.targetWeight;
  const weight =
    session.progressionRule === 'wave' && currentWeight !== null
      ? proposeJokerWeight(currentWeight, session.roundingIncrement)
      : currentWeight;

  return {
    reps: last?.reps ?? fallback.targetReps,
    weight,
  };
}

/** Target metadata for a row, including an appended extra set. */
export function runnerTargetForSet(
  exercise: RunnerExercise,
  session: RunnerSession,
  currentSets: readonly (LoggedSet | null)[],
  setIndex: number,
): RunnerTargetSet {
  if (exercise.isPlanned === false) {
    return { targetReps: 0, targetWeight: null, isAmrap: false };
  }
  const planned = runnerTargetsFor(exercise, session)[setIndex];
  if (planned !== undefined) {
    return planned;
  }
  const extra = nextExtraSet(exercise, session, currentSets.slice(0, setIndex));
  return {
    targetReps: extra.reps,
    targetWeight: extra.weight,
    isAmrap: false,
  };
}

const exerciseUnit = (exercise: RunnerExercise, session: RunnerSession): RoutineUnit =>
  exercise.unitOverride ?? session.unit;

/** The concrete target weight for one exercise, in the routine's rounding. */
export function runnerTargetWeight(
  exercise: RunnerExercise,
  roundingIncrement: number,
  weekNumber?: number,
): number | null {
  return targetWeightFor(exercise, roundingIncrement, weekNumber);
}

/**
 * The warm-up ramp for a weighted exercise: the standard 5/3/1 convention of
 * 40% x5, 50% x5, 60% x3 of the first work set's target, rounded to the
 * routine's increment (reuses the tested arithmetic from utils/fiveThreeOne.ts).
 * Bodyweight exercises have no bar to ramp — no warm-ups.
 */
export function warmupSetsFor(
  exercise: RunnerExercise,
  session: RunnerSession,
): { weight: number; reps: number }[] {
  const target = runnerTargetWeight(exercise, session.roundingIncrement, session.weekNumber);
  if (target === null || target <= 0) {
    return [];
  }
  return warmupSets(target, {
    increment: session.roundingIncrement,
    direction: 'nearest',
    unit: exerciseUnit(exercise, session),
  }).map((set) => ({ weight: set.weight, reps: set.reps }));
}

export function sessionTotals(session: RunnerSession, draft: RunnerDraft): RunnerTotals {
  let loggedSets = 0;
  let totalSets = 0;
  let loggedExercises = 0;
  session.exercises.forEach((exercise, exerciseIndex) => {
    totalSets += exercise.targetSets;
    const sets = draft[exerciseIndex] ?? [];
    if (sets.some((set) => set !== null)) {
      loggedExercises += 1;
    }
    loggedSets += sets.filter((set) => set !== null).length;
  });
  return { loggedSets, totalSets, loggedExercises };
}

/**
 * How far a logged set fell below its target, for the soft inline note.
 * `repsShort` counts missing reps (0 when met); `weightShort` is the missing
 * weight in the exercise's unit, null when not short or not applicable.
 */
export function belowTarget(
  exercise: RunnerExercise,
  set: LoggedSet,
  roundingIncrement: number,
  weekNumber?: number,
  setIndex = 0,
): { repsShort: number; weightShort: number | null } {
  const targetSet = targetSetsFor(exercise, roundingIncrement, weekNumber)[setIndex] ?? {
    targetReps: exercise.targetReps,
    targetWeight: runnerTargetWeight(exercise, roundingIncrement, weekNumber),
    isAmrap: exercise.isAmrap,
  };
  const repsShort = Math.max(0, targetSet.targetReps - set.reps);
  const target = targetSet.targetWeight;
  const weightShort =
    target !== null && set.weight !== null && set.weight < target
      ? target - set.weight
      : null;
  return { repsShort, weightShort };
}

/**
 * The §3.2 history rows for a finished session: exercises without a logged
 * set produce no rows at all; `set_number` sequences only the logged work
 * sets, in order, so a skipped middle set leaves a gapless 1..N per exercise.
 */
export function buildLogRows(session: RunnerSession, draft: RunnerDraft): RunnerLogRows {
  const loggedExercises: RunnerLogRows['loggedExercises'] = [];
  const weightLog: RunnerLogRows['weightLog'] = [];

  session.exercises.forEach((exercise, exerciseIndex) => {
    const sets = (draft[exerciseIndex] ?? []).filter(
      (set): set is LoggedSet => set !== null,
    );
    if (sets.length === 0) {
      return;
    }
    const loggedExerciseIndex = loggedExercises.length;
    const isPlanned = exercise.isPlanned !== false;
    const lastSet = sets[sets.length - 1];
    if (lastSet === undefined) {
      return;
    }
    loggedExercises.push({
      exerciseName: exercise.name,
      sets: isPlanned ? exercise.targetSets : sets.length,
      reps: isPlanned ? exercise.targetReps : lastSet.reps,
    });
    sets.forEach((set, index) => {
      weightLog.push({
        loggedExerciseIndex,
        setNumber: index + 1,
        weight: set.weight ?? 0,
        reps: set.reps,
        unit: set.unit ?? exerciseUnit(exercise, session),
        startedAt: set.startedAt ?? null,
        completedAt: set.completedAt ?? null,
      });
    });
  });

  return {
    workoutLog: {
      workoutName: session.workoutName,
      dayName: session.sessionName,
      workoutDate: session.workoutDate,
    },
    loggedExercises,
    weightLog,
  };
}

export interface SavedSession {
  workoutLogId: number;
  loggedSets: number;
  loggedExercises: number;
  finishContext: SessionFinishContext;
}

/**
 * The §3.2 baseline write, inside the session transaction: for every exercise
 * whose plan weight is still NULL, the first set the user actually logged
 * becomes the baseline (training max for `training_max_pct`, starting load
 * otherwise). The `IS NULL` guard is what makes it "learned, never demanded"
 * — a value the user entered by hand is never overwritten, and an exercise
 * that already has a baseline is never touched again.
 */
async function applyLearnedBaselines(
  db: RoutineDatabase,
  session: RunnerSession,
  draft: RunnerDraft,
): Promise<void> {
  for (const [exerciseIndex, exercise] of session.exercises.entries()) {
    if (exercise.isPlanned === false) {
      continue;
    }
    const column = baselineColumn(exercise.loadSource);
    if (column === null) {
      continue;
    }
    const sets = draft[exerciseIndex] ?? [];
    const first = sets.find((set): set is LoggedSet => set !== null);
    if (first === undefined) {
      continue;
    }
    const planUnit = exerciseUnit(exercise, session);
    const baseline = inferBaselineWeight({
      loadSource: exercise.loadSource,
      trainingMaxPct: exercise.trainingMaxPct,
      roundingIncrement: session.roundingIncrement,
      planUnit,
      set: {
        weight: first.weight ?? 0,
        reps: first.reps,
        unit: first.unit ?? planUnit,
      },
    });
    if (baseline === null) {
      continue;
    }
    await db.run(
      `UPDATE SessionExercises
         SET ${column} = ?
       WHERE session_exercise_id = ? AND ${column} IS NULL;`,
      [baseline, exercise.sessionExerciseId],
    );
  }
}

/**
 * Writes the whole session atomically — Workout_Log, Logged_Exercises,
 * Weight_Log, and the WeekSessions completion in one transaction — so an
 * abandoned session writes nothing and a failed write rolls everything back.
 * Refuses a draft with no logged sets and a week-session that is not pending
 * (a completed session cannot be logged twice).
 */
export async function saveSessionLog(
  db: RoutineDatabase,
  weekSessionId: number,
  session: RunnerSession,
  draft: RunnerDraft,
): Promise<SavedSession> {
  const rows = buildLogRows(session, draft);
  if (rows.loggedExercises.length === 0) {
    throw new Error('saveSessionLog: nothing logged');
  }

  await db.run('BEGIN;');
  try {
    await db.run(
      `INSERT INTO Workout_Log (workout_name, day_name, workout_date)
       VALUES (?, ?, ?);`,
      [
        rows.workoutLog.workoutName,
        rows.workoutLog.dayName,
        rows.workoutLog.workoutDate,
      ],
    );
    const workoutLogRow = await db.get('SELECT last_insert_rowid() AS id;', []);
    if (!workoutLogRow) {
      throw new Error('Could not read the new workout log id');
    }
    const workoutLogId = Number(workoutLogRow.id);

    for (let index = 0; index < rows.loggedExercises.length; index += 1) {
      const logged = rows.loggedExercises[index];
      await db.run(
        `INSERT INTO Logged_Exercises (workout_log_id, exercise_name, sets, reps)
         VALUES (?, ?, ?, ?);`,
        [workoutLogId, logged.exerciseName, logged.sets, logged.reps],
      );
      const loggedRow = await db.get('SELECT last_insert_rowid() AS id;', []);
      if (!loggedRow) {
        throw new Error('Could not read the new logged exercise id');
      }
      const loggedExerciseId = Number(loggedRow.id);

      for (const set of rows.weightLog) {
        if (set.loggedExerciseIndex !== index) {
          continue;
        }
        await db.run(
          `INSERT INTO Weight_Log
             (workout_log_id, logged_exercise_id, exercise_name, set_number,
              weight_logged, reps_logged, unit, started_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            workoutLogId,
            loggedExerciseId,
            logged.exerciseName,
            set.setNumber,
            set.weight,
            set.reps,
            set.unit,
            set.startedAt,
            set.completedAt,
          ],
        );
      }
    }

    await applyLearnedBaselines(db, session, draft);

    const update = await db.run(
      `UPDATE WeekSessions
         SET status = 'completed', resolved_on_date = ?, completed_log_id = ?
       WHERE week_session_id = ? AND status = 'pending';`,
      [session.workoutDate, workoutLogId, weekSessionId],
    );
    if (update !== null && update !== undefined && typeof update === 'object' && 'changes' in update) {
      const changes = Number((update as { changes: unknown }).changes);
      if (changes !== 1) {
        throw new Error('saveSessionLog: week session is not pending');
      }
    }

    const finishContext = await loadSessionFinishContext(db, weekSessionId);

    await db.run('COMMIT;');
    return {
      workoutLogId,
      loggedSets: rows.weightLog.length,
      loggedExercises: rows.loggedExercises.length,
      finishContext,
    };
  } catch (error) {
    await db.run('ROLLBACK;');
    throw error;
  }
}

/** Persist the exercise-level bar choice; it affects this exercise in future sessions. */
export async function saveRunnerBarProfile(
  db: RoutineDatabase,
  sessionExerciseId: number,
  barProfile: BarProfileKey,
  barWeight: number | null,
): Promise<void> {
  if (!canSaveBarProfile(barProfile, barWeight)) {
    throw new Error('saveRunnerBarProfile: custom bar weight must be positive');
  }
  await db.run(
    `UPDATE SessionExercises
        SET bar_profile = ?, bar_weight = ?
      WHERE session_exercise_id = ?;`,
    [barProfile, barProfile === 'custom' ? barWeight : null, sessionExerciseId],
  );
}

/**
 * The runner's context for one week session: the plan rows and the routine's
 * unit, rounding and rest values. Throws when the session is not pending —
 * the runner only ever acts on a session that has not been resolved.
 */
export async function loadRunnerSession(
  db: RoutineDatabase,
  weekSessionId: number,
  todayStamp: number,
): Promise<RunnerSession> {
  const row = await db.get(
    `SELECT ws.week_session_id, ws.status, ws.resolved_on_date, cw.week_number,
            s.session_id, s.name AS session_name,
            r.name AS workout_name, r.unit, r.progression_rule,
            r.rounding_increment,
            r.rest_main_seconds, r.rest_accessory_seconds
     FROM WeekSessions ws
     JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
     JOIN Sessions s ON s.session_id = ws.session_id
     JOIN Routines r ON r.routine_id = s.routine_id
     WHERE ws.week_session_id = ?;`,
    [weekSessionId],
  );
  if (!row) {
    throw new Error(`Unknown week session ${weekSessionId}`);
  }
  if (String(row.status) !== 'pending') {
    throw new Error(`Week session ${weekSessionId} is not pending`);
  }

  const exerciseRows = await db.getAll(
    `SELECT session_exercise_id, exercise_name, role, target_sets, target_reps,
            load_source, absolute_weight, training_max_weight, training_max_pct,
            unit_override, is_amrap, bar_profile, bar_weight
     FROM SessionExercises
     WHERE session_id = ? ORDER BY sort_order;`,
    [Number(row.session_id)],
  );

  const num = (value: unknown): number => Number(value);
  const str = (value: unknown): string => String(value);
  const nullableNum = (value: unknown): number | null =>
    value === null || value === undefined ? null : Number(value);
  const nullableStr = (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value);

  return {
    weekSessionId,
    sessionId: num(row.session_id),
    sessionName: str(row.session_name),
    workoutName: str(row.workout_name),
    workoutDate:
      row.resolved_on_date === null || row.resolved_on_date === undefined
        ? todayStamp
        : num(row.resolved_on_date),
    weekNumber: num(row.week_number),
    unit: str(row.unit) as RoutineUnit,
    progressionRule: str(row.progression_rule) as RoutineProgressionRule,
    roundingIncrement: num(row.rounding_increment),
    restMainSeconds: num(row.rest_main_seconds),
    restAccessorySeconds: num(row.rest_accessory_seconds),
    exercises: exerciseRows.map((exercise) => ({
      sessionExerciseId: num(exercise.session_exercise_id),
      name: str(exercise.exercise_name),
      role: str(exercise.role) as RunnerExercise['role'],
      targetSets: num(exercise.target_sets),
      targetReps: num(exercise.target_reps),
      loadSource: str(exercise.load_source) as RoutineLoadSource,
      absoluteWeight: nullableNum(exercise.absolute_weight),
      trainingMaxWeight: nullableNum(exercise.training_max_weight),
      trainingMaxPct: nullableNum(exercise.training_max_pct),
      unitOverride: nullableStr(exercise.unit_override) as RoutineUnit | null,
      isAmrap: num(exercise.is_amrap) === 1,
      barProfile: nullableStr(exercise.bar_profile) as BarProfileKey | null,
      barWeight: nullableNum(exercise.bar_weight),
    })),
  };
}
