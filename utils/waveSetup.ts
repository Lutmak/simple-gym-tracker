/**
 * D4 — The 5/3/1 setup, rebuilt (SPECS.md D4, §3.1, §3.4, §7).
 *
 * The old B3 wizard exposed every internal knob on the main path; the rebuilt
 * flow is ONE screen with sections: a main path (name, unit, increment,
 * deload, warm-ups), a closed-by-default Advanced section (TM percentage,
 * rounding direction, per-lift TM increments, assistance volume bias),
 * week-first training days, and a live, tappable review. This module is the
 * pure core of that screen: defaults, the TM estimator, upper/lower
 * derivation from the catalog's primary muscles, the warm-up ramp preview,
 * the routine-rows builder and the single write transaction.
 *
 * The write path follows the D2 copy machinery (`utils/routineActions.ts`):
 * one Routines row with progression_rule 'wave' and user origin, one Session
 * per day, a main SessionExercise per day loaded from the training max, and
 * one accessory row per assistance row. Weights are learned, never demanded
 * (§3.2): a missing training max or assistance start weight is written as
 * NULL, and the first logged session fills it in. Bar profiles default from
 * the catalog equipment when the draft carries it (utils/barProfiles.ts).
 *
 * Rounding direction affects only setup-time arithmetic (the estimator and
 * the ramp preview): the Routines table stores no direction, so the runtime
 * (today.ts / sessionRunner.ts) is always nearest.
 */

import {
  calcSetWeight,
  estimate1RM,
  warmupSets,
  type LiftCategory,
  type RoundingDirection,
  type WarmupSet,
} from './fiveThreeOne';
import { defaultBarProfileForEquipment } from './barProfiles';
import { ensureActiveCycle } from './cycleSeed';
import type { RoutineCopyRows, RoutineDatabase, RoutineUnit } from './routineActions';

export type AssistanceBias = 'hypertrophy' | 'strength' | 'hybrid';

export interface WaveAssistanceRow {
  /** Stable client key for React; the database assigns its own row id. */
  key: string;
  catalogExerciseId: string | null;
  name: string;
  sets: number;
  reps: number;
  /** The catalog equipment of the chosen exercise — the bar-profile default. */
  equipment?: string | null;
  /** Per-exercise warm-ups (§3.6); omitted means the role's default. */
  warmupsEnabled?: boolean | null;
}

export interface WaveDayDraft {
  key: string;
  weekday: number;
  liftName: string;
  catalogExerciseId: string | null;
  category: LiftCategory;
  /** The training max in the routine's unit — entered once, per lift. Null until learned. */
  trainingMax: number | null;
  /** One start weight shared by every accessory row of the day. Null until learned. */
  assistanceStartWeight: number | null;
  assistance: WaveAssistanceRow[];
  /** The catalog equipment of the chosen lift — the bar-profile default. */
  equipment?: string | null;
  /** Per-lift warm-ups (§3.6); omitted follows the program's own warm-up switch. */
  warmupsEnabled?: boolean | null;
}

export interface WaveSetupDraft {
  name: string;
  unit: RoutineUnit;
  roundingIncrement: number;
  roundingDirection: RoundingDirection;
  /** The fraction 0.85–0.90; stored on every main exercise at confirm. */
  tmPercentage: number;
  includeDeload: boolean;
  warmupsEnabled: boolean;
  upperTmIncrement: number;
  lowerTmIncrement: number;
  assistanceBias: AssistanceBias;
  days: WaveDayDraft[];
  /** Planned jokers (§3.4); 0 when omitted — off by default. */
  plannedJokers?: number;
}

export interface DefaultTrainingDay {
  weekday: number;
  liftName: string;
  category: LiftCategory;
}

/** Wendler's standard four-day week: two lower days and two upper days, Monday to Friday. */
export const DEFAULT_TRAINING_DAYS: readonly DefaultTrainingDay[] = [
  { weekday: 1, liftName: 'Squat', category: 'lower' },
  { weekday: 2, liftName: 'Bench Press', category: 'upper' },
  { weekday: 4, liftName: 'Deadlift', category: 'lower' },
  { weekday: 5, liftName: 'Overhead Press', category: 'upper' },
];

/** Unit-coupled setup defaults: the increments a kg and a lb program ship with. */
export const WAVE_UNIT_DEFAULTS: Record<RoutineUnit, {
  roundingIncrement: number;
  upperTmIncrement: number;
  lowerTmIncrement: number;
}> = {
  kg: { roundingIncrement: 2.5, upperTmIncrement: 2.5, lowerTmIncrement: 5 },
  lb: { roundingIncrement: 5, upperTmIncrement: 5, lowerTmIncrement: 10 },
};

