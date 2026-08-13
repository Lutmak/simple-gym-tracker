import {
  DEFAULT_TRAINING_DAYS,
  assignDaySlots,
  assignLegacyWeekdays,
  getAssistanceInsertParams,
  getFiveThreeOneProgramInsertParams,
  moveAssistanceExercise,
  orderedWeekdays,
  orderByWeek,
  validateWeeklyPlan,
  type FiveThreeOneProgramSettings,
  type TrainingDayDraft,
  type WeeklyPlanValidationInput,
} from './fiveThreeOneSetup';

const day = (overrides: Partial<TrainingDayDraft> = {}): TrainingDayDraft => ({
  weekday: 1,
  liftName: 'Squat',
  category: 'lower',
  trainingMax: 100,
  warmupEnabled: true,
  assistanceTemplateId: 1,
  assistance: [],
  ...overrides,
});

const plan = (
  overrides: Partial<WeeklyPlanValidationInput> = {},
): WeeklyPlanValidationInput => ({
  programName: 'Strength',
  unit: 'kg',
  roundingIncrement: 2.5,
  roundingDirection: 'nearest',
  tmPercentage: 0.9,
  includeDeload: true,
  upperTmIncrement: 2.5,
  lowerTmIncrement: 5,
  warmupEnabled: true,
  days: [day()],
  ...overrides,
});

