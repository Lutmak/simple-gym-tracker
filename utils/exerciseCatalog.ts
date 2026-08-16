/**
 * R2 — the catalog as the picker sees it (SPECS.md R2).
 *
 * The old picker asked the database a different question for every state it was in: the tapped
 * exercise's primary muscles, or all exercises, and nothing at all when there was no exercise in
 * context — which is exactly why the session runner's "add an exercise" opened an unfiltered wall
 * of 870 rows. There is one question now: give me the catalog with its primary muscles. Everything
 * the user does to that list — search, body part, the region the tapped exercise belongs to — is
 * pure filtering over rows already in memory, so it is testable without a device and instant
 * without a query per keystroke.
 *
 * A custom exercise is a catalog row (`origin = 'user'`), so it arrives through the same load, the
 * same filters and the same sheet as a seeded one. That is R2's acceptance criterion, and it is a
 * property of the data model here rather than a rule every screen has to remember.
 */

import { bodyPartsOfMuscles, type BodyPartKey } from './bodyParts';
import type { RoutineDatabase } from './routineActions';

export type ExerciseOrigin = 'catalog' | 'user';

export interface CatalogExercise {
  exerciseKey: string;
  name: string;
  equipment: string | null;
  /** The user's own answer for a custom exercise; null when the equipment mapping decides. */
  usesBar: boolean | null;
  origin: ExerciseOrigin;
  /** Catalog muscle names, lower-case, English by decision (§2). */
  primaryMuscles: string[];
  /** The regions those muscles cover — what the filter chips match on. */
  bodyParts: BodyPartKey[];
}

export interface CatalogFilter {
  /** Free text, matched case-insensitively anywhere in the name. */
  query: string;
  /** null means every body part. */
  bodyPart: BodyPartKey | null;
}

/** Search and body part, in that order of cheapness. Order of the input list is preserved. */
export function filterCatalogExercises(
  exercises: readonly CatalogExercise[],
  filter: CatalogFilter,
): CatalogExercise[] {
  const needle = filter.query.trim().toLowerCase();
  return exercises.filter((exercise) => {
    if (needle !== '' && !exercise.name.toLowerCase().includes(needle)) {
      return false;
    }
    if (filter.bodyPart !== null && !exercise.bodyParts.includes(filter.bodyPart)) {
      return false;
    }
    return true;
  });
}

/**
 * The region the picker opens on: the tapped exercise's own, so replacing a bench press starts
 * among chest work. Null — every body part — when nothing was tapped, which is the runner's
 * "add an exercise" and is a deliberate absence of a filter rather than the old silent skip.
 */
export function initialBodyPart(
  exercises: readonly CatalogExercise[],
  catalogExerciseId: string | null,
): BodyPartKey | null {
  if (catalogExerciseId === null) {
    return null;
  }
  const exercise = exercises.find((row) => row.exerciseKey === catalogExerciseId);
  return exercise?.bodyParts[0] ?? null;
}

const MUSCLE_SEPARATOR = '|';

const str = (value: unknown): string => String(value);
const nullableStr = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

/** SQLite has no boolean; 0/1 columns come back as numbers and NULL means "not answered". */
const nullableBool = (value: unknown): boolean | null =>
  value === null || value === undefined ? null : Number(value) === 1;

export function buildCatalogExercise(row: Record<string, unknown>): CatalogExercise {
  const primaryMuscles =
    row.primary_muscles === null || row.primary_muscles === undefined
      ? []
      : str(row.primary_muscles).split(MUSCLE_SEPARATOR).filter((muscle) => muscle !== '');
  return {
    exerciseKey: str(row.exercise_key),
    name: str(row.name),
    equipment: nullableStr(row.equipment),
    usesBar: nullableBool(row.uses_bar),
    origin: str(row.origin) === 'user' ? 'user' : 'catalog',
    primaryMuscles,
    bodyParts: bodyPartsOfMuscles(primaryMuscles),
  };
}

/** The whole catalog with its primary muscles, alphabetically — one query, one round trip. */
export async function loadCatalogExercises(
  db: RoutineDatabase,
): Promise<CatalogExercise[]> {
  const rows = await db.getAll(
    `SELECT e.exercise_key, e.name, e.equipment, e.uses_bar, e.origin,
            GROUP_CONCAT(CASE WHEN m.is_primary = 1 THEN m.muscle_name END, '${MUSCLE_SEPARATOR}')
              AS primary_muscles
     FROM Catalog_Exercises e
     LEFT JOIN Catalog_Exercise_Muscles m ON m.exercise_key = e.exercise_key
     GROUP BY e.exercise_key, e.name, e.equipment, e.uses_bar, e.origin
     ORDER BY e.name;`,
    [],
  );
  return rows.map(buildCatalogExercise);
}
