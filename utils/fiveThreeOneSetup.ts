import type { LiftCategory } from './fiveThreeOne';

export interface DefaultSetupLift {
  id: string;
  name: string;
  category: LiftCategory;
  daySlot: number;
}

export const DEFAULT_SETUP_LIFTS: readonly DefaultSetupLift[] = [
  { id: 'squat', name: 'Squat', category: 'lower', daySlot: 1 },
  { id: 'bench-press', name: 'Bench Press', category: 'upper', daySlot: 2 },
  { id: 'deadlift', name: 'Deadlift', category: 'lower', daySlot: 3 },
  { id: 'overhead-press', name: 'Overhead Press', category: 'upper', daySlot: 4 },
];

export function normalizeDaySlots<T extends { daySlot: number | null }>(
  lifts: readonly T[],
): T[] {
  const usedSlots = new Set<number>();
  let nextAvailableSlot = 1;

  return lifts.map((lift) => {
    let daySlot = lift.daySlot;

    if (
      daySlot === null ||
      !Number.isInteger(daySlot) ||
      daySlot <= 0 ||
      usedSlots.has(daySlot)
    ) {
      while (usedSlots.has(nextAvailableSlot)) {
        nextAvailableSlot += 1;
      }
      daySlot = nextAvailableSlot;
    }

    usedSlots.add(daySlot);
    while (usedSlots.has(nextAvailableSlot)) {
      nextAvailableSlot += 1;
    }

    return { ...lift, daySlot };
  });
}

export interface SetupLiftValidationInput {
  name: string;
  category: string;
  trainingMax: number | null;
  daySlot: number | null;
  assistanceTemplateId: number | null;
}

export interface SetupValidationInput {
  programName: string;
  unit: string;
  roundingIncrement: number | null;
  roundingDirection: string;
  tmPercentage: number;
  lifts: readonly SetupLiftValidationInput[];
}

export type SetupValidationIssue =
  | 'program-name-required'
  | 'unit-invalid'
  | 'rounding-increment-positive'
  | 'rounding-direction-invalid'
  | 'tm-percentage-invalid'
  | 'lift-required'
  | 'lift-name-required'
  | 'duplicate-lift-name'
  | 'lift-category-invalid'
  | 'training-max-positive'
  | 'day-slot-positive-integer'
  | 'duplicate-day-slot'
  | 'assistance-template-required';

export function validateSetup(
  input: SetupValidationInput,
): SetupValidationIssue | null {
  if (!input.programName.trim()) {
    return 'program-name-required';
  }

  if (input.unit !== 'kg' && input.unit !== 'lb') {
    return 'unit-invalid';
  }

  if (
    input.roundingIncrement === null ||
    !Number.isFinite(input.roundingIncrement) ||
    input.roundingIncrement <= 0
  ) {
    return 'rounding-increment-positive';
  }

  if (!['up', 'down', 'nearest'].includes(input.roundingDirection)) {
    return 'rounding-direction-invalid';
  }

  if (
    !Number.isFinite(input.tmPercentage) ||
    input.tmPercentage < 0.85 ||
    input.tmPercentage > 0.9
  ) {
    return 'tm-percentage-invalid';
  }

  if (input.lifts.length === 0) {
    return 'lift-required';
  }

  const liftNames = new Set<string>();
  const daySlots = new Set<number>();

  for (const lift of input.lifts) {
    const normalizedName = lift.name.trim().toLocaleLowerCase();
    if (!normalizedName) {
      return 'lift-name-required';
    }

    if (liftNames.has(normalizedName)) {
      return 'duplicate-lift-name';
    }
    liftNames.add(normalizedName);

    if (lift.category !== 'upper' && lift.category !== 'lower') {
      return 'lift-category-invalid';
    }

    if (
      lift.trainingMax === null ||
      !Number.isFinite(lift.trainingMax) ||
      lift.trainingMax <= 0
    ) {
      return 'training-max-positive';
    }

    if (
      lift.daySlot === null ||
      !Number.isInteger(lift.daySlot) ||
      lift.daySlot <= 0
    ) {
      return 'day-slot-positive-integer';
    }

    if (daySlots.has(lift.daySlot)) {
      return 'duplicate-day-slot';
    }
    daySlots.add(lift.daySlot);

    if (
      lift.assistanceTemplateId === null ||
      !Number.isInteger(lift.assistanceTemplateId) ||
      lift.assistanceTemplateId <= 0
    ) {
      return 'assistance-template-required';
    }
  }

  return null;
}
