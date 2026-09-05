/**
 * G1 — Week and cycle review (SPECS.md G1, §3.3, §3.4).
 *
 * The stored review: `proposeNextTargets` is a value, never an effect; this
 * module is where its output lands and where it becomes a plan change. The
 * thin edges generate the pending proposals once per resolved week, resolve
 * them (accept / hold / edit), apply the resolved values into the plan on an
 * explicit confirm, and only then advance the week or complete the cycle.
 * `Progression_Proposal` is the stored state, so a review survives a restart.
 *
 * The wave engine emits TWO proposals per exercise at cycle end (the next
 * cycle's week-1 target and the TM proposal), but the table's
 * UNIQUE(cycle_id, session_exercise_id) admits one row per exercise. The TM
 * proposal is the one with plan semantics — identified by
 * `current_target === training_max_weight` — and is the one stored at cycle
 * end; the week-1 target is derived from the TM by the runner and is not a
 * stored decision. Mid-cycle the week-target proposals are stored as-is.
 *
 * The advisory flag is not stored: it is derived at load from stored state.
 * Linear: a hold whose previous cycle's row for the same exercise was also
 * held. Wave TM: two or more AMRAP misses in the completed cycle.
 */

import { createCycle } from './cycleSeed';
import { estimate1RM, waveForWeek } from './fiveThreeOne';
import {
  proposeNextTargets,
  roundTo,
  type CycleHistory,
  type LoadProposal,
  type LoadUnit,
  type PerformedSet,
  type ProposalStatus,
  type RoutineLike,
} from './progression';
import { loadRoutineSourceById, type RoutineDatabase, type RoutineUnit } from './routineActions';

export type ReviewRule = 'wave' | 'linear' | 'none';

export interface ReviewRoutine {
  routineId: number;
  name: string;
  unit: RoutineUnit;
  roundingIncrement: number;
  progressionRule: ReviewRule;
  /** Per-routine TM increments (§3.1); null = the wave engine's own unit default. */
  tmIncrementUpper: number | null;
  tmIncrementLower: number | null;
  /** The cycle length (§3.2) a NEW cycle of this routine seeds with: 3 or 4 weeks. */
  cycleWeeks: number;
}

export interface ReviewCycle {
  cycleId: number;
  cycleNumber: number;
  weeks: number;
  status: 'planned' | 'active' | 'complete';
  currentWeek: number;
}

export interface ReviewExercise {
  sessionExerciseId: number;
  catalogExerciseId: string | null;
  name: string;
  role: 'main' | 'accessory';
  targetSets: number;
  targetReps: number;
  loadSource: 'training_max_pct' | 'absolute' | 'bodyweight';
  absoluteWeight: number | null;
  trainingMaxWeight: number | null;
  trainingMaxPct: number | null;
  unitOverride: LoadUnit | null;
  isAmrap: boolean;
  /** The 5/3/1 upper/lower role (§3.1); null = inferred from the training max. */
  category: 'upper' | 'lower' | null;
}

export interface PerformedSetGroup {
  cycleNumber: number;
  weekNumber: number;
  exerciseName: string;
  /**
   * Copied at log time onto `Logged_Exercises` (F2, ADR-0006): disambiguates
   * two SessionExercises rows that share a name — a preset's main lift and a
   * back-off set on the same catalog exercise (the shipped '531' preset's FSL
   * rows). Null for a free session (no plan role to copy) or a row logged
   * before this column existed; a null-role group matches by name alone, same
   * as before this fix, since there is nothing left to disambiguate with.
   */
  role: 'main' | 'accessory' | null;
  sets: PerformedSet[];
}

/**
 * Whether a set group belongs to a given (name, role) exercise. Role is the
 * disambiguator (F2): an exercise's own role must agree with the group's,
 * unless either side has none to compare (a free-session or pre-fix group,
 * or a caller that does not know the role) — then name alone decides, same
 * as before role existed.
 */
export function groupMatchesExercise(
  group: Pick<PerformedSetGroup, 'exerciseName' | 'role'>,
  name: string,
  role: 'main' | 'accessory' | null,
): boolean {
  return group.exerciseName === name && (group.role === null || role === null || group.role === role);
}

