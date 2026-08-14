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
 * one accessory row per assistance row. The SessionExercises CHECK requires
 * an absolute weight for 'absolute' rows, so the setup collects ONE assistance
 * start weight per day and every accessory row of that day shares it.
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
import type { RoutineCopyRows, RoutineDatabase, RoutineUnit } from './routineActions';

export type AssistanceBias = 'hypertrophy' | 'strength' | 'hybrid';

export interface WaveAssistanceRow {
  /** Stable client key for React; the database assigns its own row id. */
  key: string;
  catalogExerciseId: string | null;
  name: string;
  sets: number;
  reps: number;
}

export interface WaveDayDraft {
  key: string;
  weekday: number;
  liftName: string;
  catalogExerciseId: string | null;
  category: LiftCategory;
  /** The training max in the routine's unit — entered once, per lift. */
  trainingMax: number | null;
  /** One start weight shared by every accessory row of the day (§ ruling 3c). */
  assistanceStartWeight: number | null;
  assistance: WaveAssistanceRow[];
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
 */
export const ASSISTANCE_BIAS_DEFAULTS: Record<AssistanceBias, { sets: number; reps: number }> = {
  hypertrophy: { sets: 4, reps: 10 },
  strength: { sets: 5, reps: 5 },
  hybrid: { sets: 4, reps: 8 },
};

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
 * 50% x5, 60% x3 of the first work set — TM x TM percentage — rounded to the
 * routine's increment. The same base the D6 session runner uses, so the ramp
 * seen at setup is the ramp seen in the gym.
 */
export function warmupRampFor(
  day: WaveDayDraft,
  unit: RoutineUnit,
  roundingIncrement: number,
  roundingDirection: RoundingDirection,
  tmPercentage: number,
): WarmupSet[] | null {
  if (day.trainingMax === null || !Number.isFinite(day.trainingMax) || day.trainingMax <= 0) {
    return null;
  }
  return warmupSets(day.trainingMax * tmPercentage, {
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
  | { code: 'trainingMaxMissing'; lift: string }
  | { code: 'assistanceStartWeightMissing'; day: string }
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
  if (!isPositive(day.trainingMax ?? NaN)) {
    fail({ code: 'trainingMaxMissing', lift: liftName });
  }
  if (day.assistance.length > 0 && !isPositive(day.assistanceStartWeight ?? NaN)) {
    fail({ code: 'assistanceStartWeightMissing', day: liftName });
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
      trainingMaxWeight: day.trainingMax,
      absoluteWeight: null,
      unitOverride: null,
      isAmrap: true,
      sortOrder: 1,
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
      absoluteWeight: day.assistanceStartWeight,
      unitOverride: null,
      isAmrap: false,
      sortOrder: index + 2,
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
    },
    sessions,
    exercises,
  };
}

/**
 * Writes the routine in one transaction: clears any other active routine
 * (the partial unique index `Routines_single_active` enforces it), inserts
 * the routine, its sessions and their exercises, and returns the new id.
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
          rest_main_seconds, rest_accessory_seconds, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
            unit_override, is_amrap, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
        ],
      );
    }

    await db.run('COMMIT;');
    return routineId;
  } catch (error) {
    await db.run('ROLLBACK;');
    throw error;
  }
}
