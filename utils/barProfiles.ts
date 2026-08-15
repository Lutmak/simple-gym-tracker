/**
 * M2 — Bar profiles and plate arithmetic (SPECS.md §3.5).
 *
 * An exercise performed with a bar stores WHICH bar on its SessionExercises
 * row (`bar_profile`) and, for a custom bar, the weight in `bar_weight`. The
 * stored number is always the TOTAL load, bar included — the profile exists
 * so the app can compose a total from bar + plates per side, never to make
 * history ambiguous.
 *
 * The catalog default mapping is a decision, recorded here: the catalog's
 * equipment vocabulary (`data/catalog-seed.ts`, from yuhonas/free-exercise-db)
 * contains exactly one barbell-family value — `barbell` — so only that value
 * maps to the olympic profile. Semi-olympic, Smith, EZ and custom bars exist
 * as profiles because a real user's gym has them, but no catalog row claims
 * them; they are chosen by the user, per exercise. Everything else (dumbbell,
 * machine, cable, kettlebells, body only, …) has no bar — NULL.
 *
 * `composeLoad` is exact arithmetic; `suggestPlates` is its inverse as a
 * SUGGESTION — it may fail, and a failure means the caller shows the total
 * and no composition, never an error.
 */

export type BarProfileKey = 'olympic' | 'semi-olympic' | 'smith' | 'ez' | 'custom';

export interface BarProfile {
  key: BarProfileKey;
  weightKg: number;
  weightLb: number;
}

/**
 * Conventional bar weights, chosen as the values a normal gym's bar actually
 * is: olympic 20 kg / 45 lb, semi-olympic 15 kg / 33 lb, Smith 15 kg / 33 lb,
 * EZ curl bar 8 kg / 18 lb. All four are approximations in the wild; the
 * `custom` profile exists exactly because of that, and every profile is
 * editable per exercise anyway.
 */
export const BAR_PROFILES: Record<BarProfileKey, BarProfile> = {
  olympic: { key: 'olympic', weightKg: 20, weightLb: 45 },
  'semi-olympic': { key: 'semi-olympic', weightKg: 15, weightLb: 33 },
  smith: { key: 'smith', weightKg: 15, weightLb: 33 },
  ez: { key: 'ez', weightKg: 8, weightLb: 18 },
  custom: { key: 'custom', weightKg: 0, weightLb: 0 },
};

export type PlateUnit = 'kg' | 'lb';

/**
 * The standard plate sets the app suggests compositions from, per unit. The
 * kg set bottoms out at 1.25 kg per side, which is exactly what makes 2.5 kg
 * total increments possible; the lb set at 2.5 lb per side for 5 lb total
 * increments — the same relationship the routine rounding increments have.
 * A caller with different plates passes its own list; these are defaults.
 */
export const STANDARD_PLATES: Record<PlateUnit, readonly number[]> = {
  kg: [1.25, 2.5, 5, 10, 20, 25],
  lb: [2.5, 5, 10, 25, 35, 45],
};

/** The catalog equipment values that carry a bar by default — a closed set. */
const BARBELL_FAMILY_EQUIPMENT = new Set(['barbell']);

/** The default profile for a catalog exercise's equipment, or null for no bar. */
export function defaultBarProfileForEquipment(equipment: string | null): BarProfileKey | null {
  if (equipment !== null && BARBELL_FAMILY_EQUIPMENT.has(equipment)) {
    return 'olympic';
  }
  return null;
}

export const KG_PER_LB = 0.45359237;

export function convertWeight(
  weight: number,
  from: PlateUnit,
  to: PlateUnit,
): number {
  if (from === to) {
    return weight;
  }
  return from === 'kg' ? weight / KG_PER_LB : weight * KG_PER_LB;
}

/**
 * The weight of an exercise's bar in a given unit: the profile's own
 * convention for that unit (20 kg / 45 lb — not a conversion of one into the
 * other), the custom weight when the profile says so, and null when there is
 * no bar. `barWeight` is the per-exercise `bar_weight` column, in the
 * exercise's own unit.
 */
export function barWeightFor(
  profile: BarProfileKey | null,
  barWeight: number | null,
  unit: PlateUnit,
): number | null {
  if (profile === null) {
    return null;
  }
  if (profile === 'custom') {
    return barWeight;
  }
  const conventions = BAR_PROFILES[profile];
  return unit === 'kg' ? conventions.weightKg : conventions.weightLb;
}

/** Total load: bar + both sides of the plates. Exact for the values plates take. */
export function composeLoad(bar: number, platesPerSide: readonly number[]): number {
  return bar + 2 * platesPerSide.reduce((sum, plate) => sum + plate, 0);
}

const SCALE = 1000;

const toUnits = (weight: number): number => Math.round(weight * SCALE);

/**
 * The composition of `total` on a `bar` with the given plates per side, as a
 * suggestion: the fewest plates, and among equal counts the largest-plate
 * composition (standard gym loading order). Returns null when the total
 * cannot be made — the caller shows the total and no composition. Exact
 * arithmetic on a milligram scale, so 102.5 = 20 + (20+20+1.25)·2 holds.
 */
export function suggestPlates(
  total: number,
  bar: number,
  availablePlates: readonly number[] = STANDARD_PLATES.kg,
): number[] | null {
  if (!Number.isFinite(total) || !Number.isFinite(bar) || total <= 0 || bar < 0) {
    return null;
  }
  const perSide = (total - bar) / 2;
  if (perSide < 0) {
    return null;
  }
  const plates = [...availablePlates]
    .filter((plate) => Number.isFinite(plate) && plate > 0)
    .sort((a, b) => b - a);
  const target = toUnits(perSide);

  const memo = new Map<number, number[] | null>();
  const best = (remaining: number, index: number): number[] | null => {
    if (remaining === 0) {
      return [];
    }
    if (index >= plates.length) {
      return null;
    }
    const key = remaining * (plates.length + 1) + index;
    if (memo.has(key)) {
      return memo.get(key) ?? null;
    }
    const plateUnits = toUnits(plates[index]);
    const withPlate =
      remaining >= plateUnits
        ? best(remaining - plateUnits, index)
        : null;
    const without = best(remaining, index + 1);
    const candidates: number[][] = [];
    if (withPlate !== null) {
      candidates.push([plates[index], ...withPlate]);
    }
    if (without !== null) {
      candidates.push(without);
    }
    const result = candidates.length === 0 ? null : candidates.sort(compareCompositions)[0] ?? null;
    memo.set(key, result);
    return result;
  };

  return best(target, 0);
}

/** Fewest plates wins; equal counts prefer the larger-plate composition. */
const compareCompositions = (a: readonly number[], b: readonly number[]): number => {
  if (a.length !== b.length) {
    return a.length - b.length;
  }
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left !== right) {
      return right - left;
    }
  }
  return 0;
};
