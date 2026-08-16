/**
 * R2 — everything the one exercise sheet shows (SPECS.md R2).
 *
 * The sheet is opened from the routine editor, the session runner, the catalog picker, Inicio and
 * Progreso, so its content cannot be assembled inside any one of them. Three questions live here:
 *
 * - **What is this exercise?** `loadExerciseDetail` resolves a plan row to its catalog row by key,
 *   or by name when the surface only snapshotted a name (the runner and Inicio do). Catalog names
 *   are UNIQUE, which is what makes the name path exact rather than a guess.
 * - **What have I done with it?** `digestExerciseHistory` reduces the G3 series the charts already
 *   use into the four numbers a sheet has room for.
 * - **Why does it say 4 × 8?** `accessoryVolumeRationale` answers the recorded complaint
 *   (*"4 × 8 appearing from nowhere"*) from the rep range itself, which is the actual reason the
 *   defaults are what they are — see ASSISTANCE_BIAS_DEFAULTS in waveSetup.ts and the preset
 *   volumes in data/presetRoutines.ts, both of which are rep-range decisions.
 */

import type { ExerciseSeriesData } from './exerciseHistory';
import type { RoutineDatabase, RoutineRole, RoutineUnit } from './routineActions';
import { bodyPartsOfMuscles, type BodyPartKey } from './bodyParts';
import type { ExerciseOrigin } from './exerciseCatalog';

export interface ExerciseDetail {
  /** Null only for a plan row written before R2 that no catalog row matches. */
  exerciseKey: string | null;
  name: string;
  origin: ExerciseOrigin;
  level: string | null;
  force: string | null;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  bodyParts: BodyPartKey[];
  /** One entry per instruction step; empty for a custom exercise. */
  instructions: string[];
}

export interface ExerciseReference {
  name: string;
  catalogExerciseId?: string | null;
}

const str = (value: unknown): string => String(value);
const nullableStr = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

export function buildExerciseDetail(
  row: Record<string, unknown>,
  muscleRows: readonly Record<string, unknown>[],
): ExerciseDetail {
  const primaryMuscles: string[] = [];
  const secondaryMuscles: string[] = [];
  for (const muscleRow of muscleRows) {
    const muscle = str(muscleRow.muscle_name);
    if (Number(muscleRow.is_primary) === 1) {
      primaryMuscles.push(muscle);
    } else {
      secondaryMuscles.push(muscle);
    }
  }
  const instructions = nullableStr(row.instructions);

  return {
    exerciseKey: str(row.exercise_key),
    name: str(row.name),
    origin: str(row.origin) === 'user' ? 'user' : 'catalog',
    level: nullableStr(row.level),
    force: nullableStr(row.force),
    mechanic: nullableStr(row.mechanic),
    equipment: nullableStr(row.equipment),
    primaryMuscles,
    secondaryMuscles,
    bodyParts: bodyPartsOfMuscles(primaryMuscles),
    instructions:
      instructions === null
        ? []
        : instructions
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line !== ''),
  };
}

/**
 * The catalog row behind an exercise, by key when the surface has one and by name otherwise.
 * Null means the app genuinely knows nothing about it — a pre-R2 custom row — and the sheet says
 * so rather than showing empty fields.
 */
export async function loadExerciseDetail(
  db: RoutineDatabase,
  reference: ExerciseReference,
): Promise<ExerciseDetail | null> {
  const key = reference.catalogExerciseId ?? null;
  const row =
    key === null
      ? await db.get(
          `SELECT exercise_key, name, origin, level, force, mechanic, equipment, instructions
           FROM Catalog_Exercises WHERE name = ?;`,
          [reference.name],
        )
      : await db.get(
          `SELECT exercise_key, name, origin, level, force, mechanic, equipment, instructions
           FROM Catalog_Exercises WHERE exercise_key = ?;`,
          [key],
        );
  if (row === undefined) {
    return null;
  }
  const muscleRows = await db.getAll(
    `SELECT muscle_name, is_primary FROM Catalog_Exercise_Muscles
     WHERE exercise_key = ?
     ORDER BY is_primary DESC, muscle_name;`,
    [str(row.exercise_key)],
  );
  return buildExerciseDetail(row, muscleRows);
}

export interface ExerciseHistoryDigest {
  /** Logged sessions containing this exercise. */
  sessions: number;
  /** The most recent session's top set, or null when nothing is logged. */
  lastDate: number | null;
  lastWeight: number | null;
  lastReps: number | null;
  /** The heaviest set ever logged, in `unit`. */
  bestWeight: number | null;
  unit: RoutineUnit;
  mixedUnits: boolean;
  /** A trend needs two points — the same rule the charts use (B7/G3). */
  chartable: boolean;
}

/** The sheet's four numbers, from the same series the per-exercise charts draw. */
export function digestExerciseHistory(
  series: ExerciseSeriesData,
): ExerciseHistoryDigest {
  const points = series.points;
  const last = points.length === 0 ? null : points[points.length - 1];
  const bestWeight = points.reduce<number | null>(
    (best, point) => (best === null || point.weight > best ? point.weight : best),
    null,
  );

  return {
    sessions: points.length,
    lastDate: last?.date ?? null,
    lastWeight: last?.weight ?? null,
    lastReps: last?.reps ?? null,
    bestWeight,
    unit: series.unit,
    mixedUnits: series.mixedUnits,
    chartable: points.length >= 2,
  };
}

export type VolumeRationale = 'strength' | 'hypertrophy' | 'endurance';

export interface VolumePrescription {
  role: RoutineRole;
  targetSets: number;
  targetReps: number;
}

/**
 * Why an accessory's sets and reps are what they are, in one word the caller turns into one line.
 *
 * Only accessories: a main lift's load comes from the training max and the runner already states
 * that, whereas an accessory's `4 × 8` is the number that appeared from nowhere. The ranges are the
 * conventional ones the app's own defaults were chosen from — five reps or fewer is strength work,
 * six to twelve is hypertrophy volume, thirteen or more is endurance.
 */
export function accessoryVolumeRationale(
  prescription: VolumePrescription,
): VolumeRationale | null {
  if (prescription.role !== 'accessory') {
    return null;
  }
  const reps = prescription.targetReps;
  if (!Number.isFinite(reps) || reps <= 0) {
    return null;
  }
  if (reps <= 5) {
    return 'strength';
  }
  if (reps <= 12) {
    return 'hypertrophy';
  }
  return 'endurance';
}
