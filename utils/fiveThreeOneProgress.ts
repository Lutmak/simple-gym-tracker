import type { FiveThreeOneDatabase } from './fiveThreeOneGenerationPersistence';
import type { WeightUnit } from './fiveThreeOne';

export interface FiveThreeOneProgressLift {
  liftId: number;
  name: string;
  trainingMax: number;
}

export interface FiveThreeOneProgressProgram {
  programId: number;
  name: string;
  unit: WeightUnit;
  lifts: FiveThreeOneProgressLift[];
}

export interface FiveThreeOneTrainingMaxSnapshot {
  cycleId: number;
  cycleNumber: number;
  trainingMax: number;
}

export interface FiveThreeOneAmrapProgressRow {
  amrapResultId: number;
  cycleId: number;
  cycleNumber: number;
  weekNumber: number;
  reps: number;
  estimated1RM: number;
  targetReps: number | null;
}

export interface FiveThreeOneProgressPoint {
  label: string;
  value: number;
}

export interface FiveThreeOneAmrapProgressPoint extends FiveThreeOneProgressPoint {
  cycleNumber: number;
  weekNumber: number;
  targetReps: number | null;
}

export interface FiveThreeOneProgressSeries {
  trainingMax: FiveThreeOneProgressPoint[];
  amrapReps: FiveThreeOneAmrapProgressPoint[];
  estimated1RM: FiveThreeOneProgressPoint[];
}

export interface FiveThreeOneLiftProgressSource {
  lift: FiveThreeOneProgressLift;
  trainingMaxSnapshots: FiveThreeOneTrainingMaxSnapshot[];
  amrapResults: FiveThreeOneAmrapProgressRow[];
}

interface ProgramRow {
  program_id: number;
  program_name: string;
  unit: string;
}

interface LiftRow {
  lift_id: number;
  lift_name: string;
  training_max: number;
}

interface TrainingMaxRow {
  cycle_id: number;
  cycle_number: number;
  training_max: number;
}

interface AmrapRow {
  amrap_result_id: number;
  cycle_id: number;
  cycle_number: number;
  week_number: number;
  reps: number;
  estimated_1rm: number;
  target_reps: number | null;
}

const assertPositiveId = (value: number, label: string): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
};

function assertWeightUnit(value: string): asserts value is WeightUnit {
  if (value !== 'kg' && value !== 'lb') {
    throw new Error('Program unit must be kg or lb.');
  }
}

const progressRowOrder = (
  left: Pick<FiveThreeOneAmrapProgressRow, 'cycleNumber' | 'weekNumber' | 'amrapResultId'>,
  right: Pick<FiveThreeOneAmrapProgressRow, 'cycleNumber' | 'weekNumber' | 'amrapResultId'>,
): number =>
  left.cycleNumber - right.cycleNumber ||
  left.weekNumber - right.weekNumber ||
  left.amrapResultId - right.amrapResultId;

export async function loadFiveThreeOneProgressProgram(
  db: FiveThreeOneDatabase,
  programId: number,
): Promise<FiveThreeOneProgressProgram> {
  assertPositiveId(programId, 'Program ID');

  const program = await db.getFirstAsync<ProgramRow>(
    `SELECT program_id, program_name, unit
     FROM FiveThreeOne_Programs
     WHERE program_id = ?;`,
    [programId],
  );
  if (!program) {
    throw new Error('The selected 5/3/1 program was not found.');
  }
  const unit = program.unit;
  assertWeightUnit(unit);

  const lifts = await db.getAllAsync<LiftRow>(
    `SELECT lift_id, lift_name, training_max
     FROM FiveThreeOne_Lifts
     WHERE program_id = ?
     ORDER BY day_slot;`,
    [programId],
  );

  return {
    programId: program.program_id,
    name: program.program_name,
    unit,
    lifts: lifts.map((lift) => ({
      liftId: lift.lift_id,
      name: lift.lift_name,
      trainingMax: lift.training_max,
    })),
  };
}

