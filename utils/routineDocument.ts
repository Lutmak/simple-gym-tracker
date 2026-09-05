/**
 * X — a routine's portable document form (SPEC.md Phase X, ADR-0048).
 *
 * `sgt-routine` v1, JSON, extension `.sgtroutine.json`. It carries the plan only — routine
 * settings, sessions, exercises, progression config, optional training maxes and starting
 * weights — and never history (§3.1 of the design study: history tables copy values and never
 * reference the plan, which is exactly why history must never be exported).
 *
 * `serialiseRoutine` and `parseRoutineDocument` are the pure core: they read and produce the same
 * `RoutineSourceBundle` / `RoutineCopyRows` shapes `utils/routineActions.ts` already reads from
 * and writes to SQL, so no new write path exists — only a translation layer next to the existing
 * one. Both take a `catalog` snapshot (the whole `Catalog_Exercises` table, seeded and custom, as
 * loaded by `utils/exerciseCatalog.ts`) and touch no database themselves.
 *
 * `parseRoutineDocument` never throws on bad input — a hand-authored file is untrusted external
 * data, not a programmer error, so every problem comes back as a typed `RoutineDocumentError`
 * naming the session/exercise/field, for the caller to localise and show. This is deliberately a
 * different posture from `WaveSetupValidationError`/`EditRoutineValidationError`, which validate a
 * draft the app itself built in memory.
 *
 * `writeRoutineDocument` is the one thin, DB-touching edge in this file (X2): one transaction,
 * new custom catalog rows first, a colliding routine name suffixed, never activated.
 */

import {
  CUSTOM_EQUIPMENT_OPTIONS,
  buildCustomExerciseKey,
  validateCustomExercise,
  type CustomExerciseDraft,
} from './customExercise';
import type { CatalogExercise } from './exerciseCatalog';
import {
  loadRoutineSourceById,
  type RoutineCopyRows,
  type RoutineDatabase,
  type RoutineLoadSource,
  type RoutineProgressionRule,
  type RoutineRole,
  type RoutineSourceBundle,
  type RoutineUnit,
} from './routineActions';
import type { BarProfileKey } from './barProfiles';

export const ROUTINE_DOCUMENT_FORMAT = 'sgt-routine';
export const ROUTINE_DOCUMENT_VERSION = 1;

export interface RoutineDocumentCustomExercise {
  name: string;
  primaryMuscle: string;
  equipment: string;
  usesBar: boolean;
}

export interface RoutineDocumentExercise {
  catalogKey?: string;
  catalogName?: string;
  custom?: RoutineDocumentCustomExercise;
  role: RoutineRole;
  targetSets: number;
  targetReps: number;
  loadSource: RoutineLoadSource;
  trainingMaxPct?: number;
  trainingMaxWeight?: number;
  absoluteWeight?: number;
  unitOverride?: RoutineUnit;
  isAmrap?: boolean;
  barProfile?: BarProfileKey | null;
  barWeight?: number;
  warmupsEnabled?: boolean | null;
}

export interface RoutineDocumentSession {
  weekday: number;
  name: string;
  exercises: RoutineDocumentExercise[];
}

export interface RoutineDocument {
  format: typeof ROUTINE_DOCUMENT_FORMAT;
  version: number;
  routine: {
    name: string;
    progressionRule: RoutineProgressionRule;
    unit: RoutineUnit;
    roundingIncrement: number;
    restMainSeconds: number;
    restAccessorySeconds: number;
    plannedJokers: number;
  };
  sessions: RoutineDocumentSession[];
}

/**
 * Every problem `parseRoutineDocument` finds names where it is: the session and exercise (by
 * index and best-known name, since a bad document may not even have a usable name), and the field
 * that failed. `detail` carries whatever extra value the message needs (an unresolved reference,
 * an unsupported version, the offending weekday) — the caller builds the localised sentence from
 * these parts, this module never renders English text.
 */