/**
 * Extra sets (§3.4) never reach a proposal or the AMRAP review: each group is
 * cut to its exercise's planned set count, keeping only the first `targetSets`
 * logged sets. Applied once at load time, so `buildCycleHistory` and the
 * AMRAP rows both read planned work sets only. Matched by (name, role) so a
 * main lift and a same-named accessory (F2) each get their own count.
 */
export function plannedWorkSets(
  groups: readonly PerformedSetGroup[],
  exercises: readonly ReviewExercise[],
): PerformedSetGroup[] {
  return groups.map((group) => {
    const match = exercises.find((exercise) => groupMatchesExercise(group, exercise.name, exercise.role));
    return match === undefined
      ? group
      : { ...group, sets: group.sets.slice(0, match.targetSets) };
  });
}

export interface CycleExerciseStatus {
  cycleNumber: number;
  sessionExerciseId: number;
  status: ProposalStatus;
}

export interface ProposalRow {
  proposalId: number;
  sessionExerciseId: number;
  exerciseName: string;
  currentTarget: number;
  proposedTarget: number;
  unit: LoadUnit;
  reason: string;
  status: ProposalStatus;
}

export interface ReviewProposalView {
  proposalId: number;
  sessionExerciseId: number;
  exerciseName: string;
  role: 'main' | 'accessory';
  currentTarget: number;
  proposedTarget: number;
  unit: LoadUnit;
  reason: string;
  status: ProposalStatus;
  /** A reset-suggesting note, derived from stored state; never applied automatically. */
  advisory: boolean;
  /** A wave TM row: on apply its value lands in training_max_weight directly. */
  isTmProposal: boolean;
}

export interface AmrapRow {
  weekNumber: number;
  reps: number;
  estimated1rm: number;
}

export interface ReviewData {
  routine: ReviewRoutine;
  cycle: ReviewCycle;
  /** The reviewed week is the cycle's last; a wave TM proposal is in play. */
  atCycleEnd: boolean;
  proposals: ReviewProposalView[];
  /** AMRAP history of the completed wave cycle, per main lift with a TM proposal. */
  amrap: { sessionExerciseId: number; rows: AmrapRow[] }[];
}

/** Maps a SessionExercises snapshot to the engine's RoutineExercise. */
export function buildRoutineLike(
  routine: ReviewRoutine,
  exercises: readonly ReviewExercise[],
): RoutineLike {
  return {
    unit: routine.unit,
    roundingIncrement: routine.roundingIncrement,
    progressionRule: routine.progressionRule,
    tmIncrementUpper: routine.tmIncrementUpper,
    tmIncrementLower: routine.tmIncrementLower,
    exercises: exercises.map((exercise) => ({
      identifier: exercise.sessionExerciseId,
      name: exercise.name,
      targetSets: exercise.targetSets,
      targetReps: exercise.targetReps,
      loadSource: exercise.loadSource,
      unitOverride: exercise.unitOverride,
      absoluteWeight: exercise.absoluteWeight,
      trainingMaxWeight: exercise.trainingMaxWeight,
      trainingMaxPct: exercise.trainingMaxPct,
      ...(exercise.category === null ? {} : { category: exercise.category }),
    })),
  };
}

/**
 * The engine's history. Linear evaluates one entry per CYCLE (all of the
 * cycle's logged sets aggregated); the wave rule walks one entry per WEEK and
 * needs exactly four entries per cycle. proposalStatus per exercise comes
 * from the resolved Progression_Proposal rows of that cycle — the previous
 * cycle's 'held' is the consecutive-hold source the linear rule reads.
 */
