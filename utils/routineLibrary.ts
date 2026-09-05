/**
 * R1 — the Rutinas tab's model (SPECS.md R1, §3.2).
 *
 * *"¿Por qué en la pestaña de rutinas están las predefinidas mezcladas con las mías?"* The tab used
 * to render two lists of the same shape: the user's routines and the 22 presets, one after the
 * other, so the answer to "what am I training" competed with the answer to "what could I train".
 * This module draws the line the screen renders:
 *
 * - **The library** is `Routines` — and only `Routines`. Everything in it belongs to the user, and
 *   the active one comes first (`orderLibrary`).
 * - **The presets** are `Preset_Routines`, grouped by level (`buildPresetLibrary`), and they are
 *   reachable only from the "new routine" door. A preset the user already copied says so rather
 *   than pretending to be new.
 * - **Activation** is planned, never improvised (`planActivation`): the plan names what becomes
 *   inactive, and it carries **no weight, no number and no field**. That absence is the point
 *   (§3.2 — targets are learned, never demanded): there is no branch of this type that a screen
 *   could turn into an input. Weight fields stay NULL at activation and the first logged session
 *   learns them (`utils/learnedWeights.ts`).
 *
 * Everything here is pure except the two loaders at the bottom, which are the thin edges that read
 * the rows and hand them to the pure builders.
 */

import { ROUNDING_INCREMENT_OPTIONS } from './waveSetup';
import type {
  RoutineDatabase,
  RoutineOrigin,
  RoutineProgressionRule,
  RoutineUnit,
} from './routineActions';

export type RoutineLevel = 'beginner' | 'intermediate' | 'advanced';

/** The order levels are always presented in — a progression, not an alphabet. */
export const ROUTINE_LEVELS: readonly RoutineLevel[] = [
  'beginner',
  'intermediate',
  'advanced',
];

const isRoutineLevel = (value: string): value is RoutineLevel =>
  ROUTINE_LEVELS.includes(value as RoutineLevel);

/** One of the user's own routines, as the tab lists it. */
export interface LibraryRoutine {
  routineId: number;
  name: string;
  /** Whether it started life as a preset copy; the tab does not distinguish them. */
  origin: RoutineOrigin;
  progressionRule: RoutineProgressionRule;
  isActive: boolean;
  /** The preset it was copied from, or null for a routine the user built. */
  routineKey: string | null;
  /** The weekdays it trains, `Date.getDay()` convention. */
  weekdays: readonly number[];
}

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase());

/**
 * The tab's order: the active routine first — it is the answer to "what am I training" — then the
 * rest by name. Sorting here rather than in SQL is what makes the order a tested decision.
 */
export function orderLibrary(routines: readonly LibraryRoutine[]): LibraryRoutine[] {
  const active = routines.filter((routine) => routine.isActive).sort(byName);
  const rest = routines.filter((routine) => !routine.isActive).sort(byName);
  return [...active, ...rest];
}

/**
 * The routine's weekdays in the user's own week order, so a Monday-first user never reads a
 * routine as "Sun · Mon · Wed". Duplicates and out-of-range days are dropped: a weekday is unique
 * per routine by the `Sessions` UNIQUE constraint, and anything else is not a day.
 */
export function weekdaySequence(
  weekdays: readonly number[],
  firstWeekday: 'Sunday' | 'Monday',
): number[] {
  const start = firstWeekday === 'Monday' ? 1 : 0;
  const present = new Set(weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6));
  return Array.from({ length: 7 }, (_, index) => (start + index) % 7).filter((day) =>
    present.has(day),
  );
}

/** A preset as the "new routine" door offers it. */
export interface PresetEntry {
  routineKey: string;
  name: string;
  description: string;
  /** Real Spanish; `NewRoutineScreen` picks between the two by the active language (U6). */
  descriptionEs: string;
  level: RoutineLevel;
  progressionRule: RoutineProgressionRule;
  weekdays: readonly number[];
  /** The user's copy of this preset, when one already exists; null when activating would add one. */
  copyRoutineId: number | null;
}

