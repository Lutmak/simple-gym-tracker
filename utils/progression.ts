/**
 * The progression engine (§3.4 of SPECS.md): one signature, two implementations,
 * no registry. Pure module — no database, no React. The app proposes, the user
 * decides; nothing here ever writes anything.
 *
 * `proposeNextTargets` dispatches on the routine's `progressionRule` to the
 * `linear` implementation now and to `wave` (landing in F2b) later.
 */

export type LoadUnit = 'kg' | 'lb';

export type LoadSource = 'training_max_pct' | 'absolute' | 'bodyweight';

export type ProgressionRule = 'wave' | 'linear' | 'none';

/** Mirrors the Progression_Proposal.status CHECK constraint. */
export type ProposalStatus = 'pending' | 'accepted' | 'held' | 'edited' | 'declined';

/**
 * One SessionExercises row, shaped to the schema. `absoluteWeight` /
 * `trainingMaxWeight` + `trainingMaxPct` follow the same mutual-exclusion CHECK
 * as the table; the current target is derived here so the caller never
 * reimplements the pct arithmetic.
 */
export interface RoutineExercise {
  /** session_exercise_id — the key proposals are deduplicated on per cycle. */
  identifier: number;
  name: string;
  targetSets: number;
  targetReps: number;
  loadSource: LoadSource;
  unitOverride: LoadUnit | null;
  absoluteWeight: number | null;
  trainingMaxWeight: number | null;
  trainingMaxPct: number | null;
}

export interface RoutineLike {
  unit: LoadUnit;
  roundingIncrement: number;
  progressionRule: ProgressionRule;
  exercises: RoutineExercise[];
}

export interface PerformedSet {
  reps: number;
  weight: number;
  unit: LoadUnit;
}

/** What happened to one exercise in one cycle. */
export interface ExerciseHistory {
  /** Actual performed sets, in order. */
  sets: PerformedSet[];
  /** The resolved review outcome, for consecutive-hold detection. */
  proposalStatus: ProposalStatus | null;
}

/** Ascending by cycle number; the last entry is the cycle under review. */
export interface CycleHistory {
  cycleNumber: number;
  exercises: Record<number, ExerciseHistory>;
}

export interface LoadProposal {
  exerciseIdentifier: number;
  exerciseName: string;
  currentTarget: number;
  proposedTarget: number;
  unit: LoadUnit;
  reason: string;
  /** True when the previous cycle also held — suggests a reset, never applies one. */
  advisory: boolean;
}

export function proposeNextTargets(
  routine: RoutineLike,
  cycleHistory: CycleHistory[],
): LoadProposal[] {
  switch (routine.progressionRule) {
    case 'linear':
      return linearProposeNextTargets(routine, cycleHistory);
    case 'wave':
      return waveProposeNextTargets(routine, cycleHistory);
    case 'none':
      return [];
  }
}

export function waveProposeNextTargets(
  _routine: RoutineLike,
  _cycleHistory: CycleHistory[],
): LoadProposal[] {
  throw new Error('wave adapter lands in F2b');
}

function linearProposeNextTargets(
  routine: RoutineLike,
  cycleHistory: CycleHistory[],
): LoadProposal[] {
  const currentCycle = cycleHistory[cycleHistory.length - 1];
  const previousCycle = cycleHistory[cycleHistory.length - 2];
  const proposals: LoadProposal[] = [];

  for (const exercise of routine.exercises) {
    const currentTarget = currentTargetFor(exercise);
    if (currentTarget === null) {
      continue;
    }
    const unit = exercise.unitOverride ?? routine.unit;
    const sets = currentCycle?.exercises[exercise.identifier]?.sets ?? [];
    const evaluation = evaluate(exercise, sets);

    if (evaluation.kind === 'met') {
      const increment = routine.roundingIncrement;
      proposals.push({
        exerciseIdentifier: exercise.identifier,
        exerciseName: exercise.name,
        currentTarget,
        proposedTarget: roundTo(currentTarget + increment, increment),
        unit,
        reason: metReason(exercise, sets),
        advisory: false,
      });
    } else {
      // The previous cycle's resolved review is the source of truth for a second
      // consecutive hold; the outcome, not a replay of its old performance.
      const previousHeld =
        previousCycle?.exercises[exercise.identifier]?.proposalStatus === 'held';
      proposals.push({
        exerciseIdentifier: exercise.identifier,
        exerciseName: exercise.name,
        currentTarget,
        proposedTarget: currentTarget,
        unit,
        reason: holdReason(exercise, evaluation),
        advisory: previousHeld,
      });
    }
  }

  return proposals;
}

function currentTargetFor(exercise: RoutineExercise): number | null {
  switch (exercise.loadSource) {
    case 'absolute':
      return exercise.absoluteWeight;
    case 'training_max_pct':
      if (exercise.trainingMaxWeight === null || exercise.trainingMaxPct === null) {
        return null;
      }
      return exercise.trainingMaxWeight * exercise.trainingMaxPct;
    case 'bodyweight':
      return null;
  }
}

type Evaluation =
  | { kind: 'met' }
  | { kind: 'set-short'; doneSets: number }
  | { kind: 'rep-short'; setIndex: number; actualReps: number };

function evaluate(exercise: RoutineExercise, sets: PerformedSet[]): Evaluation {
  if (sets.length < exercise.targetSets) {
    return { kind: 'set-short', doneSets: sets.length };
  }
  const setIndex = sets.findIndex((set) => set.reps < exercise.targetReps);
  if (setIndex !== -1) {
    return { kind: 'rep-short', setIndex, actualReps: sets[setIndex].reps };
  }
  return { kind: 'met' };
}

function holdReason(
  exercise: RoutineExercise,
  evaluation: Exclude<Evaluation, { kind: 'met' }>,
): string {
  switch (evaluation.kind) {
    case 'set-short':
      if (evaluation.doneSets === 0) {
        return 'sin registros este ciclo';
      }
      const missingSets = exercise.targetSets - evaluation.doneSets;
      return `te faltó ${missingSets} ${missingSets === 1 ? 'serie' : 'series'} (hiciste ${evaluation.doneSets} de ${exercise.targetSets})`;
    case 'rep-short':
      const missingReps = exercise.targetReps - evaluation.actualReps;
      return `te faltaron ${missingReps} reps en la serie ${evaluation.setIndex + 1} (hiciste ${evaluation.actualReps} de ${exercise.targetReps})`;
  }
}

function metReason(exercise: RoutineExercise, sets: PerformedSet[]): string {
  const unit = sets[sets.length - 1].unit;
  const reps = sets.map((set) => set.reps).join(', ');
  const weights = sets.map((set) => set.weight);
  const weight = weights.every((value) => value === weights[0])
    ? `${weights[0]} ${unit}`
    : weights.map((value) => `${value} ${unit}`).join(', ');
  return `hiciste ${reps} con ${weight}`;
}

function roundTo(weight: number, increment: number): number {
  return Math.round(weight / increment) * increment;
}