export type RoutineDocumentErrorCode =
  | 'wrongFormat'
  | 'unsupportedVersion'
  | 'noSessions'
  | 'routineNameRequired'
  | 'progressionRuleInvalid'
  | 'unitInvalid'
  | 'roundingIncrementInvalid'
  | 'restInvalid'
  | 'plannedJokersInvalid'
  | 'weekdayInvalid'
  | 'duplicateWeekday'
  | 'sessionNameRequired'
  | 'sessionNoExercises'
  | 'roleInvalid'
  | 'targetSetsInvalid'
  | 'targetRepsInvalid'
  | 'loadSourceInvalid'
  | 'trainingMaxPctInvalid'
  | 'trainingMaxPctNotAllowed'
  | 'trainingMaxWeightInvalid'
  | 'trainingMaxWeightNotAllowed'
  | 'absoluteWeightInvalid'
  | 'absoluteWeightNotAllowed'
  | 'unitOverrideInvalid'
  | 'barProfileInvalid'
  | 'barWeightRequired'
  | 'barWeightNotAllowed'
  | 'exerciseReferenceMissing'
  | 'exerciseNotFound'
  | 'customNameRequired'
  | 'customExclusiveWithReference'
  | 'customMuscleInvalid'
  | 'customEquipmentInvalid';

export interface RoutineDocumentError {
  code: RoutineDocumentErrorCode;
  session: { index: number; name: string } | null;
  exercise: { index: number; name: string } | null;
  field: string | null;
  detail: string | null;
}

/** A custom exercise this import will create, with the key it will be inserted under. */
export type NewCustomExercise = CustomExerciseDraft & { exerciseKey: string };

export type ParseRoutineDocumentResult =
  | { ok: true; rows: RoutineCopyRows; newCustomExercises: NewCustomExercise[] }
  | { ok: false; errors: RoutineDocumentError[] };

// ---------------------------------------------------------------------------
// serialiseRoutine
// ---------------------------------------------------------------------------

const catalogNameLookup = (
  catalog: ReadonlyMap<string, CatalogExercise>,
): Map<string, CatalogExercise> => {
  const byName = new Map<string, CatalogExercise>();
  for (const exercise of catalog.values()) {
    byName.set(exercise.name.trim().toLowerCase(), exercise);
  }
  return byName;
};

/**
 * The document form of a stored routine. `bundle` is what `loadRoutineSourceById` already
 * returns — a user routine, always with a resolved unit. A catalog-backed exercise is written as
 * `catalogKey` + `catalogName` (canonical id plus the hand-authoring convenience); a custom
 * exercise (`origin: 'user'`) is inlined as a `custom` block so the file is self-contained on a
 * device that has never seen it. A `catalog_exercise_id` orphaned by a deleted custom exercise
 * (the schema allows `ON DELETE SET NULL`) falls back to the snapshotted name alone — the best an
 * already-broken reference can offer.
 */
export function serialiseRoutine(
  bundle: RoutineSourceBundle,
  catalog: ReadonlyMap<string, CatalogExercise>,
): RoutineDocument {
  if (bundle.routine.unit === null) {
    throw new Error('Cannot export a routine with no unit.');
  }

  const sessionIndexBySourceId = new Map<number, number>();
  bundle.sessions.forEach((session, index) => sessionIndexBySourceId.set(session.sessionId, index));

  const sessions: RoutineDocumentSession[] = bundle.sessions.map((session) => ({
    weekday: session.weekday,
    name: session.name,
    exercises: [],
  }));

  const sortedExercises = [...bundle.exercises].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const exercise of sortedExercises) {
    const sessionIndex = sessionIndexBySourceId.get(exercise.sessionId);
    if (sessionIndex === undefined) {
      throw new Error(`Export source references unknown session ${exercise.sessionId}`);
    }

    const doc: RoutineDocumentExercise = {
      role: exercise.role,
      targetSets: exercise.targetSets,
      targetReps: exercise.targetReps,
      loadSource: exercise.loadSource,
    };

    const catalogRow = exercise.catalogExerciseId === null
      ? null
      : catalog.get(exercise.catalogExerciseId) ?? null;

    if (catalogRow !== null && catalogRow.origin === 'user') {
      doc.custom = {
        name: catalogRow.name,
        primaryMuscle: catalogRow.primaryMuscles[0] ?? '',
        equipment: catalogRow.equipment ?? 'other',
        usesBar: catalogRow.usesBar ?? false,
      };
    } else if (catalogRow !== null) {
      doc.catalogKey = catalogRow.exerciseKey;
      doc.catalogName = catalogRow.name;
    } else if (exercise.catalogExerciseId !== null) {
      // The catalog row this exercise pointed to no longer exists; fall back to the
      // snapshotted name so the document still resolves something on re-import.
      doc.catalogName = exercise.name;
    }

    if (exercise.loadSource === 'training_max_pct' && exercise.trainingMaxPct !== null) {
      doc.trainingMaxPct = exercise.trainingMaxPct;
    }
    if (exercise.trainingMaxWeight !== null) {
      doc.trainingMaxWeight = exercise.trainingMaxWeight;
    }
    if (exercise.absoluteWeight !== null) {
      doc.absoluteWeight = exercise.absoluteWeight;
    }
    if (exercise.unitOverride !== null) {
      doc.unitOverride = exercise.unitOverride;
    }
    if (exercise.isAmrap) {
      doc.isAmrap = true;
    }
    if (exercise.barProfile !== null) {
      doc.barProfile = exercise.barProfile;
      if (exercise.barProfile === 'custom' && exercise.barWeight !== null) {
        doc.barWeight = exercise.barWeight;
      }
    }
    if (exercise.warmupsEnabled !== null) {
      doc.warmupsEnabled = exercise.warmupsEnabled;
    }

    sessions[sessionIndex].exercises.push(doc);
  }

  return {
    format: ROUTINE_DOCUMENT_FORMAT,
    version: ROUTINE_DOCUMENT_VERSION,
    routine: {
      name: bundle.routine.name,
      progressionRule: bundle.routine.progressionRule,
      unit: bundle.routine.unit,
      roundingIncrement: bundle.routine.roundingIncrement,
      restMainSeconds: bundle.routine.restMainSeconds,
      restAccessorySeconds: bundle.routine.restAccessorySeconds,
      plannedJokers: bundle.routine.plannedJokers,
    },
    sessions,
  };
}

