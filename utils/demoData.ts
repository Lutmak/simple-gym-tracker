/**
 * The seeded demo data: six months of realistic novice history (SPECS.md M3).
 *
 * Two routines. The ACTIVE one is a 5/3/1-style `wave` routine: four training
 * days (Squat / Bench / Deadlift / Press), each main lift with three or four
 * accessories, six four-week cycles spanning 2026-03-02..2026-08-16. Its
 * history is generated from the same arithmetic the app uses (`waveForWeek` +
 * `calcSetWeight` over each cycle's training max), so the logged loads ARE
 * the plan: weeks 1-3 carry the wave's percentage ramp with an AMRAP last
 * set, week 4 is the deload at 60%. The training max advances +5/+2.5 kg per
 * cycle when the AMRAPs are met and holds when they are not; cycle 3 is the
 * bad cycle (three lifts miss the week-2 AMRAP, bench misses twice, so its
 * TM proposal carries the two-miss advisory). Cycles 1-5 carry resolved
 * review rows (accepted / held / edited / declined); cycle 6 is active with
 * its deload week in progress — exactly one session (Friday's press) is left
 * pending and unresolved, which is the queue head the walkthrough starts
 * from (§3.1).
 *
 * The INACTIVE routine is `linear` — the user's earlier program, two complete
 * cycles of three days (Dec 2025 - Jan 2026). Its bench press missed the
 * first week of each cycle, so its cycle-2 review row is a consecutive hold:
 * the seed's one linear-rule advisory (the app derives it from the stored
 * rows; see cycleReview.buildReviewData).
 *
 * Special cases in the history: one moved session (cycle 2 week 1 deadlift —
 * Thursday to Saturday, same cycle position, new date), one discarded session
 * (cycle 2 week 2 bench — recorded on its nominal day, breaking that week's
 * streak), one free-logging session (a Saturday, tied to no routine's plan),
 * one bad week (cycle 3 week 2), six deloads, a novice curve that rises
 * weekly early and flattens at the held cycle, and per-set timing on every
 * log row (§3.9).
 *
 * Loads are real plate arithmetic: the wave table rounds to the routine's
 * 2.5 kg increment and every exercise with a bar carries its profile, so
 * every logged weight composes from the standard plates (`suggestPlates`,
 * §3.5). The lb-override accessory (lat pulldown, 110-120 lb) keeps the
 * per-set unit story alive inside a kg routine.
 *
 * `buildDemoRows` is pure — it produces typed row objects with stable keys;
 * `loadDemoData` / `removeDemoData` are the thin imperative edges that
 * resolve the keys to ids and write the rows. Loading is idempotent (guarded
 * per routine key), removal restores the database, and reload works.
 */

import { calcSetWeight, waveForWeek } from './fiveThreeOne';
import { DAY_SECONDS, nominalSessionStamp } from './today';

export type DemoWeightUnit = 'kg' | 'lb';
export type DemoLoadSource = 'training_max_pct' | 'absolute' | 'bodyweight';
export type DemoSessionStatus = 'pending' | 'completed' | 'moved' | 'discarded';
export type DemoProposalStatus = 'pending' | 'accepted' | 'held' | 'edited' | 'declined';
export type DemoBarProfile = 'olympic' | 'semi-olympic' | 'smith' | 'ez' | 'custom';

export const DEMO_ROUTINE_KEY = 'demo-wave-4day';
export const DEMO_LINEAR_ROUTINE_KEY = 'demo-linear-3day';
export const DEMO_ROUTINE_NAME = 'Demo Routine';
export const DEMO_LINEAR_NAME = 'Demo Linear';
export const DEMO_FREE_LOG_NAME = 'Free Log';

const WAVE_CYCLES = 6;
const WAVE_WEEKS = 4;
const LINEAR_CYCLES = 2;
const ROUNDING = 2.5;

export interface DemoRoutineRow {
  routineKey: string;
  name: string;
  origin: 'catalog' | 'user';
  progressionRule: 'wave' | 'linear' | 'none';
  unit: DemoWeightUnit;
  roundingIncrement: number;
  restMainSeconds: number;
  restAccessorySeconds: number;
  isActive: boolean;
  createdAt: number;
}

export interface DemoSessionRow {
  sessionKey: string;
  weekday: number;
  name: string;
  sortOrder: number;
}

export interface DemoSessionExerciseRow {
  exerciseKey: string;
  sessionKey: string;
  catalogKey: string | null;
  name: string;
  role: 'main' | 'accessory';
  targetSets: number;
  targetReps: number;
  loadSource: DemoLoadSource;
  absoluteWeight: number | null;
  trainingMaxWeight: number | null;
  trainingMaxPct: number | null;
  unitOverride: DemoWeightUnit | null;
  isAmrap: boolean;
  sortOrder: number;
  barProfile: DemoBarProfile | null;
  barWeight: number | null;
}

export interface DemoCycleRow {
  cycleKey: string;
  cycleNumber: number;
  weeks: number;
  status: 'planned' | 'active' | 'complete';
  currentWeek: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface DemoCycleWeekRow {
  cycleKey: string;
  weekNumber: number;
}

export interface DemoSet {
  weight: number;
  reps: number;
}

export interface DemoWeekSessionRow {
  cycleKey: string;
  weekNumber: number;
  sessionKey: string;
  status: DemoSessionStatus;
  date: number;
  results: Record<string, DemoSet[]>;
}

export interface DemoProposalRow {
  cycleKey: string;
  sessionExerciseKey: string;
  currentTarget: number;
  proposedTarget: number;
  unit: DemoWeightUnit;
  reason: string;
  status: Exclude<DemoProposalStatus, 'pending'>;
}

export interface DemoFreeLogExercise {
  name: string;
  unit: DemoWeightUnit;
  sets: DemoSet[];
}

export interface DemoFreeLogRow {
  workoutName: string;
  dayName: string;
  workoutDate: number;
  exercises: DemoFreeLogExercise[];
}

export interface DemoRoutineRows {
  routine: DemoRoutineRow;
  sessions: DemoSessionRow[];
  exercises: DemoSessionExerciseRow[];
  cycles: DemoCycleRow[];
  cycleWeeks: DemoCycleWeekRow[];
  weekSessions: DemoWeekSessionRow[];
  proposals: DemoProposalRow[];
}

export interface DemoRows {
  routines: DemoRoutineRows[];
  freeLog: DemoFreeLogRow | null;
}

const epoch = (ymd: string): number => {
  const [year, month, day] = ymd.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day, 12, 0, 0) / 1000);
};