/**
 * The rounding increments a real gym's plates make, per unit — 1.25 kg per
 * side is the smallest standard plate, so 2.5 kg is the smallest honest total
 * step (utils/barProfiles.ts). Offering these three as a choice rather than a
 * free number is what stops the field from ever being empty, and an empty
 * field is the only way a save could be blocked by a missing number (R3).
 */
export const ROUNDING_INCREMENT_OPTIONS: Record<RoutineUnit, readonly number[]> = {
  kg: [1.25, 2.5, 5],
  lb: [2.5, 5, 10],
};

/**
 * The increment a routine is created with. **This is the settings seam:** once
 * Ajustes persists a default rounding increment (SPECS.md S2) this function is
 * the one place that reads it. Until then the unit's own convention is the
 * default, which is what every routine already shipped with.
 */
export function defaultRoundingIncrement(unit: RoutineUnit): number {
  return WAVE_UNIT_DEFAULTS[unit].roundingIncrement;
}

/**
 * The rounding increment a unit switch carries forward. An untouched increment — still the OLD
 * unit's own default — follows the unit, matching `WAVE_UNIT_DEFAULTS`; a value the user
 * deliberately chose stays theirs, but only if the NEW unit still offers it, since an increment
 * invalid for the new unit cannot stay selected either.
 *
 * `ROUNDING_INCREMENT_OPTIONS` overlaps at 5 for kg and lb, which is why checking only "is this
 * value valid under the new unit" is not enough on its own: lb's default (5) is also a valid kg
 * option, so that check alone carried lb's untouched default into kg as if the user had chosen
 * 5 kg on purpose — found on the fresh-install walkthrough, 2026-09-04 (switching lb → kg left
 * "5" selected and the review read "5 kg").
 */
export function nextRoundingIncrementForUnit(
  currentUnit: RoutineUnit,
  currentIncrement: number,
  nextUnit: RoutineUnit,
): number {
  const wasUntouched = currentIncrement === defaultRoundingIncrement(currentUnit);
  const staysValid = ROUNDING_INCREMENT_OPTIONS[nextUnit].includes(currentIncrement);
  return !wasUntouched && staysValid ? currentIncrement : defaultRoundingIncrement(nextUnit);
}

/** The rest values a 5/3/1 routine is created with (§3.8). */
export const WAVE_REST_MAIN_SECONDS = 180;
export const WAVE_REST_ACCESSORY_SECONDS = 90;

/** The nominal main-set shape the wave engine overrides with its own percentages. */
export const WAVE_MAIN_SETS = 3;
export const WAVE_MAIN_REPS = 5;

/**
 * Sets/reps an added accessory row starts from, per bias. Hypertrophy rows
 * run higher-rep, strength rows lower-rep heavier, hybrid splits the
 * difference — all editable per row afterwards (D3).
 *
 * R3 renamed the *label* of this option, not its behaviour: "sesgo de volumen
 * de asistencia" said nothing a user could act on. The option is now presented
 * as the sets × reps it actually produces, which is the whole of what it
 * changes — these three pairs.
 */
export const ASSISTANCE_BIAS_DEFAULTS: Record<AssistanceBias, { sets: number; reps: number }> = {
  hypertrophy: { sets: 4, reps: 10 },
  strength: { sets: 5, reps: 5 },
  hybrid: { sets: 4, reps: 8 },
};

/** The cap on planned jokers (§3.4) — off by default, three at the very most. */
export const WAVE_MAX_PLANNED_JOKERS = 3;

/**
 * Everything behind **Opciones avanzadas** (R3), as one value.
 *
 * The screen never invents a default and never leaves one blank: it opens with
 * exactly this, and an emptied field falls back to it rather than blocking the
 * save. That is what makes the acceptance criterion — "created and activated
 * without opening Advanced and without entering a single weight" — true by
 * construction instead of by discipline.
 */
export interface WaveAdvanced {
  tmPercentage: number;
  roundingDirection: RoundingDirection;
  upperTmIncrement: number;
  lowerTmIncrement: number;
  assistanceBias: AssistanceBias;
  plannedJokers: number;
}

/**
 * The recommended advanced settings, per unit: Wendler's own 90% training max,
 * nearest rounding (the gym's plates decide the rest), his +2.5 kg upper /
 * +5 kg lower cycle increments, hybrid accessory volume, and no planned
 * jokers — a joker is a decision made in the moment, not in a form.
 */
