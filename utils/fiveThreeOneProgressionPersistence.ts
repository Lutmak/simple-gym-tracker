import type { FiveThreeOneDatabase } from './fiveThreeOneGenerationPersistence';
import {
  decideFiveThreeOneSuggestion,
  prepareFiveThreeOneSuggestion,
  type FiveThreeOnePreparedSuggestion,
  type FiveThreeOneProgressionLift,
  type FiveThreeOneReviewAmrapResult,
  type FiveThreeOneSuggestionDecision,
  type FiveThreeOneSuggestionDecisionResult,
  type FiveThreeOneSuggestionStatus,
} from './fiveThreeOneProgression';
import type { LiftCategory, WeightUnit } from './fiveThreeOne';

export interface FiveThreeOneCycleReview {
  programId: number;
  programName: string;
  unit: WeightUnit;
  cycleId: number;
  cycleNumber: number;
  includeDeload: boolean;
  lifts: FiveThreeOneReviewLift[];
}

export interface FiveThreeOneReviewLift {
  liftId: number;
  name: string;
  category: LiftCategory;
  currentTM: number;
  results: FiveThreeOneReviewAmrapResult[];
  suggestion: FiveThreeOnePreparedSuggestion;
}

export interface SaveFiveThreeOneSuggestionDecisionInput {
  programId: number;
  cycleId: number;
  liftId: number;
  decision: FiveThreeOneSuggestionDecision;
  editedTM?: number | null;
}

interface ReviewCycleRow {
  cycle_id: number;
  program_id: number;
  program_name: string;
  unit: WeightUnit;
  upper_tm_increment: number;
  lower_tm_increment: number;
  cycle_number: number;
  status: 'planned' | 'active' | 'complete';
  current_week: number;
  include_deload: number;
}

interface ReviewLiftRow {
  lift_id: number;
  lift_name: string;
  lift_type: LiftCategory;
  training_max: number;
  suggested_training_max: number | null;
  suggestion_status: FiveThreeOneSuggestionStatus | null;
}

interface ReviewAmrapRow {
  amrap_result_id: number;
  lift_id: number | null;
  week_number: number;
  target_reps: number | null;
  weight: number;
  reps: number;
  estimated_1rm: number;
}

interface DecisionLiftRow {
  training_max: number;
  suggested_training_max: number | null;
  suggestion_status: FiveThreeOneSuggestionStatus | null;
}

const assertPositiveId = (value: number, label: string): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
};

const booleanFromDatabase = (value: number, label: string): boolean => {
  if (value !== 0 && value !== 1) {
    throw new Error(`${label} must be 0 or 1.`);
  }
  return value === 1;
};

const completeCycleWhere = `
  c.status = 'complete'
  AND c.current_week = CASE WHEN c.include_deload = 1 THEN 4 ELSE 3 END
  AND NOT EXISTS (
    SELECT 1
    FROM FiveThreeOne_Cycles newer
    WHERE newer.program_id = c.program_id
      AND newer.cycle_number > c.cycle_number
  )`;

const reviewCycleQuery = `
  SELECT c.cycle_id, c.program_id, p.program_name, p.unit,
         p.upper_tm_increment, p.lower_tm_increment,
         c.cycle_number, c.status, c.current_week, c.include_deload
  FROM FiveThreeOne_Cycles c
  JOIN FiveThreeOne_Programs p ON p.program_id = c.program_id
  WHERE c.program_id = ? AND c.cycle_id = ?
    AND ${completeCycleWhere};`;

