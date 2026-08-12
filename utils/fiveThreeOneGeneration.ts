import {
  calcSetWeight,
  type LiftCategory,
  type RoundingDirection,
  type WeightUnit,
  warmupSets,
  waveForWeek,
  type TrainingWeek,
} from './fiveThreeOne';

export interface FiveThreeOneProgramForGeneration {
  programId: number;
  name: string;
  unit: WeightUnit;
  roundingIncrement: number;
  roundingDirection: RoundingDirection;
  includeDeload: boolean;
  warmupEnabled: boolean;
}

export interface FiveThreeOneLiftForGeneration {
  liftId: number;
  name: string;
  category: LiftCategory;
  trainingMax: number;
  daySlot: number;
  assistanceTemplateId: number | null;
}

export interface FiveThreeOneAssistanceExerciseForGeneration {
  assistanceExerciseId: number;
  name: string;
  sets: number;
  reps: number;
  sortOrder: number;
}

export interface FiveThreeOneAssistanceTemplateForGeneration {
  templateId: number;
  name: string;
  exercises: readonly FiveThreeOneAssistanceExerciseForGeneration[];
}

export interface FiveThreeOneGenerationSource {
  program: FiveThreeOneProgramForGeneration;
  lifts: readonly FiveThreeOneLiftForGeneration[];
  assistanceTemplates: readonly FiveThreeOneAssistanceTemplateForGeneration[];
}

export interface FiveThreeOneCycleSelection {
  cycleNumber: number;
  includeDeload: boolean;
}

export interface FiveThreeOneGenerationInput {
  source: FiveThreeOneGenerationSource;
  cycle: FiveThreeOneCycleSelection;
}

export interface GeneratedFiveThreeOneLink {
  setNumber: number;
  workSetNumber: number | null;
  percent: number;
  targetWeight: number;
  targetReps: number;
  isAmrap: boolean;
  isWarmup: boolean;
}

export interface GeneratedFiveThreeOneMainLift {
  exerciseName: string;
  sets: number;
  reps: number;
  links: readonly GeneratedFiveThreeOneLink[];
}

export interface GeneratedFiveThreeOneAssistanceExercise {
  exerciseName: string;
  sets: number;
  reps: number;
}

export interface GeneratedFiveThreeOneDay {
  dayName: string;
  daySlot: number;
  liftId: number;
  mainLift: GeneratedFiveThreeOneMainLift;
  assistanceExercises: readonly GeneratedFiveThreeOneAssistanceExercise[];
}

export interface GeneratedFiveThreeOneWeek {
  weekNumber: TrainingWeek;
  isDeload: boolean;
  workoutName: string;
  days: readonly GeneratedFiveThreeOneDay[];
}

export interface GeneratedFiveThreeOneCycle {
  cycleNumber: number;
  includeDeload: boolean;
  weeks: readonly GeneratedFiveThreeOneWeek[];
}

export interface FiveThreeOneCycleProgressInput {
  currentWeek: number;
  includeDeload: boolean;
  expectedDayIds: readonly number[];
  loggedDayIds: readonly number[];
}

export interface FiveThreeOneCycleProgressDecision {
  advanced: boolean;
  nextWeek: number;
  cycleComplete: boolean;
}

const assertPositiveInteger = (value: number, message: string): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(message);
  }
};

function assertUnit(unit: string): asserts unit is WeightUnit {
  if (unit !== 'kg' && unit !== 'lb') {
    throw new Error('Unit must be kg or lb.');
  }
}

function assertRoundingDirection(direction: string): asserts direction is RoundingDirection {
  if (direction !== 'up' && direction !== 'down' && direction !== 'nearest') {
    throw new Error('Rounding direction must be up, down, or nearest.');
  }
}

const assertBoolean = (value: boolean, message: string): void => {
  if (typeof value !== 'boolean') {
    throw new Error(message);
  }
};