export function recommendedWaveAdvanced(unit: RoutineUnit): WaveAdvanced {
  const defaults = WAVE_UNIT_DEFAULTS[unit];
  return {
    tmPercentage: 0.9,
    roundingDirection: 'nearest',
    upperTmIncrement: defaults.upperTmIncrement,
    lowerTmIncrement: defaults.lowerTmIncrement,
    assistanceBias: 'hybrid',
    plannedJokers: 0,
  };
}

/** Whether the advanced block still holds every recommendation — the review says so. */
export function isRecommendedWaveAdvanced(
  advanced: WaveAdvanced,
  unit: RoutineUnit,
): boolean {
  const recommended = recommendedWaveAdvanced(unit);
  return (
    advanced.tmPercentage === recommended.tmPercentage &&
    advanced.roundingDirection === recommended.roundingDirection &&
    advanced.upperTmIncrement === recommended.upperTmIncrement &&
    advanced.lowerTmIncrement === recommended.lowerTmIncrement &&
    advanced.assistanceBias === recommended.assistanceBias &&
    advanced.plannedJokers === recommended.plannedJokers
  );
}

/**
 * Primary muscles that make a lift a lower-body lift. Everything else —
 * chest, shoulders, back, arms, core — is upper. The deadlift is 'lower'
 * through its lower-back primary, which matches Wendler's own pairing.
 */
const LOWER_BODY_PRIMARY_MUSCLES = new Set([
  'quadriceps',
  'hamstrings',
  'glutes',
  'calves',
  'adductors',
  'abductors',
  'lower back',
]);

/** Upper/lower is derived from the lift's primary muscles — the app never asks. */
export const derivedCategory = (primaryMuscles: readonly string[]): LiftCategory =>
  primaryMuscles.some((muscle) => LOWER_BODY_PRIMARY_MUSCLES.has(muscle)) ? 'lower' : 'upper';

/**
 * The training max estimator: Epley 1RM from a recent set, times the TM
 * percentage, rounded to the routine's increment. This is 5/3/1's own
 * convention — the TM is a planning number 90% of a 1RM estimate.
 */
export function estimateTrainingMax(
  weight: number,
  reps: number,
  tmPercentage: number,
  increment: number,
  direction: RoundingDirection,
): number {
  return calcSetWeight(estimate1RM(weight, reps), tmPercentage * 100, increment, direction);
}

/**
 * The warm-up ramp a day shows when warm-ups are on: the standard 40% x5,
 * 50% x5, 60% x3 of the TRAINING MAX itself (F6) — never TM x TM percentage,
 * which is not the training max and matches no real work set in the wave
 * table (weeks 1-3 top out at 85/90/95% of TM, never flatly at the TM
 * percentage). The same base the D6 session runner uses, so the ramp seen
 * at setup is the ramp seen in the gym, unchanged week to week.
 */
export function warmupRampFor(
  day: WaveDayDraft,
  unit: RoutineUnit,
  roundingIncrement: number,
  roundingDirection: RoundingDirection,
): WarmupSet[] | null {
  if (day.trainingMax === null || !Number.isFinite(day.trainingMax) || day.trainingMax <= 0) {
    return null;
  }
  return warmupSets(day.trainingMax, {
    increment: roundingIncrement,
    direction: roundingDirection,
    unit,
  });
}

export type WaveSetupError =
  | { code: 'routineNameRequired' }
  | { code: 'roundingIncrementInvalid' }
  | { code: 'tmPercentageInvalid' }
  | { code: 'upperTmIncrementInvalid' }
  | { code: 'lowerTmIncrementInvalid' }
  | { code: 'noTrainingDays' }
  | { code: 'duplicateWeekday' }
  | { code: 'liftNameRequired'; day: string }
  | { code: 'assistanceNameRequired'; exercise: string }
  | { code: 'assistanceSetsInvalid'; exercise: string }
  | { code: 'assistanceRepsInvalid'; exercise: string };

export class WaveSetupValidationError extends Error {
  readonly detail: WaveSetupError;

  constructor(detail: WaveSetupError) {
    super(detail.code);
    this.name = 'WaveSetupValidationError';
    this.detail = detail;
  }
}

const fail = (detail: WaveSetupError): never => {
  throw new WaveSetupValidationError(detail);
};

const isPositive = (value: number): boolean => Number.isFinite(value) && value > 0;

