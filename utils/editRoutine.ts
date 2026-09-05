/**
 * D3 — Editing a routine (SPECS.md D3, §3.2, §3.7).
 *
 * The editor screen mutates a local draft; `buildEditRows` turns the draft
 * into plan rows (pure, testable) and `saveRoutineEdit` applies the edit in
 * one transaction, updating kept rows in place so their ids — and therefore
 * WeekSessions and Progression_Proposal rows that cascade from them — survive.
 * History tables are never touched: Workout_Log / Logged_Exercises /
 * Weight_Log copy their values at log time and never reference the plan
 * (§3.2). Weight fields are normalized per load source so the SessionExercises
 * CHECK constraint holds by construction — and a missing weight stays NULL:
 * a routine is valid with no loads, the first logged session learns the
 * baseline (§3.2). Invalid drafts throw `EditRoutineValidationError` with a
 * user-facing code.
 */

import {
  defaultBarProfileForEquipment,
  type BarProfileKey,
} from './barProfiles';
import { usableWeight } from './learnedWeights';
import { nominalSessionStamp } from './today';
import type {
  RoutineDatabase,
  RoutineLoadSource,
  RoutineRole,
  RoutineUnit,
} from './routineActions';

export interface EditExercise {
  /** The source SessionExercises row id; null for exercises added in this edit. */
  exerciseId: number | null;
  catalogExerciseId: string | null;
  name: string;
  role: RoutineRole;
  targetSets: number;
  targetReps: number;
  loadSource: RoutineLoadSource;
  trainingMaxPct: number | null;
  trainingMaxWeight: number | null;
  absoluteWeight: number | null;
  unitOverride: RoutineUnit | null;
  isAmrap: boolean;
  /** The catalog equipment of a catalog-backed exercise — the bar-profile default. */
  equipment?: string | null;
  /** A stored bar profile; the caller omits it to keep the catalog default. */
  barProfile?: BarProfileKey | null;
  /** The custom bar weight, in the exercise's unit. */
  barWeight?: number | null;
  /** The per-exercise warm-up answer (§3.6); null/omitted keeps the role default. */
  warmupsEnabled?: boolean | null;
}

export interface EditSession {
  /** The source Sessions row id; null for days added in this edit. */
  sessionId: number | null;
  weekday: number;
  name: string;
  exercises: EditExercise[];
}

export interface EditRoutine {
  name: string;
  unit: RoutineUnit;
  roundingIncrement: number;
  restMainSeconds: number;
  restAccessorySeconds: number;
  sessions: EditSession[];
  /** Planned jokers (§3.4); omitted means the current value is kept. */
  plannedJokers?: number;
}

/**
 * What an exercise added in the editor starts as. Three sets of ten is the
 * conventional accessory prescription, and it is also what the app falls back
 * to when the user clears the field — R3's rule is that no save is ever
 * blocked by a missing number, which means every number needs a value the app
 * can supply on its own.
 */
export const DEFAULT_TARGET_SETS = 3;
export const DEFAULT_TARGET_REPS = 10;

export type EditRoutineError =
  | { code: 'routineNameRequired' }
  | { code: 'roundingIncrementInvalid' }
  | { code: 'restInvalid' }
  | { code: 'sessionNameRequired' }
  | { code: 'duplicateWeekday' }
  | { code: 'setsInvalid'; exercise: string }
  | { code: 'repsInvalid'; exercise: string };

export class EditRoutineValidationError extends Error {
  readonly detail: EditRoutineError;

  constructor(detail: EditRoutineError) {
    super(detail.code);
    this.name = 'EditRoutineValidationError';
    this.detail = detail;
  }
}

export interface EditRoutineRows {
  routine: {
    name: string;
    unit: RoutineUnit;
    roundingIncrement: number;
    restMainSeconds: number;
    restAccessorySeconds: number;
    /** Null when the draft does not carry it — the stored value is kept. */
    plannedJokers: number | null;
  };
  sessions: {
    sessionId: number | null;
    weekday: number;
    name: string;
    sortOrder: number;
  }[];
  exercises: {
    sessionIndex: number;
    exerciseId: number | null;
    catalogExerciseId: string | null;
    name: string;
    role: RoutineRole;
    targetSets: number;
    targetReps: number;
    loadSource: RoutineLoadSource;
    trainingMaxPct: number | null;
    trainingMaxWeight: number | null;
    absoluteWeight: number | null;
    unitOverride: RoutineUnit | null;
    isAmrap: boolean;
    sortOrder: number;
    barProfile: BarProfileKey | null;
    barWeight: number | null;
    warmupsEnabled: boolean | null;
  }[];
}

