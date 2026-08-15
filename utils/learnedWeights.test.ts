import {
  baselineColumn,
  inferBaselineWeight,
} from './learnedWeights';

describe('inferBaselineWeight — the §3.2 first-log baseline', () => {
  const waveInput = {
    loadSource: 'training_max_pct' as const,
    trainingMaxPct: 0.9,
    roundingIncrement: 2.5,
    planUnit: 'kg' as const,
  };
  const linearInput = {
    loadSource: 'absolute' as const,
    trainingMaxPct: null,
    roundingIncrement: 2.5,
    planUnit: 'kg' as const,
  };

  it('derives the wave training max from the first set via the existing estimator', () => {
    // Epley 100 x (1 + 5/30) = 116.67; x 0.9 = 105 — the same arithmetic the
    // setup screen's estimator produces.
    expect(
      inferBaselineWeight({ ...waveInput, set: { weight: 100, reps: 5, unit: 'kg' } }),
    ).toBe(105);
    // Epley 90 x (1 + 8/30) = 114; x 0.9 = 102.6; nearest 2.5 = 102.5.
    expect(
      inferBaselineWeight({ ...waveInput, set: { weight: 90, reps: 8, unit: 'kg' } }),
    ).toBe(102.5);
  });

  it('uses the exercise own TM percentage, defaulting to 0.9', () => {
    expect(
      inferBaselineWeight({
        ...waveInput,
        trainingMaxPct: null,
        set: { weight: 100, reps: 5, unit: 'kg' },
      }),
    ).toBe(105);
    expect(
      inferBaselineWeight({
        ...waveInput,
        trainingMaxPct: 0.85,
        set: { weight: 100, reps: 5, unit: 'kg' },
      }),
    ).toBe(100);
  });

  it('uses the weight itself as the linear starting load', () => {
    expect(
      inferBaselineWeight({ ...linearInput, set: { weight: 60, reps: 5, unit: 'kg' } }),
    ).toBe(60);
    expect(
      inferBaselineWeight({ ...linearInput, set: { weight: 22.5, reps: 10, unit: 'kg' } }),
    ).toBe(22.5);
  });

  it('converts a set logged in the other unit once, for the plan', () => {
    // 200 lb = 90.72 kg; Epley x1.1667 = 105.84; x0.9 = 95.25; nearest 2.5 = 95.
    expect(
      inferBaselineWeight({ ...waveInput, set: { weight: 200, reps: 5, unit: 'lb' } }),
    ).toBe(95);
    // 100 lb = 45.36 kg — the linear starting load in the plan unit, unrounded.
    expect(
      inferBaselineWeight({ ...linearInput, set: { weight: 100, reps: 5, unit: 'lb' } }),
    ).toBeCloseTo(45.36, 1);
  });

  it('returns null for bodyweight and impossible sets', () => {
    expect(
      inferBaselineWeight({
        loadSource: 'bodyweight',
        trainingMaxPct: null,
        roundingIncrement: 2.5,
        planUnit: 'kg',
        set: { weight: 0, reps: 5, unit: 'kg' },
      }),
    ).toBeNull();
    expect(
      inferBaselineWeight({ ...linearInput, set: { weight: 0, reps: 5, unit: 'kg' } }),
    ).toBeNull();
    expect(
      inferBaselineWeight({ ...linearInput, set: { weight: 60, reps: 0, unit: 'kg' } }),
    ).toBeNull();
    expect(
      inferBaselineWeight({ ...linearInput, set: { weight: 60, reps: 5.5, unit: 'kg' } }),
    ).toBeNull();
    expect(
      inferBaselineWeight({ ...linearInput, set: { weight: NaN, reps: 5, unit: 'kg' } }),
    ).toBeNull();
  });
});

describe('baselineColumn — the plan column per load source', () => {
  it('maps the weighted sources and refuses bodyweight', () => {
    expect(baselineColumn('training_max_pct')).toBe('training_max_weight');
    expect(baselineColumn('absolute')).toBe('absolute_weight');
    expect(baselineColumn('bodyweight')).toBeNull();
  });
});
