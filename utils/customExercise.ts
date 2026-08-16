/**
 * R2 — a custom exercise, asked what a custom exercise needs (SPECS.md R2).
 *
 * The old flow took a name and wrote a plan row with a NULL catalog id. That exercise could never
 * be described, never be filtered, never carry a bar, and it landed in history that way forever —
 * the maintainer's complaint was *"no sé qué es, no sé qué zona trabaja"* about exactly this.
 *
 * A custom exercise is now a catalog row the user wrote: name, primary muscle, equipment, and
 * whether it uses a bar. Four answers, none of which the app can learn from a name, and every one
 * of them is something the app then never has to ask again — it shows the same sheet, appears in
 * the same body-part filter, and gets a bar profile from the same mapping as a seeded row.
 *
 * Pure validation and key derivation here; one thin database edge at the bottom.
 */

import { bodyPartOfMuscle } from './bodyParts';
import { buildCatalogExercise, type CatalogExercise } from './exerciseCatalog';
import type { RoutineDatabase } from './routineActions';

export interface CustomExerciseDraft {
  name: string;
  /** A catalog muscle name — the same vocabulary the filters group (§2: English). */
  primaryMuscle: string | null;
  /** A catalog equipment value, or null for "not sure". */
  equipment: string | null;
  usesBar: boolean;
}

export type CustomExerciseProblem = 'name-required' | 'name-taken' | 'muscle-required';

/**
 * The equipment values offered for a custom exercise: the catalog's own vocabulary, trimmed to
 * what a user would name. Staying inside the catalog vocabulary is what keeps the bar mapping in
 * barProfiles.ts and any future equipment filter honest for custom rows.
 */
export const CUSTOM_EQUIPMENT_OPTIONS: readonly string[] = [
  'body only',
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'kettlebells',
  'bands',
  'other',
];

/** Equipment that carries a bar unless the user says otherwise — the form's proposed answer. */
export function usesBarByDefault(equipment: string | null): boolean {
  return equipment === 'barbell' || equipment === 'e-z curl bar';
}

/**
 * The first problem with a draft, or null when it can be saved. Names are compared
 * case-insensitively because `Catalog_Exercises.name` is UNIQUE and a second "Press militar" would
 * fail at the database instead of on the screen.
 */
export function validateCustomExercise(
  draft: CustomExerciseDraft,
  takenNames: ReadonlySet<string>,
): CustomExerciseProblem | null {
  const name = draft.name.trim();
  if (name === '') {
    return 'name-required';
  }
  const taken = new Set([...takenNames].map((value) => value.trim().toLowerCase()));
  if (taken.has(name.toLowerCase())) {
    return 'name-taken';
  }
  if (draft.primaryMuscle === null || bodyPartOfMuscle(draft.primaryMuscle) === null) {
    return 'muscle-required';
  }
  return null;
}

/**
 * A stable key derived from the name, in the catalog's own `Word_Word` style with a `user-`
 * prefix so provenance is readable in the data. Collisions get a numeric suffix rather than a
 * timestamp: the key ends up in `SessionExercises` and in the image pack's manifest, where a
 * reproducible value is worth more than a unique-by-construction one.
 */
export function buildCustomExerciseKey(
  name: string,
  existingKeys: ReadonlySet<string>,
): string {
  const slug =
    name
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, '_')
      .replace(/^_+|_+$/g, '') || 'exercise';
  const base = `user-${slug}`;
  if (!existingKeys.has(base)) {
    return base;
  }
  let suffix = 2;
  while (existingKeys.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

/**
 * Writes the row and its primary muscle, and returns it in the shape the picker already holds.
 * The caller has validated the draft; the UNIQUE name constraint is the backstop.
 */
export async function createCustomExercise(
  db: RoutineDatabase,
  draft: CustomExerciseDraft,
  existingKeys: ReadonlySet<string>,
): Promise<CatalogExercise> {
  const name = draft.name.trim();
  const primaryMuscle = draft.primaryMuscle;
  if (primaryMuscle === null) {
    throw new Error('A custom exercise needs a primary muscle.');
  }
  const exerciseKey = buildCustomExerciseKey(name, existingKeys);

  await db.run(
    `INSERT INTO Catalog_Exercises
       (exercise_key, name, category, level, force, mechanic, equipment, instructions,
        origin, uses_bar)
     VALUES (?, ?, 'strength', NULL, NULL, NULL, ?, NULL, 'user', ?);`,
    [exerciseKey, name, draft.equipment, draft.usesBar ? 1 : 0],
  );
  await db.run(
    `INSERT INTO Catalog_Exercise_Muscles (exercise_key, muscle_name, is_primary)
     VALUES (?, ?, 1);`,
    [exerciseKey, primaryMuscle],
  );

  return buildCatalogExercise({
    exercise_key: exerciseKey,
    name,
    equipment: draft.equipment,
    uses_bar: draft.usesBar ? 1 : 0,
    origin: 'user',
    primary_muscles: primaryMuscle,
  });
}