export function buildCycleHistory(
  rule: ReviewRule,
  cycles: readonly ReviewCycle[],
  exercises: readonly ReviewExercise[],
  setGroups: readonly PerformedSetGroup[],
  statuses: readonly CycleExerciseStatus[],
): CycleHistory[] {
  const identifiersByName = new Map<string, number[]>();
  for (const exercise of exercises) {
    const list = identifiersByName.get(exercise.name);
    if (list === undefined) {
      identifiersByName.set(exercise.name, [exercise.sessionExerciseId]);
    } else {
      list.push(exercise.sessionExerciseId);
    }
  }

  const statusByCycleExercise = new Map<string, ProposalStatus>();
  for (const status of statuses) {
    statusByCycleExercise.set(`${status.cycleNumber}:${status.sessionExerciseId}`, status.status);
  }

  const cyclesAsc = [...cycles].sort((a, b) => a.cycleNumber - b.cycleNumber);
  if (rule === 'wave') {
    const history: CycleHistory[] = [];
    for (const cycle of cyclesAsc) {
      for (let weekNumber = 1; weekNumber <= cycle.weeks; weekNumber += 1) {
        const entry: CycleHistory = {
          cycleNumber: cycle.cycleNumber,
          weeks: cycle.weeks,
          exercises: {},
        };
        for (const exercise of exercises) {
          const weekSets = setGroups
            .filter(
              (group) =>
                group.cycleNumber === cycle.cycleNumber &&
                group.weekNumber === weekNumber &&
                groupMatchesExercise(group, exercise.name, exercise.role),
            )
            .flatMap((group) => group.sets);
          entry.exercises[exercise.sessionExerciseId] = {
            sets: weekSets,
            proposalStatus:
              statusByCycleExercise.get(`${cycle.cycleNumber}:${exercise.sessionExerciseId}`) ??
              null,
          };
        }
        history.push(entry);
      }
    }
    return history;
  }

  return cyclesAsc.map((cycle) => {
    const entry: CycleHistory = { cycleNumber: cycle.cycleNumber, weeks: cycle.weeks, exercises: {} };
    for (const exercise of exercises) {
      const cycleSets = setGroups
        .filter(
          (group) =>
            group.cycleNumber === cycle.cycleNumber &&
            groupMatchesExercise(group, exercise.name, exercise.role),
        )
        .flatMap((group) => group.sets);
      entry.exercises[exercise.sessionExerciseId] = {
        sets: cycleSets,
        proposalStatus:
          statusByCycleExercise.get(`${cycle.cycleNumber}:${exercise.sessionExerciseId}`) ?? null,
      };
    }
    return entry;
  });
}

/**
 * Which engine proposals become stored rows. One row per exercise per cycle
 * (UNIQUE(cycle_id, session_exercise_id)); at wave cycle end the TM proposal
 * — the row whose current target IS the training max — wins over the derived
 * week-1 target. Mid-cycle wave and every linear week store all proposals.
 */
export function selectStoredProposals(
  rule: ReviewRule,
  cycle: ReviewCycle,
  exercises: readonly ReviewExercise[],
  proposals: readonly LoadProposal[],
): LoadProposal[] {
  if (rule !== 'wave' || cycle.currentWeek < cycle.weeks) {
    return [...proposals];
  }
  const trainingMaxById = new Map(
    exercises.map((exercise) => [exercise.sessionExerciseId, exercise.trainingMaxWeight]),
  );
  return proposals.filter(
    (proposal) =>
      trainingMaxById.get(proposal.exerciseIdentifier) === proposal.currentTarget,
  );
}

const exerciseById = (exercises: readonly ReviewExercise[]): Map<number, ReviewExercise> =>
  new Map(exercises.map((exercise) => [exercise.sessionExerciseId, exercise]));

/** The row that lands in training_max_weight on apply. */
const isTmProposal = (
  rule: ReviewRule,
  exercise: ReviewExercise,
  row: ProposalRow,
): boolean =>
  rule === 'wave' &&
  exercise.loadSource === 'training_max_pct' &&
  row.currentTarget === exercise.trainingMaxWeight;

/**
 * The advisory, derived from stored state: linear — this is a hold and the
 * previous cycle's row for the same exercise was also held; wave TM — two or
 * more AMRAP misses across the completed cycle.
 */
function advisoryFor(
  rule: ReviewRule,
  proposal: ProposalRow,
  previousStatus: ProposalStatus | null,
  amrapMisses: number,
): boolean {
  if (rule === 'wave') {
    return amrapMisses >= 2;
  }
  return proposal.proposedTarget === proposal.currentTarget && previousStatus === 'held';
}

const amrapMisses = (rows: readonly AmrapRow[]): number => {
  let misses = 0;
  for (const row of rows) {
    const targetReps = waveForWeek(row.weekNumber).sets[2].targetReps;
    if (row.reps < targetReps) {
      misses += 1;
    }
  }
  return misses;
};

