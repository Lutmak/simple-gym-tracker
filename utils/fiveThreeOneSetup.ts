import type {
  LiftCategory,
  RoundingDirection,
  WeightUnit,
} from './fiveThreeOne';

/**
 * Weekdays use the `Date.getDay()` convention already used by the recurring-workout selector:
 * 0 = Sunday, 1 = Monday, ... 6 = Saturday.
 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type FirstWeekday = 'Sunday' | 'Monday';

const SUNDAY_FIRST: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];
const MONDAY_FIRST: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];

export const orderedWeekdays = (firstWeekday: FirstWeekday): readonly Weekday[] =>
  firstWeekday === 'Sunday' ? SUNDAY_FIRST : MONDAY_FIRST;

export const isWeekday = (value: number): value is Weekday =>
  Number.isInteger(value) && value >= 0 && value <= 6;

export interface ScheduledOnWeekday {
  weekday: number;
}

export function orderByWeek<T extends ScheduledOnWeekday>(
  days: readonly T[],
  firstWeekday: FirstWeekday,
): T[] {
  const week = orderedWeekdays(firstWeekday);
  const positionOf = (weekday: number): number => {
    const position = week.indexOf(weekday as Weekday);
    return position === -1 ? week.length : position;
  };

  return [...days].sort((left, right) => positionOf(left.weekday) - positionOf(right.weekday));
}

/**
 * `day_slot` is not chosen by the user any more — it is the 1..N position of a training day
 * within the week, recomputed from the weekday selection every time a program is saved.
 */
export function assignDaySlots<T extends ScheduledOnWeekday>(
  days: readonly T[],
  firstWeekday: FirstWeekday,
): (T & { daySlot: number })[] {
  return orderByWeek(days, firstWeekday).map((day, index) => ({ ...day, daySlot: index + 1 }));
}

export interface DefaultTrainingDay {
  weekday: Weekday;
  liftName: string;
  category: LiftCategory;
}

/** Wendler's standard four-day week: two lower days and two upper days, Monday to Friday. */
export const DEFAULT_TRAINING_DAYS: readonly DefaultTrainingDay[] = [
  { weekday: 1, liftName: 'Squat', category: 'lower' },
  { weekday: 2, liftName: 'Bench Press', category: 'upper' },
  { weekday: 4, liftName: 'Deadlift', category: 'lower' },
  { weekday: 5, liftName: 'Overhead Press', category: 'upper' },
];