const validateGenerationSource = (source: FiveThreeOneGenerationSource): void => {
  const { program, lifts, assistanceTemplates } = source;
  assertPositiveInteger(program.programId, 'Program ID must be a positive integer.');
  if (!program.name.trim()) {
    throw new Error('Program name must not be empty.');
  }
  assertUnit(program.unit);
  assertRoundingDirection(program.roundingDirection);
  if (!Number.isFinite(program.roundingIncrement) || program.roundingIncrement <= 0) {
    throw new Error('Rounding increment must be a finite number greater than zero.');
  }
  assertBoolean(program.includeDeload, 'Program deload setting must be a boolean.');
  assertBoolean(program.warmupEnabled, 'Program warm-up setting must be a boolean.');

  if (lifts.length === 0) {
    throw new Error('At least one lift is required to generate a cycle.');
  }

  const daySlots = new Set<number>();
  const liftIds = new Set<number>();
  for (const lift of lifts) {
    assertPositiveInteger(lift.liftId, 'Lift ID must be a positive integer.');
    if (liftIds.has(lift.liftId)) {
      throw new Error(`Lift ID ${lift.liftId} is duplicated.`);
    }
    liftIds.add(lift.liftId);

    if (!lift.name.trim()) {
      throw new Error('Lift name must not be empty.');
    }
    if (lift.category !== 'upper' && lift.category !== 'lower') {
      throw new Error(`Lift category is invalid for ${lift.name}.`);
    }
    if (!Number.isFinite(lift.trainingMax) || lift.trainingMax <= 0) {
      throw new Error(`Training max must be greater than zero for ${lift.name}.`);
    }
    assertPositiveInteger(lift.daySlot, `Day slot must be a positive integer for ${lift.name}.`);
    if (daySlots.has(lift.daySlot)) {
      throw new Error(`Day slot ${lift.daySlot} is duplicated.`);
    }
    daySlots.add(lift.daySlot);
    if (lift.assistanceTemplateId !== null) {
      assertPositiveInteger(
        lift.assistanceTemplateId,
        `Assistance template ID must be positive for ${lift.name}.`,
      );
    }
  }

  const templateIds = new Set<number>();
  for (const template of assistanceTemplates) {
    assertPositiveInteger(template.templateId, 'Assistance template ID must be a positive integer.');
    if (templateIds.has(template.templateId)) {
      throw new Error(`Assistance template ID ${template.templateId} is duplicated.`);
    }
    templateIds.add(template.templateId);
    if (!template.name.trim()) {
      throw new Error('Assistance template name must not be empty.');
    }

    const exerciseIds = new Set<number>();
    for (const exercise of template.exercises) {
      assertPositiveInteger(
        exercise.assistanceExerciseId,
        'Assistance exercise ID must be a positive integer.',
      );
      if (exerciseIds.has(exercise.assistanceExerciseId)) {
        throw new Error(`Assistance exercise ID ${exercise.assistanceExerciseId} is duplicated.`);
      }
      exerciseIds.add(exercise.assistanceExerciseId);
      if (!exercise.name.trim()) {
        throw new Error('Assistance exercise name must not be empty.');
      }
      assertPositiveInteger(exercise.sets, `Assistance sets must be positive for ${exercise.name}.`);
      assertPositiveInteger(exercise.reps, `Assistance reps must be positive for ${exercise.name}.`);
      assertPositiveInteger(
        exercise.sortOrder,
        `Assistance sort order must be positive for ${exercise.name}.`,
      );
    }
  }
};

const assistanceForLift = (
  lift: FiveThreeOneLiftForGeneration,
  templates: readonly FiveThreeOneAssistanceTemplateForGeneration[],
): GeneratedFiveThreeOneAssistanceExercise[] => {
  if (lift.assistanceTemplateId === null) {
    throw new Error(`Assistance template is required for ${lift.name}.`);
  }

  const template = templates.find((candidate) => candidate.templateId === lift.assistanceTemplateId);
  if (!template) {
    throw new Error(`Assistance template ${lift.assistanceTemplateId} was not found for ${lift.name}.`);
  }

  return [...template.exercises]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((exercise) => ({
      exerciseName: exercise.name.trim(),
      sets: exercise.sets,
      reps: exercise.reps,
    }));
};