export async function loadFiveThreeOneCycleReview(
  db: FiveThreeOneDatabase,
  programId: number,
  cycleId: number,
): Promise<FiveThreeOneCycleReview> {
  assertPositiveId(programId, 'Program ID');
  assertPositiveId(cycleId, 'Cycle ID');

  let review: FiveThreeOneCycleReview | null = null;
  await db.withTransactionAsync(async () => {
    const cycle = await db.getFirstAsync<ReviewCycleRow>(reviewCycleQuery, [programId, cycleId]);
    if (!cycle) {
      throw new Error('The selected 5/3/1 cycle is not complete or is no longer current.');
    }

    const lifts = await db.getAllAsync<ReviewLiftRow>(
      `SELECT lift_id, lift_name, lift_type, training_max,
              suggested_training_max, suggestion_status
       FROM FiveThreeOne_Lifts
       WHERE program_id = ?
       ORDER BY day_slot;`,
      [programId],
    );
    if (lifts.length === 0) {
      throw new Error('The selected 5/3/1 program has no configured lifts.');
    }

    const amrapResults = await db.getAllAsync<ReviewAmrapRow>(
      `SELECT ar.amrap_result_id, ar.lift_id, ar.week_number,
              wl.target_reps, ar.weight, ar.reps, ar.estimated_1rm
       FROM FiveThreeOne_AmrapResults ar
       LEFT JOIN FiveThreeOne_WorkoutLink wl
         ON wl.workout_link_id = ar.workout_link_id
        AND wl.cycle_id = ar.cycle_id
        AND wl.lift_id = ar.lift_id
        AND wl.is_amrap = 1
       WHERE ar.program_id = ? AND ar.cycle_id = ?
       ORDER BY ar.lift_id, ar.week_number, ar.amrap_result_id;`,
      [programId, cycleId],
    );

    const resultsByLift = new Map<number, FiveThreeOneReviewAmrapResult[]>();
    for (const result of amrapResults) {
      if (result.lift_id === null) {
        continue;
      }
      const results = resultsByLift.get(result.lift_id) ?? [];
      results.push({
        weekNumber: result.week_number,
        targetReps: result.target_reps,
        actualReps: result.reps,
        weight: result.weight,
        estimated1RM: result.estimated_1rm,
      });
      resultsByLift.set(result.lift_id, results);
    }

    const reviewLifts = lifts.map((lift): FiveThreeOneReviewLift => {
      const progressionLift: FiveThreeOneProgressionLift = {
        liftId: lift.lift_id,
        name: lift.lift_name,
        category: lift.lift_type,
        trainingMax: lift.training_max,
        unit: cycle.unit,
        upperIncrement: cycle.upper_tm_increment,
        lowerIncrement: cycle.lower_tm_increment,
      };
      const suggestion = prepareFiveThreeOneSuggestion(
        progressionLift,
        resultsByLift.get(lift.lift_id) ?? [],
        {
          suggestedTM: lift.suggested_training_max,
          status: lift.suggestion_status,
        },
      );

      return {
        liftId: lift.lift_id,
        name: lift.lift_name,
        category: lift.lift_type,
        currentTM: lift.training_max,
        results: resultsByLift.get(lift.lift_id) ?? [],
        suggestion,
      };
    });

    for (const lift of reviewLifts) {
      if (lift.suggestion.status !== 'pending') {
        continue;
      }

      const persistedLift = lifts.find((candidate) => candidate.lift_id === lift.liftId);
      if (!persistedLift) {
        throw new Error(`Lift ${lift.liftId} was not found while preparing the review.`);
      }
      if (
        persistedLift.suggestion_status === 'pending' &&
        persistedLift.suggested_training_max === lift.suggestion.suggestedTM
      ) {
        continue;
      }

      await db.runAsync(
        `UPDATE FiveThreeOne_Lifts
         SET suggested_training_max = ?, suggestion_status = 'pending'
         WHERE program_id = ? AND lift_id = ?;`,
        [lift.suggestion.suggestedTM, programId, lift.liftId],
      );
    }

    review = {
      programId: cycle.program_id,
      programName: cycle.program_name,
      unit: cycle.unit,
      cycleId: cycle.cycle_id,
      cycleNumber: cycle.cycle_number,
      includeDeload: booleanFromDatabase(cycle.include_deload, 'Cycle deload setting'),
      lifts: reviewLifts,
    };
  });

  if (!review) {
    throw new Error('The 5/3/1 cycle review did not return a result.');
  }
  return review;
}

export async function saveFiveThreeOneSuggestionDecision(
  db: FiveThreeOneDatabase,
  input: SaveFiveThreeOneSuggestionDecisionInput,
): Promise<FiveThreeOneSuggestionDecisionResult> {
  assertPositiveId(input.programId, 'Program ID');
  assertPositiveId(input.cycleId, 'Cycle ID');
  assertPositiveId(input.liftId, 'Lift ID');

  let decisionResult: FiveThreeOneSuggestionDecisionResult | null = null;
  await db.withTransactionAsync(async () => {
    const lift = await db.getFirstAsync<DecisionLiftRow>(
      `SELECT l.training_max, l.suggested_training_max, l.suggestion_status
       FROM FiveThreeOne_Lifts l
       JOIN FiveThreeOne_Cycles c ON c.program_id = l.program_id
       WHERE l.program_id = ? AND l.lift_id = ? AND c.cycle_id = ?
         AND ${completeCycleWhere}
       LIMIT 1;`,
      [input.programId, input.liftId, input.cycleId],
    );
    if (!lift || lift.suggestion_status !== 'pending' || lift.suggested_training_max === null) {
      throw new Error('Prepare the completed cycle review before deciding this suggestion.');
    }

    decisionResult = decideFiveThreeOneSuggestion({
      currentTM: lift.training_max,
      suggestedTM: lift.suggested_training_max,
      decision: input.decision,
      editedTM: input.editedTM,
    });

    if (input.decision === 'decline') {
      await db.runAsync(
        `UPDATE FiveThreeOne_Lifts
         SET suggested_training_max = ?, suggestion_status = ?
         WHERE program_id = ? AND lift_id = ?;`,
        [
          decisionResult.suggestedTM,
          decisionResult.status,
          input.programId,
          input.liftId,
        ],
      );
      return;
    }

    await db.runAsync(
      `UPDATE FiveThreeOne_Lifts
       SET training_max = ?, suggested_training_max = ?, suggestion_status = ?
       WHERE program_id = ? AND lift_id = ?;`,
      [
        decisionResult.trainingMax,
        decisionResult.suggestedTM,
        decisionResult.status,
        input.programId,
        input.liftId,
      ],
    );
  });

  if (!decisionResult) {
    throw new Error('The 5/3/1 suggestion decision did not return a result.');
  }
  return decisionResult;
}