// --- The wave routine -------------------------------------------------------

const WAVE_SESSIONS: readonly DemoSessionRow[] = [
  { sessionKey: 'squat-day', weekday: 1, name: 'Squat Day', sortOrder: 1 },
  { sessionKey: 'bench-day', weekday: 2, name: 'Bench Day', sortOrder: 2 },
  { sessionKey: 'deadlift-day', weekday: 4, name: 'Deadlift Day', sortOrder: 3 },
  { sessionKey: 'press-day', weekday: 5, name: 'Press Day', sortOrder: 4 },
];

type WaveLiftKey = 'squat' | 'bench' | 'deadlift' | 'ohp';

/**
 * Training max per cycle, 1..6. Derived from the resolved review rows below:
 * an accepted or edited cycle-end review advances the TM, a held or declined
 * one keeps it. Cycle 3 (the bad cycle) holds every lower-body lift, and the
 * cycle-5 deadlift decline keeps it flat into cycle 6.
 */
const WAVE_TMS: Record<WaveLiftKey, readonly number[]> = {
  squat: [100, 105, 110, 110, 115, 120],
  bench: [70, 72.5, 75, 75, 77.5, 82.5],
  deadlift: [120, 125, 130, 130, 135, 135],
  // Starts at 50 so even the 40% deload week sits on the bar (20 kg).
  ohp: [50, 52.5, 55, 57.5, 60, 62.5],
};

/** AMRAP reps, per cycle (rows) and week 1-3 (columns); overrides script the bad cycle. */
const AMRAP_BASE: readonly (readonly [number, number, number])[] = [
  [5, 3, 1],
  [6, 4, 2],
  [5, 3, 1],
  [6, 4, 3],
  [7, 5, 3],
  [6, 5, 3],
];

/** `cycle:week:lift` → achieved reps; the cycle-3 misses produce the holds and the advisory. */
const AMRAP_OVERRIDES: Readonly<Record<string, number>> = {
  '3:1:bench': 4,
  '3:2:squat': 2,
  '3:2:bench': 2,
  '3:2:deadlift': 2,
};

const amrapReps = (cycle: number, week: number, lift: WaveLiftKey): number => {
  const overridden = AMRAP_OVERRIDES[`${cycle}:${week}:${lift}`];
  if (overridden !== undefined) {
    return overridden;
  }
  return AMRAP_BASE[cycle - 1][week - 1];
};

interface WaveExerciseDef {
  exerciseKey: string;
  sessionKey: string;
  catalogKey: string | null;
  name: string;
  role: 'main' | 'accessory';
  targetSets: number;
  targetReps: number;
  loadSource: DemoLoadSource;
  absoluteWeight: number | null;
  unitOverride: DemoWeightUnit | null;
  isAmrap: boolean;
  barProfile: DemoBarProfile | null;
  /** Main lifts: logged weights derive from the cycle's training max. */
  wave?: true;
  /** Accessories: logged weight = base + step × floor((cycle-1)/2) — rises, then plateaus. */
  base?: number;
  step?: number;
}

