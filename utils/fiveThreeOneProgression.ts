import {
  suggestNextTM,
  type CyclePerformance,
  type LiftCategory,
  type WeightUnit,
} from './fiveThreeOne';

export type FiveThreeOneSuggestionStatus =
  | 'pending'
  | 'accepted'
  | 'edited'
  | 'declined';

export type FiveThreeOneSuggestionDecision = 'accept' | 'edit' | 'decline';

export type FiveThreeOneProgressionAdvisory =
  | 'no-amrap'
  | 'repeated-underperformance';

export interface FiveThreeOneProgressionLift {
  liftId: number;
  name: string;
  trainingMax: number;
  unit: WeightUnit;
  category: LiftCategory;
  upperIncrement: number;
  lowerIncrement: number;
}

export interface FiveThreeOneReviewAmrapResult {
  weekNumber: number;
  targetReps: number | null;
  actualReps: number;
  weight: number;
  estimated1RM: number;
}

export interface FiveThreeOneStoredSuggestion {
  suggestedTM: number | null;
  status: FiveThreeOneSuggestionStatus | null;
}

export interface FiveThreeOnePreparedSuggestion {
  liftId: number;
  liftName: string;
  unit: WeightUnit;
  currentTM: number;
  suggestedTM: number;
  increment: number | null;
  performance: CyclePerformance | 'no-amrap';
  missedTargets: number;
  reviewRequired: boolean;
  advisory: FiveThreeOneProgressionAdvisory | null;
  status: FiveThreeOneSuggestionStatus;
}

export interface FiveThreeOneSuggestionDecisionInput {
  currentTM: number;
  suggestedTM: number;
  decision: FiveThreeOneSuggestionDecision;
  editedTM?: number | null;
}

export interface FiveThreeOneSuggestionDecisionResult {
  trainingMax: number;
  suggestedTM: number;
  status: Exclude<FiveThreeOneSuggestionStatus, 'pending'>;
}

export interface FiveThreeOnePersistedSuggestion {
  suggestedTM: number | null;
  status: FiveThreeOneSuggestionStatus | null;
}

const assertPositiveNumber = (value: number, message: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(message);
  }
};

const assertPositiveInteger = (value: number, message: string): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(message);
  }
};

const assertReviewResult = (result: FiveThreeOneReviewAmrapResult): void => {
  if (!Number.isInteger(result.weekNumber) || result.weekNumber < 1 || result.weekNumber > 4) {
    throw new Error('AMRAP week must be between 1 and 4.');
  }
  if (
    result.targetReps !== null &&
    (!Number.isInteger(result.targetReps) || result.targetReps <= 0)
  ) {
    throw new Error('AMRAP target reps must be a positive integer or null.');
  }
  if (!Number.isInteger(result.actualReps) || result.actualReps < 0) {
    throw new Error('AMRAP actual reps must be a non-negative integer.');
  }
  if (!Number.isFinite(result.weight) || result.weight < 0) {
    throw new Error('AMRAP weight must be a finite non-negative number.');
  }
  if (!Number.isFinite(result.estimated1RM) || result.estimated1RM < 0) {
    throw new Error('AMRAP estimated 1RM must be a finite non-negative number.');
  }
};

const assertProgressionLift = (lift: FiveThreeOneProgressionLift): void => {
  assertPositiveInteger(lift.liftId, 'Lift ID must be a positive integer.');
  assertPositiveNumber(lift.trainingMax, 'Training max must be a finite number greater than zero.');
  assertPositiveNumber(lift.upperIncrement, 'Upper TM increment must be greater than zero.');
  assertPositiveNumber(lift.lowerIncrement, 'Lower TM increment must be greater than zero.');
};

const isResolvedStatus = (
  status: FiveThreeOneSuggestionStatus | null,
): status is Exclude<FiveThreeOneSuggestionStatus, 'pending'> =>
  status === 'accepted' || status === 'edited' || status === 'declined';