const fail = (detail: EditRoutineError): never => {
  throw new EditRoutineValidationError(detail);
};

/** SQLite has no boolean; null stays null so "never said" survives a save (§3.6). */
const toFlag = (value: boolean | null): number | null =>
  value === null ? null : value ? 1 : 0;

/**
 * Normalizes the weight fields per load source, mirroring the SessionExercises
 * CHECK. A missing weight stays NULL — targets are learned, never demanded.
 */
const normalizedLoad = (
  exercise: EditExercise,
): {
  loadSource: RoutineLoadSource;
  trainingMaxPct: number | null;
  trainingMaxWeight: number | null;
  absoluteWeight: number | null;
} => {
  switch (exercise.loadSource) {
    case 'training_max_pct':
      return {
        loadSource: 'training_max_pct',
        trainingMaxPct: exercise.trainingMaxPct ?? 0.9,
        // A non-positive value is not a load — it stays NULL until the first
        // logged session learns it (§3.2).
        trainingMaxWeight: usableWeight(exercise.trainingMaxWeight),
        absoluteWeight: null,
      };
    case 'absolute':
      return {
        loadSource: 'absolute',
        trainingMaxPct: null,
        trainingMaxWeight: null,
        absoluteWeight: usableWeight(exercise.absoluteWeight),
      };
    case 'bodyweight':
      return {
        loadSource: 'bodyweight',
        trainingMaxPct: null,
        trainingMaxWeight: null,
        absoluteWeight: null,
      };
  }
};

/**
 * The rows `saveRoutineEdit` writes. Sort orders come from list positions —
 * the routine's ordering is the order the user sees. Throws
 * `EditRoutineValidationError` on any input the schema would reject.
 */
export function buildEditRows(draft: EditRoutine): EditRoutineRows {
  const name = draft.name.trim();
  if (name === '') {
    fail({ code: 'routineNameRequired' });
  }
  if (!(draft.roundingIncrement > 0)) {
    fail({ code: 'roundingIncrementInvalid' });
  }
  if (
    !Number.isInteger(draft.restMainSeconds) ||
    !Number.isInteger(draft.restAccessorySeconds) ||
    draft.restMainSeconds < 0 ||
    draft.restAccessorySeconds < 0
  ) {
    fail({ code: 'restInvalid' });
  }

  const usedWeekdays = new Set<number>();
  const sessions = draft.sessions.map((session, index) => {
    const sessionName = session.name.trim();
    if (sessionName === '') {
      fail({ code: 'sessionNameRequired' });
    }
    if (usedWeekdays.has(session.weekday)) {
      fail({ code: 'duplicateWeekday' });
    }
    usedWeekdays.add(session.weekday);
    return {
      sessionId: session.sessionId,
      weekday: session.weekday,
      name: sessionName,
      sortOrder: index + 1,
    };
  });

  const exercises = draft.sessions.flatMap((session, sessionIndex) =>
    session.exercises.map((exercise, index) => {
      if (!Number.isInteger(exercise.targetSets) || exercise.targetSets < 1) {
        fail({ code: 'setsInvalid', exercise: exercise.name });
      }
      if (!Number.isInteger(exercise.targetReps) || exercise.targetReps < 1) {
        fail({ code: 'repsInvalid', exercise: exercise.name });
      }
      return {
        sessionIndex,
        exerciseId: exercise.exerciseId,
        catalogExerciseId: exercise.catalogExerciseId,
        name: exercise.name,
        role: exercise.role,
        targetSets: exercise.targetSets,
        targetReps: exercise.targetReps,
        ...normalizedLoad(exercise),
        unitOverride: exercise.unitOverride,
        isAmrap: exercise.isAmrap,
        sortOrder: index + 1,
        barProfile:
          exercise.barProfile ?? defaultBarProfileForEquipment(exercise.equipment ?? null),
        barWeight: exercise.barWeight ?? null,
        warmupsEnabled: exercise.warmupsEnabled ?? null,
      };
    }),
  );

  return {
    routine: {
      name,
      unit: draft.unit,
      roundingIncrement: draft.roundingIncrement,
      restMainSeconds: draft.restMainSeconds,
      restAccessorySeconds: draft.restAccessorySeconds,
      plannedJokers: draft.plannedJokers ?? null,
    },
    sessions,
    exercises,
  };
}