const WAVE_EXERCISES: readonly WaveExerciseDef[] = [
  {
    exerciseKey: 'squat',
    sessionKey: 'squat-day',
    catalogKey: 'Barbell_Full_Squat',
    name: 'Barbell Full Squat',
    role: 'main',
    targetSets: 3,
    targetReps: 5,
    loadSource: 'training_max_pct',
    absoluteWeight: null,
    unitOverride: null,
    isAmrap: true,
    barProfile: 'olympic',
    wave: true,
  },
  {
    exerciseKey: 'row',
    sessionKey: 'squat-day',
    catalogKey: 'Bent_Over_Two-Dumbbell_Row',
    name: 'Bent Over Two-Dumbbell Row',
    role: 'accessory',
    targetSets: 3,
    targetReps: 10,
    loadSource: 'absolute',
    absoluteWeight: 27.5,
    unitOverride: null,
    isAmrap: false,
    barProfile: null,
    base: 22.5,
    step: 2.5,
  },
  {
    exerciseKey: 'leg-curl',
    sessionKey: 'squat-day',
    catalogKey: 'Lying_Leg_Curls',
    name: 'Lying Leg Curls',
    role: 'accessory',
    targetSets: 3,
    targetReps: 10,
    loadSource: 'absolute',
    absoluteWeight: 35,
    unitOverride: null,
    isAmrap: false,
    barProfile: null,
    base: 30,
    step: 2.5,
  },
  {
    exerciseKey: 'calf',
    sessionKey: 'squat-day',
    catalogKey: 'Standing_Calf_Raises',
    name: 'Standing Calf Raises',
    role: 'accessory',
    targetSets: 3,
    targetReps: 12,
    loadSource: 'absolute',
    absoluteWeight: 45,
    unitOverride: null,
    isAmrap: false,
    barProfile: null,
    base: 40,
    step: 2.5,
  },
  {
    exerciseKey: 'bench',
    sessionKey: 'bench-day',
    catalogKey: 'Barbell_Bench_Press_-_Medium_Grip',
    name: 'Barbell Bench Press - Medium Grip',
    role: 'main',
    targetSets: 3,
    targetReps: 5,
    loadSource: 'training_max_pct',
    absoluteWeight: null,
    unitOverride: null,
    isAmrap: true,
    barProfile: 'olympic',
    wave: true,
  },
  {
    exerciseKey: 'db-bench',
    sessionKey: 'bench-day',
    catalogKey: 'Dumbbell_Bench_Press',
    name: 'Dumbbell Bench Press',
    role: 'accessory',
    targetSets: 3,
    targetReps: 8,
    loadSource: 'absolute',
    absoluteWeight: 27.5,
    unitOverride: null,
    isAmrap: false,
    barProfile: null,
    base: 22.5,
    step: 2.5,
  },
  {
    exerciseKey: 'barbell-row',
    sessionKey: 'bench-day',
    catalogKey: 'Bent_Over_Barbell_Row',
    name: 'Bent Over Barbell Row',
    role: 'accessory',
    targetSets: 3,
    targetReps: 8,
    loadSource: 'absolute',
    absoluteWeight: 50,
    unitOverride: null,
    isAmrap: false,
    barProfile: 'olympic',
    base: 45,
    step: 2.5,
  },
  {
    exerciseKey: 'triceps',
    sessionKey: 'bench-day',
    catalogKey: 'Triceps_Pushdown',
    name: 'Triceps Pushdown',
    role: 'accessory',
    targetSets: 3,
    targetReps: 12,
    loadSource: 'absolute',
    absoluteWeight: 30,
    unitOverride: null,
    isAmrap: false,
    barProfile: null,
    base: 25,
    step: 2.5,
  },
  {
    exerciseKey: 'lateral',
    sessionKey: 'bench-day',
    catalogKey: 'Side_Lateral_Raise',
    name: 'Side Lateral Raise',
    role: 'accessory',
    targetSets: 3,
    targetReps: 12,
    loadSource: 'absolute',
    absoluteWeight: 15,
    unitOverride: null,
    isAmrap: false,
    barProfile: null,
    base: 10,
    step: 2.5,
  },
  {
    exerciseKey: 'deadlift',
    sessionKey: 'deadlift-day',
    catalogKey: 'Barbell_Deadlift',
    name: 'Barbell Deadlift',
    role: 'main',
    targetSets: 3,
    targetReps: 5,
    loadSource: 'training_max_pct',
    absoluteWeight: null,
    unitOverride: null,
    isAmrap: true,
    barProfile: 'olympic',
    wave: true,
  },
  {
    exerciseKey: 'good-morning',
    sessionKey: 'deadlift-day',
    catalogKey: 'Good_Morning',
    name: 'Good Morning',
    role: 'accessory',
    targetSets: 3,
    targetReps: 10,
    loadSource: 'absolute',
    absoluteWeight: 40,
    unitOverride: null,
    isAmrap: false,
    barProfile: 'olympic',
    base: 35,
    step: 2.5,
  },
  {
    exerciseKey: 'ab-roller',
    sessionKey: 'deadlift-day',
    catalogKey: 'Ab_Roller',
    name: 'Ab Roller',
    role: 'accessory',
    targetSets: 3,
    targetReps: 10,
    loadSource: 'bodyweight',
    absoluteWeight: null,
    unitOverride: null,
    isAmrap: false,
    barProfile: null,
  },
  {
    exerciseKey: 'ghr',
    sessionKey: 'deadlift-day',
    catalogKey: 'Glute_Ham_Raise',
    name: 'Glute Ham Raise',
    role: 'accessory',
    targetSets: 3,
    targetReps: 10,
    loadSource: 'bodyweight',
    absoluteWeight: null,
    unitOverride: null,
    isAmrap: false,
    barProfile: null,
  },
  {
    exerciseKey: 'ohp',
    sessionKey: 'press-day',
    catalogKey: 'Barbell_Shoulder_Press',
    name: 'Barbell Shoulder Press',
    role: 'main',
    targetSets: 3,
    targetReps: 5,
    loadSource: 'training_max_pct',
    absoluteWeight: null,
    unitOverride: null,
    isAmrap: true,
    barProfile: 'olympic',
    wave: true,
  },
  {
    exerciseKey: 'lat-pulldown',
    sessionKey: 'press-day',
    catalogKey: 'Wide-Grip_Lat_Pulldown',
    name: 'Wide-Grip Lat Pulldown',
    role: 'accessory',
    targetSets: 3,
    targetReps: 10,
    loadSource: 'absolute',
    absoluteWeight: 120,
    unitOverride: 'lb',
    isAmrap: false,
    barProfile: null,
    base: 110,
    step: 5,
  },
  {
    exerciseKey: 'curl',
    sessionKey: 'press-day',
    catalogKey: 'Barbell_Curl',
    name: 'Barbell Curl',
    role: 'accessory',
    targetSets: 3,
    targetReps: 10,
    loadSource: 'absolute',
    absoluteWeight: 28,
    unitOverride: null,
    isAmrap: false,
    barProfile: 'ez',
    base: 23,
    step: 2.5,
  },
  {
    exerciseKey: 'cable-crunch',
    sessionKey: 'press-day',
    catalogKey: 'Cable_Crunch',
    name: 'Cable Crunch',
    role: 'accessory',
    targetSets: 3,
    targetReps: 12,
    loadSource: 'absolute',
    absoluteWeight: 35,
    unitOverride: null,
    isAmrap: false,
    barProfile: null,
    base: 30,
    step: 2.5,
  },
];

/**
 * The wave-week script: the moved session (cycle 2 week 1 deadlift, Thursday
 * to Saturday — it keeps its cycle position and only its date changes), the
 * discarded session (cycle 2 week 2 bench — recorded on its nominal day) and
 * the single pending head (cycle 6 week 4 press — the queue's unresolved
 * head). Everything else is completed.
 */
const WAVE_MOVED: readonly [number, number, string, number] = [2, 1, 'deadlift-day', 2];
const WAVE_DISCARDED: readonly [number, number, string] = [2, 2, 'bench-day'];
const WAVE_PENDING: readonly [number, number, string] = [6, 4, 'press-day'];

const waveStartOfCycle = (cycle: number): number =>
  epoch('2026-03-02') + (cycle - 1) * 28 * DAY_SECONDS;

const waveSessionResults = (
  cycle: number,
  week: number,
  sessionKey: string,
): Record<string, DemoSet[]> => {
  const results: Record<string, DemoSet[]> = {};
  for (const exercise of WAVE_EXERCISES) {
    if (exercise.sessionKey !== sessionKey) {
      continue;
    }
    if (exercise.wave === true) {
      const tm = WAVE_TMS[exercise.exerciseKey as WaveLiftKey][cycle - 1];
      results[exercise.exerciseKey] = waveForWeek(week).sets.map((set, index) => ({
        weight: calcSetWeight(tm, set.percent, ROUNDING, 'nearest'),
        reps:
          set.isAmrap && week !== 4
            ? amrapReps(cycle, week, exercise.exerciseKey as WaveLiftKey)
            : set.targetReps,
      }));
    } else if (exercise.loadSource === 'bodyweight') {
      results[exercise.exerciseKey] = Array.from({ length: exercise.targetSets }, () => ({
        weight: 0,
        reps: exercise.targetReps,
      }));
    } else {
      const weight = (exercise.base ?? 0) + (exercise.step ?? 0) * Math.floor((cycle - 1) / 2);
      results[exercise.exerciseKey] = Array.from({ length: exercise.targetSets }, () => ({
        weight,
        reps: exercise.targetReps,
      }));
    }
  }
  return results;
};

const waveSessionStatus = (cycle: number, week: number, sessionKey: string): DemoSessionStatus => {
  if (WAVE_MOVED[0] === cycle && WAVE_MOVED[1] === week && WAVE_MOVED[2] === sessionKey) {
    return 'moved';
  }
  if (WAVE_DISCARDED[0] === cycle && WAVE_DISCARDED[1] === week && WAVE_DISCARDED[2] === sessionKey) {
    return 'discarded';
  }
  if (WAVE_PENDING[0] === cycle && WAVE_PENDING[1] === week && WAVE_PENDING[2] === sessionKey) {
    return 'pending';
  }
  return 'completed';
};

