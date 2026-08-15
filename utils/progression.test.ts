import {
  proposeNextTargets,
  waveProposeNextTargets,
  type CycleHistory,
  type PerformedSet,
  type ProposalStatus,
  type RoutineExercise,
  type RoutineLike,
} from './progression';

const squat: RoutineExercise = {
  identifier: 1,
  name: 'Squat',
  targetSets: 3,
  targetReps: 5,
  loadSource: 'absolute',
  unitOverride: null,
  absoluteWeight: 100,
  trainingMaxWeight: null,
  trainingMaxPct: null,
};

const routine = (
  overrides: Partial<RoutineLike> = {},
  exercises: RoutineExercise[] = [squat],
): RoutineLike => ({
  unit: 'kg',
  roundingIncrement: 2.5,
  progressionRule: 'linear',
  exercises,
  ...overrides,
});

const set = (
  reps: number,
  weight: number,
  unit: PerformedSet['unit'] = 'kg',
): PerformedSet => ({ reps, weight, unit });

const cycle = (
  sets: PerformedSet[],
  proposalStatus: ProposalStatus | null = null,
): CycleHistory => ({
  cycleNumber: 1,
  exercises: {
    [squat.identifier]: { sets, proposalStatus },
  },
});

describe('progression — linear rule', () => {
  it('proposes current plus the increment when all target sets and reps are met', () => {
    const proposals = proposeNextTargets(
      routine(),
      [cycle([set(5, 100), set(5, 100), set(5, 100)])],
    );

    expect(proposals).toEqual([
      {
        exerciseIdentifier: 1,
        exerciseName: 'Squat',
        currentTarget: 100,
        proposedTarget: 102.5,
        unit: 'kg',
        reason: 'hiciste 5, 5, 5 con 100 kg',
        advisory: false,
      },
    ]);
  });

  it('rounds the proposed target to the routine rounding increment', () => {
    const proposals = proposeNextTargets(
      routine({}, [{ ...squat, absoluteWeight: 101 }]),
      [cycle([set(5, 101), set(5, 101), set(5, 101)])],
    );

    expect(proposals[0].proposedTarget).toBe(102.5);
  });

  it('increments an lb routine in pounds', () => {
    const proposals = proposeNextTargets(
      routine({ unit: 'lb', roundingIncrement: 5 }),
      [cycle([set(5, 100, 'lb'), set(5, 100, 'lb'), set(5, 100, 'lb')])],
    );

    expect(proposals[0]).toMatchObject({ proposedTarget: 105, unit: 'lb' });
  });

  it('increments an lb-override exercise in pounds inside a kg routine', () => {
    const proposals = proposeNextTargets(
      routine({}, [{ ...squat, unitOverride: 'lb' }]),
      [cycle([set(5, 100, 'lb'), set(5, 100, 'lb'), set(5, 100, 'lb')])],
    );

    expect(proposals[0]).toMatchObject({ proposedTarget: 102.5, unit: 'lb' });
  });

  it('holds at the current target when a set is missing', () => {
    const proposals = proposeNextTargets(
      routine(),
      [cycle([set(5, 100), set(5, 100)])],
    );

    expect(proposals[0]).toMatchObject({
      currentTarget: 100,
      proposedTarget: 100,
      reason: 'te faltó 1 serie (hiciste 2 de 3)',
      advisory: false,
    });
  });

  it('holds and names the set and missed reps when a set is short on reps', () => {
    const proposals = proposeNextTargets(
      routine(),
      [cycle([set(5, 100), set(3, 100), set(5, 100)])],
    );

    expect(proposals[0]).toMatchObject({
      proposedTarget: 100,
      reason: 'te faltaron 2 reps en la serie 2 (hiciste 3 de 5)',
    });
  });

  it('holds with a no-history reason when the cycle has no logged sets', () => {
    const proposals = proposeNextTargets(routine(), []);

    expect(proposals[0]).toMatchObject({
      proposedTarget: 100,
      reason: 'sin registros este ciclo',
      advisory: false,
    });
  });

  it('extra sets never move the proposal — only the first targetSets sets are read (§3.4)', () => {
    const planned = proposeNextTargets(
      routine(),
      [cycle([set(5, 100), set(5, 100), set(5, 100)])],
    );
    const withExtras = proposeNextTargets(
      routine(),
      [cycle([set(5, 100), set(5, 100), set(5, 100), set(3, 110), set(1, 115)])],
    );

    expect(withExtras).toEqual(planned);
  });

  it('extra sets cannot rescue a short session — a missed planned set still holds', () => {
    const proposals = proposeNextTargets(
      routine(),
      [cycle([set(5, 100), set(5, 100), set(3, 100), set(5, 110)])],
    );

    expect(proposals[0]).toMatchObject({
      proposedTarget: 100,
      reason: 'te faltaron 2 reps en la serie 3 (hiciste 3 de 5)',
    });
  });

  it('flags an advisory when the previous cycle also held, but never changes the target', () => {
    const proposals = proposeNextTargets(routine(), [
      cycle([set(5, 100), set(5, 100)], 'held'),
      cycle([set(5, 100), set(3, 100), set(5, 100)]),
    ]);

    expect(proposals[0]).toMatchObject({ proposedTarget: 100, advisory: true });
  });

  it('does not flag an advisory when the previous cycle resolved with a decision other than held', () => {
    const proposals = proposeNextTargets(routine(), [
      cycle([set(5, 100), set(5, 100), set(5, 100)], 'accepted'),
      cycle([set(5, 100), set(3, 100), set(5, 100)]),
    ]);

    expect(proposals[0]).toMatchObject({ advisory: false });
  });

  it('states every logged weight in the reason when the sets differ', () => {
    const proposals = proposeNextTargets(routine(), [
      cycle([set(5, 100), set(5, 102.5), set(5, 100)]),
    ]);

    expect(proposals[0].reason).toBe('hiciste 5, 5, 5 con 100 kg, 102.5 kg, 100 kg');
  });

  it('derives the current target from the training max for training_max_pct loads', () => {
    const proposals = proposeNextTargets(
      routine({}, [
        {
          ...squat,
          loadSource: 'training_max_pct',
          trainingMaxWeight: 200,
          trainingMaxPct: 0.9,
          absoluteWeight: null,
        },
      ]),
      [cycle([set(5, 180), set(5, 180), set(5, 180)])],
    );

    expect(proposals[0]).toMatchObject({ currentTarget: 180, proposedTarget: 182.5 });
  });

  it('proposes nothing for bodyweight exercises', () => {
    const pullUps: RoutineExercise = {
      identifier: 2,
      name: 'Pull-ups',
      targetSets: 3,
      targetReps: 8,
      loadSource: 'bodyweight',
      unitOverride: null,
      absoluteWeight: null,
      trainingMaxWeight: null,
      trainingMaxPct: null,
    };

    const proposals = proposeNextTargets(routine({}, [squat, pullUps]), [
      {
        cycleNumber: 1,
        exercises: {
          [squat.identifier]: {
            sets: [set(5, 100), set(5, 100), set(5, 100)],
            proposalStatus: null,
          },
          [pullUps.identifier]: {
            sets: [set(8, 0), set(8, 0), set(8, 0)],
            proposalStatus: null,
          },
        },
      },
    ]);

    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ exerciseIdentifier: 1, proposedTarget: 102.5 });
  });

  it('proposes nothing for a wave routine with no history', () => {
    expect(proposeNextTargets(routine({ progressionRule: 'wave' }), [])).toEqual([]);
    expect(waveProposeNextTargets(routine({ progressionRule: 'wave' }), [])).toEqual([]);
  });

  it('proposes nothing for a none-rule routine', () => {
    expect(proposeNextTargets(routine({ progressionRule: 'none' }), [])).toEqual([]);
  });
});