// ---------------------------------------------------------------------------
// parseRoutineDocument
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isPositiveInteger = (value: unknown): value is number =>
  isFiniteNumber(value) && Number.isInteger(value) && value > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  isFiniteNumber(value) && Number.isInteger(value) && value >= 0;

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

const BAR_PROFILE_KEYS: readonly BarProfileKey[] = [
  'olympic',
  'semi-olympic',
  'smith',
  'ez',
  'custom',
];

const error = (
  code: RoutineDocumentErrorCode,
  context: {
    session?: { index: number; name: string };
    exercise?: { index: number; name: string };
    field?: string;
    detail?: string;
  } = {},
): RoutineDocumentError => ({
  code,
  session: context.session ?? null,
  exercise: context.exercise ?? null,
  field: context.field ?? null,
  detail: context.detail ?? null,
});

const exerciseDisplayName = (raw: unknown, index: number): string => {
  if (isRecord(raw)) {
    if (nonEmptyString(raw.catalogName)) {
      return raw.catalogName;
    }
    if (isRecord(raw.custom) && nonEmptyString(raw.custom.name)) {
      return raw.custom.name;
    }
    if (nonEmptyString(raw.catalogKey)) {
      return raw.catalogKey;
    }
  }
  return `#${index + 1}`;
};

/**
 * Parses an already-`JSON.parse`d value into the rows an import would write, or every problem
 * found. Structural/range validation covers every `CHECK` `Routines`/`SessionExercises` enforce
 * (§6 of the design study) plus the sanity ranges the schema itself does not (`trainingMaxPct` in
 * `(0, 1]`, a custom bar weight only with a custom profile). Catalog resolution never invents a
 * custom exercise from an unresolved reference — that is always a rejection naming the line.
 */