interface TmProposal {
  cycle: number;
  lift: WaveLiftKey;
  current: number;
  proposed: number;
  status: Exclude<DemoProposalStatus, 'pending'>;
}

/**
 * The resolved cycle-end TM reviews. Every value is consistent with the
 * engine's suggestion given the AMRAP script above: met cycles suggest
 * +increment (held/declined keep the TM), the bad cycle holds every lift
 * with a miss, bench's two misses make its cycle-3 proposal the wave
 * advisory, and the cycle-5 bench edit and deadlift decline are the user's
 * own decisions over the suggestion.
 */
const WAVE_TM_PROPOSALS: readonly TmProposal[] = [
  { cycle: 1, lift: 'squat', current: 100, proposed: 105, status: 'accepted' },
  { cycle: 1, lift: 'bench', current: 70, proposed: 72.5, status: 'accepted' },
  { cycle: 1, lift: 'deadlift', current: 120, proposed: 125, status: 'accepted' },
  { cycle: 1, lift: 'ohp', current: 50, proposed: 52.5, status: 'accepted' },
  { cycle: 2, lift: 'squat', current: 105, proposed: 110, status: 'accepted' },
  { cycle: 2, lift: 'bench', current: 72.5, proposed: 75, status: 'accepted' },
  { cycle: 2, lift: 'deadlift', current: 125, proposed: 130, status: 'accepted' },
  { cycle: 2, lift: 'ohp', current: 52.5, proposed: 55, status: 'accepted' },
  { cycle: 3, lift: 'squat', current: 110, proposed: 110, status: 'held' },
  { cycle: 3, lift: 'bench', current: 75, proposed: 75, status: 'held' },
  { cycle: 3, lift: 'deadlift', current: 130, proposed: 130, status: 'held' },
  { cycle: 3, lift: 'ohp', current: 55, proposed: 57.5, status: 'accepted' },
  { cycle: 4, lift: 'squat', current: 110, proposed: 115, status: 'accepted' },
  { cycle: 4, lift: 'bench', current: 75, proposed: 77.5, status: 'accepted' },
  { cycle: 4, lift: 'deadlift', current: 130, proposed: 135, status: 'accepted' },
  { cycle: 4, lift: 'ohp', current: 57.5, proposed: 60, status: 'accepted' },
  { cycle: 5, lift: 'squat', current: 115, proposed: 120, status: 'accepted' },
  { cycle: 5, lift: 'bench', current: 77.5, proposed: 82.5, status: 'edited' },
  { cycle: 5, lift: 'deadlift', current: 135, proposed: 140, status: 'declined' },
  { cycle: 5, lift: 'ohp', current: 60, proposed: 62.5, status: 'accepted' },
];

const waveProposalReason = (proposal: TmProposal): string => {
  switch (proposal.status) {
    case 'held':
      return 'Missed one or more AMRAP targets this cycle.';
    case 'edited':
      return 'Adjusted the proposed training max by hand.';
    case 'declined':
      return 'Declined the proposed increase; kept the current training max.';
    default:
      return 'Hit every AMRAP target this cycle.';
  }
};

const waveLastSessionOfCycle = (cycle: number): number => {
  const start = waveStartOfCycle(cycle);
  return nominalSessionStamp(start, WAVE_WEEKS, 5);
};

const buildWaveRows = (): DemoRoutineRows => {
  const cycles: DemoCycleRow[] = [];
  const cycleWeeks: DemoCycleWeekRow[] = [];
  const weekSessions: DemoWeekSessionRow[] = [];
  const proposals: DemoProposalRow[] = [];

  for (let cycle = 1; cycle <= WAVE_CYCLES; cycle += 1) {
    const cycleKey = `wave-c${cycle}`;
    const completed = cycle < WAVE_CYCLES;
    cycles.push({
      cycleKey,
      cycleNumber: cycle,
      weeks: WAVE_WEEKS,
      status: completed ? 'complete' : 'active',
      currentWeek: WAVE_WEEKS,
      startedAt: waveStartOfCycle(cycle),
      completedAt: completed ? waveLastSessionOfCycle(cycle) : null,
    });
    for (let week = 1; week <= WAVE_WEEKS; week += 1) {
      cycleWeeks.push({ cycleKey, weekNumber: week });
      const start = waveStartOfCycle(cycle);
      for (const session of WAVE_SESSIONS) {
        const nominal = nominalSessionStamp(start, week, session.weekday);
        const status = waveSessionStatus(cycle, week, session.sessionKey);
        const isMoved =
          cycle === WAVE_MOVED[0] && week === WAVE_MOVED[1] && session.sessionKey === WAVE_MOVED[2];
        weekSessions.push({
          cycleKey,
          weekNumber: week,
          sessionKey: session.sessionKey,
          status,
          date: isMoved ? nominal + WAVE_MOVED[3] * DAY_SECONDS : nominal,
          results: status === 'pending' || status === 'discarded' ? {} : waveSessionResults(cycle, week, session.sessionKey),
        });
      }
    }
  }

  for (const proposal of WAVE_TM_PROPOSALS) {
    const exercise = WAVE_EXERCISES.find((entry) => entry.exerciseKey === proposal.lift);
    if (exercise === undefined) {
      throw new Error(`Wave proposal references unknown lift ${proposal.lift}`);
    }
    proposals.push({
      cycleKey: `wave-c${proposal.cycle}`,
      sessionExerciseKey: proposal.lift,
      currentTarget: proposal.current,
      proposedTarget: proposal.proposed,
      unit: 'kg',
      reason: waveProposalReason(proposal),
      status: proposal.status,
    });
  }

  const exercises: DemoSessionExerciseRow[] = WAVE_EXERCISES.map((exercise, index) => ({
    exerciseKey: exercise.exerciseKey,
    sessionKey: exercise.sessionKey,
    catalogKey: exercise.catalogKey,
    name: exercise.name,
    role: exercise.role,
    targetSets: exercise.targetSets,
    targetReps: exercise.targetReps,
    loadSource: exercise.loadSource,
    absoluteWeight: exercise.absoluteWeight,
    trainingMaxWeight:
      exercise.wave === true ? WAVE_TMS[exercise.exerciseKey as WaveLiftKey][WAVE_CYCLES - 1] : null,
    trainingMaxPct: exercise.wave === true ? 0.9 : null,
    unitOverride: exercise.unitOverride,
    isAmrap: exercise.isAmrap,
    sortOrder: index + 1,
    barProfile: exercise.barProfile,
    barWeight: null,
  }));

  return {
    routine: {
      routineKey: DEMO_ROUTINE_KEY,
      name: DEMO_ROUTINE_NAME,
      origin: 'user',
      progressionRule: 'wave',
      unit: 'kg',
      roundingIncrement: ROUNDING,
      restMainSeconds: 180,
      restAccessorySeconds: 90,
      isActive: true,
      createdAt: epoch('2026-02-16'),
    },
    sessions: [...WAVE_SESSIONS],
    exercises,
    cycles,
    cycleWeeks,
    weekSessions,
    proposals,
  };
};