export const generateFiveThreeOneCyclePlan = ({
  source,
  cycle,
}: FiveThreeOneGenerationInput): GeneratedFiveThreeOneCycle => {
  validateGenerationSource(source);
  assertPositiveInteger(cycle.cycleNumber, 'Cycle number must be a positive integer.');
  assertBoolean(cycle.includeDeload, 'Cycle deload setting must be a boolean.');

  const weekNumbers: TrainingWeek[] = [1, 2, 3];
  if (cycle.includeDeload) {
    weekNumbers.push(4);
  }

  const orderedLifts = [...source.lifts].sort((left, right) => left.daySlot - right.daySlot);
  const weeks = weekNumbers.map((weekNumber) => {
    const wave = waveForWeek(weekNumber);
    const days = orderedLifts.map((lift) => {
      const warmups = source.program.warmupEnabled
        ? warmupSets(lift.trainingMax, {
            unit: source.program.unit,
            increment: source.program.roundingIncrement,
            direction: source.program.roundingDirection,
          })
        : [];
      const warmupLinks: GeneratedFiveThreeOneLink[] = warmups.map((warmup, index) => ({
        setNumber: index + 1,
        workSetNumber: null,
        percent: warmup.percent,
        targetWeight: warmup.weight,
        targetReps: warmup.reps,
        isAmrap: false,
        isWarmup: true,
      }));
      const workLinks: GeneratedFiveThreeOneLink[] = wave.sets.map((set, index) => ({
        setNumber: warmups.length + index + 1,
        workSetNumber: index + 1,
        percent: set.percent,
        targetWeight: calcSetWeight(
          lift.trainingMax,
          set.percent,
          source.program.roundingIncrement,
          source.program.roundingDirection,
        ),
        targetReps: set.targetReps,
        isAmrap: set.isAmrap,
        isWarmup: false,
      }));

      return {
        dayName: `${lift.daySlot}. ${lift.name.trim()}`,
        daySlot: lift.daySlot,
        liftId: lift.liftId,
        mainLift: {
          exerciseName: lift.name.trim(),
          sets: workLinks.length,
          reps: wave.sets[0]?.targetReps ?? 1,
          links: [...warmupLinks, ...workLinks],
        },
        assistanceExercises: assistanceForLift(lift, source.assistanceTemplates),
      };
    });

    return {
      weekNumber,
      isDeload: wave.isDeload,
      workoutName: `${source.program.name.trim()} - Cycle ${cycle.cycleNumber} - Week ${weekNumber}`,
      days,
    };
  });

  return {
    cycleNumber: cycle.cycleNumber,
    includeDeload: cycle.includeDeload,
    weeks,
  };
};

export const decideFiveThreeOneCycleProgress = ({
  currentWeek,
  includeDeload,
  expectedDayIds,
  loggedDayIds,
}: FiveThreeOneCycleProgressInput): FiveThreeOneCycleProgressDecision => {
  if (!Number.isInteger(currentWeek) || currentWeek < 1 || currentWeek > 4) {
    throw new Error('Current week must be 1, 2, 3, or 4.');
  }
  assertBoolean(includeDeload, 'Cycle deload setting must be a boolean.');
  if (!includeDeload && currentWeek === 4) {
    throw new Error('A cycle without a deload cannot be on week 4.');
  }
  if (expectedDayIds.length === 0) {
    throw new Error('At least one expected day is required to advance a cycle.');
  }
  for (const dayId of expectedDayIds) {
    assertPositiveInteger(dayId, 'Expected day IDs must be positive integers.');
  }
  for (const dayId of loggedDayIds) {
    assertPositiveInteger(dayId, 'Logged day IDs must be positive integers.');
  }

  const expectedDays = new Set(expectedDayIds);
  const loggedDays = new Set(loggedDayIds);
  const allDaysLogged = [...expectedDays].every((dayId) => loggedDays.has(dayId));
  if (!allDaysLogged) {
    return {
      advanced: false,
      nextWeek: currentWeek,
      cycleComplete: false,
    };
  }

  const finalWeek = includeDeload ? 4 : 3;
  return {
    advanced: true,
    nextWeek: currentWeek === finalWeek ? currentWeek : currentWeek + 1,
    cycleComplete: currentWeek === finalWeek,
  };
};