/**
 * F7 — a weekday edit must not rewrite the displayed plan-position of a
 * session that already happened. WeekSessions snapshots its nominal date at
 * cycle-seed time (`nominal_date`, utils/cycleSeed.ts); this restamps that
 * snapshot for a session's STILL-PENDING WeekSessions rows only, recomputed
 * from each row's own cycle start and week number against the session's NEW
 * weekday. An already-resolved row (completed, moved, discarded) is left
 * alone — the day it actually happened on never changes underneath it. Safe
 * to call unconditionally after every existing-session update, whether the
 * weekday actually changed or not: recomputing to the same weekday yields
 * the same stamp already stored.
 */
async function restampPendingWeekSessions(
  db: RoutineDatabase,
  sessionId: number,
  weekday: number,
): Promise<void> {
  const rows = await db.getAll(
    `SELECT ws.week_session_id AS week_session_id, cw.week_number AS week_number,
            c.started_at AS started_at
     FROM WeekSessions ws
     JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
     JOIN Cycles c ON c.cycle_id = cw.cycle_id
     WHERE ws.session_id = ? AND ws.status = 'pending' AND c.started_at IS NOT NULL;`,
    [sessionId],
  );
  for (const row of rows) {
    const weekSessionId = Number(row.week_session_id);
    const weekNumber = Number(row.week_number);
    const startedAt = Number(row.started_at);
    const nominalDate = nominalSessionStamp(startedAt, weekNumber, weekday);
    await db.run(
      'UPDATE WeekSessions SET nominal_date = ? WHERE week_session_id = ?;',
      [nominalDate, weekSessionId],
    );
  }
}

export interface EditRemovalWarning {
  /** Session names being removed that have logged history in the active cycle. */
  days: string[];
  /** Exercise names being removed that have a stored proposal in the active cycle. */
  exercises: string[];
}

/**
 * F7 — what an edit is about to discard, if the routine has an active cycle:
 * a day or exercise being removed that already has real bookkeeping against
 * it there. Raw Weight_Log/Workout_Log rows are never at risk either way
 * (§3.2, ADR-0006) — this is about what the CYCLE's own bookkeeping loses
 * when its Sessions/SessionExercises row is cascade-deleted: a completed
 * WeekSessions row's link to its cycle/week tile (a day), or a stored
 * Progression_Proposal (an exercise). Call this BEFORE `saveRoutineEdit` so
 * the screen can confirm once, naming both what's kept and what's lost; an
 * empty result means nothing needs confirming.
 */
export async function editRemovalWarning(
  db: RoutineDatabase,
  routineId: number,
  draft: EditRoutine,
): Promise<EditRemovalWarning> {
  const keptSessionIds = new Set(
    draft.sessions.map((session) => session.sessionId).filter((id): id is number => id !== null),
  );
  const keptExerciseIds = new Set(
    draft.sessions
      .flatMap((session) => session.exercises)
      .map((exercise) => exercise.exerciseId)
      .filter((id): id is number => id !== null),
  );

  const activeCycle = await db.get(
    `SELECT cycle_id FROM Cycles WHERE routine_id = ? AND status = 'active'
     ORDER BY cycle_number DESC LIMIT 1;`,
    [routineId],
  );
  if (activeCycle === undefined) {
    return { days: [], exercises: [] };
  }
  const cycleId = Number(activeCycle.cycle_id);

  const sessionRows = await db.getAll(
    'SELECT session_id, name FROM Sessions WHERE routine_id = ?;',
    [routineId],
  );
  const days: string[] = [];
  const removedSessionIds = new Set<number>();
  for (const row of sessionRows) {
    const sessionId = Number(row.session_id);
    if (keptSessionIds.has(sessionId)) {
      continue;
    }
    removedSessionIds.add(sessionId);
    const hasHistory = await db.get(
      `SELECT 1 AS present FROM WeekSessions ws
       JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
       WHERE cw.cycle_id = ? AND ws.session_id = ? AND ws.status <> 'pending' LIMIT 1;`,
      [cycleId, sessionId],
    );
    if (hasHistory !== undefined) {
      days.push(String(row.name));
    }
  }

  // Only an exercise whose session SURVIVES can be individually removed —
  // one whose whole day is going away is already named in `days` above, so
  // it is never checked again here.
  const exerciseRows = await db.getAll(
    `SELECT e.session_exercise_id, e.exercise_name, e.session_id
     FROM SessionExercises e JOIN Sessions s ON s.session_id = e.session_id
     WHERE s.routine_id = ?;`,
    [routineId],
  );
  const exercises: string[] = [];
  for (const row of exerciseRows) {
    const exerciseId = Number(row.session_exercise_id);
    const sessionId = Number(row.session_id);
    if (keptExerciseIds.has(exerciseId) || removedSessionIds.has(sessionId)) {
      continue;
    }
    const hasProposal = await db.get(
      'SELECT 1 AS present FROM Progression_Proposal WHERE cycle_id = ? AND session_exercise_id = ? LIMIT 1;',
      [cycleId, exerciseId],
    );
    if (hasProposal !== undefined) {
      exercises.push(String(row.exercise_name));
    }
  }

  return { days, exercises };
}