// --- The linear routine -----------------------------------------------------

const LINEAR_SESSIONS: readonly DemoSessionRow[] = [
  { sessionKey: 'push-day', weekday: 1, name: 'Push Day', sortOrder: 1 },
  { sessionKey: 'pull-day', weekday: 3, name: 'Pull Day', sortOrder: 2 },
  { sessionKey: 'leg-day', weekday: 5, name: 'Leg Day', sortOrder: 3 },
];

interface LinearExerciseDef {
  exerciseKey: string;
  sessionKey: string;
  catalogKey: string;
  name: string;
  role: 'main' | 'accessory';
  targetSets: number;
  targetReps: number;
  barProfile: DemoBarProfile | null;
  /** Cycle 1 weight; the second cycle's logged weight after the review row. */
  base: number;
  /** The +2.5 accepted at the cycle-1 review; bench is 0 — held both cycles. */
  step: number;
}

const LINEAR_EXERCISES: readonly LinearExerciseDef[] = [
  {
    exerciseKey: 'lin-bench',
    sessionKey: 'push-day',
    catalogKey: 'Barbell_Bench_Press_-_Medium_Grip',
    name: 'Barbell Bench Press - Medium Grip',
    role: 'main',
    targetSets: 3,
    targetReps: 5,
    barProfile: 'olympic',
    base: 60,
    step: 0,
  },
  {
    exerciseKey: 'lin-db-bench',
    sessionKey: 'push-day',
    catalogKey: 'Dumbbell_Bench_Press',
    name: 'Dumbbell Bench Press',
    role: 'accessory',
    targetSets: 3,
    targetReps: 8,
    barProfile: null,
    base: 20,
    step: 2.5,
  },
  {
    exerciseKey: 'lin-triceps',
    sessionKey: 'push-day',
    catalogKey: 'Triceps_Pushdown',
    name: 'Triceps Pushdown',
    role: 'accessory',
    targetSets: 3,
    targetReps: 12,
    barProfile: null,
    base: 25,
    step: 2.5,
  },
  {
    exerciseKey: 'lin-row',
    sessionKey: 'pull-day',
    catalogKey: 'Bent_Over_Barbell_Row',
    name: 'Bent Over Barbell Row',
    role: 'main',
    targetSets: 3,
    targetReps: 8,
    barProfile: 'olympic',
    base: 40,
    step: 2.5,
  },
  {
    exerciseKey: 'lin-curl',
    sessionKey: 'pull-day',
    catalogKey: 'Barbell_Curl',
    name: 'Barbell Curl',
    role: 'accessory',
    targetSets: 3,
    targetReps: 10,
    // The EZ bar weighs 8 kg, so a 20 kg total cannot be composed — the base
    // is the first real combination above it.
    barProfile: 'ez',
    base: 20.5,
    step: 2.5,
  },
  {
    exerciseKey: 'lin-squat',
    sessionKey: 'leg-day',
    catalogKey: 'Barbell_Full_Squat',
    name: 'Barbell Full Squat',
    role: 'main',
    targetSets: 3,
    targetReps: 5,
    barProfile: 'olympic',
    base: 80,
    step: 2.5,
  },
  {
    exerciseKey: 'lin-leg-curl',
    sessionKey: 'leg-day',
    catalogKey: 'Lying_Leg_Curls',
    name: 'Lying Leg Curls',
    role: 'accessory',
    targetSets: 3,
    targetReps: 10,
    barProfile: null,
    base: 25,
    step: 2.5,
  },
  {
    exerciseKey: 'lin-calf',
    sessionKey: 'leg-day',
    catalogKey: 'Standing_Calf_Raises',
    name: 'Standing Calf Raises',
    role: 'accessory',
    targetSets: 3,
    targetReps: 12,
    barProfile: null,
    base: 30,
    step: 2.5,
  },
];

interface LinearProposal {
  cycle: number;
  exerciseKey: string;
  current: number;
  proposed: number;
  status: Exclude<DemoProposalStatus, 'pending'>;
}

/**
 * The resolved linear reviews. The bench missed its first week in both
 * cycles (the linear engine reads the first week's sets), so it was held in
 * cycle 1 and held again in cycle 2 — the consecutive hold that derives the
 * seed's linear advisory. Everything else met and advanced +2.5.
 */
const LINEAR_PROPOSALS: readonly LinearProposal[] = [
  { cycle: 1, exerciseKey: 'lin-bench', current: 60, proposed: 60, status: 'held' },
  { cycle: 1, exerciseKey: 'lin-db-bench', current: 20, proposed: 22.5, status: 'accepted' },
  { cycle: 1, exerciseKey: 'lin-triceps', current: 25, proposed: 27.5, status: 'accepted' },
  { cycle: 1, exerciseKey: 'lin-row', current: 40, proposed: 42.5, status: 'accepted' },
  { cycle: 1, exerciseKey: 'lin-curl', current: 20.5, proposed: 23, status: 'accepted' },
  { cycle: 1, exerciseKey: 'lin-squat', current: 80, proposed: 82.5, status: 'accepted' },
  { cycle: 1, exerciseKey: 'lin-leg-curl', current: 25, proposed: 27.5, status: 'accepted' },
  { cycle: 1, exerciseKey: 'lin-calf', current: 30, proposed: 32.5, status: 'accepted' },
  { cycle: 2, exerciseKey: 'lin-bench', current: 60, proposed: 60, status: 'held' },
  { cycle: 2, exerciseKey: 'lin-db-bench', current: 22.5, proposed: 25, status: 'accepted' },
  { cycle: 2, exerciseKey: 'lin-triceps', current: 27.5, proposed: 30, status: 'accepted' },
  { cycle: 2, exerciseKey: 'lin-row', current: 42.5, proposed: 45, status: 'accepted' },
  { cycle: 2, exerciseKey: 'lin-curl', current: 23, proposed: 25.5, status: 'accepted' },
  { cycle: 2, exerciseKey: 'lin-squat', current: 82.5, proposed: 85, status: 'accepted' },
  { cycle: 2, exerciseKey: 'lin-leg-curl', current: 27.5, proposed: 30, status: 'accepted' },
  { cycle: 2, exerciseKey: 'lin-calf', current: 32.5, proposed: 35, status: 'accepted' },
];