/**
 * A cycle's AMRAP weeks are always its first three (§3.2, F3) — true whether
 * it has a 4th (deload) week or not, since a deload-off cycle's week 3 is
 * still a normal AMRAP week, not a renumbered deload. Never `cycle.weeks - 1`:
 * that assumed every cycle has exactly one non-AMRAP week at the end, which
 * is false for a 3-week cycle (none) and would silently drop its week 3.
 */
const AMRAP_WEEK_COUNT = 3;

/**
 * The AMRAP sets of one exercise in one cycle: the last logged set of each
 * week with at least three sets. Weeks up to `maxWeek` only — the deload week
 * is a fixed-target week and carries no AMRAP result.
 */
const amrapRowsFor = (
  setGroups: readonly PerformedSetGroup[],
  cycleNumber: number,
  exerciseName: string,
  role: 'main' | 'accessory' | null,
  maxWeek: number,
): AmrapRow[] => {
  const rows: AmrapRow[] = [];
  for (const group of setGroups) {
    if (
      group.cycleNumber !== cycleNumber ||
      !groupMatchesExercise(group, exerciseName, role) ||
      group.weekNumber > maxWeek
    ) {
      continue;
    }
    if (group.sets.length < 3) {
      continue;
    }
    const amrapSet = group.sets[group.sets.length - 1];
    rows.push({
      weekNumber: group.weekNumber,
      reps: amrapSet.reps,
      estimated1rm: estimate1RM(amrapSet.weight, amrapSet.reps),
    });
  }
  return rows.sort((a, b) => a.weekNumber - b.weekNumber);
};

interface ReviewSource {
  routine: ReviewRoutine;
  cycle: ReviewCycle;
  cycles: ReviewCycle[];
  exercises: ReviewExercise[];
  setGroups: PerformedSetGroup[];
  statuses: CycleExerciseStatus[];
  rows: ProposalRow[];
}

const num = (value: unknown): number => Number(value);
const str = (value: unknown): string => String(value);
const nullableNum = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);
const nullableStr = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

const toCycle = (row: Record<string, unknown>): ReviewCycle => ({
  cycleId: num(row.cycle_id),
  cycleNumber: num(row.cycle_number),
  weeks: num(row.weeks),
  status: str(row.status) as ReviewCycle['status'],
  currentWeek: num(row.current_week),
});

const toExercise = (row: Record<string, unknown>): ReviewExercise => ({
  sessionExerciseId: num(row.session_exercise_id),
  catalogExerciseId: nullableStr(row.catalog_exercise_id),
  name: str(row.exercise_name),
  role: str(row.role) as ReviewExercise['role'],
  targetSets: num(row.target_sets),
  targetReps: num(row.target_reps),
  loadSource: str(row.load_source) as ReviewExercise['loadSource'],
  absoluteWeight: nullableNum(row.absolute_weight),
  trainingMaxWeight: nullableNum(row.training_max_weight),
  trainingMaxPct: nullableNum(row.training_max_pct),
  unitOverride: nullableStr(row.unit_override) as LoadUnit | null,
  isAmrap: num(row.is_amrap) === 1,
  category: nullableStr(row.category) as ReviewExercise['category'],
});

const toProposalRow = (row: Record<string, unknown>): ProposalRow => ({
  proposalId: num(row.proposal_id),
  sessionExerciseId: num(row.session_exercise_id),
  exerciseName: str(row.exercise_name),
  currentTarget: num(row.current_target),
  proposedTarget: num(row.proposed_target),
  unit: str(row.unit) as LoadUnit,
  reason: str(row.reason),
  status: str(row.status) as ProposalStatus,
});

/**
 * Ruling 1: the review is due when every session of the cycle's current week
 * is resolved and no proposal for the cycle is still pending. A completed
 * cycle's review is history and is never regenerated.
 */
export async function reviewDueFor(db: RoutineDatabase, cycle: ReviewCycle): Promise<boolean> {
  if (cycle.status !== 'active') {
    return false;
  }
  const rows = await db.getAll(
    `SELECT COUNT(*) AS n FROM WeekSessions ws
     JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
     WHERE cw.cycle_id = ? AND cw.week_number = ? AND ws.status = 'pending';`,
    [cycle.cycleId, cycle.currentWeek],
  );
  const pendingSessions = rows[0] === undefined ? 0 : num(rows[0].n);
  return pendingSessions === 0;
}

