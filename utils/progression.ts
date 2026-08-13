/**
 * The progression engine (§3.4 of SPECS.md): one signature, two implementations,
 * no registry. Pure module — no database, no React. The app proposes, the user
 * decides; nothing here ever writes anything.
 *
 * `proposeNextTargets` dispatches on the routine's `progressionRule` to the
 * `linear` implementation or the `wave` adapter over `utils/fiveThreeOne.ts`.
 */

import {
  calcSetWeight,
  suggestNextTM,
  waveForWeek,
  type CycleResult,
  type LiftCategory,
  type WeekWave,
} from './fiveThreeOne';

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
  /**
   * The 5/3/1 upper/lower role, which decides the training-max increment
   * (+2.5/+5 kg, +5/+10 lb). No longer in the schema; when absent, the wave
   * adapter infers the role from the training max itself.
   */
  category?: LiftCategory;
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

const WAVE_CYCLE_LENGTH = 4;
const AMRAP_SET_INDEX = 2;

/**
 * The wave rule as an adapter over the surviving 5/3/1 helpers (§3.4):
 * weekly targets are the wave table's percentages applied to the exercise's
 * training max via `calcSetWeight`; the cycle-end TM proposal comes from
 * `suggestNextTM` fed the AMRAP sets of weeks 1-3.
 *
 * Conventions meet here, at the boundary: the wave table speaks percentages
 * 0-100 and `calcSetWeight` expects them as-is, so the model's fraction
 * (`trainingMaxPct`, 0..1) never reaches it — the wave's weekly percentages
 * ARE the load plan, and `trainingMaxPct` is not interpreted by this rule.
 * Rounding is always 'nearest': the model has no rounding direction, and it
 * is the helpers' default.
 *
 * `cycleHistory` entries are weeks. A wave cycle is four consecutive entries
 * (weeks 1-3 plus the deload week 4); the last incomplete cycle's next week
 * is proposed, and a completed cycle additionally proposes the next cycle's
 * week 1 and a new training max. Week targets are computed from the current
 * TM — after the user settles the TM proposal, the caller regenerates the
 * next cycle's weeks from the accepted value.
 */
export function waveProposeNextTargets(
  routine: RoutineLike,
  cycleHistory: CycleHistory[],
): LoadProposal[] {
  if (cycleHistory.length === 0) {
    return [];
  }

  const completedWeek = ((cycleHistory.length - 1) % WAVE_CYCLE_LENGTH) + 1;
  const cycleComplete = completedWeek === WAVE_CYCLE_LENGTH;
  const nextWeek = cycleComplete ? 1 : completedWeek + 1;

  const proposals: LoadProposal[] = [];
  for (const exercise of routine.exercises) {
    if (!waveTrainingMax(exercise)) {
      continue;
    }
    const unit = exercise.unitOverride ?? routine.unit;
    const increment = routine.roundingIncrement;
    const currentWeekTop = waveTopSet(
      waveForWeek(cycleComplete ? WAVE_CYCLE_LENGTH : completedWeek),
      exercise.trainingMaxWeight,
      increment,
    );
    const nextWeekTop = waveTopSet(
      waveForWeek(nextWeek),
      exercise.trainingMaxWeight,
      increment,
    );

    proposals.push({
      exerciseIdentifier: exercise.identifier,
      exerciseName: exercise.name,
      currentTarget: currentWeekTop,
      proposedTarget: nextWeekTop,
      unit,
      reason: weekTargetReason(nextWeek, nextWeekTop, unit),
      advisory: false,
    });

    if (cycleComplete) {
      const tmProposal = cycleEndTmProposal(
        exercise,
        cycleHistory,
        unit,
        exercise.trainingMaxWeight,
      );
      if (tmProposal !== null) {
        proposals.push(tmProposal);
      }
    }
  }
  return proposals;
}

/** A wave exercise must carry a finite, positive training max; anything else gets no proposal. */
function waveTrainingMax(
  exercise: RoutineExercise,
): exercise is RoutineExercise & { trainingMaxWeight: number } {
  return (
    exercise.loadSource === 'training_max_pct' &&
    exercise.trainingMaxWeight !== null &&
    Number.isFinite(exercise.trainingMaxWeight) &&
    exercise.trainingMaxWeight > 0
  );
}

/** The week's target is its final work set — the AMRAP set in weeks 1-3, the 60% set in deload. */
function waveTopSet(wave: WeekWave, trainingMax: number, increment: number): number {
  return calcSetWeight(
    trainingMax,
    wave.sets[AMRAP_SET_INDEX].percent,
    increment,
    'nearest',
  );
}

function weekTargetReason(week: number, weight: number, unit: LoadUnit): string {
  const targetReps = waveForWeek(week).sets[AMRAP_SET_INDEX].targetReps;
  if (week === WAVE_CYCLE_LENGTH) {
    return `semana 4 de descarga: ${targetReps} reps con ${weight} ${unit}`;
  }
  return `semana ${week}: ${targetReps}+ reps con ${weight} ${unit} (AMRAP)`;
}

/**
 * The TM proposal at cycle end: `suggestNextTM` over the AMRAP sets of the
 * last cycle's weeks 1-3. A week with fewer than three logged sets has no
 * AMRAP result and is left out; without any, there is nothing to propose.
 * The advisory mirrors `suggestNextTM.reviewRequired` — two or more misses —
 * and never changes a target by itself.
 */
function cycleEndTmProposal(
  exercise: RoutineExercise,
  cycleHistory: CycleHistory[],
  unit: LoadUnit,
  trainingMax: number,
): LoadProposal | null {
  const amrapWeeks = cycleHistory.slice(
    cycleHistory.length - WAVE_CYCLE_LENGTH,
    cycleHistory.length - 1,
  );
  const cycleResults: CycleResult[] = [];
  const amrapSets: PerformedSet[] = [];

  amrapWeeks.forEach((weekEntry, index) => {
    const sets = weekEntry.exercises[exercise.identifier]?.sets ?? [];
    const amrapSet = sets.length >= 3 ? sets[sets.length - 1] : null;
    if (amrapSet === null) {
      return;
    }
    cycleResults.push({
      targetReps: waveForWeek(index + 1).sets[AMRAP_SET_INDEX].targetReps,
      actualReps: amrapSet.reps,
    });
    amrapSets.push(amrapSet);
  });

  if (cycleResults.length === 0) {
    return null;
  }

  const suggestion = suggestNextTM(
    {
      name: exercise.name,
      trainingMax,
      unit,
      category: exercise.category ?? inferCategoryFromTrainingMax(trainingMax, unit),
    },
    cycleResults,
  );

  const missedTargets = suggestion.missedTargets;
  const reason =
    metReason(exercise, amrapSets) +
    (missedTargets > 0
      ? ` — sin cumplir ${missedTargets} ${missedTargets === 1 ? 'objetivo' : 'objetivos'}`
      : '');

  return {
    exerciseIdentifier: exercise.identifier,
    exerciseName: exercise.name,
    currentTarget: trainingMax,
    proposedTarget: suggestion.suggestedTM,
    unit,
    reason,
    advisory: suggestion.reviewRequired,
  };
}

/**
 * Upper/lower cannot be derived from a training max; the heuristic assumes
 * lifts at or above the conventional "two plates" mark are lower-body. The
 * explicit `category` field overrides it whenever the caller has real
 * knowledge.
 */
function inferCategoryFromTrainingMax(trainingMax: number, unit: LoadUnit): LiftCategory {
  const lowerBodyThreshold = unit === 'kg' ? 100 : 225;
  return trainingMax >= lowerBodyThreshold ? 'lower' : 'upper';
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