const linearProposalReason = (proposal: LinearProposal): string => {
  if (proposal.status === 'held') {
    return 'Missed the last set (4 of 5 reps).';
  }
  return 'Hit every target set and rep.';
};

const linearStartOfCycle = (cycle: number): number =>
  epoch('2025-12-01') + (cycle - 1) * 28 * DAY_SECONDS;

const linearSessionResults = (
  cycle: number,
  week: number,
  sessionKey: string,
): Record<string, DemoSet[]> => {
  const results: Record<string, DemoSet[]> = {};
  for (const exercise of LINEAR_EXERCISES) {
    if (exercise.sessionKey !== sessionKey) {
      continue;
    }
    const weight = exercise.base + exercise.step * (cycle - 1);
    const sets = Array.from({ length: exercise.targetSets }, () => ({
      weight,
      reps: exercise.targetReps,
    }));
    if (exercise.exerciseKey === 'lin-bench' && week === 1) {
      sets[sets.length - 1] = { weight, reps: 4 };
    }
    results[exercise.exerciseKey] = sets;
  }
  return results;
};

const linearLastSessionOfCycle = (cycle: number): number => {
  const start = linearStartOfCycle(cycle);
  return nominalSessionStamp(start, 4, 5);
};

const buildLinearRows = (): DemoRoutineRows => {
  const cycles: DemoCycleRow[] = [];
  const cycleWeeks: DemoCycleWeekRow[] = [];
  const weekSessions: DemoWeekSessionRow[] = [];
  const proposals: DemoProposalRow[] = [];

  for (let cycle = 1; cycle <= LINEAR_CYCLES; cycle += 1) {
    const cycleKey = `linear-c${cycle}`;
    cycles.push({
      cycleKey,
      cycleNumber: cycle,
      weeks: 4,
      status: 'complete',
      currentWeek: 4,
      startedAt: linearStartOfCycle(cycle),
      completedAt: linearLastSessionOfCycle(cycle),
    });
    for (let week = 1; week <= 4; week += 1) {
      cycleWeeks.push({ cycleKey, weekNumber: week });
      const start = linearStartOfCycle(cycle);
      for (const session of LINEAR_SESSIONS) {
        weekSessions.push({
          cycleKey,
          weekNumber: week,
          sessionKey: session.sessionKey,
          status: 'completed',
          date: nominalSessionStamp(start, week, session.weekday),
          results: linearSessionResults(cycle, week, session.sessionKey),
        });
      }
    }
  }

  for (const proposal of LINEAR_PROPOSALS) {
    proposals.push({
      cycleKey: `linear-c${proposal.cycle}`,
      sessionExerciseKey: proposal.exerciseKey,
      currentTarget: proposal.current,
      proposedTarget: proposal.proposed,
      unit: 'kg',
      reason: linearProposalReason(proposal),
      status: proposal.status,
    });
  }

  const exercises: DemoSessionExerciseRow[] = LINEAR_EXERCISES.map((exercise, index) => ({
    exerciseKey: exercise.exerciseKey,
    sessionKey: exercise.sessionKey,
    catalogKey: exercise.catalogKey,
    name: exercise.name,
    role: exercise.role,
    targetSets: exercise.targetSets,
    targetReps: exercise.targetReps,
    loadSource: 'absolute',
    absoluteWeight: exercise.base + exercise.step,
    trainingMaxWeight: null,
    trainingMaxPct: null,
    unitOverride: null,
    isAmrap: false,
    sortOrder: index + 1,
    barProfile: exercise.barProfile,
    barWeight: null,
  }));

  return {
    routine: {
      routineKey: DEMO_LINEAR_ROUTINE_KEY,
      name: DEMO_LINEAR_NAME,
      origin: 'user',
      progressionRule: 'linear',
      unit: 'kg',
      roundingIncrement: ROUNDING,
      restMainSeconds: 180,
      restAccessorySeconds: 90,
      isActive: false,
      createdAt: epoch('2025-11-24'),
    },
    sessions: [...LINEAR_SESSIONS],
    exercises,
    cycles,
    cycleWeeks,
    weekSessions,
    proposals,
  };
};

// --- The free-logging session ----------------------------------------------

const FREE_LOG: DemoFreeLogRow = {
  workoutName: DEMO_FREE_LOG_NAME,
  dayName: DEMO_FREE_LOG_NAME,
  workoutDate: epoch('2026-06-20'),
  exercises: [
    {
      name: 'Hack Squat',
      unit: 'kg',
      sets: [
        { weight: 60, reps: 10 },
        { weight: 60, reps: 10 },
        { weight: 60, reps: 10 },
      ],
    },
    {
      name: 'Cable Crossover',
      unit: 'kg',
      sets: [
        { weight: 20, reps: 12 },
        { weight: 20, reps: 12 },
        { weight: 20, reps: 12 },
      ],
    },
  ],
};

export function buildDemoRows(): DemoRows {
  return {
    routines: [buildWaveRows(), buildLinearRows()],
    freeLog: FREE_LOG,
  };
}

/** Inclusive epoch range covering every demo log date — the removal window. */
export function demoLogDateRange(): [number, number] {
  const rows = buildDemoRows();
  const dates: number[] = [];
  for (const routine of rows.routines) {
    for (const session of routine.weekSessions) {
      if (session.status !== 'pending') {
        dates.push(session.date);
      }
    }
  }
  if (rows.freeLog !== null) {
    dates.push(rows.freeLog.workoutDate);
  }
  return [Math.min(...dates), Math.max(...dates)];
}

/**
 * §3.9 timing for one set of one session: the session starts at 18:00 on its
 * day, one set every five minutes, each lasting ninety seconds — monotonic
 * and plausible enough for the time-per-exercise and session-duration views.
 * Epoch milliseconds, matching the runner's write path.
 */
export function setTimestamps(
  dayStamp: number,
  setOrdinal: number,
): { startedAt: number | null; completedAt: number | null } {
  const started = (dayStamp + 18 * 3600 + setOrdinal * 300) * 1000;
  return { startedAt: started, completedAt: started + 90 * 1000 };
}