/** A non-positive weight is not a load — it stays NULL until learned (§3.2). */
const usable = (weight: number | null): number | null =>
  weight !== null && isPositive(weight) ? weight : null;

const isPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value > 0;

const assertProgram = (draft: WaveSetupDraft): void => {
  if (draft.name.trim() === '') {
    fail({ code: 'routineNameRequired' });
  }
  if (!isPositive(draft.roundingIncrement)) {
    fail({ code: 'roundingIncrementInvalid' });
  }
  if (
    !Number.isFinite(draft.tmPercentage) ||
    draft.tmPercentage < 0.85 ||
    draft.tmPercentage > 0.9
  ) {
    fail({ code: 'tmPercentageInvalid' });
  }
  if (!isPositive(draft.upperTmIncrement)) {
    fail({ code: 'upperTmIncrementInvalid' });
  }
  if (!isPositive(draft.lowerTmIncrement)) {
    fail({ code: 'lowerTmIncrementInvalid' });
  }
};

const assertDay = (day: WaveDayDraft): void => {
  const liftName = day.liftName.trim();
  if (liftName === '') {
    fail({ code: 'liftNameRequired', day: day.key });
  }
  for (const exercise of day.assistance) {
    if (exercise.name.trim() === '') {
      fail({ code: 'assistanceNameRequired', exercise: exercise.key });
    }
    if (!isPositiveInteger(exercise.sets)) {
      fail({ code: 'assistanceSetsInvalid', exercise: exercise.name || exercise.key });
    }
    if (!isPositiveInteger(exercise.reps)) {
      fail({ code: 'assistanceRepsInvalid', exercise: exercise.name || exercise.key });
    }
  }
};

/**
 * The rows `writeWaveRoutine` inserts — one routine, one session per day, one
 * main lift per day (training-max loaded, AMRAP) plus one accessory row per
 * assistance row (absolute-loaded at the day's start weight). The shape is
 * the same `RoutineCopyRows` the D2 machinery produces, so the review and the
 * write are the same value the user saw.
 */
export function buildWaveRoutineRows(draft: WaveSetupDraft): RoutineCopyRows {
  assertProgram(draft);
  if (draft.days.length === 0) {
    fail({ code: 'noTrainingDays' });
  }

  const usedWeekdays = new Set<number>();
  const sessions = draft.days.map((day, index) => {
    if (usedWeekdays.has(day.weekday)) {
      fail({ code: 'duplicateWeekday' });
    }
    usedWeekdays.add(day.weekday);
    assertDay(day);
    return { weekday: day.weekday, name: day.liftName.trim(), sortOrder: index + 1 };
  });

  const exercises = draft.days.flatMap((day, sessionIndex) => {
    const main = {
      sessionIndex,
      catalogExerciseId: day.catalogExerciseId,
      name: day.liftName.trim(),
      role: 'main' as const,
      targetSets: WAVE_MAIN_SETS,
      targetReps: WAVE_MAIN_REPS,
      loadSource: 'training_max_pct' as const,
      trainingMaxPct: draft.tmPercentage,
      // A non-positive training max is not a load — it stays NULL until the
      // first logged session learns it (§3.2).
      trainingMaxWeight: usable(day.trainingMax),
      absoluteWeight: null,
      unitOverride: null,
      isAmrap: true,
      sortOrder: 1,
      barProfile: defaultBarProfileForEquipment(day.equipment ?? null),
      barWeight: null,
      // Null is "the role decides", which for a main lift means warm-ups on
      // (§3.6). The program switch turning them off is a real answer, so it
      // is stored as one.
      warmupsEnabled: day.warmupsEnabled ?? (draft.warmupsEnabled ? null : false),
      // §3.1/F3: the lift's own upper/lower role, actually persisted — only
      // the main lift carries one; accessories have no TM increment concept.
      category: day.category,
    };
    const accessories = day.assistance.map((exercise, index) => ({
      sessionIndex,
      catalogExerciseId: exercise.catalogExerciseId,
      name: exercise.name.trim(),
      role: 'accessory' as const,
      targetSets: exercise.sets,
      targetReps: exercise.reps,
      loadSource: 'absolute' as const,
      trainingMaxPct: null,
      trainingMaxWeight: null,
      absoluteWeight: usable(day.assistanceStartWeight),
      unitOverride: null,
      isAmrap: false,
      sortOrder: index + 2,
      barProfile: defaultBarProfileForEquipment(exercise.equipment ?? null),
      barWeight: null,
      warmupsEnabled: exercise.warmupsEnabled ?? null,
      category: null,
    }));
    return [main, ...accessories];
  });

  return {
    routine: {
      routineKey: null,
      name: draft.name.trim(),
      origin: 'user',
      progressionRule: 'wave',
      unit: draft.unit,
      roundingIncrement: draft.roundingIncrement,
      restMainSeconds: WAVE_REST_MAIN_SECONDS,
      restAccessorySeconds: WAVE_REST_ACCESSORY_SECONDS,
      isActive: true,
      createdAt: Date.now(),
      plannedJokers: draft.plannedJokers ?? 0,
      // §3.1/§3.2 (F3): persisted instead of validated-then-discarded.
      tmIncrementUpper: draft.upperTmIncrement,
      tmIncrementLower: draft.lowerTmIncrement,
      cycleWeeks: draft.includeDeload ? 4 : 3,
    },
    sessions,
    exercises,
  };
}