export interface PresetLevelGroup {
  level: RoutineLevel;
  entries: PresetEntry[];
}

export interface PresetRow {
  routineKey: string;
  name: string;
  description: string;
  descriptionEs: string;
  level: string;
  progressionRule: RoutineProgressionRule;
  weekdays: readonly number[];
}

/**
 * The presets grouped by level, in `ROUTINE_LEVELS` order, each group sorted by name — the shape
 * the in-place accordion renders without deciding anything itself. Every level is returned even
 * when empty, so the accordion's rows do not appear and disappear as content changes.
 *
 * A preset already copied into the library carries that copy's id, which is what lets the door say
 * "already in your routines" instead of offering it as new.
 */
export function buildPresetLibrary(
  presets: readonly PresetRow[],
  library: readonly Pick<LibraryRoutine, 'routineId' | 'routineKey'>[],
): PresetLevelGroup[] {
  const copyByKey = new Map<string, number>();
  for (const routine of library) {
    if (routine.routineKey !== null && !copyByKey.has(routine.routineKey)) {
      copyByKey.set(routine.routineKey, routine.routineId);
    }
  }

  const entries = presets
    .filter((preset): preset is PresetRow & { level: RoutineLevel } =>
      isRoutineLevel(preset.level),
    )
    .map((preset) => ({
      routineKey: preset.routineKey,
      name: preset.name,
      description: preset.description,
      descriptionEs: preset.descriptionEs,
      level: preset.level,
      progressionRule: preset.progressionRule,
      weekdays: preset.weekdays,
      copyRoutineId: copyByKey.get(preset.routineKey) ?? null,
    }));

  return ROUTINE_LEVELS.map((level) => ({
    level,
    entries: entries.filter((entry) => entry.level === level).sort(byName),
  }));
}

export interface ActiveRoutineRef {
  routineId: number;
  name: string;
}

/** What the user asked to activate: one of their routines, or a preset that becomes one. */
export type ActivationTarget =
  | { kind: 'routine'; routineId: number; name: string }
  | { kind: 'preset'; routineKey: string; name: string; copyRoutineId: number | null };

/**
 * What activation will do — and, by construction, everything it needs. There is no weight here,
 * and no `missing`/`required` case a screen could render as a form: activating any routine, preset
 * or not, is one tap and at most one confirmation (§3.2, §7.5).
 */
export type ActivationPlan =
  | { outcome: 'alreadyActive'; name: string }
  | {
      outcome: 'activate';
      name: string;
      /** The routine that stops being active, which the confirmation must name. Null when none is. */
      deactivating: ActiveRoutineRef | null;
      /** Whether a new routine appears in the library — true only for a preset with no copy yet. */
      addsToLibrary: boolean;
    };

/**
 * Activating a preset the user already copied reactivates that copy rather than making a second
 * one, which is what `activatePresetRoutine` does; the plan says so, so the confirmation is true.
 */
export function planActivation(
  target: ActivationTarget,
  active: ActiveRoutineRef | null,
): ActivationPlan {
  const targetRoutineId = target.kind === 'routine' ? target.routineId : target.copyRoutineId;
  if (active !== null && targetRoutineId !== null && active.routineId === targetRoutineId) {
    return { outcome: 'alreadyActive', name: target.name };
  }
  return {
    outcome: 'activate',
    name: target.name,
    deactivating: active,
    addsToLibrary: target.kind === 'preset' && target.copyRoutineId === null,
  };
}

/**
 * The routine a user gets when they choose "from scratch": named, in their unit, with the rounding
 * increment and rest times the app can decide for them, and no training days yet — the editor's
 * job. Nothing here is asked for, which is the whole reason "from scratch" is one tap (§7.5).
 */
export interface BlankRoutineDraft {
  name: string;
  unit: RoutineUnit;
  roundingIncrement: number;
  restMainSeconds: number;
  restAccessorySeconds: number;
  progressionRule: RoutineProgressionRule;
}

