import {
  proposeNextTargets,
  type CycleHistory,
  type PerformedSet,
  type RoutineExercise,
  type RoutineLike,
} from './progression';

const bench: RoutineExercise = {
  identifier: 11,
  name: 'Press de banca',
  targetSets: 3,
  targetReps: 5,
  loadSource: 'training_max_pct',
  unitOverride: null,
  absoluteWeight: null,
  trainingMaxWeight: 100,
  trainingMaxPct: 0.95,
  category: 'upper',
};

const routine = (
  overrides: Partial<RoutineLike> = {},
  exercises: RoutineExercise[] = [bench],
): RoutineLike => ({
  unit: 'kg',
  roundingIncrement: 2.5,
  progressionRule: 'wave',
  exercises,
  ...overrides,
});

const entry = (
  amrap: { reps: number; weight: number } | null,
  unit: PerformedSet['unit'] = 'kg',
  cycleNumber = 1,
  loggedSets = 3,
): CycleHistory => {
  const sets: PerformedSet[] = [];
  for (let index = 0; index < loggedSets; index++) {
    const isAmrapSet = index === loggedSets - 1 && amrap !== null;
    sets.push({
      reps: isAmrapSet ? amrap.reps : 5,
      weight: isAmrapSet ? amrap.weight : 60,
      unit,
    });
  }
  return {
    cycleNumber,
    exercises: {
      [bench.identifier]: { sets, proposalStatus: null },
    },
  };
};

/** A wave cycle under review: weeks 1-4, in order; a null week logged no AMRAP. */
const waveCycle = (
  weekResults: Array<{ reps: number; weight: number } | null>,
  unit: PerformedSet['unit'] = 'kg',
): CycleHistory[] =>
  weekResults.map((result, index) => entry(result, unit, index + 1));

