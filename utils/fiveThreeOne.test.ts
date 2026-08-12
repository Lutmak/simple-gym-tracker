import {
  calcSetWeight,
  estimate1RM,
  suggestNextTM,
  warmupSets,
  waveForWeek,
} from './fiveThreeOne';
import type { CycleResult, FiveThreeOneLift } from './fiveThreeOne';

describe('calcSetWeight', () => {
  it.each([
    ['up', 67.5],
    ['down', 65],
    ['nearest', 67.5],
  ] as const)('rounds 67% of a 100 kg TM %s', (direction, expected) => {
    expect(calcSetWeight(100, 67, 2.5, direction)).toBe(expected);
  });

  it.each([
    ['up', 170],
    ['down', 165],
    ['nearest', 165],
  ] as const)('rounds 83% of a 200 lb TM %s using a 5 lb increment', (direction, expected) => {
    expect(calcSetWeight(200, 83, 5, direction)).toBe(expected);
  });

  it('rejects invalid numeric inputs and directions', () => {
    expect(() => calcSetWeight(0, 50, 2.5, 'nearest')).toThrow(
      'Training max must be a finite number greater than zero.',
    );
    expect(() => calcSetWeight(100, 101, 2.5, 'nearest')).toThrow(
      'Percent must be a finite number between zero and 100.',
    );
    expect(() => calcSetWeight(100, 50, 0, 'nearest')).toThrow(
      'Increment must be a finite number greater than zero.',
    );
    expect(() => calcSetWeight(100, 50, 2.5, 'sideways' as never)).toThrow(
      'Rounding direction must be up, down, or nearest.',
    );
  });
});

describe('estimate1RM', () => {
  it('uses Epley for a one-rep set', () => {
    expect(estimate1RM(100, 1)).toBeCloseTo(103.3333333333, 10);
  });

  it('uses Epley for a twenty-rep set', () => {
    expect(estimate1RM(100, 20)).toBeCloseTo(166.6666666667, 10);
  });

  it('rejects non-positive or non-integer inputs', () => {
    expect(() => estimate1RM(0, 1)).toThrow(
      'Weight must be a finite number greater than zero.',
    );
    expect(() => estimate1RM(100, 0)).toThrow(
      'Reps must be a positive integer.',
    );
    expect(() => estimate1RM(100, 2.5)).toThrow(
      'Reps must be a positive integer.',
    );
  });
});

describe('waveForWeek', () => {
  it.each([
    [1, false, [65, 75, 85], [5, 5, 5], [false, false, true]],
    [2, false, [70, 80, 90], [3, 3, 3], [false, false, true]],
    [3, false, [75, 85, 95], [5, 3, 1], [false, false, true]],
    [4, true, [40, 50, 60], [5, 5, 5], [false, false, false]],
  ] as const)(
    'returns the hand-computed week %i wave',
    (week, isDeload, percentages, targetReps, amrapFlags) => {
      expect(waveForWeek(week)).toEqual({
        week,
        isDeload,
        sets: percentages.map((percent, index) => ({
          percent,
          targetReps: targetReps[index],
          isAmrap: amrapFlags[index],
        })),
      });
    },
  );

  it('rejects a week outside the three training weeks and deload', () => {
    expect(() => waveForWeek(0)).toThrow(
      'Week must be 1, 2, 3, or 4 (deload).',
    );
    expect(() => waveForWeek(5)).toThrow(
      'Week must be 1, 2, 3, or 4 (deload).',
    );
  });

  it('produces hand-computed target weights for the three training weeks', () => {
    expect(
      ([1, 2, 3] as const).map((week) =>
        waveForWeek(week).sets.map((set) =>
          calcSetWeight(100, set.percent, 2.5, 'nearest'),
        ),
      ),
    ).toEqual([
      [65, 75, 85],
      [70, 80, 90],
      [75, 85, 95],
    ]);
  });
});

describe('warmupSets', () => {
  it('uses the default percentages, reps, kg unit, and nearest rounding', () => {
    expect(warmupSets(100)).toEqual([
      { percent: 40, reps: 5, weight: 40, unit: 'kg' },
      { percent: 50, reps: 5, weight: 50, unit: 'kg' },
      { percent: 60, reps: 3, weight: 60, unit: 'kg' },
    ]);
  });

  it('uses the requested rounding and lb unit', () => {
    expect(
      warmupSets(123, { increment: 5, direction: 'up', unit: 'lb' }),
    ).toEqual([
      { percent: 40, reps: 5, weight: 50, unit: 'lb' },
      { percent: 50, reps: 5, weight: 65, unit: 'lb' },
      { percent: 60, reps: 3, weight: 75, unit: 'lb' },
    ]);
  });

  it('defaults the lb increment to 5 lb and rejects an invalid unit', () => {
    expect(warmupSets(123, { unit: 'lb', direction: 'down' })).toEqual([
      { percent: 40, reps: 5, weight: 45, unit: 'lb' },
      { percent: 50, reps: 5, weight: 60, unit: 'lb' },
      { percent: 60, reps: 3, weight: 70, unit: 'lb' },
    ]);
    expect(() => warmupSets(100, { unit: 'stone' as never })).toThrow(
      'Unit must be kg or lb.',
    );
  });
});