async function loadReviewSource(
  db: RoutineDatabase,
  routineId: number,
  cycleId: number,
): Promise<ReviewSource> {
  const source = await loadRoutineSourceById(db, routineId);
  const routine: ReviewRoutine = {
    routineId,
    name: source.routine.name,
    unit: source.routine.unit as RoutineUnit,
    roundingIncrement: source.routine.roundingIncrement,
    progressionRule: source.routine.progressionRule,
    tmIncrementUpper: source.routine.tmIncrementUpper,
    tmIncrementLower: source.routine.tmIncrementLower,
    cycleWeeks: source.routine.cycleWeeks,
  };
  const exercises: ReviewExercise[] = source.exercises.map((exercise) => ({
    sessionExerciseId: exercise.exerciseId,
    catalogExerciseId: exercise.catalogExerciseId,
    name: exercise.name,
    role: exercise.role,
    targetSets: exercise.targetSets,
    targetReps: exercise.targetReps,
    loadSource: exercise.loadSource,
    absoluteWeight: exercise.absoluteWeight,
    trainingMaxWeight: exercise.trainingMaxWeight,
    trainingMaxPct: exercise.trainingMaxPct,
    unitOverride: exercise.unitOverride,
    isAmrap: exercise.isAmrap,
    category: exercise.category,
  }));

  const cycleRows = await db.getAll(
    `SELECT cycle_id, cycle_number, weeks, status, current_week
     FROM Cycles WHERE routine_id = ? ORDER BY cycle_number;`,
    [routineId],
  );
  const cycles = cycleRows.map(toCycle);
  const cycle = cycles.find((entry) => entry.cycleId === cycleId);
  if (cycle === undefined) {
    throw new Error(`Unknown cycle ${cycleId} for routine ${routineId}`);
  }

  const setRows = await db.getAll(
    `SELECT c.cycle_number, cw.week_number, le.exercise_name, le.role, wl.set_number,
            wl.weight_logged, wl.reps_logged, wl.unit
     FROM Cycles c
     JOIN CycleWeeks cw ON cw.cycle_id = c.cycle_id
     JOIN WeekSessions ws ON ws.cycle_week_id = cw.cycle_week_id
     JOIN Workout_Log wol ON wol.workout_log_id = ws.completed_log_id
     JOIN Logged_Exercises le ON le.workout_log_id = wol.workout_log_id
     JOIN Weight_Log wl ON wl.logged_exercise_id = le.logged_exercise_id
     WHERE c.routine_id = ?
     ORDER BY c.cycle_number, cw.week_number, le.exercise_name, le.role, wl.set_number;`,
    [routineId],
  );
  const setGroups: PerformedSetGroup[] = [];
  for (const row of setRows) {
    // F2: grouped by (cycle, week, name, role) — role is what keeps a
    // main lift and a same-catalog back-off row (the shipped '531' preset's
    // FSL sets) from merging into one blob and corrupting the AMRAP read.
    const role = nullableStr(row.role) as PerformedSetGroup['role'];
    let group = setGroups[setGroups.length - 1];
    if (
      group === undefined ||
      group.cycleNumber !== num(row.cycle_number) ||
      group.weekNumber !== num(row.week_number) ||
      group.exerciseName !== str(row.exercise_name) ||
      group.role !== role
    ) {
      group = {
        cycleNumber: num(row.cycle_number),
        weekNumber: num(row.week_number),
        exerciseName: str(row.exercise_name),
        role,
        sets: [],
      };
      setGroups.push(group);
    }
    group.sets.push({
      weight: num(row.weight_logged),
      reps: num(row.reps_logged),
      unit: str(row.unit) as LoadUnit,
    });
  }

  const statusRows = await db.getAll(
    `SELECT c.cycle_number, p.session_exercise_id, p.status
     FROM Progression_Proposal p JOIN Cycles c ON c.cycle_id = p.cycle_id
     WHERE p.routine_id = ?;`,
    [routineId],
  );
  const statuses: CycleExerciseStatus[] = statusRows.map((row) => ({
    cycleNumber: num(row.cycle_number),
    sessionExerciseId: num(row.session_exercise_id),
    status: str(row.status) as ProposalStatus,
  }));

  const proposalRows = await db.getAll(
    `SELECT proposal_id, session_exercise_id, exercise_name, current_target,
            proposed_target, unit, reason, status
     FROM Progression_Proposal WHERE cycle_id = ?
     ORDER BY proposal_id;`,
    [cycleId],
  );

  return {
    routine,
    cycle,
    cycles,
    exercises,
    // Cut to the planned work sets here, once, for the whole review (§3.4):
    // extra sets count toward volume but never toward a proposal or the AMRAP
    // history the review shows.
    setGroups: plannedWorkSets(setGroups, exercises),
    statuses,
    rows: proposalRows.map(toProposalRow),
  };
}

