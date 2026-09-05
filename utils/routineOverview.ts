/**
 * U4 — the Rutinas list hero and the routine details' collapsed configuration (SPEC.md U4).
 *
 * Two small read models, kept pure and out of the screens per SPEC.md §0.4 ("domain logic stays
 * pure in utils/"):
 *
 * - `activeCyclePosition` answers "where in its cycle is this routine" — "Ciclo 4 · semana 2 ·
 *   6 de 16 sesiones". It is deliberately built on `cycleAdherence`
 *   (utils/routineProgress.ts) rather than re-deriving session counts, so the list's line and
 *   Progreso's own cycle tile can never disagree about what "16 de 16" means.
 * - `buildRoutineConfigView` turns a routine's stored settings into the values the collapsed
 *   "Configuración" row shows, resolving a null TM increment to the wave engine's own default
 *   (utils/waveSetup.ts) exactly the way the 5/3/1 setup screen already does, so the same routine
 *   never reads two different recommended increments in two places.
 */

import { cycleAdherence, type ProgressCycleView } from './routineProgress';
import { recommendedWaveAdvanced } from './waveSetup';
import type { RoutineProgressionRule, RoutineUnit } from './routineActions';

export interface CyclePosition {
  cycleNumber: number;
  currentWeek: number;
  sessionsDone: number;
  sessionsPlanned: number;
}

/**
 * The routine's currently active cycle, named and counted. Null when the routine has no active
 * cycle (never activated, or its last cycle already finished — §3.4 hands that case to the
 * pending-review call instead, which this function has no part in).
 */
export function activeCyclePosition(
  cycles: readonly ProgressCycleView[],
): CyclePosition | null {
  const active = cycles.find((view) => view.cycle.status === 'active');
  if (active === undefined) {
    return null;
  }
  const adherence = cycleAdherence(active.weeks);
  return {
    cycleNumber: active.cycle.cycleNumber,
    currentWeek: active.cycle.currentWeek,
    sessionsDone: adherence.done,
    sessionsPlanned: adherence.planned,
  };
}

export interface RoutineConfigSource {
  unit: RoutineUnit;
  roundingIncrement: number;
  restMainSeconds: number;
  restAccessorySeconds: number;
  progressionRule: RoutineProgressionRule;
  plannedJokers: number;
  /** Null = the wave engine's own unit default (§3.1). */
  tmIncrementUpper: number | null;
  tmIncrementLower: number | null;
  /** 3 or 4 (§3.2); 4 means the cycle closes with a deload week. */
  cycleWeeks: number;
}

export interface RoutineConfigView {
  unit: RoutineUnit;
  roundingIncrement: number;
  restMainSeconds: number;
  restAccessorySeconds: number;
  progressionRule: RoutineProgressionRule;
  plannedJokers: number;
  /** Resolved to the wave engine's recommended value when the routine stores none. */
  tmIncrementUpper: number;
  tmIncrementLower: number;
  deloadEnabled: boolean;
}

/**
 * The collapsed "Configuración" row's values (SPEC.md U4). The caller decides which rows are
 * worth showing (jokers, TM increments and the deload switch are only meaningful for a `wave`
 * routine) — this function only resolves values, it does not decide layout.
 */
export function buildRoutineConfigView(routine: RoutineConfigSource): RoutineConfigView {
  const recommended = recommendedWaveAdvanced(routine.unit);
  return {
    unit: routine.unit,
    roundingIncrement: routine.roundingIncrement,
    restMainSeconds: routine.restMainSeconds,
    restAccessorySeconds: routine.restAccessorySeconds,
    progressionRule: routine.progressionRule,
    plannedJokers: routine.plannedJokers,
    tmIncrementUpper: routine.tmIncrementUpper ?? recommended.upperTmIncrement,
    tmIncrementLower: routine.tmIncrementLower ?? recommended.lowerTmIncrement,
    deloadEnabled: routine.cycleWeeks === 4,
  };
}