const bench: FiveThreeOneLift = {
  name: 'Bench Press',
  trainingMax: 100,
  unit: 'kg',
  category: 'upper',
};

const squat: FiveThreeOneLift = {
  name: 'Squat',
  trainingMax: 180,
  unit: 'kg',
  category: 'lower',
};

const metResults: CycleResult[] = [
  { targetReps: 5, actualReps: 5 },
  { targetReps: 3, actualReps: 4 },
];

describe('suggestNextTM', () => {
  it('adds the default upper-body increment when every target is met', () => {
    expect(suggestNextTM(bench, metResults)).toEqual({
      liftName: 'Bench Press',
      unit: 'kg',
      currentTM: 100,
      suggestedTM: 102.5,
      increment: 2.5,
      performance: 'met',
      missedTargets: 0,
      reviewRequired: false,
      note: null,
    });
  });

  it('holds the lower-body TM when the target is missed', () => {
    expect(
      suggestNextTM(squat, [{ targetReps: 5, actualReps: 4 }]),
    ).toEqual({
      liftName: 'Squat',
      unit: 'kg',
      currentTM: 180,
      suggestedTM: 180,
      increment: 5,
      performance: 'missed',
      missedTargets: 1,
      reviewRequired: false,
      note: null,
    });
  });

  it('holds the TM for mixed target results rather than decreasing it', () => {
    expect(
      suggestNextTM(bench, [
        { targetReps: 5, actualReps: 5 },
        { targetReps: 5, actualReps: 4 },
      ]),
    ).toMatchObject({
      currentTM: 100,
      suggestedTM: 100,
      performance: 'mixed',
      missedTargets: 1,
      reviewRequired: false,
    });
  });

  it('uses configurable upper and lower increments', () => {
    expect(suggestNextTM(bench, metResults, { upperIncrement: 5 })).toMatchObject({
      suggestedTM: 105,
      increment: 5,
    });
    expect(suggestNextTM(squat, metResults, { lowerIncrement: 10 })).toMatchObject({
      suggestedTM: 190,
      increment: 10,
    });
  });

  it('flags repeated underperformance with an advisory note', () => {
    expect(
      suggestNextTM(squat, [
        { targetReps: 5, actualReps: 4 },
        { targetReps: 3, actualReps: 2 },
        { targetReps: 5, actualReps: 5 },
      ]),
    ).toMatchObject({
      suggestedTM: 180,
      performance: 'mixed',
      missedTargets: 2,
      reviewRequired: true,
      note: 'Repeated underperformance: consider reviewing or resetting this training max.',
    });
  });

  it('uses unit-appropriate lb defaults for upper and lower lifts', () => {
    expect(
      suggestNextTM(
        { ...bench, trainingMax: 200, unit: 'lb' },
        metResults,
      ),
    ).toMatchObject({ suggestedTM: 205, increment: 5, unit: 'lb' });
    expect(
      suggestNextTM(
        { ...squat, trainingMax: 300, unit: 'lb' },
        metResults,
      ),
    ).toMatchObject({ suggestedTM: 310, increment: 10, unit: 'lb' });
  });

  it('rejects invalid lift and cycle result boundaries', () => {
    expect(() => suggestNextTM({ ...bench, name: ' ' }, metResults)).toThrow(
      'Lift name must not be empty.',
    );
    expect(() => suggestNextTM({ ...bench, trainingMax: Number.NaN }, metResults)).toThrow(
      'Training max must be a finite number greater than zero.',
    );
    expect(() => suggestNextTM({ ...bench, category: 'other' as never }, metResults)).toThrow(
      'Lift category must be upper or lower.',
    );
    expect(() => suggestNextTM(bench, null as never)).toThrow(
      'At least one cycle result is required.',
    );
    expect(() => suggestNextTM(bench, [{ targetReps: 0, actualReps: 0 }])).toThrow(
      'Target reps must be a positive integer.',
    );
    expect(() => suggestNextTM(bench, [{ targetReps: 1, actualReps: -1 }])).toThrow(
      'Actual reps must be a non-negative integer.',
    );
  });

  it('rejects invalid progression values', () => {
    expect(() => suggestNextTM(bench, [])).toThrow(
      'At least one cycle result is required.',
    );
    expect(() => suggestNextTM(bench, metResults, { upperIncrement: 0 })).toThrow(
      'TM increment must be a finite number greater than zero.',
    );
  });
});