/**
 * Proposal generation (the load step of G1): build the engine input from the
 * DB — the §3.2 name-join from WeekSessions.completed_log_id to Weight_Log —
 * call `proposeNextTargets` once, and store every selected proposal as
 * 'pending' (INSERT OR REPLACE on UNIQUE(cycle_id, session_exercise_id), so
 * regeneration never duplicates). A cycle with an unresolved review is left
 * untouched: decisions in progress are stored state and survive restarts.
 */
export async function generateReview(
  db: RoutineDatabase,
  routineId: number,
  cycleId: number,
): Promise<void> {
  const source = await loadReviewSource(db, routineId, cycleId);
  if (source.rows.some((row) => row.status === 'pending')) {
    return;
  }

  const routineLike = buildRoutineLike(source.routine, source.exercises);
  const cycleHistory = buildCycleHistory(
    source.routine.progressionRule,
    source.cycles,
    source.exercises,
    source.setGroups,
    source.statuses,
  );
  const engineProposals = proposeNextTargets(routineLike, cycleHistory);
  const stored = selectStoredProposals(
    source.routine.progressionRule,
    source.cycle,
    source.exercises,
    engineProposals,
  );

  const exerciseByIdMap = exerciseById(source.exercises);
  const createdAt = Math.floor(Date.now() / 1000);
  for (const proposal of stored) {
    await db.run(
      `INSERT OR REPLACE INTO Progression_Proposal
         (routine_id, cycle_id, session_exercise_id, catalog_exercise_id, exercise_name,
          current_target, proposed_target, unit, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?);`,
      [
        routineId,
        cycleId,
        proposal.exerciseIdentifier,
        exerciseByIdMap.get(proposal.exerciseIdentifier)?.catalogExerciseId ?? null,
        proposal.exerciseName,
        proposal.currentTarget,
        proposal.proposedTarget,
        proposal.unit,
        proposal.reason,
        createdAt,
      ],
    );
  }
}

export function buildReviewData(source: ReviewSource): ReviewData {
  const { routine, cycle, exercises, rows } = source;
  const atCycleEnd = cycle.currentWeek >= cycle.weeks;
  const exercisesById = exerciseById(exercises);

  const previousCycle = [...source.cycles]
    .sort((a, b) => a.cycleNumber - b.cycleNumber)
    .reverse()
    .find((entry) => entry.cycleNumber < cycle.cycleNumber);

  const amrap: ReviewData['amrap'] = [];
  const proposals: ReviewProposalView[] = rows.map((row) => {
    const exercise = exercisesById.get(row.sessionExerciseId);
    const previousStatus =
      previousCycle === undefined || exercise === undefined
        ? null
        : (source.statuses.find(
            (status) =>
              status.cycleNumber === previousCycle.cycleNumber &&
              status.sessionExerciseId === exercise.sessionExerciseId,
          )?.status ?? null);
    const amrapRows =
      routine.progressionRule === 'wave' && atCycleEnd && exercise !== undefined
        ? amrapRowsFor(
            source.setGroups,
            cycle.cycleNumber,
            row.exerciseName,
            exercise.role,
            AMRAP_WEEK_COUNT,
          )
        : [];
    return {
      proposalId: row.proposalId,
      sessionExerciseId: row.sessionExerciseId,
      exerciseName: row.exerciseName,
      role: exercise?.role ?? 'accessory',
      currentTarget: row.currentTarget,
      proposedTarget: row.proposedTarget,
      unit: row.unit,
      reason: row.reason,
      status: row.status,
      advisory: advisoryFor(
        routine.progressionRule,
        row,
        previousStatus,
        exercise === undefined ? 0 : amrapMisses(amrapRows),
      ),
      isTmProposal: exercise !== undefined && isTmProposal(routine.progressionRule, exercise, row),
    };
  });

  if (routine.progressionRule === 'wave' && atCycleEnd) {
    for (const proposal of proposals) {
      const exercise = exercisesById.get(proposal.sessionExerciseId);
      if (exercise === undefined || exercise.role !== 'main' || !proposal.isTmProposal) {
        continue;
      }
      amrap.push({
        sessionExerciseId: proposal.sessionExerciseId,
        rows: amrapRowsFor(
          source.setGroups,
          cycle.cycleNumber,
          proposal.exerciseName,
          exercise.role,
          AMRAP_WEEK_COUNT,
        ),
      });
    }
  }

  return { routine, cycle, atCycleEnd, proposals, amrap };
}