/**
 * Rewrites the routine's plan in one transaction, preserving the identity of
 * every kept row: draft rows that carry a source id are UPDATEd in place,
 * rows without an id (new days / exercises) are INSERTed, and rows not in the
 * draft at all are DELETEd. Preserving ids is what keeps WeekSessions and
 * Progression_Proposal rows — whose FKs cascade from Sessions /
 * SessionExercises — alive across an edit, so an edit of an active routine
 * mid-cycle affects future sessions only. Only rows the user actually removed
 * are deleted; their WeekSessions cascade-delete is the correct consequence of
 * the session being gone. Workout_Log / Logged_Exercises / Weight_Log have no
 * foreign key into the plan and are never touched (§3.2).
 */
export async function saveRoutineEdit(
  db: RoutineDatabase,
  routineId: number,
  draft: EditRoutine,
): Promise<void> {
  const rows = buildEditRows(draft);

  const draftSessionIds = rows.sessions
    .map((session) => session.sessionId)
    .filter((id): id is number => id !== null);
  const draftExerciseIds = rows.exercises
    .map((exercise) => exercise.exerciseId)
    .filter((id): id is number => id !== null);
  assertUniqueIds(draftSessionIds, 'session');
  assertUniqueIds(draftExerciseIds, 'exercise');

  await db.run('BEGIN;');
  try {
    await db.run(
      `UPDATE Routines
         SET name = ?, unit = ?, rounding_increment = ?,
             rest_main_seconds = ?, rest_accessory_seconds = ?,
             planned_jokers = COALESCE(?, planned_jokers)
       WHERE routine_id = ?;`,
      [
        rows.routine.name,
        rows.routine.unit,
        rows.routine.roundingIncrement,
        rows.routine.restMainSeconds,
        rows.routine.restAccessorySeconds,
        rows.routine.plannedJokers,
        routineId,
      ],
    );

    const resolvedSessionIds: number[] = [];
    for (const session of rows.sessions) {
      if (session.sessionId === null) {
        await db.run(
          `INSERT INTO Sessions (routine_id, weekday, name, sort_order)
           VALUES (?, ?, ?, ?);`,
          [routineId, session.weekday, session.name, session.sortOrder],
        );
        const sessionIdRow = await db.get('SELECT last_insert_rowid() AS id;', []);
        if (!sessionIdRow) {
          throw new Error('Could not read the new session id');
        }
        resolvedSessionIds.push(Number(sessionIdRow.id));
      } else {
        await db.run(
          `UPDATE Sessions
             SET weekday = ?, name = ?, sort_order = ?
           WHERE session_id = ? AND routine_id = ?;`,
          [
            session.weekday,
            session.name,
            session.sortOrder,
            session.sessionId,
            routineId,
          ],
        );
        const existing = await db.get(
          'SELECT session_id FROM Sessions WHERE session_id = ? AND routine_id = ?;',
          [session.sessionId, routineId],
        );
        if (!existing) {
          throw new Error(`Draft references unknown session ${session.sessionId}`);
        }
        // F7: restamp this session's still-pending WeekSessions rows to the
        // (possibly new) weekday; already-resolved rows are untouched.
        await restampPendingWeekSessions(db, session.sessionId, session.weekday);
        resolvedSessionIds.push(session.sessionId);
      }
    }

    await deleteNotIn(
      db,
      'Sessions',
      'session_id',
      'routine_id',
      routineId,
      resolvedSessionIds,
    );

    for (let sessionIndex = 0; sessionIndex < rows.sessions.length; sessionIndex += 1) {
      const sessionId = resolvedSessionIds[sessionIndex];
      if (sessionId === undefined) {
        throw new Error(`Edit session ${sessionIndex} resolved to no id`);
      }
      const sessionExercises = rows.exercises.filter(
        (exercise) => exercise.sessionIndex === sessionIndex,
      );
      const resolvedExerciseIds: number[] = [];
      for (const exercise of sessionExercises) {
        if (exercise.exerciseId === null) {
          await db.run(
            `INSERT INTO SessionExercises
               (session_id, catalog_exercise_id, exercise_name, role, target_sets,
                target_reps, load_source, training_max_pct, training_max_weight,
                absolute_weight, unit_override, is_amrap, sort_order, bar_profile,
                bar_weight, warmups_enabled)
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
              toFlag(exercise.warmupsEnabled),
            ],
          );
          const exerciseIdRow = await db.get('SELECT last_insert_rowid() AS id;', []);
          if (!exerciseIdRow) {
            throw new Error('Could not read the new exercise id');
          }
          resolvedExerciseIds.push(Number(exerciseIdRow.id));
        } else {
          await db.run(
            `UPDATE SessionExercises
               SET catalog_exercise_id = ?, exercise_name = ?, role = ?,
                   target_sets = ?, target_reps = ?, load_source = ?,
                   training_max_pct = ?, training_max_weight = ?,
                   absolute_weight = ?, unit_override = ?, is_amrap = ?,
                   sort_order = ?, bar_profile = ?, bar_weight = ?,
                   warmups_enabled = ?
             WHERE session_exercise_id = ? AND session_id = ?;`,
            [
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
              toFlag(exercise.warmupsEnabled),
              exercise.exerciseId,
              sessionId,
            ],
          );
          const existing = await db.get(
            `SELECT session_exercise_id FROM SessionExercises
             WHERE session_exercise_id = ? AND session_id = ?;`,
            [exercise.exerciseId, sessionId],
          );
          if (!existing) {
            throw new Error(
              `Draft references unknown exercise ${exercise.exerciseId}`,
            );
          }
          resolvedExerciseIds.push(exercise.exerciseId);
        }
      }
      await deleteNotIn(
        db,
        'SessionExercises',
        'session_exercise_id',
        'session_id',
        sessionId,
        resolvedExerciseIds,
      );
    }

    await db.run('COMMIT;');
  } catch (error) {
    await db.run('ROLLBACK;');
    throw error;
  }
}

/** A draft repeating a source id is corruption — the save must not proceed. */
const assertUniqueIds = (ids: readonly number[], kind: string): void => {
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(`Draft repeats ${kind} id ${id}`);
    }
    seen.add(id);
  }
};

/**
 * Deletes rows scoped to one owner, keeping exactly the ids the edit resolved
 * to — draft ids plus the ids of newly inserted rows. An empty keep-list
 * deletes everything in scope — the empty-IN-list shape is a syntax error in
 * SQLite, so it gets its own branch.
 */
const deleteNotIn = async (
  db: RoutineDatabase,
  table: 'Sessions' | 'SessionExercises',
  idColumn: string,
  scopeColumn: string,
  scopeValue: number,
  keepIds: readonly number[],
): Promise<void> => {
  if (keepIds.length === 0) {
    await db.run(
      `DELETE FROM ${table} WHERE ${scopeColumn} = ?;`,
      [scopeValue],
    );
    return;
  }
  const placeholders = keepIds.map(() => '?').join(', ');
  await db.run(
    `DELETE FROM ${table}
     WHERE ${scopeColumn} = ? AND ${idColumn} NOT IN (${placeholders});`,
    [scopeValue, ...keepIds],
  );
};