export interface DemoDatabase {
  run(sql: string, params?: readonly unknown[]): Promise<unknown> | unknown;
  get(
    sql: string,
    params?: readonly unknown[],
  ): Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;
}

const run = async (db: DemoDatabase, sql: string, params: readonly unknown[] = []): Promise<void> => {
  await db.run(sql, params);
};

const idOf = async (
  db: DemoDatabase,
  sql: string,
  params: readonly unknown[],
): Promise<number> => {
  const row = await db.get(sql, params);
  if (!row) {
    throw new Error(`Expected a row for ${sql}`);
  }
  return Number(row.id);
};

const unitOf = (exercise: DemoSessionExerciseRow, routineUnit: DemoWeightUnit): DemoWeightUnit =>
  exercise.unitOverride ?? routineUnit;

async function insertRoutineRows(db: DemoDatabase, rows: DemoRoutineRows): Promise<void> {
  const existing = await db.get('SELECT routine_id FROM Routines WHERE routine_key = ?;', [
    rows.routine.routineKey,
  ]);
  if (existing) {
    return;
  }

  if (rows.routine.isActive) {
    await run(db, 'UPDATE Routines SET is_active = 0 WHERE is_active = 1;');
  }
  await run(
    db,
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
  const routineId = await idOf(
    db,
    'SELECT routine_id AS id FROM Routines WHERE routine_key = ?;',
    [rows.routine.routineKey],
  );

  const sessionIds = new Map<string, number>();
  for (const session of rows.sessions) {
    await run(db, `INSERT INTO Sessions (routine_id, weekday, name, sort_order) VALUES (?, ?, ?, ?);`, [
      routineId,
      session.weekday,
      session.name,
      session.sortOrder,
    ]);
    const sessionId = await idOf(
      db,
      'SELECT session_id AS id FROM Sessions WHERE routine_id = ? AND weekday = ?;',
      [routineId, session.weekday],
    );
    sessionIds.set(session.sessionKey, sessionId);
  }

  const exerciseIds = new Map<string, number>();
  for (const exercise of rows.exercises) {
    const sessionId = sessionIds.get(exercise.sessionKey);
    if (!sessionId) {
      throw new Error(`Demo exercise references unknown session ${exercise.sessionKey}`);
    }
    await run(
      db,
      `INSERT INTO SessionExercises
         (session_id, catalog_exercise_id, exercise_name, role, target_sets, target_reps,
          load_source, training_max_pct, training_max_weight, absolute_weight, unit_override,
          is_amrap, sort_order, bar_profile, bar_weight)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        sessionId,
        exercise.catalogKey,
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
      ],
    );
    const exerciseId = await idOf(
      db,
      `SELECT session_exercise_id AS id FROM SessionExercises
       WHERE session_id = ? AND sort_order = ?;`,
      [sessionId, exercise.sortOrder],
    );
    exerciseIds.set(exercise.exerciseKey, exerciseId);
  }

  const cycleIds = new Map<string, number>();
  for (const cycle of rows.cycles) {
    await run(
      db,
      `INSERT INTO Cycles
         (routine_id, cycle_number, weeks, status, current_week, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [
        routineId,
        cycle.cycleNumber,
        cycle.weeks,
        cycle.status,
        cycle.currentWeek,
        cycle.startedAt,
        cycle.completedAt,
      ],
    );
    const cycleId = await idOf(
      db,
      'SELECT cycle_id AS id FROM Cycles WHERE routine_id = ? AND cycle_number = ?;',
      [routineId, cycle.cycleNumber],
    );
    cycleIds.set(cycle.cycleKey, cycleId);
  }

  const weekIds = new Map<string, number>();
  for (const week of rows.cycleWeeks) {
    const cycleId = cycleIds.get(week.cycleKey);
    if (!cycleId) {
      throw new Error(`Demo week references unknown cycle ${week.cycleKey}`);
    }
    await run(db, `INSERT INTO CycleWeeks (cycle_id, week_number) VALUES (?, ?);`, [
      cycleId,
      week.weekNumber,
    ]);
    const weekId = await idOf(
      db,
      'SELECT cycle_week_id AS id FROM CycleWeeks WHERE cycle_id = ? AND week_number = ?;',
      [cycleId, week.weekNumber],
    );
    weekIds.set(`${week.cycleKey}:${week.weekNumber}`, weekId);
  }

  const exerciseByKey = new Map(rows.exercises.map((exercise) => [exercise.exerciseKey, exercise]));
  for (const weekSession of rows.weekSessions) {
    const weekId = weekIds.get(`${weekSession.cycleKey}:${weekSession.weekNumber}`);
    const sessionId = sessionIds.get(weekSession.sessionKey);
    if (!weekId || !sessionId) {
      throw new Error(
        `Demo week session references unknown plan row (${weekSession.cycleKey} ` +
          `${weekSession.weekNumber} ${weekSession.sessionKey})`,
      );
    }

    let completedLogId: number | null = null;
    if (weekSession.status === 'completed' || weekSession.status === 'moved') {
      const session = rows.sessions.find((entry) => entry.sessionKey === weekSession.sessionKey);
      if (!session) {
        throw new Error(`Demo log references unknown session ${weekSession.sessionKey}`);
      }
      await run(db, `INSERT INTO Workout_Log (workout_name, day_name, workout_date) VALUES (?, ?, ?);`, [
        rows.routine.name,
        session.name,
        weekSession.date,
      ]);
      completedLogId = await idOf(
        db,
        `SELECT workout_log_id AS id FROM Workout_Log
         WHERE workout_name = ? AND day_name = ? AND workout_date = ?;`,
        [rows.routine.name, session.name, weekSession.date],
      );

      let setOrdinal = 0;
      for (const [exerciseKey, sets] of Object.entries(weekSession.results)) {
        const exercise = exerciseByKey.get(exerciseKey);
        const exerciseId = exerciseIds.get(exerciseKey);
        if (!exercise || !exerciseId) {
          throw new Error(`Demo log references unknown exercise ${exerciseKey}`);
        }
        await run(
          db,
          `INSERT INTO Logged_Exercises (workout_log_id, exercise_name, sets, reps)
           VALUES (?, ?, ?, ?);`,
          [completedLogId, exercise.name, exercise.targetSets, exercise.targetReps],
        );
        const loggedExerciseId = await idOf(
          db,
          `SELECT logged_exercise_id AS id FROM Logged_Exercises
           WHERE workout_log_id = ? AND exercise_name = ?;`,
          [completedLogId, exercise.name],
        );

        const unit = unitOf(exercise, rows.routine.unit);
        for (const [index, set] of sets.entries()) {
          const timing = setTimestamps(weekSession.date, setOrdinal);
          await run(
            db,
            `INSERT INTO Weight_Log
               (workout_log_id, logged_exercise_id, exercise_name, set_number,
                weight_logged, reps_logged, unit, started_at, completed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
              completedLogId,
              loggedExerciseId,
              exercise.name,
              index + 1,
              set.weight,
              set.reps,
              unit,
              timing.startedAt,
              timing.completedAt,
            ],
          );
          setOrdinal += 1;
        }
      }
    }

    await run(
      db,
      `INSERT INTO WeekSessions
         (cycle_week_id, session_id, status, resolved_on_date, completed_log_id)
       VALUES (?, ?, ?, ?, ?);`,
      [
        weekId,
        sessionId,
        weekSession.status,
        weekSession.status === 'pending' ? null : weekSession.date,
        completedLogId,
      ],
    );
  }

  for (const proposal of rows.proposals) {
    const cycleId = cycleIds.get(proposal.cycleKey);
    const exerciseId = exerciseIds.get(proposal.sessionExerciseKey);
    const exercise = exerciseByKey.get(proposal.sessionExerciseKey);
    if (!cycleId || !exerciseId || !exercise) {
      throw new Error(`Demo proposal references unknown row ${proposal.cycleKey} ${proposal.sessionExerciseKey}`);
    }
    const cycle = rows.cycles.find((entry) => entry.cycleKey === proposal.cycleKey);
    await run(
      db,
      `INSERT INTO Progression_Proposal
         (routine_id, cycle_id, session_exercise_id, catalog_exercise_id, exercise_name,
          current_target, proposed_target, unit, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        routineId,
        cycleId,
        exerciseId,
        exercise.catalogKey,
        exercise.name,
        proposal.currentTarget,
        proposal.proposedTarget,
        proposal.unit,
        proposal.reason,
        proposal.status,
        cycle?.completedAt ?? rows.cycles[0].completedAt,
      ],
    );
  }
}

async function insertFreeLog(db: DemoDatabase, freeLog: DemoFreeLogRow): Promise<void> {
  const existing = await db.get(
    'SELECT workout_log_id FROM Workout_Log WHERE workout_name = ? AND workout_date = ?;',
    [freeLog.workoutName, freeLog.workoutDate],
  );
  if (existing) {
    return;
  }

  await run(db, `INSERT INTO Workout_Log (workout_name, day_name, workout_date) VALUES (?, ?, ?);`, [
    freeLog.workoutName,
    freeLog.dayName,
    freeLog.workoutDate,
  ]);
  const workoutLogId = await idOf(
    db,
    'SELECT workout_log_id AS id FROM Workout_Log WHERE workout_name = ? AND workout_date = ?;',
    [freeLog.workoutName, freeLog.workoutDate],
  );

  let setOrdinal = 0;
  for (const exercise of freeLog.exercises) {
    await run(
      db,
      `INSERT INTO Logged_Exercises (workout_log_id, exercise_name, sets, reps)
       VALUES (?, ?, ?, ?);`,
      [workoutLogId, exercise.name, exercise.sets.length, exercise.sets[exercise.sets.length - 1].reps],
    );
    const loggedExerciseId = await idOf(
      db,
      `SELECT logged_exercise_id AS id FROM Logged_Exercises
       WHERE workout_log_id = ? AND exercise_name = ?;`,
      [workoutLogId, exercise.name],
    );
    for (const set of exercise.sets) {
      const timing = setTimestamps(freeLog.workoutDate, setOrdinal);
      await run(
        db,
        `INSERT INTO Weight_Log
           (workout_log_id, logged_exercise_id, exercise_name, set_number,
            weight_logged, reps_logged, unit, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          workoutLogId,
          loggedExerciseId,
          exercise.name,
          exercise.sets.indexOf(set) + 1,
          set.weight,
          set.reps,
          exercise.unit,
          timing.startedAt,
          timing.completedAt,
        ],
      );
      setOrdinal += 1;
    }
  }
}

export async function loadDemoData(db: DemoDatabase): Promise<void> {
  const rows = buildDemoRows();
  const keys = rows.routines.map((routine) => routine.routine.routineKey);
  const placeholders = keys.map(() => '?').join(', ');
  const present = await db.get(
    `SELECT COUNT(*) AS n FROM Routines WHERE routine_key IN (${placeholders});`,
    keys,
  );
  if (present !== undefined && Number(present.n) === keys.length) {
    return;
  }

  await run(db, 'BEGIN;');
  try {
    for (const routine of rows.routines) {
      await insertRoutineRows(db, routine);
    }
    if (rows.freeLog !== null) {
      await insertFreeLog(db, rows.freeLog);
    }
    await run(db, 'COMMIT;');
  } catch (error) {
    await run(db, 'ROLLBACK;');
    throw error;
  }
}

export async function removeDemoData(db: DemoDatabase): Promise<void> {
  const rows = buildDemoRows();
  const [minDate, maxDate] = demoLogDateRange();
  const logNames = rows.routines.map((routine) => routine.routine.name);
  if (rows.freeLog !== null) {
    logNames.push(rows.freeLog.workoutName);
  }
  const placeholders = logNames.map(() => '?').join(', ');

  await run(
    db,
    `DELETE FROM Weight_Log
     WHERE workout_log_id IN (
       SELECT workout_log_id FROM Workout_Log
       WHERE workout_name IN (${placeholders}) AND workout_date BETWEEN ? AND ?
     );`,
    [...logNames, minDate, maxDate],
  );
  await run(
    db,
    `DELETE FROM Logged_Exercises
     WHERE workout_log_id IN (
       SELECT workout_log_id FROM Workout_Log
       WHERE workout_name IN (${placeholders}) AND workout_date BETWEEN ? AND ?
     );`,
    [...logNames, minDate, maxDate],
  );
  await run(
    db,
    `DELETE FROM Workout_Log
     WHERE workout_name IN (${placeholders}) AND workout_date BETWEEN ? AND ?;`,
    [...logNames, minDate, maxDate],
  );
  const routineKeys = rows.routines.map((routine) => routine.routine.routineKey);
  const keyPlaceholders = routineKeys.map(() => '?').join(', ');
  await run(db, `DELETE FROM Routines WHERE routine_key IN (${keyPlaceholders});`, routineKeys);
}
