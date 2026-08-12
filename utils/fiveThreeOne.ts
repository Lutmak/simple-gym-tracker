export type RoundingDirection = 'up' | 'down' | 'nearest';

const normalizeWeight = (weight: number): number =>
  Number(weight.toFixed(10));

export const calcSetWeight = (
  tm: number,
  percent: number,
  increment: number,
  direction: RoundingDirection,
): number => {
  if (!Number.isFinite(tm) || tm <= 0) {
    throw new Error('Training max must be a finite number greater than zero.');
  }
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
    throw new Error('Percent must be a finite number between zero and 100.');
  }
  if (!Number.isFinite(increment) || increment <= 0) {
    throw new Error('Increment must be a finite number greater than zero.');
  }

  const rawWeight = (tm * percent) / 100;
  const incrementCount = rawWeight / increment;
  let roundedCount: number;

  switch (direction) {
    case 'up':
      roundedCount = Math.ceil(incrementCount);
      break;
    case 'down':
      roundedCount = Math.floor(incrementCount);
      break;
    case 'nearest':
      roundedCount = Math.round(incrementCount);
      break;
    default:
      throw new Error('Rounding direction must be up, down, or nearest.');
  }

  return normalizeWeight(roundedCount * increment);
};

export const estimate1RM = (weight: number, reps: number): number => {
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error('Weight must be a finite number greater than zero.');
  }
  if (!Number.isInteger(reps) || reps <= 0) {
    throw new Error('Reps must be a positive integer.');
  }

  return weight * (1 + reps / 30);
};

export type TrainingWeek = 1 | 2 | 3 | 4;

export interface WaveSet {
  percent: number;
  targetReps: number;
  isAmrap: boolean;
}

export interface WeekWave {
  week: TrainingWeek;
  isDeload: boolean;
  sets: WaveSet[];
}

const WAVE_TABLE: Record<TrainingWeek, readonly WaveSet[]> = {
  1: [
    { percent: 65, targetReps: 5, isAmrap: false },
    { percent: 75, targetReps: 5, isAmrap: false },
    { percent: 85, targetReps: 5, isAmrap: true },
  ],
  2: [
    { percent: 70, targetReps: 3, isAmrap: false },
    { percent: 80, targetReps: 3, isAmrap: false },
    { percent: 90, targetReps: 3, isAmrap: true },
  ],
  3: [
    { percent: 75, targetReps: 5, isAmrap: false },
    { percent: 85, targetReps: 3, isAmrap: false },
    { percent: 95, targetReps: 1, isAmrap: true },
  ],
  4: [
    { percent: 40, targetReps: 5, isAmrap: false },
    { percent: 50, targetReps: 5, isAmrap: false },
    { percent: 60, targetReps: 5, isAmrap: false },
  ],
};

export const waveForWeek = (week: number): WeekWave => {
  let validWeek: TrainingWeek;

  switch (week) {
    case 1:
    case 2:
    case 3:
    case 4:
      validWeek = week;
      break;
    default:
      throw new Error('Week must be 1, 2, 3, or 4 (deload).');
  }

  return {
    week: validWeek,
    isDeload: validWeek === 4,
    sets: WAVE_TABLE[validWeek].map((set) => ({ ...set })),
  };
};

export type WeightUnit = 'kg' | 'lb';

export interface WarmupOptions {
  increment?: number;
  direction?: RoundingDirection;
  unit?: WeightUnit;
}

export interface WarmupSet {
  percent: number;
  reps: number;
  weight: number;
  unit: WeightUnit;
}

function assertUnit(unit: string): asserts unit is WeightUnit {
  if (unit !== 'kg' && unit !== 'lb') {
    throw new Error('Unit must be kg or lb.');
  }
}

const defaultIncrementForUnit = (unit: WeightUnit): number =>
  unit === 'kg' ? 2.5 : 5;

export const warmupSets = (
  tm: number,
  options: WarmupOptions = {},
): WarmupSet[] => {
  const unit = options.unit ?? 'kg';
  assertUnit(unit);

  const increment = options.increment ?? defaultIncrementForUnit(unit);
  const direction = options.direction ?? 'nearest';
  const definitions = [
    { percent: 40, reps: 5 },
    { percent: 50, reps: 5 },
    { percent: 60, reps: 3 },
  ];

  return definitions.map((definition) => ({
    ...definition,
    weight: calcSetWeight(tm, definition.percent, increment, direction),
    unit,
  }));
};

export type LiftCategory = 'upper' | 'lower';

export interface FiveThreeOneLift {
  name: string;
  trainingMax: number;
  unit: WeightUnit;
  category: LiftCategory;
}

export interface CycleResult {
  targetReps: number;
  actualReps: number;
}

export interface TMProgressionOptions {
  upperIncrement?: number;
  lowerIncrement?: number;
}

export type CyclePerformance = 'met' | 'missed' | 'mixed';

export interface TMSuggestion {
  liftName: string;
  unit: WeightUnit;
  currentTM: number;
  suggestedTM: number;
  increment: number;
  performance: CyclePerformance;
  missedTargets: number;
  reviewRequired: boolean;
  note: string | null;
}

const REPEATED_UNDERPERFORMANCE_NOTE =
  'Repeated underperformance: consider reviewing or resetting this training max.';

export const suggestNextTM = (
  lift: FiveThreeOneLift,
  cycleResults: readonly CycleResult[],
  options: TMProgressionOptions = {},
): TMSuggestion => {
  if (lift.name.trim().length === 0) {
    throw new Error('Lift name must not be empty.');
  }
  if (!Number.isFinite(lift.trainingMax) || lift.trainingMax <= 0) {
    throw new Error('Training max must be a finite number greater than zero.');
  }
  assertUnit(lift.unit);
  if (lift.category !== 'upper' && lift.category !== 'lower') {
    throw new Error('Lift category must be upper or lower.');
  }
  if (!Array.isArray(cycleResults) || cycleResults.length === 0) {
    throw new Error('At least one cycle result is required.');
  }

  for (const result of cycleResults) {
    if (!Number.isInteger(result.targetReps) || result.targetReps <= 0) {
      throw new Error('Target reps must be a positive integer.');
    }
    if (!Number.isInteger(result.actualReps) || result.actualReps < 0) {
      throw new Error('Actual reps must be a non-negative integer.');
    }
  }

  const defaultIncrement =
    lift.unit === 'kg'
      ? lift.category === 'upper'
        ? 2.5
        : 5
      : lift.category === 'upper'
        ? 5
        : 10;
  const configuredIncrement =
    lift.category === 'upper' ? options.upperIncrement : options.lowerIncrement;
  const increment = configuredIncrement ?? defaultIncrement;

  if (!Number.isFinite(increment) || increment <= 0) {
    throw new Error('TM increment must be a finite number greater than zero.');
  }

  const missedTargets = cycleResults.filter(
    (result) => result.actualReps < result.targetReps,
  ).length;
  const performance: CyclePerformance =
    missedTargets === 0
      ? 'met'
      : missedTargets === cycleResults.length
        ? 'missed'
        : 'mixed';
  const reviewRequired = missedTargets >= 2;
  const suggestedTM =
    performance === 'met'
      ? Math.max(lift.trainingMax, lift.trainingMax + increment)
      : lift.trainingMax;

  return {
    liftName: lift.name,
    unit: lift.unit,
    currentTM: lift.trainingMax,
    suggestedTM,
    increment,
    performance,
    missedTargets,
    reviewRequired,
    note: reviewRequired ? REPEATED_UNDERPERFORMANCE_NOTE : null,
  };
};
