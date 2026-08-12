export interface FiveThreeOneLinkForLogging {
  workoutLinkId: number;
  setNumber: number;
  workSetNumber: number | null;
  targetWeight: number;
  targetReps: number;
  isAmrap: boolean;
  isWarmup: boolean;
  warmupCompletedAt: number | null;
}

export interface FiveThreeOneSetDescription {
  workoutLinkId: number;
  displaySetNumber: number;
  databaseSetNumber: number | null;
  targetWeight: number;
  targetReps: number;
  isAmrap: boolean;
  isWarmup: boolean;
  warmupCompletedAt: number | null;
}

const assertPositiveInteger = (value: number, label: string): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
};

export const describeFiveThreeOneLink = (
  link: FiveThreeOneLinkForLogging,
): FiveThreeOneSetDescription => {
  assertPositiveInteger(link.workoutLinkId, 'Workout link ID');
  assertPositiveInteger(link.setNumber, 'Link set number');

  if (link.isWarmup) {
    if (link.workSetNumber !== null) {
      throw new Error('Warm-up links cannot have a work-set number.');
    }

    return {
      workoutLinkId: link.workoutLinkId,
      displaySetNumber: link.setNumber,
      databaseSetNumber: null,
      targetWeight: link.targetWeight,
      targetReps: link.targetReps,
      isAmrap: false,
      isWarmup: true,
      warmupCompletedAt: link.warmupCompletedAt,
    };
  }

  assertPositiveInteger(link.workSetNumber ?? 0, 'Work-set number');
  if (link.workSetNumber !== null && link.workSetNumber > 3) {
    throw new Error('Work-set number must be between 1 and 3.');
  }

  return {
    workoutLinkId: link.workoutLinkId,
    displaySetNumber: link.setNumber,
    databaseSetNumber: link.workSetNumber,
    targetWeight: link.targetWeight,
    targetReps: link.targetReps,
    isAmrap: link.isAmrap,
    isWarmup: false,
    warmupCompletedAt: null,
  };
};

export const isFiveThreeOneBelowTarget = (
  targetReps: number,
  actualReps: number | null,
): boolean => {
  if (!Number.isInteger(targetReps) || targetReps <= 0) {
    throw new Error('Target reps must be a positive integer.');
  }
  if (actualReps === null) {
    return false;
  }
  if (!Number.isInteger(actualReps) || actualReps <= 0) {
    throw new Error('Actual reps must be a positive integer.');
  }

  return actualReps < targetReps;
};

export const isFiveThreeOneAmrapPr = (
  estimated1rm: number,
  priorBestEstimated1rm: number | null,
): boolean => {
  if (!Number.isFinite(estimated1rm) || estimated1rm <= 0) {
    throw new Error('Estimated 1RM must be a finite number greater than zero.');
  }
  if (
    priorBestEstimated1rm !== null &&
    (!Number.isFinite(priorBestEstimated1rm) || priorBestEstimated1rm <= 0)
  ) {
    throw new Error('Prior best estimated 1RM must be null or greater than zero.');
  }

  return priorBestEstimated1rm === null || estimated1rm > priorBestEstimated1rm;
};