/**
 * Loads the stored review. Generates the pending proposals the first time the
 * review is due (current week resolved, nothing pending) and resumes whatever
 * was stored — the screen never holds review state that a restart can lose.
 * A due review replaces the previous week's fully resolved rows, which were
 * already applied; an unresolved review is never touched.
 */
export async function loadCycleReview(
  db: RoutineDatabase,
  routineId: number,
  cycleId: number,
): Promise<ReviewData> {
  let source = await loadReviewSource(db, routineId, cycleId);
  if (
    (await reviewDueFor(db, source.cycle)) &&
    source.rows.every((row) => row.status !== 'pending')
  ) {
    await generateReview(db, routineId, cycleId);
    source = await loadReviewSource(db, routineId, cycleId);
  }
  return buildReviewData(source);
}

/** One user decision on one proposal; stored immediately, applied only on confirm. */
export async function resolveProposal(
  db: RoutineDatabase,
  proposalId: number,
  outcome: 'accepted' | 'held',
): Promise<void> {
  await db.run(
    `UPDATE Progression_Proposal SET status = ? WHERE proposal_id = ?;`,
    [outcome, proposalId],
  );
}

/** The edited outcome: the entered value rounded to the routine's increment. */
export async function editProposalValue(
  db: RoutineDatabase,
  proposalId: number,
  value: number,
  roundingIncrement: number,
): Promise<void> {
  await db.run(
    `UPDATE Progression_Proposal SET proposed_target = ?, status = 'edited'
     WHERE proposal_id = ?;`,
    [roundTo(value, roundingIncrement), proposalId],
  );
}

interface WriteTarget {
  column: 'absolute_weight' | 'training_max_weight';
  value: number;
}

/**
 * What one resolved proposal writes into the plan. Only 'accepted' and
 * 'edited' write (hold keeps the current value); wave TM rows land directly
 * in training_max_weight, a linear pct row raises the training max so the
 * target becomes the proposed value, and derived wave week targets have no
 * plan column and write nothing.
 */
function planWrite(
  routine: ReviewRoutine,
  exercise: ReviewExercise,
  row: ProposalRow,
): WriteTarget | null {
  if (row.status !== 'accepted' && row.status !== 'edited') {
    return null;
  }
  if (exercise.loadSource === 'absolute') {
    return { column: 'absolute_weight', value: row.proposedTarget };
  }
  if (exercise.loadSource === 'training_max_pct') {
    if (isTmProposal(routine.progressionRule, exercise, row)) {
      return { column: 'training_max_weight', value: row.proposedTarget };
    }
    if (
      routine.progressionRule === 'linear' &&
      exercise.trainingMaxPct !== null &&
      exercise.trainingMaxPct > 0
    ) {
      return {
        column: 'training_max_weight',
        value: roundTo(row.proposedTarget / exercise.trainingMaxPct, routine.roundingIncrement),
      };
    }
  }
  return null;
}

export interface ApplyResult {
  completed: boolean;
}

/**
 * The only place loads change: writes every resolved proposal into the plan
 * and advances the week — or completes the cycle at its last week — in one
 * transaction. Refuses to run while any proposal is still pending, when the
 * current week is not fully resolved (an already-applied review), or once the
 * cycle is complete; the next cycle is generated only by the explicit
 * startNextCycle action.
 */
