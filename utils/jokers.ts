/**
 * M2 — Extra sets and jokers (SPECS.md §3.4).
 *
 * Any exercise accepts extra sets during a session; on a `wave` routine they
 * are jokers and the app proposes the next weight step. This module is the
 * pure part: the proposal arithmetic and the planned-jokers cap. Extra sets
 * themselves are model-level — a session's draft may carry more sets than
 * planned, they enter history like any other set and count toward volume, and
 * the progression engine reads only the first `targetSets` sets (see
 * utils/progression.ts), so they can never move a proposal on their own.
 */

import { roundTo } from './progression';

/** The cap on how many jokers a `wave` routine may plan ahead (§3.4). */
export const PLANNED_JOKERS_MAX = 3;

/**
 * The next weight step for a joker: one rounding increment above the current
 * work weight, on the routine's grid.
 */
export function proposeJokerWeight(
  currentWorkWeight: number,
  roundingIncrement: number,
): number {
  return roundTo(currentWorkWeight + roundingIncrement, roundingIncrement);
}

/**
 * The jokers a routine plans in advance: the first `count` steps above the
 * current work weight, in order. `count` is clamped to the cap, so a caller
 * can never plan more jokers than the model allows.
 */
export function plannedJokerWeights(
  currentWorkWeight: number,
  roundingIncrement: number,
  count: number,
): number[] {
  const planned = Math.min(Math.max(0, Math.floor(count)), PLANNED_JOKERS_MAX);
  const weights: number[] = [];
  let weight = currentWorkWeight;
  for (let index = 0; index < planned; index += 1) {
    weight = proposeJokerWeight(weight, roundingIncrement);
    weights.push(weight);
  }
  return weights;
}