export const prepareFiveThreeOneSuggestion = (
  lift: FiveThreeOneProgressionLift,
  results: readonly FiveThreeOneReviewAmrapResult[],
  storedSuggestion: FiveThreeOneStoredSuggestion,
): FiveThreeOnePreparedSuggestion => {
  assertProgressionLift(lift);
  if (!Array.isArray(results)) {
    throw new Error('AMRAP results must be an array.');
  }
  results.forEach(assertReviewResult);

  const usableResults = results.filter(
    (result): result is FiveThreeOneReviewAmrapResult & { targetReps: number } =>
      result.targetReps !== null,
  );

  let prepared: Omit<FiveThreeOnePreparedSuggestion, 'status'>;
  if (usableResults.length === 0) {
    prepared = {
      liftId: lift.liftId,
      liftName: lift.name,
      unit: lift.unit,
      currentTM: lift.trainingMax,
      suggestedTM: lift.trainingMax,
      increment: null,
      performance: 'no-amrap',
      missedTargets: 0,
      reviewRequired: false,
      advisory: 'no-amrap',
    };
  } else {
    const suggestion = suggestNextTM(
      {
        name: lift.name,
        trainingMax: lift.trainingMax,
        unit: lift.unit,
        category: lift.category,
      },
      usableResults.map((result) => ({
        targetReps: result.targetReps,
        actualReps: result.actualReps,
      })),
      {
        upperIncrement: lift.upperIncrement,
        lowerIncrement: lift.lowerIncrement,
      },
    );
    prepared = {
      liftId: lift.liftId,
      liftName: suggestion.liftName,
      unit: suggestion.unit,
      currentTM: suggestion.currentTM,
      suggestedTM: suggestion.suggestedTM,
      increment: suggestion.increment,
      performance: suggestion.performance,
      missedTargets: suggestion.missedTargets,
      reviewRequired: suggestion.reviewRequired,
      advisory: suggestion.reviewRequired ? 'repeated-underperformance' : null,
    };
  }

  if (isResolvedStatus(storedSuggestion.status)) {
    const resolvedSuggestedTM = storedSuggestion.suggestedTM;
    if (resolvedSuggestedTM === null) {
      throw new Error('A resolved suggestion must have a positive training max.');
    }
    assertPositiveNumber(resolvedSuggestedTM, 'A resolved suggestion must have a positive training max.');
    return {
      ...prepared,
      suggestedTM: resolvedSuggestedTM,
      status: storedSuggestion.status,
    };
  }

  return { ...prepared, status: 'pending' };
};

export const decideFiveThreeOneSuggestion = ({
  currentTM,
  suggestedTM,
  decision,
  editedTM,
}: FiveThreeOneSuggestionDecisionInput): FiveThreeOneSuggestionDecisionResult => {
  assertPositiveNumber(currentTM, 'Training max must be a finite number greater than zero.');
  assertPositiveNumber(suggestedTM, 'Suggested training max must be a finite number greater than zero.');

  switch (decision) {
    case 'accept':
      return { trainingMax: suggestedTM, suggestedTM, status: 'accepted' };
    case 'edit':
      if (editedTM === null || editedTM === undefined) {
        throw new Error('Edited training max must be a finite number greater than zero.');
      }
      assertPositiveNumber(editedTM, 'Edited training max must be a finite number greater than zero.');
      return { trainingMax: editedTM, suggestedTM: editedTM, status: 'edited' };
    case 'decline':
      return { trainingMax: currentTM, suggestedTM, status: 'declined' };
    default:
      throw new Error('Suggestion decision must be accept, edit, or decline.');
  }
};

export const hasUnresolvedFiveThreeOneSuggestions = (
  suggestions: readonly FiveThreeOnePersistedSuggestion[],
): boolean =>
  suggestions.some(
    (suggestion) =>
      !isResolvedStatus(suggestion.status) ||
      suggestion.suggestedTM === null ||
      !Number.isFinite(suggestion.suggestedTM) ||
      suggestion.suggestedTM <= 0,
  );

export const canGenerateFiveThreeOneNextCycle = (
  suggestions: readonly FiveThreeOnePersistedSuggestion[],
): boolean => suggestions.length > 0 && !hasUnresolvedFiveThreeOneSuggestions(suggestions);
