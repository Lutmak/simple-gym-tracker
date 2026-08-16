/**
 * R2 — body parts, the filter the catalog picker was missing (SPECS.md R2).
 *
 * The catalog's muscle vocabulary is seventeen anatomical names (`abductors`, `lats`, `traps`, …).
 * Seventeen filter chips is not a filter, it is a second search field, so the app groups them into
 * the six regions a lifter actually thinks in. The grouping lives here, once: the picker filters
 * with it, the exercise sheet reads muscles from the same vocabulary, and a custom exercise picks
 * its primary muscle from the same list — which is what makes a custom exercise appear in the same
 * filters as a seeded one (R2's acceptance).
 *
 * Muscle names are English by decision (SPECS.md §2) and are the catalog's own strings, so they are
 * never translated. The six group labels are the app's invention, not the catalog's, and are
 * localised by the caller through `bodyPartLabelKey`.
 *
 * Icons are Ionicons names because Ionicons is the app's only icon font (ENGINEERING.md §4 — the
 * `@expo/vector-icons` alias trap): adding a second family to render six chips would put a second
 * font in the bundle and a second canary in the gate.
 */

export type BodyPartKey = 'chest' | 'back' | 'shoulders' | 'arms' | 'core' | 'legs';

export interface BodyPart {
  key: BodyPartKey;
  /** Ionicons glyph name. */
  icon: string;
  /** The catalog muscle names this region covers. Lower-case, as stored. */
  muscles: readonly string[];
}

export const BODY_PARTS: readonly BodyPart[] = [
  { key: 'chest', icon: 'shirt-outline', muscles: ['chest'] },
  {
    key: 'back',
    icon: 'body-outline',
    muscles: ['lats', 'middle back', 'lower back', 'traps'],
  },
  { key: 'shoulders', icon: 'accessibility-outline', muscles: ['shoulders', 'neck'] },
  { key: 'arms', icon: 'hand-left-outline', muscles: ['biceps', 'triceps', 'forearms'] },
  { key: 'core', icon: 'flame-outline', muscles: ['abdominals'] },
  {
    key: 'legs',
    icon: 'walk-outline',
    muscles: [
      'quadriceps',
      'hamstrings',
      'glutes',
      'calves',
      'adductors',
      'abductors',
    ],
  },
];

const BY_MUSCLE: ReadonlyMap<string, BodyPartKey> = new Map(
  BODY_PARTS.flatMap((part) =>
    part.muscles.map((muscle) => [muscle, part.key] as const),
  ),
);

/** Every muscle the user may pick as a custom exercise's primary, grouped as the filter groups. */
export const PRIMARY_MUSCLE_OPTIONS: readonly string[] = BODY_PARTS.flatMap(
  (part) => part.muscles,
);

/** The region a catalog muscle belongs to, or null for a name outside the vocabulary. */
export function bodyPartOfMuscle(muscle: string): BodyPartKey | null {
  return BY_MUSCLE.get(muscle.trim().toLowerCase()) ?? null;
}

/** The regions a set of muscles covers, in `BODY_PARTS` order and without repeats. */
export function bodyPartsOfMuscles(
  muscles: readonly string[],
): BodyPartKey[] {
  const found = new Set<BodyPartKey>();
  for (const muscle of muscles) {
    const key = bodyPartOfMuscle(muscle);
    if (key !== null) {
      found.add(key);
    }
  }
  return BODY_PARTS.filter((part) => found.has(part.key)).map((part) => part.key);
}

/** The i18n key of a region's label. Groups are the app's words, so they are translated. */
export function bodyPartLabelKey(key: BodyPartKey): string {
  return `bodyPart_${key}`;
}