export async function loadFiveThreeOneLiftProgress(
  db: FiveThreeOneDatabase,
  programId: number,
  liftId: number,
): Promise<FiveThreeOneLiftProgressSource> {
  assertPositiveId(programId, 'Program ID');
  assertPositiveId(liftId, 'Lift ID');

  const lift = await db.getFirstAsync<LiftRow>(
    `SELECT l.lift_id, l.lift_name, l.training_max
     FROM FiveThreeOne_Lifts l
     WHERE l.program_id = ? AND l.lift_id = ?;`,
    [programId, liftId],
  );
  if (!lift) {
    throw new Error('The selected 5/3/1 lift was not found in this program.');
  }

  const trainingMaxRows = await db.getAllAsync<TrainingMaxRow>(
    `SELECT wl.cycle_id, c.cycle_number, wl.training_max
     FROM FiveThreeOne_WorkoutLink wl
     JOIN FiveThreeOne_Cycles c ON c.cycle_id = wl.cycle_id
     WHERE c.program_id = ? AND wl.lift_id = ? AND wl.is_warmup = 0
     ORDER BY c.cycle_number, wl.workout_link_id;`,
    [programId, liftId],
  );

  const amrapRows = await db.getAllAsync<AmrapRow>(
    `SELECT ar.amrap_result_id, ar.cycle_id, c.cycle_number, ar.week_number,
            ar.reps, ar.estimated_1rm, wl.target_reps
     FROM FiveThreeOne_AmrapResults ar
     JOIN FiveThreeOne_Cycles c
       ON c.cycle_id = ar.cycle_id
      AND c.program_id = ?
     LEFT JOIN FiveThreeOne_WorkoutLink wl
       ON wl.workout_link_id = ar.workout_link_id
      AND wl.cycle_id = ar.cycle_id
      AND wl.lift_id = ar.lift_id
      AND wl.is_amrap = 1
     WHERE ar.program_id = ? AND ar.lift_id = ?
     ORDER BY c.cycle_number, ar.week_number, ar.amrap_result_id;`,
    [programId, programId, liftId],
  );

  return {
    lift: {
      liftId: lift.lift_id,
      name: lift.lift_name,
      trainingMax: lift.training_max,
    },
    trainingMaxSnapshots: trainingMaxRows.map((row) => ({
      cycleId: row.cycle_id,
      cycleNumber: row.cycle_number,
      trainingMax: row.training_max,
    })),
    amrapResults: amrapRows.map((row) => ({
      amrapResultId: row.amrap_result_id,
      cycleId: row.cycle_id,
      cycleNumber: row.cycle_number,
      weekNumber: row.week_number,
      reps: row.reps,
      estimated1RM: row.estimated_1rm,
      targetReps: row.target_reps,
    })),
  };
}

export interface BuildFiveThreeOneProgressSeriesInput {
  currentTrainingMax: number;
  currentTrainingMaxLabel?: string;
  trainingMaxSnapshots: readonly FiveThreeOneTrainingMaxSnapshot[];
  amrapResults: readonly FiveThreeOneAmrapProgressRow[];
}

export const buildFiveThreeOneProgressSeries = ({
  currentTrainingMax,
  currentTrainingMaxLabel = 'Current',
  trainingMaxSnapshots,
  amrapResults,
}: BuildFiveThreeOneProgressSeriesInput): FiveThreeOneProgressSeries => {
  const snapshotsByCycle = new Map<number, FiveThreeOneTrainingMaxSnapshot>();
  for (const snapshot of trainingMaxSnapshots) {
    snapshotsByCycle.set(snapshot.cycleId, snapshot);
  }

  const orderedSnapshots = [...snapshotsByCycle.values()].sort(
    (left, right) => left.cycleNumber - right.cycleNumber || left.cycleId - right.cycleId,
  );
  const orderedAmrapResults = [...amrapResults].sort(progressRowOrder);

  return {
    trainingMax: [
      ...orderedSnapshots.map((snapshot) => ({
        label: `C${snapshot.cycleNumber}`,
        value: snapshot.trainingMax,
      })),
      { label: currentTrainingMaxLabel, value: currentTrainingMax },
    ],
    amrapReps: orderedAmrapResults.map((result) => ({
      label: `C${result.cycleNumber} W${result.weekNumber}`,
      value: result.reps,
      cycleNumber: result.cycleNumber,
      weekNumber: result.weekNumber,
      targetReps: result.targetReps,
    })),
    estimated1RM: orderedAmrapResults.map((result) => ({
      label: `C${result.cycleNumber} W${result.weekNumber}`,
      value: result.estimated1RM,
    })),
  };
};