describe('weekday ordering', () => {
  it('orders the week from the configured first weekday', () => {
    expect(orderedWeekdays('Monday')).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(orderedWeekdays('Sunday')).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('sorts training days into week order rather than insertion order', () => {
    const days = [day({ weekday: 0 }), day({ weekday: 3 }), day({ weekday: 1 })];

    expect(orderByWeek(days, 'Monday').map((entry) => entry.weekday)).toEqual([1, 3, 0]);
    expect(orderByWeek(days, 'Sunday').map((entry) => entry.weekday)).toEqual([0, 1, 3]);
  });

  it('leaves the input untouched', () => {
    const days = [day({ weekday: 5 }), day({ weekday: 2 })];
    orderByWeek(days, 'Monday');

    expect(days.map((entry) => entry.weekday)).toEqual([5, 2]);
  });
});

describe('assignDaySlots', () => {
  it('numbers the selected days from one in week order', () => {
    const slotted = assignDaySlots(
      [day({ weekday: 4 }), day({ weekday: 1 }), day({ weekday: 2 })],
      'Monday',
    );

    expect(slotted.map((entry) => [entry.weekday, entry.daySlot])).toEqual([
      [1, 1],
      [2, 2],
      [4, 3],
    ]);
  });

  it('renumbers when the week starts on Sunday', () => {
    const slotted = assignDaySlots([day({ weekday: 1 }), day({ weekday: 0 })], 'Sunday');

    expect(slotted.map((entry) => [entry.weekday, entry.daySlot])).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it('numbers a full seven-day week without gaps', () => {
    const week = [0, 1, 2, 3, 4, 5, 6].map((weekday) => day({ weekday }));

    expect(assignDaySlots(week, 'Monday').map((entry) => entry.daySlot)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });
});

describe('DEFAULT_TRAINING_DAYS', () => {
  it('is the standard four-day week with distinct weekdays', () => {
    expect(DEFAULT_TRAINING_DAYS.map((entry) => entry.liftName)).toEqual([
      'Squat',
      'Bench Press',
      'Deadlift',
      'Overhead Press',
    ]);
    expect(DEFAULT_TRAINING_DAYS.map((entry) => entry.weekday)).toEqual([1, 2, 4, 5]);
    expect(new Set(DEFAULT_TRAINING_DAYS.map((entry) => entry.weekday)).size).toBe(4);
  });
});

describe('assistance list editing', () => {
  const exercises = [
    { id: 'a', name: 'Dip', sets: 5, reps: 10 },
    { id: 'b', name: 'Row', sets: 5, reps: 10 },
    { id: 'c', name: 'Leg Raise', sets: 5, reps: 15 },
  ];

  it('moves an exercise up and down', () => {
    expect(moveAssistanceExercise(exercises, 2, -1).map((entry) => entry.id)).toEqual([
      'a',
      'c',
      'b',
    ]);
    expect(moveAssistanceExercise(exercises, 0, 1).map((entry) => entry.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('refuses to move past either end', () => {
    expect(moveAssistanceExercise(exercises, 0, -1)).toEqual(exercises);
    expect(moveAssistanceExercise(exercises, 2, 1)).toEqual(exercises);
    expect(moveAssistanceExercise(exercises, 7, -1)).toEqual(exercises);
  });

  it('assigns dense one-based sort orders and trims names when persisting', () => {
    expect(
      getAssistanceInsertParams(12, [
        { name: '  Dip  ', sets: 5, reps: 10 },
        { name: 'Row', sets: 3, reps: 12 },
      ]),
    ).toEqual([
      [12, 'Dip', 5, 10, 1],
      [12, 'Row', 3, 12, 2],
    ]);
  });

  it('produces no rows for a day with no assistance work', () => {
    expect(getAssistanceInsertParams(12, [])).toEqual([]);
  });
});

describe('assignLegacyWeekdays', () => {
  it('spreads existing lifts across the week in day-slot order', () => {
    expect(
      assignLegacyWeekdays([
        { liftId: 30, daySlot: 3 },
        { liftId: 10, daySlot: 1 },
        { liftId: 20, daySlot: 2 },
      ]),
    ).toEqual([
      { liftId: 10, weekday: 1 },
      { liftId: 20, weekday: 2 },
      { liftId: 30, weekday: 3 },
    ]);
  });

  it('ends the week on Sunday and leaves an eighth lift unassigned', () => {
    const lifts = [1, 2, 3, 4, 5, 6, 7, 8].map((daySlot) => ({ liftId: daySlot, daySlot }));

    expect(assignLegacyWeekdays(lifts).map((entry) => entry.weekday)).toEqual([
      1, 2, 3, 4, 5, 6, 0,
    ]);
  });
});

describe('validateWeeklyPlan', () => {
  it('accepts a complete plan', () => {
    expect(validateWeeklyPlan(plan())).toBeNull();
    expect(
      validateWeeklyPlan(
        plan({
          days: [
            day({ weekday: 1, assistance: [{ name: 'Dip', sets: 5, reps: 10 }] }),
            day({ weekday: 4, liftName: 'Bench Press', category: 'upper' }),
          ],
        }),
      ),
    ).toBeNull();
  });

  it('still rejects invalid program settings', () => {
    expect(validateWeeklyPlan(plan({ programName: '   ' }))).toBe('program-name-required');
    expect(validateWeeklyPlan(plan({ unit: 'stone' }))).toBe('unit-invalid');
    expect(validateWeeklyPlan(plan({ roundingIncrement: 0 }))).toBe(
      'rounding-increment-positive',
    );
    expect(validateWeeklyPlan(plan({ roundingDirection: 'sideways' }))).toBe(
      'rounding-direction-invalid',
    );
    expect(validateWeeklyPlan(plan({ tmPercentage: 0.91 }))).toBe('tm-percentage-invalid');
    expect(validateWeeklyPlan(plan({ upperTmIncrement: 0 }))).toBe(
      'upper-tm-increment-positive',
    );
    expect(validateWeeklyPlan(plan({ lowerTmIncrement: null }))).toBe(
      'lower-tm-increment-positive',
    );
  });

  it('requires at least one training day', () => {
    expect(validateWeeklyPlan(plan({ days: [] }))).toBe('training-day-required');
  });

  it('rejects an out-of-range or repeated weekday', () => {
    expect(validateWeeklyPlan(plan({ days: [day({ weekday: 7 })] }))).toBe('weekday-invalid');
    expect(validateWeeklyPlan(plan({ days: [day({ weekday: -1 })] }))).toBe('weekday-invalid');
    expect(
      validateWeeklyPlan(
        plan({ days: [day({ weekday: 2 }), day({ weekday: 2, liftName: 'Bench Press' })] }),
      ),
    ).toBe('duplicate-weekday');
  });

  it('rejects an incomplete main lift', () => {
    expect(validateWeeklyPlan(plan({ days: [day({ liftName: '  ' })] }))).toBe(
      'lift-name-required',
    );
    expect(validateWeeklyPlan(plan({ days: [day({ category: 'middle' })] }))).toBe(
      'lift-category-invalid',
    );
    expect(validateWeeklyPlan(plan({ days: [day({ trainingMax: 0 })] }))).toBe(
      'training-max-positive',
    );
    expect(validateWeeklyPlan(plan({ days: [day({ trainingMax: null })] }))).toBe(
      'training-max-positive',
    );
  });

  it('rejects the same lift name on two days', () => {
    expect(
      validateWeeklyPlan(
        plan({ days: [day({ weekday: 1 }), day({ weekday: 3, liftName: ' squat ' })] }),
      ),
    ).toBe('duplicate-lift-name');
  });

  it('rejects malformed assistance exercises', () => {
    expect(
      validateWeeklyPlan(
        plan({ days: [day({ assistance: [{ name: '', sets: 3, reps: 10 }] })] }),
      ),
    ).toBe('assistance-name-required');
    expect(
      validateWeeklyPlan(
        plan({ days: [day({ assistance: [{ name: 'Dip', sets: 0, reps: 10 }] })] }),
      ),
    ).toBe('assistance-sets-positive');
    expect(
      validateWeeklyPlan(
        plan({ days: [day({ assistance: [{ name: 'Dip', sets: 2.5, reps: 10 }] })] }),
      ),
    ).toBe('assistance-sets-positive');
    expect(
      validateWeeklyPlan(
        plan({ days: [day({ assistance: [{ name: 'Dip', sets: 3, reps: null }] })] }),
      ),
    ).toBe('assistance-reps-positive');
  });

  it('allows a day with no assistance work and no template', () => {
    expect(
      validateWeeklyPlan(plan({ days: [day({ assistanceTemplateId: null, assistance: [] })] })),
    ).toBeNull();
  });
});

describe('getFiveThreeOneProgramInsertParams', () => {
  it('persists the wizard choices rather than later-changing defaults', () => {
    const program: FiveThreeOneProgramSettings = {
      name: 'Strength',
      unit: 'lb',
      roundingIncrement: 5,
      roundingDirection: 'down',
      tmPercentage: 0.85,
      includeDeload: false,
      upperTmIncrement: 5,
      lowerTmIncrement: 10,
      warmupEnabled: false,
    };

    const persistedValues = getFiveThreeOneProgramInsertParams(program);
    const laterDefaults = {
      ...program,
      roundingIncrement: 2.5,
      includeDeload: true,
      warmupEnabled: true,
    };

    expect(persistedValues).toEqual(['Strength', 'lb', 5, 'down', 0.85, 0, 5, 10, 0]);
    expect(laterDefaults).not.toEqual(program);
    expect(persistedValues[2]).toBe(program.roundingIncrement);
    expect(persistedValues[5]).toBe(0);
    expect(persistedValues[8]).toBe(0);
  });
});
