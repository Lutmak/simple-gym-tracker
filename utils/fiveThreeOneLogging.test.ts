import {
  describeFiveThreeOneLink,
  isFiveThreeOneAmrapPr,
  isFiveThreeOneBelowTarget,
  type FiveThreeOneLinkForLogging,
} from './fiveThreeOneLogging';

const link = (overrides: Partial<FiveThreeOneLinkForLogging> = {}): FiveThreeOneLinkForLogging => ({
  workoutLinkId: 42,
  setNumber: 6,
  workSetNumber: 3,
  targetWeight: 85,
  targetReps: 5,
  isAmrap: true,
  isWarmup: false,
  warmupCompletedAt: null,
  ...overrides,
});

describe('fiveThreeOneLogging', () => {
  it('maps a work link to its independent 1-based work-set number', () => {
    expect(describeFiveThreeOneLink(link())).toMatchObject({
      displaySetNumber: 6,
      databaseSetNumber: 3,
      isWarmup: false,
    });
  });

  it('maps a warm-up link without a Weight_Log set number', () => {
    expect(
      describeFiveThreeOneLink(
        link({
          workoutLinkId: 39,
          setNumber: 3,
          workSetNumber: null,
          targetWeight: 60,
          targetReps: 3,
          isAmrap: false,
          isWarmup: true,
          warmupCompletedAt: null,
        }),
      ),
    ).toMatchObject({
      displaySetNumber: 3,
      databaseSetNumber: null,
      isWarmup: true,
    });
  });

  it('rejects a work link that could consume a fourth work-set number', () => {
    expect(() => describeFiveThreeOneLink(link({ workSetNumber: 4 }))).toThrow(
      'Work-set number must be between 1 and 3.',
    );
  });

  it('flags only positive actual reps below the programmed target', () => {
    expect(isFiveThreeOneBelowTarget(5, 4)).toBe(true);
    expect(isFiveThreeOneBelowTarget(5, 5)).toBe(false);
    expect(isFiveThreeOneBelowTarget(5, 6)).toBe(false);
    expect(isFiveThreeOneBelowTarget(5, null)).toBe(false);
  });

  it('treats the first AMRAP result and a new best as PRs', () => {
    expect(isFiveThreeOneAmrapPr(100, null)).toBe(true);
    expect(isFiveThreeOneAmrapPr(101, 100)).toBe(true);
    expect(isFiveThreeOneAmrapPr(100, 100)).toBe(false);
    expect(isFiveThreeOneAmrapPr(99, 100)).toBe(false);
  });
});