/**
 * Writes the routine in one transaction: clears any other active routine
 * (the partial unique index `Routines_single_active` enforces it), inserts
 * the routine, its sessions and their exercises, seeds its first cycle
 * (utils/cycleSeed.ts — without one the session queue has no head), and
 * returns the new id.
 */
export async function writeWaveRoutine(
  db: RoutineDatabase,
  draft: WaveSetupDraft,
): Promise<number> {
  const rows = buildWaveRoutineRows(draft);

  await db.run('BEGIN;');
  try {
    await db.run('UPDATE Routines SET is_active = 0 WHERE is_active = 1;');
    await db.run(
      `INSERT INTO Routines
         (routine_key, name, origin, progression_rule, unit, rounding_increment,
          rest_main_seconds, rest_accessory_seconds, is_active, created_at, planned_jokers,
          tm_increment_upper, tm_increment_lower, cycle_weeks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        rows.routine.routineKey,
        rows.routine.name,
        rows.routine.origin,
        rows.routine.progressionRule,
        rows.routine.unit,
        rows.routine.roundingIncrement,
        rows.routine.restMainSeconds,
        rows.routine.restAccessorySeconds,
        rows.routine.isActive ? 1 : 0,
        rows.routine.createdAt,
        rows.routine.plannedJokers,
        rows.routine.tmIncrementUpper,
        rows.routine.tmIncrementLower,
        rows.routine.cycleWeeks,
      ],
    );
    const routineIdRow = await db.get('SELECT last_insert_rowid() AS id;', []);
    if (!routineIdRow) {
      throw new Error('Could not read the new routine id');
    }
    const routineId = Number(routineIdRow.id);

    const sessionIds: number[] = [];
    for (const session of rows.sessions) {
      await db.run(
        `INSERT INTO Sessions (routine_id, weekday, name, sort_order) VALUES (?, ?, ?, ?);`,
        [routineId, session.weekday, session.name, session.sortOrder],
      );
      const sessionIdRow = await db.get('SELECT last_insert_rowid() AS id;', []);
      if (!sessionIdRow) {
        throw new Error('Could not read the new session id');
      }
      sessionIds.push(Number(sessionIdRow.id));
    }

    for (const exercise of rows.exercises) {
      const sessionId = sessionIds[exercise.sessionIndex];
      if (sessionId === undefined) {
        throw new Error(`Wave exercise has no session ${exercise.sessionIndex}`);
      }
      await db.run(
        `INSERT INTO SessionExercises
           (session_id, catalog_exercise_id, exercise_name, role, target_sets, target_reps,
            load_source, training_max_pct, training_max_weight, absolute_weight,
            unit_override, is_amrap, sort_order, bar_profile, bar_weight, warmups_enabled,
            category)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          sessionId,
          exercise.catalogExerciseId,
          exercise.name,
          exercise.role,
          exercise.targetSets,
          exercise.targetReps,
          exercise.loadSource,
          exercise.trainingMaxPct,
          exercise.trainingMaxWeight,
          exercise.absoluteWeight,
          exercise.unitOverride,
          exercise.isAmrap ? 1 : 0,
          exercise.sortOrder,
          exercise.barProfile,
          exercise.barWeight,
          exercise.warmupsEnabled === null ? null : exercise.warmupsEnabled ? 1 : 0,
          exercise.category,
        ],
      );
    }

    // The routine is written active, so it is trainable immediately.
    if (rows.routine.isActive) {
      await ensureActiveCycle(db, routineId, Math.floor(Date.now() / 1000));
    }

    await db.run('COMMIT;');
    return routineId;
  } catch (error) {
    await db.run('ROLLBACK;');
    throw error;
  }
}
