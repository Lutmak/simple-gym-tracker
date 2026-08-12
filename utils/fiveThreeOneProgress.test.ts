import {
  buildFiveThreeOneProgressSeries,
  type FiveThreeOneAmrapProgressRow,
  type FiveThreeOneTrainingMaxSnapshot,
} from './fiveThreeOneProgress';

const snapshot = (
  overrides: Partial<FiveThreeOneTrainingMaxSnapshot> = {},
): FiveThreeOneTrainingMaxSnapshot => ({
  cycleId: 1,
  cycleNumber: 1,
  trainingMax: 100,
  ...overrides,
});

const amrap = (
  overrides: Partial<FiveThreeOneAmrapProgressRow> = {},
): FiveThreeOneAmrapProgressRow => ({
  amrapResultId: 1,
  cycleId: 1,
  cycleNumber: 1,
  weekNumber: 1,
  reps: 8,
  estimated1RM: 122,
  targetReps: 5,
  ...overrides,
});

describe('fiveThreeOneProgress', () => {
  it('groups training-max snapshots by cycle and appends the current TM', () => {
    const progress = buildFiveThreeOneProgressSeries({
      currentTrainingMax: 110,
      trainingMaxSnapshots: [
        snapshot({ cycleId: 2, cycleNumber: 2, trainingMax: 105 }),
        snapshot({ cycleId: 1, cycleNumber: 1, trainingMax: 100 }),
        snapshot({ cycleId: 1, cycleNumber: 1, trainingMax: 100 }),
      ],
      amrapResults: [],
    });

    expect(progress.trainingMax).toEqual([
      { label: 'C1', value: 100 },
      { label: 'C2', value: 105 },
      { label: 'Current', value: 110 },
    ]);
  });

  it('labels AMRAP values by cycle and week slot', () => {
    const progress = buildFiveThreeOneProgressSeries({
      currentTrainingMax: 100,
      trainingMaxSnapshots: [],
      amrapResults: [
        amrap({
          amrapResultId: 2,
          cycleId: 2,
          cycleNumber: 2,
          weekNumber: 3,
          reps: 4,
          targetReps: 1,
        }),
        amrap({ reps: 7, estimated1RM: 120 }),
      ],
    });

    expect(progress.amrapReps).toEqual([
      { label: 'C1 W1', value: 7, cycleNumber: 1, weekNumber: 1, targetReps: 5 },
      { label: 'C2 W3', value: 4, cycleNumber: 2, weekNumber: 3, targetReps: 1 },
    ]);
  });

  it('uses stored estimated 1RM values in the same cycle/week order', () => {
    const progress = buildFiveThreeOneProgressSeries({
      currentTrainingMax: 100,
      trainingMaxSnapshots: [],
      amrapResults: [
        amrap({
          amrapResultId: 2,
          cycleId: 2,
          cycleNumber: 2,
          weekNumber: 1,
          estimated1RM: 130,
        }),
        amrap({ estimated1RM: 122 }),
      ],
    });

    expect(progress.estimated1RM).toEqual([
      { label: 'C1 W1', value: 122 },
      { label: 'C2 W1', value: 130 },
    ]);
  });

  it('keeps empty AMRAP and estimated-1RM series empty', () => {
    const progress = buildFiveThreeOneProgressSeries({
      currentTrainingMax: 100,
      trainingMaxSnapshots: [],
      amrapResults: [],
    });

    expect(progress.trainingMax).toEqual([{ label: 'Current', value: 100 }]);
    expect(progress.amrapReps).toEqual([]);
    expect(progress.estimated1RM).toEqual([]);
  });
});