export async function applyReview(
  db: RoutineDatabase,
  routineId: number,
  cycleId: number,
): Promise<ApplyResult> {
  const source = await loadReviewSource(db, routineId, cycleId);
  if (source.cycle.status !== 'active') {
    throw new Error('applyReview: the cycle is not active');
  }
  if (source.rows.some((row) => row.status === 'pending')) {
    throw new Error('applyReview: unresolved proposals remain');
  }
  if (!(await reviewDueFor(db, source.cycle))) {
    throw new Error('applyReview: the current week is not resolved');
  }

  const exercisesById = exerciseById(source.exercises);
  const completed = source.cycle.currentWeek >= source.cycle.weeks;

  await db.run('BEGIN;');
  try {
    for (const row of source.rows) {
      const exercise = exercisesById.get(row.sessionExerciseId);
      if (exercise === undefined) {
        continue;
      }
      const write = planWrite(source.routine, exercise, row);
      if (write === null) {
        continue;
      }
      await db.run(
        `UPDATE SessionExercises SET ${write.column} = ?
         WHERE session_exercise_id = ?;`,
        [write.value, row.sessionExerciseId],
      );
    }
    if (completed) {
      await db.run(
        `UPDATE Cycles SET status = 'complete', completed_at = ?
         WHERE cycle_id = ? AND status = 'active';`,
        [Math.floor(Date.now() / 1000), cycleId],
      );
    } else {
      await db.run(
        `UPDATE Cycles SET current_week = current_week + 1
         WHERE cycle_id = ? AND status = 'active';`,
        [cycleId],
      );
    }
    await db.run('COMMIT;');
    return { completed };
  } catch (error) {
    await db.run('ROLLBACK;');
    throw error;
  }
}

/**
 * Explicitly generates the next cycle after a completed review, through the
 * shared `createCycle` (utils/cycleSeed.ts): a new Cycles row (status
 * 'active', current week 1) with the ROUTINE'S CURRENT `cycle_weeks` (§3.2) —
 * not the just-completed cycle's own length, so a deload switch flipped since
 * then is honoured — all CycleWeeks, and one pending WeekSessions row per
 * session per week. The confirmed plan values — absolute weights or training
 * maxes — are already in SessionExercises, which is where the new week's
 * targets derive from.
 */
export async function startNextCycle(
  db: RoutineDatabase,
  routineId: number,
  cycleId: number,
): Promise<number> {
  const source = await loadReviewSource(db, routineId, cycleId);
  if (source.cycle.status !== 'complete') {
    throw new Error('startNextCycle: the cycle is not complete');
  }

  await db.run('BEGIN;');
  try {
    const newCycleId = await createCycle(
      db,
      routineId,
      source.routine.cycleWeeks,
      Math.floor(Date.now() / 1000),
    );
    await db.run('COMMIT;');
    return newCycleId;
  } catch (error) {
    await db.run('ROLLBACK;');
    throw error;
  }
}

export interface ReviewEntry {
  routineId: number;
  cycleId: number;
  cycleNumber: number;
  currentWeek: number;
  routineName: string;
}

/**
 * The Today entry point: an active routine whose active cycle's current week
 * is fully resolved has a review awaiting the user. A partially resolved
 * review stays reachable — the screen resumes its stored rows.
 */
export async function loadReviewEntry(db: RoutineDatabase): Promise<ReviewEntry | null> {
  const routineRow = await db.get(
    'SELECT routine_id, name FROM Routines WHERE is_active = 1 LIMIT 1;',
    [],
  );
  if (!routineRow) {
    return null;
  }
  const routineId = num(routineRow.routine_id);

  const cycleRow = await db.get(
    `SELECT cycle_id, cycle_number, current_week
     FROM Cycles WHERE routine_id = ? AND status = 'active'
     ORDER BY cycle_number DESC LIMIT 1;`,
    [routineId],
  );
  if (!cycleRow) {
    return null;
  }
  const cycleId = num(cycleRow.cycle_id);
  const currentWeek = num(cycleRow.current_week);

  const pendingRows = await db.getAll(
    `SELECT COUNT(*) AS n
     FROM WeekSessions ws JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
     WHERE cw.cycle_id = ? AND cw.week_number = ? AND ws.status = 'pending';`,
    [cycleId, currentWeek],
  );
  const pendingCount = pendingRows[0] === undefined ? 0 : num(pendingRows[0].n);
  if (pendingCount > 0) {
    return null;
  }

  return {
    routineId,
    cycleId,
    cycleNumber: num(cycleRow.cycle_number),
    currentWeek,
    routineName: str(routineRow.name),
  };
}