export function parseRoutineDocument(
  doc: unknown,
  catalog: ReadonlyMap<string, CatalogExercise>,
): ParseRoutineDocumentResult {
  if (!isRecord(doc)) {
    return { ok: false, errors: [error('wrongFormat')] };
  }
  if (doc.format !== ROUTINE_DOCUMENT_FORMAT) {
    return { ok: false, errors: [error('wrongFormat')] };
  }
  if (doc.version !== ROUTINE_DOCUMENT_VERSION) {
    return {
      ok: false,
      errors: [error('unsupportedVersion', { detail: String(doc.version) })],
    };
  }

  const errors: RoutineDocumentError[] = [];
  const routineRaw = isRecord(doc.routine) ? doc.routine : {};

  if (!nonEmptyString(routineRaw.name)) {
    errors.push(error('routineNameRequired', { field: 'routine.name' }));
  }
  if (routineRaw.progressionRule !== 'wave' && routineRaw.progressionRule !== 'linear' && routineRaw.progressionRule !== 'none') {
    errors.push(error('progressionRuleInvalid', { field: 'routine.progressionRule' }));
  }
  if (routineRaw.unit !== 'kg' && routineRaw.unit !== 'lb') {
    errors.push(error('unitInvalid', { field: 'routine.unit' }));
  }
  if (!isFiniteNumber(routineRaw.roundingIncrement) || routineRaw.roundingIncrement <= 0) {
    errors.push(error('roundingIncrementInvalid', { field: 'routine.roundingIncrement' }));
  }
  if (!isNonNegativeInteger(routineRaw.restMainSeconds)) {
    errors.push(error('restInvalid', { field: 'routine.restMainSeconds' }));
  }
  if (!isNonNegativeInteger(routineRaw.restAccessorySeconds)) {
    errors.push(error('restInvalid', { field: 'routine.restAccessorySeconds' }));
  }
  let plannedJokers = 0;
  if (routineRaw.plannedJokers !== undefined) {
    if (!isNonNegativeInteger(routineRaw.plannedJokers)) {
      errors.push(error('plannedJokersInvalid', { field: 'routine.plannedJokers' }));
    } else {
      plannedJokers = routineRaw.plannedJokers;
    }
  }

  if (!Array.isArray(doc.sessions) || doc.sessions.length === 0) {
    errors.push(error('noSessions'));
    return { ok: false, errors };
  }

  const weekdaysSeen = new Set<number>();
  const sessionsOut: RoutineCopyRows['sessions'] = [];
  const exercisesOut: RoutineCopyRows['exercises'] = [];
  const newCustomExercises: NewCustomExercise[] = [];
  const byName = catalogNameLookup(catalog);
  const usedKeys = new Set(catalog.keys());
  const stagedCustomByName = new Map<string, string>();

  doc.sessions.forEach((sessionRaw: unknown, sessionIndex: number) => {
    const session = isRecord(sessionRaw) ? sessionRaw : {};
    const sessionName = nonEmptyString(session.name) ? session.name : `#${sessionIndex + 1}`;
    const sessionRef = { index: sessionIndex, name: sessionName };

    if (!isFiniteNumber(session.weekday) || session.weekday < 0 || session.weekday > 6 || !Number.isInteger(session.weekday)) {
      errors.push(error('weekdayInvalid', { session: sessionRef, field: 'weekday' }));
    } else if (weekdaysSeen.has(session.weekday)) {
      errors.push(
        error('duplicateWeekday', { session: sessionRef, field: 'weekday', detail: String(session.weekday) }),
      );
    } else {
      weekdaysSeen.add(session.weekday);
    }

    if (!nonEmptyString(session.name)) {
      errors.push(error('sessionNameRequired', { session: sessionRef, field: 'name' }));
    }

    if (!Array.isArray(session.exercises) || session.exercises.length === 0) {
      errors.push(error('sessionNoExercises', { session: sessionRef }));
      return;
    }

    const sessionOutIndex = sessionsOut.length;
    sessionsOut.push({
      weekday: isFiniteNumber(session.weekday) ? session.weekday : 0,
      name: sessionName,
      sortOrder: sessionOutIndex + 1,
    });

    session.exercises.forEach((exerciseRaw: unknown, exerciseIndex: number) => {
      const exercise = isRecord(exerciseRaw) ? exerciseRaw : {};
      const exerciseName = exerciseDisplayName(exerciseRaw, exerciseIndex);
      const exerciseRef = { index: exerciseIndex, name: exerciseName };
      const field = (name: string) => ({ session: sessionRef, exercise: exerciseRef, field: name });

      if (exercise.role !== 'main' && exercise.role !== 'accessory') {
        errors.push(error('roleInvalid', field('role')));
      }
      if (!isPositiveInteger(exercise.targetSets)) {
        errors.push(error('targetSetsInvalid', field('targetSets')));
      }
      if (!isPositiveInteger(exercise.targetReps)) {
        errors.push(error('targetRepsInvalid', field('targetReps')));
      }
      const loadSource = exercise.loadSource;
      if (loadSource !== 'training_max_pct' && loadSource !== 'absolute' && loadSource !== 'bodyweight') {
        errors.push(error('loadSourceInvalid', field('loadSource')));
      }

      let trainingMaxPct: number | null = null;
      let trainingMaxWeight: number | null = null;
      let absoluteWeight: number | null = null;

      if (loadSource === 'training_max_pct') {
        if (!isFiniteNumber(exercise.trainingMaxPct) || exercise.trainingMaxPct <= 0 || exercise.trainingMaxPct > 1) {
          errors.push(error('trainingMaxPctInvalid', field('trainingMaxPct')));
        } else {
          trainingMaxPct = exercise.trainingMaxPct;
        }
        if (exercise.absoluteWeight !== undefined) {
          errors.push(error('absoluteWeightNotAllowed', field('absoluteWeight')));
        }
        if (exercise.trainingMaxWeight !== undefined) {
          if (!isFiniteNumber(exercise.trainingMaxWeight) || exercise.trainingMaxWeight <= 0) {
            errors.push(error('trainingMaxWeightInvalid', field('trainingMaxWeight')));
          } else {
            trainingMaxWeight = exercise.trainingMaxWeight;
          }
        }
      } else if (loadSource === 'absolute') {
        if (exercise.trainingMaxPct !== undefined) {
          errors.push(error('trainingMaxPctNotAllowed', field('trainingMaxPct')));
        }
        if (exercise.trainingMaxWeight !== undefined) {
          errors.push(error('trainingMaxWeightNotAllowed', field('trainingMaxWeight')));
        }
        if (exercise.absoluteWeight !== undefined) {
          if (!isFiniteNumber(exercise.absoluteWeight) || exercise.absoluteWeight <= 0) {
            errors.push(error('absoluteWeightInvalid', field('absoluteWeight')));
          } else {
            absoluteWeight = exercise.absoluteWeight;
          }
        }
      } else if (loadSource === 'bodyweight') {
        if (exercise.trainingMaxPct !== undefined) {
          errors.push(error('trainingMaxPctNotAllowed', field('trainingMaxPct')));
        }
        if (exercise.trainingMaxWeight !== undefined) {
          errors.push(error('trainingMaxWeightNotAllowed', field('trainingMaxWeight')));
        }
        if (exercise.absoluteWeight !== undefined) {
          errors.push(error('absoluteWeightNotAllowed', field('absoluteWeight')));
        }
      }

      let unitOverride: RoutineUnit | null = null;
      if (exercise.unitOverride !== undefined) {
        if (exercise.unitOverride !== 'kg' && exercise.unitOverride !== 'lb') {
          errors.push(error('unitOverrideInvalid', field('unitOverride')));
        } else {
          unitOverride = exercise.unitOverride;
        }
      }

      let barProfile: BarProfileKey | null = null;
      let barWeight: number | null = null;
      if (exercise.barProfile !== undefined && exercise.barProfile !== null) {
        if (!BAR_PROFILE_KEYS.includes(exercise.barProfile as BarProfileKey)) {
          errors.push(error('barProfileInvalid', field('barProfile')));
        } else {
          barProfile = exercise.barProfile as BarProfileKey;
        }
      }
      if (barProfile === 'custom') {
        if (!isFiniteNumber(exercise.barWeight) || exercise.barWeight <= 0) {
          errors.push(error('barWeightRequired', field('barWeight')));
        } else {
          barWeight = exercise.barWeight;
        }
      } else if (exercise.barWeight !== undefined) {
        errors.push(error('barWeightNotAllowed', field('barWeight')));
      }

      let warmupsEnabled: boolean | null = null;
      if (exercise.warmupsEnabled === true || exercise.warmupsEnabled === false) {
        warmupsEnabled = exercise.warmupsEnabled;
      }

      const isAmrap = exercise.isAmrap === true;

      // Catalog resolution. catalogKey wins over catalogName when both are present and
      // disagree — it is the only one of the two the schema treats as identity.
      let catalogExerciseId: string | null = null;
      const hasCustom = exercise.custom !== undefined;
      const hasCatalogKey = nonEmptyString(exercise.catalogKey);
      const hasCatalogName = nonEmptyString(exercise.catalogName);

      if (hasCustom && (hasCatalogKey || hasCatalogName)) {
        errors.push(error('customExclusiveWithReference', field('custom')));
      }

      if (hasCustom) {
        const custom = isRecord(exercise.custom) ? exercise.custom : {};
        const customName = nonEmptyString(custom.name) ? custom.name.trim() : '';
        const nameKey = customName.toLowerCase();
        const existingByName = customName === '' ? undefined : byName.get(nameKey);
        const stagedKey = customName === '' ? undefined : stagedCustomByName.get(nameKey);

        if (existingByName !== undefined) {
          catalogExerciseId = existingByName.exerciseKey;
        } else if (stagedKey !== undefined) {
          catalogExerciseId = stagedKey;
        } else {
          const draft: CustomExerciseDraft = {
            name: customName,
            primaryMuscle: nonEmptyString(custom.primaryMuscle) ? custom.primaryMuscle : null,
            equipment: nonEmptyString(custom.equipment) ? custom.equipment : null,
            usesBar: custom.usesBar === true,
          };
          const problem = validateCustomExercise(draft, new Set());
          if (problem === 'name-required') {
            errors.push(error('customNameRequired', field('custom.name')));
          } else if (problem === 'muscle-required') {
            errors.push(error('customMuscleInvalid', field('custom.primaryMuscle')));
          } else if (
            draft.equipment === null ||
            !CUSTOM_EQUIPMENT_OPTIONS.includes(draft.equipment)
          ) {
            errors.push(error('customEquipmentInvalid', field('custom.equipment')));
          } else {
            const exerciseKey = buildCustomExerciseKey(customName, usedKeys);
            usedKeys.add(exerciseKey);
            stagedCustomByName.set(nameKey, exerciseKey);
            newCustomExercises.push({ ...draft, exerciseKey });
            catalogExerciseId = exerciseKey;
          }
        }
      } else if (hasCatalogKey) {
        const key = (exercise.catalogKey as string).trim();
        const found = catalog.get(key);
        if (found === undefined) {
          errors.push(error('exerciseNotFound', { ...field('catalogKey'), detail: key }));
        } else {
          catalogExerciseId = found.exerciseKey;
        }
      } else if (hasCatalogName) {
        const name = (exercise.catalogName as string).trim();
        const found = byName.get(name.toLowerCase());
        if (found === undefined) {
          errors.push(error('exerciseNotFound', { ...field('catalogName'), detail: name }));
        } else {
          catalogExerciseId = found.exerciseKey;
        }
      } else {
        errors.push(error('exerciseReferenceMissing', { session: sessionRef, exercise: exerciseRef }));
      }

      exercisesOut.push({
        sessionIndex: sessionOutIndex,
        catalogExerciseId,
        name: exerciseName,
        role: (exercise.role as RoutineRole) ?? 'accessory',
        targetSets: isPositiveInteger(exercise.targetSets) ? exercise.targetSets : 1,
        targetReps: isPositiveInteger(exercise.targetReps) ? exercise.targetReps : 1,
        loadSource: (loadSource as RoutineLoadSource) ?? 'bodyweight',
        trainingMaxPct,
        trainingMaxWeight,
        absoluteWeight,
        unitOverride,
        isAmrap,
        sortOrder: exerciseIndex + 1,
        barProfile,
        barWeight,
        warmupsEnabled,
      });
    });
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const rows: RoutineCopyRows = {
    routine: {
      routineKey: null,
      name: (routineRaw.name as string).trim(),
      origin: 'user',
      progressionRule: routineRaw.progressionRule as RoutineProgressionRule,
      unit: routineRaw.unit as RoutineUnit,
      roundingIncrement: routineRaw.roundingIncrement as number,
      restMainSeconds: routineRaw.restMainSeconds as number,
      restAccessorySeconds: routineRaw.restAccessorySeconds as number,
      isActive: false,
      createdAt: Date.now(),
      plannedJokers,
    },
    sessions: sessionsOut,
    exercises: exercisesOut,
  };

  return { ok: true, rows, newCustomExercises };
}

// ---------------------------------------------------------------------------
// writeRoutineDocument — the transactional edge (X2)
// ---------------------------------------------------------------------------

const num = (value: unknown): number => Number(value);

/**
 * Writes what `parseRoutineDocument` resolved: new custom catalog rows first (so the exercise
 * rows that follow can reference them), then the routine/sessions/exercises, one transaction. A
 * colliding routine name gets a numeric suffix rather than blocking the import (§7.5 of ADR-0029
 * — a choice the app can make is friction if surfaced as a question). Never activates the
 * imported routine (§3.1 — exactly one active routine, and an import must not silently
 * deactivate whatever the user is mid-cycle on).
 */
export async function writeRoutineDocument(
  db: RoutineDatabase,
  rows: RoutineCopyRows,
  newCustomExercises: readonly NewCustomExercise[],
): Promise<{ routineId: number; customExerciseCount: number }> {
  await db.run('BEGIN;');
  try {
    for (const custom of newCustomExercises) {
      await db.run(
        `INSERT INTO Catalog_Exercises
           (exercise_key, name, category, level, force, mechanic, equipment, instructions,
            origin, uses_bar)
         VALUES (?, ?, 'strength', NULL, NULL, NULL, ?, NULL, 'user', ?);`,
        [custom.exerciseKey, custom.name, custom.equipment, custom.usesBar ? 1 : 0],
      );
      if (custom.primaryMuscle !== null) {
        await db.run(
          `INSERT INTO Catalog_Exercise_Muscles (exercise_key, muscle_name, is_primary)
           VALUES (?, ?, 1);`,
          [custom.exerciseKey, custom.primaryMuscle],
        );
      }
    }

    let name = rows.routine.name;
    let suffix = 2;
    for (;;) {
      const collision = await db.get('SELECT 1 FROM Routines WHERE name = ?;', [name]);
      if (!collision) {
        break;
      }
      name = `${rows.routine.name} (${suffix})`;
      suffix += 1;
    }

    await db.run(
      `INSERT INTO Routines
         (routine_key, name, origin, progression_rule, unit, rounding_increment,
          rest_main_seconds, rest_accessory_seconds, is_active, created_at, planned_jokers)
       VALUES (NULL, ?, 'user', ?, ?, ?, ?, ?, 0, ?, ?);`,
      [
        name,
        rows.routine.progressionRule,
        rows.routine.unit,
        rows.routine.roundingIncrement,
        rows.routine.restMainSeconds,
        rows.routine.restAccessorySeconds,
        rows.routine.createdAt,
        rows.routine.plannedJokers,
      ],
    );
    const routineIdRow = await db.get('SELECT last_insert_rowid() AS id;', []);
    if (!routineIdRow) {
      throw new Error('Could not read the new routine id');
    }
    const routineId = num(routineIdRow.id);

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
      sessionIds.push(num(sessionIdRow.id));
    }

    for (const exercise of rows.exercises) {
      const sessionId = sessionIds[exercise.sessionIndex];
      if (sessionId === undefined) {
        throw new Error(`Import exercise has no session ${exercise.sessionIndex}`);
      }
      await db.run(
        `INSERT INTO SessionExercises
           (session_id, catalog_exercise_id, exercise_name, role, target_sets, target_reps,
            load_source, training_max_pct, training_max_weight, absolute_weight,
            unit_override, is_amrap, sort_order, bar_profile, bar_weight, warmups_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
        ],
      );
    }

    await db.run('COMMIT;');
    return { routineId, customExerciseCount: newCustomExercises.length };
  } catch (err) {
    await db.run('ROLLBACK;');
    throw err;
  }
}

/** `JSON.parse` plus `parseRoutineDocument`, for the caller that has raw file text (X2). */
export function parseRoutineDocumentText(
  text: string,
  catalog: ReadonlyMap<string, CatalogExercise>,
): ParseRoutineDocumentResult {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, errors: [error('wrongFormat')] };
  }
  return parseRoutineDocument(doc, catalog);
}

/**
 * Reads a routine and its pretty-printed document text, for the caller that writes it to a file
 * and hands it to the share sheet (X3). Deliberately stops at the JSON text: writing to
 * `cacheDirectory` and calling `Sharing.shareAsync` are `expo-file-system`/`expo-sharing` calls,
 * which this module has no reason to import — `RoutineActionsSheet`'s caller does that one step,
 * exactly as `Settings.tsx`'s `exportDatabase` already does for the whole-database export.
 */
export async function loadRoutineDocumentText(
  db: RoutineDatabase,
  catalog: ReadonlyMap<string, CatalogExercise>,
  routineId: number,
): Promise<{ name: string; text: string }> {
  const bundle = await loadRoutineSourceById(db, routineId);
  const document = serialiseRoutine(bundle, catalog);
  return { name: document.routine.name, text: JSON.stringify(document, null, 2) };
}