/** The smallest step a plate change can make, per unit: 2.5 kg, or 5 lb. */
const BLANK_ROUNDING_INCREMENT: Record<RoutineUnit, number> = { kg: 2.5, lb: 5 };

export const BLANK_REST_MAIN_SECONDS = 120;
export const BLANK_REST_ACCESSORY_SECONDS = 60;

/**
 * `storedIncrement` is Ajustes' default for new routines (SPECS.md S2). It is a
 * default, not a conversion: it seeds this routine and changes nothing that
 * already exists, and a unit that cannot express it falls back to that unit's
 * own convention rather than to a value the editor could not show as selected.
 */
export function blankRoutineDraft(
  name: string,
  unit: RoutineUnit,
  storedIncrement?: number,
): BlankRoutineDraft {
  return {
    name,
    unit,
    roundingIncrement:
      storedIncrement !== undefined && ROUNDING_INCREMENT_OPTIONS[unit].includes(storedIncrement)
        ? storedIncrement
        : BLANK_ROUNDING_INCREMENT[unit],
    restMainSeconds: BLANK_REST_MAIN_SECONDS,
    restAccessorySeconds: BLANK_REST_ACCESSORY_SECONDS,
    progressionRule: 'linear',
  };
}

const num = (value: unknown): number => Number(value);
const str = (value: unknown): string => String(value);
const nullableStr = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

/** Reads the user's routines and their training days, already in the tab's order. */
export async function loadRoutineLibrary(db: RoutineDatabase): Promise<LibraryRoutine[]> {
  const routineRows = await db.getAll(
    `SELECT routine_id, routine_key, name, origin, progression_rule, is_active
     FROM Routines;`,
    [],
  );
  const sessionRows = await db.getAll(
    'SELECT routine_id, weekday FROM Sessions;',
    [],
  );

  const weekdaysByRoutine = new Map<number, number[]>();
  for (const row of sessionRows) {
    const routineId = num(row.routine_id);
    const weekdays = weekdaysByRoutine.get(routineId);
    if (weekdays === undefined) {
      weekdaysByRoutine.set(routineId, [num(row.weekday)]);
    } else {
      weekdays.push(num(row.weekday));
    }
  }

  return orderLibrary(
    routineRows.map((row) => ({
      routineId: num(row.routine_id),
      name: str(row.name),
      origin: str(row.origin) as RoutineOrigin,
      progressionRule: str(row.progression_rule) as RoutineProgressionRule,
      isActive: num(row.is_active) === 1,
      routineKey: nullableStr(row.routine_key),
      weekdays: weekdaysByRoutine.get(num(row.routine_id)) ?? [],
    })),
  );
}

/** Reads the presets and their training days, grouped by level against the user's library. */
export async function loadPresetLibrary(
  db: RoutineDatabase,
  library: readonly Pick<LibraryRoutine, 'routineId' | 'routineKey'>[],
): Promise<PresetLevelGroup[]> {
  const presetRows = await db.getAll(
    `SELECT routine_key, name, description, description_es, level, progression_rule
     FROM Preset_Routines;`,
    [],
  );
  const sessionRows = await db.getAll(
    'SELECT routine_key, weekday FROM Preset_Sessions;',
    [],
  );

  const weekdaysByKey = new Map<string, number[]>();
  for (const row of sessionRows) {
    const key = str(row.routine_key);
    const weekdays = weekdaysByKey.get(key);
    if (weekdays === undefined) {
      weekdaysByKey.set(key, [num(row.weekday)]);
    } else {
      weekdays.push(num(row.weekday));
    }
  }

  return buildPresetLibrary(
    presetRows.map((row) => ({
      routineKey: str(row.routine_key),
      name: str(row.name),
      description: str(row.description),
      descriptionEs: str(row.description_es),
      level: str(row.level),
      progressionRule: str(row.progression_rule) as RoutineProgressionRule,
      weekdays: weekdaysByKey.get(str(row.routine_key)) ?? [],
    })),
    library,
  );
}
