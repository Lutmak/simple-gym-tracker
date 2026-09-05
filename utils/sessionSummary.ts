import {
  isUnlearnedSet,
  learnedBaselinesFor,
  runnerTargetsFor,
  type LearnedBaseline,
  type LoggedSet,
  type RunnerDraft,
  type RunnerSession,
} from './sessionRunner';
import type { RoutineUnit } from './routineActions';

export interface SessionSummarySet {
  reps: number;
  weight: number | null;
  unit: RoutineUnit;
}

export type SessionSummaryDeviation =
  | {
      kind: 'changed';
      exerciseName: string;
      setNumber: number;
      actual: SessionSummarySet;
      target: SessionSummarySet;
    }
  | {
      kind: 'notDone';
      exerciseName: string;
      setNumber: number;
    }
  | {
      kind: 'extra';
      exerciseName: string;
      setNumber: number;
      actual: SessionSummarySet;
    };

export interface SessionSummaryVolume {
  unit: RoutineUnit;
  volume: number;
}

export interface SessionSummary {
  exerciseCount: number;
  workSetCount: number;
  notDoneSets: number;
  /**
   * Sets still showing "peso por aprender" (F1): the plan's own default,
   * untouched. `workSetCount`/`exerciseCount` already exclude them — they
   * are not part of what gets saved — this is only the count for the
   * finish confirmation's warning line.
   */
  unsavedSets: number;
  /** Milliseconds are reduced to elapsed whole seconds; null means timing was unavailable. */
  durationSeconds: number | null;
  volumes: SessionSummaryVolume[];
  deviations: SessionSummaryDeviation[];
  /**
   * The §3.2 baselines this session set (U6): a first-ever session for an exercise learned a
   * training max or a starting load, and until now the summary never said so. Empty on every
   * later session, once every exercise already has a value.
   */
  learnedBaselines: LearnedBaseline[];
}

const exerciseUnit = (exercise: RunnerSession['exercises'][number], session: RunnerSession): RoutineUnit =>
  exercise.unitOverride ?? session.unit;

const asSummarySet = (
  set: LoggedSet,
  exercise: RunnerSession['exercises'][number],
  session: RunnerSession,
): SessionSummarySet => ({
  reps: set.reps,
  weight: set.weight,
  unit: set.unit ?? exerciseUnit(exercise, session),
});

const sameWeight = (actual: SessionSummarySet, target: SessionSummarySet): boolean => {
  if (target.weight === null) {
    return true;
  }
  return actual.weight === target.weight && actual.unit === target.unit;
};

const sameReps = (actual: number, target: number, isAmrap: boolean): boolean =>
  isAmrap ? actual >= target : actual === target;

const durationSecondsOf = (draft: RunnerDraft): number | null => {
  const started: number[] = [];
  const completed: number[] = [];
  for (const sets of draft) {
    for (const set of sets) {
      if (set?.startedAt !== undefined && Number.isFinite(set.startedAt)) {
        started.push(set.startedAt);
      }
      if (set?.completedAt !== undefined && Number.isFinite(set.completedAt)) {
        completed.push(set.completedAt);
      }
    }
  }
  if (started.length === 0 || completed.length === 0) {
    return null;
  }
  return Math.max(0, Math.round((Math.max(...completed) - Math.min(...started)) / 1000));
};

const addVolume = (
  volumes: Map<RoutineUnit, number>,
  unit: RoutineUnit,
  weight: number | null,
  reps: number,
): void => {
  if (weight === null) {
    return;
  }
  volumes.set(unit, (volumes.get(unit) ?? 0) + weight * reps);
};

/** Calculates the finish data from the runner's actual draft, without database or UI state. */
export function buildSessionSummary(
  session: RunnerSession,
  draft: RunnerDraft,
): SessionSummary {
  const volumes = new Map<RoutineUnit, number>();
  const deviations: SessionSummaryDeviation[] = [];
  let exerciseCount = 0;
  let workSetCount = 0;
  let notDoneSets = 0;
  let unsavedSets = 0;

  session.exercises.forEach((exercise, exerciseIndex) => {
    const sets = draft[exerciseIndex] ?? [];

    if (exercise.isPlanned === false) {
      const hasLoggedSet = sets.some((set) => set !== null);
      if (hasLoggedSet) {
        exerciseCount += 1;
      }
      sets.forEach((set) => {
        if (set === null) {
          return;
        }
        workSetCount += 1;
        const actual = asSummarySet(set, exercise, session);
        addVolume(volumes, actual.unit, actual.weight, actual.reps);
      });
      return;
    }

    const targets = runnerTargetsFor(exercise, session);
    let exerciseHasSavedSet = false;

    for (let setIndex = 0; setIndex < targets.length; setIndex += 1) {
      const set = sets[setIndex] ?? null;
      if (set === null) {
        notDoneSets += 1;
        deviations.push({
          kind: 'notDone',
          exerciseName: exercise.name,
          setNumber: setIndex + 1,
        });
        continue;
      }
      // Still "peso por aprender", untouched (F1): the plan's own default,
      // not a deviation, and never saved — see `isUnlearnedSet`.
      if (isUnlearnedSet(exercise, set)) {
        unsavedSets += 1;
        continue;
      }

      exerciseHasSavedSet = true;
      workSetCount += 1;
      const target = targets[setIndex];
      if (target === undefined) {
        continue;
      }
      const actual = asSummarySet(set, exercise, session);
      const targetValues: SessionSummarySet = {
        reps: target.targetReps,
        weight: target.targetWeight,
        unit: exerciseUnit(exercise, session),
      };
      addVolume(volumes, actual.unit, actual.weight, actual.reps);
      if (!sameReps(actual.reps, targetValues.reps, target.isAmrap) || !sameWeight(actual, targetValues)) {
        deviations.push({
          kind: 'changed',
          exerciseName: exercise.name,
          setNumber: setIndex + 1,
          actual,
          target: targetValues,
        });
      }
    }

    for (let setIndex = targets.length; setIndex < sets.length; setIndex += 1) {
      const set = sets[setIndex];
      if (set === null) {
        continue;
      }
      if (isUnlearnedSet(exercise, set)) {
        unsavedSets += 1;
        continue;
      }
      exerciseHasSavedSet = true;
      workSetCount += 1;
      const actual = asSummarySet(set, exercise, session);
      addVolume(volumes, actual.unit, actual.weight, actual.reps);
      deviations.push({
        kind: 'extra',
        exerciseName: exercise.name,
        setNumber: setIndex + 1,
        actual,
      });
    }

    if (exerciseHasSavedSet) {
      exerciseCount += 1;
    }
  });

  return {
    exerciseCount,
    workSetCount,
    notDoneSets,
    unsavedSets,
    durationSeconds: durationSecondsOf(draft),
    volumes: [...volumes.entries()].map(([unit, volume]) => ({
      unit,
      volume: Number(volume.toFixed(4)),
    })),
    deviations,
    learnedBaselines: learnedBaselinesFor(session, draft),
  };
}