describe('progression — wave rule', () => {
  it('proposes nothing for a wave routine with no history', () => {
    expect(proposeNextTargets(routine(), [])).toEqual([]);
  });

  it.each([
    [
      [entry({ reps: 5, weight: 85 })],
      85,
      90,
      'semana 2: 3+ reps con 90 kg (AMRAP)',
    ],
    [
      [entry({ reps: 5, weight: 85 }), entry({ reps: 3, weight: 90 })],
      90,
      95,
      'semana 3: 1+ reps con 95 kg (AMRAP)',
    ],
    [
      [
        entry({ reps: 5, weight: 85 }),
        entry({ reps: 3, weight: 90 }),
        entry({ reps: 5, weight: 95 }),
      ],
      95,
      60,
      'semana 4 de descarga: 5 reps con 60 kg',
    ],
    [
      [
        entry({ reps: 5, weight: 85 }),
        entry({ reps: 3, weight: 90 }),
        entry({ reps: 5, weight: 95 }),
        entry({ reps: 5, weight: 60 }),
      ],
      60,
      85,
      'semana 1: 5+ reps con 85 kg (AMRAP)',
    ],
  ] as const)(
    'walks the wave table tops 85/90/95/60 from the completed week to the next',
    (history, currentTarget, proposedTarget, reason) => {
      expect(proposeNextTargets(routine(), [...history])[0]).toEqual({
        exerciseIdentifier: 11,
        exerciseName: 'Press de banca',
        currentTarget,
        proposedTarget,
        unit: 'kg',
        reason,
        advisory: false,
      });
    },
  );

  it('rounds week targets to the routine rounding increment', () => {
    const proposals = proposeNextTargets(
      routine({}, [{ ...bench, trainingMaxWeight: 103 }]),
      [entry({ reps: 5, weight: 85 })],
    );

    expect(proposals[0]).toMatchObject({
      currentTarget: 87.5,
      proposedTarget: 92.5,
    });
  });

  it('uses the routine unit and increment for an lb routine', () => {
    const proposals = proposeNextTargets(
      routine({ unit: 'lb', roundingIncrement: 5 }, [{ ...bench, trainingMaxWeight: 200 }]),
      [entry({ reps: 5, weight: 170 }, 'lb')],
    );

    expect(proposals[0]).toMatchObject({
      currentTarget: 170,
      proposedTarget: 180,
      unit: 'lb',
      reason: 'semana 2: 3+ reps con 180 lb (AMRAP)',
    });
  });

  it('uses the override unit for a single exercise in a kg routine', () => {
    const proposals = proposeNextTargets(
      routine({ roundingIncrement: 5 }, [
        { ...bench, trainingMaxWeight: 200, unitOverride: 'lb' },
      ]),
      [entry({ reps: 5, weight: 170 }, 'lb')],
    );

    expect(proposals[0]).toMatchObject({
      currentTarget: 170,
      proposedTarget: 180,
      unit: 'lb',
    });
  });

  it('proposes nothing for absolute and bodyweight exercises in a wave routine', () => {
    const squat: RoutineExercise = {
      identifier: 12,
      name: 'Sentadilla',
      targetSets: 3,
      targetReps: 5,
      loadSource: 'absolute',
      unitOverride: null,
      absoluteWeight: 100,
      trainingMaxWeight: null,
      trainingMaxPct: null,
    };
    const pullUps: RoutineExercise = {
      identifier: 13,
      name: 'Dominadas',
      targetSets: 3,
      targetReps: 8,
      loadSource: 'bodyweight',
      unitOverride: null,
      absoluteWeight: null,
      trainingMaxWeight: null,
      trainingMaxPct: null,
    };

    const proposals = proposeNextTargets(routine({}, [bench, squat, pullUps]), [
      entry({ reps: 5, weight: 85 }),
    ]);

    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ exerciseIdentifier: 11 });
  });

  it('skips an exercise whose training max is missing or not positive', () => {
    const broken: RoutineExercise = {
      ...bench,
      trainingMaxWeight: 0,
    };
    const absent: RoutineExercise = {
      ...bench,
      identifier: 14,
      trainingMaxWeight: null,
    };

    const proposals = proposeNextTargets(
      routine({}, [bench, broken, absent]),
      [entry({ reps: 5, weight: 85 })],
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ exerciseIdentifier: 11 });
  });

  it('at cycle end proposes the next cycle week 1 and a TM from met AMRAPs', () => {
    const proposals = proposeNextTargets(routine(), [
      entry({ reps: 5, weight: 85 }),
      entry({ reps: 3, weight: 90 }),
      entry({ reps: 5, weight: 95 }),
      entry({ reps: 5, weight: 60 }),
    ]);

    expect(proposals).toEqual([
      {
        exerciseIdentifier: 11,
        exerciseName: 'Press de banca',
        currentTarget: 60,
        proposedTarget: 85,
        unit: 'kg',
        reason: 'semana 1: 5+ reps con 85 kg (AMRAP)',
        advisory: false,
      },
      {
        exerciseIdentifier: 11,
        exerciseName: 'Press de banca',
        currentTarget: 100,
        proposedTarget: 102.5,
        unit: 'kg',
        reason: 'hiciste 5, 3, 5 con 85 kg, 90 kg, 95 kg',
        advisory: false,
      },
    ]);
  });

  it('uses the deload week only as the week target, never as an AMRAP result', () => {
    const proposals = proposeNextTargets(routine(), [
      entry({ reps: 5, weight: 85 }),
      entry({ reps: 3, weight: 90 }),
      entry({ reps: 1, weight: 95 }),
      entry({ reps: 5, weight: 60 }),
    ]);

    expect(proposals[1]).toMatchObject({
      currentTarget: 100,
      proposedTarget: 102.5,
      reason: 'hiciste 5, 3, 1 con 85 kg, 90 kg, 95 kg',
    });
  });

  it('an extra set does not become the AMRAP set — the proposal reads the planned sets (§3.4)', () => {
    const weekWithJoker: CycleHistory = {
      cycleNumber: 1,
      exercises: {
        [bench.identifier]: {
          sets: [
            { reps: 5, weight: 60, unit: 'kg' },
            { reps: 5, weight: 60, unit: 'kg' },
            { reps: 5, weight: 85, unit: 'kg' },
            { reps: 3, weight: 90, unit: 'kg' },
          ],
          proposalStatus: null,
        },
      },
    };

    const withoutExtra = proposeNextTargets(routine(), [entry({ reps: 5, weight: 85 })]);
    const withExtra = proposeNextTargets(routine(), [weekWithJoker]);

    expect(withExtra).toEqual(withoutExtra);
  });

  it('extra sets in every week leave the cycle-end TM proposal unchanged', () => {
    const weekWithJoker = (weekNumber: number, amrap: { reps: number; weight: number }): CycleHistory => {
      const weights = [60, 60, amrap.weight, amrap.weight + 5];
      const reps = [5, 5, amrap.reps, 3];
      return {
        cycleNumber: weekNumber,
        exercises: {
          [bench.identifier]: {
            sets: weights.map((weight, index) => ({
              reps: reps[index],
              weight,
              unit: 'kg' as const,
            })),
            proposalStatus: null,
          },
        },
      };
    };

    const plain = [
      entry({ reps: 5, weight: 85 }),
      entry({ reps: 3, weight: 90 }),
      entry({ reps: 5, weight: 95 }),
      entry({ reps: 5, weight: 60 }),
    ];
    const withJokers = [
      weekWithJoker(1, { reps: 5, weight: 85 }),
      weekWithJoker(2, { reps: 3, weight: 90 }),
      weekWithJoker(3, { reps: 5, weight: 95 }),
      weekWithJoker(4, { reps: 5, weight: 60 }),
    ];

    const plainProposals = proposeNextTargets(routine(), plain);
    const jokerProposals = proposeNextTargets(routine(), withJokers);

    expect(jokerProposals[1]).toMatchObject({
      currentTarget: 100,
      proposedTarget: 102.5,
      reason: 'hiciste 5, 3, 5 con 85 kg, 90 kg, 95 kg',
    });
    expect(jokerProposals).toEqual(plainProposals);
  });

  it('uses the lower-body increment for a lower exercise', () => {
    const proposals = proposeNextTargets(
      routine({}, [{ ...bench, category: 'lower' }]),
      [
        entry({ reps: 5, weight: 85 }),
        entry({ reps: 3, weight: 90 }),
        entry({ reps: 5, weight: 95 }),
        entry({ reps: 5, weight: 60 }),
      ],
    );

    expect(proposals[1]).toMatchObject({ currentTarget: 100, proposedTarget: 105 });
  });

  it.each([
    [100, 'kg', 105],
    [80, 'kg', 82.5],
    [225, 'lb', 235],
    [150, 'lb', 155],
  ] as const)(
    'infers the role from the training max when no category is set (TM %s %s)',
    (trainingMaxWeight, unit, proposedTarget) => {
      const proposals = proposeNextTargets(
        routine({ unit, roundingIncrement: unit === 'kg' ? 2.5 : 5 }, [
          { ...bench, trainingMaxWeight, unitOverride: unit, category: undefined },
        ]),
        [
          entry({ reps: 5, weight: 85 }, unit),
          entry({ reps: 3, weight: 90 }, unit),
          entry({ reps: 5, weight: 95 }, unit),
          entry({ reps: 5, weight: 60 }, unit),
        ],
      );

      expect(proposals[1]).toMatchObject({ currentTarget: trainingMaxWeight, proposedTarget });
    },
  );

  it('holds the TM when one AMRAP misses its target, without an advisory', () => {
    const proposals = proposeNextTargets(routine(), [
      entry({ reps: 5, weight: 85 }),
      entry({ reps: 2, weight: 90 }),
      entry({ reps: 5, weight: 95 }),
      entry({ reps: 5, weight: 60 }),
    ]);

    expect(proposals[1]).toEqual({
      exerciseIdentifier: 11,
      exerciseName: 'Press de banca',
      currentTarget: 100,
      proposedTarget: 100,
      unit: 'kg',
      reason: 'hiciste 5, 2, 5 con 85 kg, 90 kg, 95 kg — sin cumplir 1 objetivo',
      advisory: false,
    });
  });

  it('flags an advisory when two or more AMRAPs miss, and still proposes no change', () => {
    const proposals = proposeNextTargets(routine(), [
      entry({ reps: 4, weight: 85 }),
      entry({ reps: 2, weight: 90 }),
      entry({ reps: 5, weight: 95 }),
      entry({ reps: 5, weight: 60 }),
    ]);

    expect(proposals[1]).toMatchObject({
      currentTarget: 100,
      proposedTarget: 100,
      reason: 'hiciste 4, 2, 5 con 85 kg, 90 kg, 95 kg — sin cumplir 2 objetivos',
      advisory: true,
    });
  });

  it('ignores weeks with fewer than three logged sets in the AMRAP analysis', () => {
    const proposals = proposeNextTargets(routine(), [
      entry({ reps: 5, weight: 85 }),
      entry({ reps: 3, weight: 90 }, 'kg', 2, 2),
      entry({ reps: 5, weight: 95 }),
      entry({ reps: 5, weight: 60 }),
    ]);

    expect(proposals[1]).toMatchObject({
      proposedTarget: 102.5,
      reason: 'hiciste 5, 5 con 85 kg, 95 kg',
    });
  });

  it('proposes no TM when the cycle has no usable AMRAP results', () => {
    const proposals = proposeNextTargets(routine(), [
      entry({ reps: 5, weight: 85 }, 'kg', 1, 2),
      entry({ reps: 3, weight: 90 }, 'kg', 2, 2),
      entry({ reps: 5, weight: 95 }, 'kg', 3, 2),
      entry({ reps: 5, weight: 60 }),
    ]);

    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      currentTarget: 60,
      proposedTarget: 85,
    });
  });

  it('analyzes only the last cycle when several are complete', () => {
    const firstCycle = waveCycle([
      { reps: 5, weight: 85 },
      { reps: 3, weight: 90 },
      { reps: 5, weight: 95 },
      { reps: 5, weight: 60 },
    ]);
    const secondCycle = waveCycle([
      { reps: 4, weight: 87.5 },
      { reps: 3, weight: 92.5 },
      { reps: 1, weight: 97.5 },
      { reps: 5, weight: 62.5 },
    ]);

    const proposals = proposeNextTargets(routine(), [...firstCycle, ...secondCycle]);

    expect(proposals[1]).toMatchObject({
      currentTarget: 100,
      proposedTarget: 100,
      reason: 'hiciste 4, 3, 1 con 87.5 kg, 92.5 kg, 97.5 kg — sin cumplir 1 objetivo',
    });
  });
});