export function moveAssistanceExercise<T>(
  exercises: readonly T[],
  index: number,
  direction: -1 | 1,
): T[] {
  const targetIndex = index + direction;
  if (
    index < 0 ||
    index >= exercises.length ||
    targetIndex < 0 ||
    targetIndex >= exercises.length
  ) {
    return [...exercises];
  }

  const reordered = [...exercises];
  [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
  return reordered;
}

export interface PersistedAssistanceExercise {
  name: string;
  sets: number;
  reps: number;
}

export type AssistanceInsertParams = [number, string, number, number, number];

/**
 * `FiveThreeOne_LiftAssistance` carries `UNIQUE (lift_id, sort_order)`. Sort orders are derived
 * from list position here so no call site can produce a gap or a collision.
 */
export function getAssistanceInsertParams(
  liftId: number,
  exercises: readonly PersistedAssistanceExercise[],
): AssistanceInsertParams[] {
  return exercises.map((exercise, index) => [
    liftId,
    exercise.name.trim(),
    exercise.sets,
    exercise.reps,
    index + 1,
  ]);
}

export interface LegacyLiftSchedule {
  liftId: number;
  daySlot: number;
}

export interface AssignedWeekday {
  liftId: number;
  weekday: Weekday;
}

/**
 * The pure half of the one-off weekday backfill: programs created before B10 have a `day_slot`
 * but no weekday. Lifts beyond the seventh are left unassigned rather than colliding.
 */
export function assignLegacyWeekdays(
  lifts: readonly LegacyLiftSchedule[],
): AssignedWeekday[] {
  const week = MONDAY_FIRST;

  return [...lifts]
    .sort((left, right) => left.daySlot - right.daySlot)
    .slice(0, week.length)
    .map((lift, index) => ({ liftId: lift.liftId, weekday: week[index] }));
}

export interface FiveThreeOneProgramSettings {
  name: string;
  unit: WeightUnit;
  roundingIncrement: number;
  roundingDirection: RoundingDirection;
  tmPercentage: number;
  includeDeload: boolean;
  upperTmIncrement: number;
  lowerTmIncrement: number;
  warmupEnabled: boolean;
}

export type FiveThreeOneProgramInsertParams = [
  string,
  WeightUnit,
  number,
  RoundingDirection,
  number,
  number,
  number,
  number,
  number,
];

export function getFiveThreeOneProgramInsertParams(
  program: FiveThreeOneProgramSettings,
): FiveThreeOneProgramInsertParams {
  return [
    program.name,
    program.unit,
    program.roundingIncrement,
    program.roundingDirection,
    program.tmPercentage,
    program.includeDeload ? 1 : 0,
    program.upperTmIncrement,
    program.lowerTmIncrement,
    program.warmupEnabled ? 1 : 0,
  ];
}

export interface AssistanceExerciseDraft {
  name: string;
  sets: number | null;
  reps: number | null;
}

export interface TrainingDayDraft {
  weekday: number;
  liftName: string;
  category: string;
  trainingMax: number | null;
  warmupEnabled: boolean;
  assistanceTemplateId: number | null;
  assistance: readonly AssistanceExerciseDraft[];
}

export interface WeeklyPlanValidationInput {
  programName: string;
  unit: string;
  roundingIncrement: number | null;
  roundingDirection: string;
  tmPercentage: number | null;
  includeDeload: boolean;
  upperTmIncrement: number | null;
  lowerTmIncrement: number | null;
  warmupEnabled: boolean;
  days: readonly TrainingDayDraft[];
}

export type WeeklyPlanIssue =
  | 'program-name-required'
  | 'unit-invalid'
  | 'rounding-increment-positive'
  | 'rounding-direction-invalid'
  | 'tm-percentage-invalid'
  | 'upper-tm-increment-positive'
  | 'lower-tm-increment-positive'
  | 'training-day-required'
  | 'weekday-invalid'
  | 'duplicate-weekday'
  | 'lift-name-required'
  | 'duplicate-lift-name'
  | 'lift-category-invalid'
  | 'training-max-positive'
  | 'assistance-name-required'
  | 'assistance-sets-positive'
  | 'assistance-reps-positive';

const isPositive = (value: number | null): boolean =>
  value !== null && Number.isFinite(value) && value > 0;

const isPositiveInteger = (value: number | null): boolean =>
  value !== null && Number.isInteger(value) && value > 0;

const validateProgramSettings = (
  input: WeeklyPlanValidationInput,
): WeeklyPlanIssue | null => {
  if (!input.programName.trim()) {
    return 'program-name-required';
  }

  if (input.unit !== 'kg' && input.unit !== 'lb') {
    return 'unit-invalid';
  }

  if (!isPositive(input.roundingIncrement)) {
    return 'rounding-increment-positive';
  }

  if (!['up', 'down', 'nearest'].includes(input.roundingDirection)) {
    return 'rounding-direction-invalid';
  }

  if (
    input.tmPercentage === null ||
    !Number.isFinite(input.tmPercentage) ||
    input.tmPercentage < 0.85 ||
    input.tmPercentage > 0.9
  ) {
    return 'tm-percentage-invalid';
  }

  if (!isPositive(input.upperTmIncrement)) {
    return 'upper-tm-increment-positive';
  }

  if (!isPositive(input.lowerTmIncrement)) {
    return 'lower-tm-increment-positive';
  }

  return null;
};

const validateTrainingDay = (day: TrainingDayDraft): WeeklyPlanIssue | null => {
  if (!isWeekday(day.weekday)) {
    return 'weekday-invalid';
  }

  if (!day.liftName.trim()) {
    return 'lift-name-required';
  }

  if (day.category !== 'upper' && day.category !== 'lower') {
    return 'lift-category-invalid';
  }

  if (!isPositive(day.trainingMax)) {
    return 'training-max-positive';
  }

  for (const exercise of day.assistance) {
    if (!exercise.name.trim()) {
      return 'assistance-name-required';
    }

    if (!isPositiveInteger(exercise.sets)) {
      return 'assistance-sets-positive';
    }

    if (!isPositiveInteger(exercise.reps)) {
      return 'assistance-reps-positive';
    }
  }

  return null;
};

export function validateWeeklyPlan(
  input: WeeklyPlanValidationInput,
): WeeklyPlanIssue | null {
  const programIssue = validateProgramSettings(input);
  if (programIssue) {
    return programIssue;
  }

  if (input.days.length === 0) {
    return 'training-day-required';
  }

  const weekdays = new Set<number>();
  const liftNames = new Set<string>();

  for (const day of input.days) {
    const dayIssue = validateTrainingDay(day);
    if (dayIssue) {
      return dayIssue;
    }

    if (weekdays.has(day.weekday)) {
      return 'duplicate-weekday';
    }
    weekdays.add(day.weekday);

    const normalizedName = day.liftName.trim().toLocaleLowerCase();
    if (liftNames.has(normalizedName)) {
      return 'duplicate-lift-name';
    }
    liftNames.add(normalizedName);
  }

  return null;
}
