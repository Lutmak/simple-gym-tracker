/**
 * M2 — Learned baselines (SPECS.md §3.2, §7.3).
 *
 * The first time an exercise is performed its target is blank; what the user
 * logs that first time becomes the app's baseline. For a `wave` exercise that
 * is the training max — Epley 1RM from the logged set, times the exercise's
 * TM percentage, rounded to the routine's increment (the same estimator the
 * setup screen offers). For a `linear`/`absolute` exercise it is the starting
 * load: the weight itself, converted to the exercise's plan unit.
 *
 * Two rules hold here, and both are the point of the module:
 *
 * - The baseline is only ever WRITTEN when the plan value is still NULL. A
 *   value the user entered by hand is never overwritten.
 * - The log row keeps the unit it was logged in; only the derived BASELINE is
 *   converted, once, because the plan column has a unit (the exercise's) and
 *   a training max stored in the wrong unit would poison every target that
 *   derives from it. Nothing in history is ever converted (§3.5).
 */

import { estimateTrainingMax } from './waveSetup';
import { convertWeight } from './barProfiles';
import type { RoutineLoadSource, RoutineUnit } from './routineActions';

export interface LearnedSet {
  weight: number;
  reps: number;
  unit: RoutineUnit;
}

export interface BaselineInput {
  loadSource: RoutineLoadSource;
  /** The exercise's stored TM percentage; 0.9 when absent. */
  trainingMaxPct: number | null;
  roundingIncrement: number;
  /** The unit the baseline must be stored in — the exercise's plan unit. */
  planUnit: RoutineUnit;
  /** The first logged set of the exercise. */
  set: LearnedSet;
}

/**
 * The baseline for one exercise from its first logged set, in the exercise's
 * plan unit, or null for bodyweight and impossible inputs. The wave estimator
 * rounds to the increment (its own convention); a linear baseline is the
 * weight as logged, converted if the set was logged in the other unit — the
 * app never rounds what the user actually lifted.
 */
export function inferBaselineWeight(input: BaselineInput): number | null {
  if (input.loadSource === 'bodyweight') {
    return null;
  }
  const set = input.set;
  if (
    !Number.isFinite(set.weight) ||
    set.weight <= 0 ||
    !Number.isInteger(set.reps) ||
    set.reps <= 0
  ) {
    return null;
  }
  const weight = convertWeight(set.weight, set.unit, input.planUnit);
  if (!Number.isFinite(weight) || weight <= 0) {
    return null;
  }
  if (input.loadSource === 'training_max_pct') {
    return estimateTrainingMax(
      weight,
      set.reps,
      input.trainingMaxPct ?? 0.9,
      input.roundingIncrement,
      'nearest',
    );
  }
  return weight;
}

/**
 * The plan column a baseline lives in, per load source — the writer's
 * counterpart to `inferBaselineWeight`.
 */
export function baselineColumn(loadSource: RoutineLoadSource): 'training_max_weight' | 'absolute_weight' | null {
  switch (loadSource) {
    case 'training_max_pct':
      return 'training_max_weight';
    case 'absolute':
      return 'absolute_weight';
    case 'bodyweight':
      return null;
  }
}

/**
 * What counts as a weight the user actually set: a finite positive number.
 * Zero — which empty numeric input can produce — is not a load; it means
 * "not yet learned", so every plan writer normalizes it to NULL. This is what
 * keeps a blank target blank until the first real log, and what keeps the
 * `IS NULL`-guarded baseline write from ever being blocked by a stray 0.
 */
export function usableWeight(weight: number | null): number | null {
  return weight !== null && Number.isFinite(weight) && weight > 0 ? weight : null;
}
