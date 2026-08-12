import {
  canGenerateFiveThreeOneNextCycle,
  decideFiveThreeOneSuggestion,
  prepareFiveThreeOneSuggestion,
  type FiveThreeOneProgressionLift,
  type FiveThreeOneReviewAmrapResult,
} from './fiveThreeOneProgression';

const squat: FiveThreeOneProgressionLift = {
  liftId: 11,
  name: 'Squat',
  category: 'lower',
  trainingMax: 180,
  unit: 'kg',
  upperIncrement: 2.5,
  lowerIncrement: 5,
};

const result = (
  overrides: Partial<FiveThreeOneReviewAmrapResult> = {},
): FiveThreeOneReviewAmrapResult => ({
  weekNumber: 1,
  targetReps: 5,
  actualReps: 5,
  weight: 150,
  estimated1RM: 175,
  ...overrides,
});

describe('fiveThreeOneProgression', () => {
  it('prepares a pending hold and advisory when a lift has no AMRAP result', () => {
    expect(
      prepareFiveThreeOneSuggestion(squat, [], { suggestedTM: null, status: null }),
    ).toEqual({
      liftId: 11,
      liftName: 'Squat',
      unit: 'kg',
      currentTM: 180,
      suggestedTM: 180,
      increment: null,
      performance: 'no-amrap',
      missedTargets: 0,
      reviewRequired: false,
      advisory: 'no-amrap',
      status: 'pending',
    });
  });

  it('uses linked target reps and actual reps for B2 suggestions', () => {
    expect(
      prepareFiveThreeOneSuggestion(
        squat,
        [result(), result({ weekNumber: 2, targetReps: 3, actualReps: 3 })],
        { suggestedTM: null, status: null },
      ),
    ).toMatchObject({
      liftId: 11,
      suggestedTM: 185,
      currentTM: 180,
      performance: 'met',
      status: 'pending',
      advisory: null,
    });
  });

  it('preserves a resolved persisted decision when a review is reloaded', () => {
    expect(
      prepareFiveThreeOneSuggestion(
        squat,
        [result()],
        { suggestedTM: 185, status: 'accepted' },
      ),
    ).toMatchObject({
      currentTM: 180,
      suggestedTM: 185,
      status: 'accepted',
    });
  });

  it('marks repeated underperformance as an advisory without lowering the TM', () => {
    expect(
      prepareFiveThreeOneSuggestion(
        squat,
        [
          result({ actualReps: 4 }),
          result({ weekNumber: 2, targetReps: 3, actualReps: 2 }),
          result({ weekNumber: 3, targetReps: 1, actualReps: 1 }),
        ],
        { suggestedTM: null, status: null },
      ),
    ).toMatchObject({
      suggestedTM: 180,
      performance: 'mixed',
      missedTargets: 2,
      reviewRequired: true,
      advisory: 'repeated-underperformance',
    });
  });

  it('accepts the suggestion, validates edits, and never changes TM on decline', () => {
    expect(
      decideFiveThreeOneSuggestion({
        currentTM: 180,
        suggestedTM: 185,
        decision: 'accept',
      }),
    ).toEqual({ trainingMax: 185, suggestedTM: 185, status: 'accepted' });

    expect(
      decideFiveThreeOneSuggestion({
        currentTM: 180,
        suggestedTM: 185,
        decision: 'edit',
        editedTM: 182.5,
      }),
    ).toEqual({ trainingMax: 182.5, suggestedTM: 182.5, status: 'edited' });

    expect(
      decideFiveThreeOneSuggestion({
        currentTM: 180,
        suggestedTM: 185,
        decision: 'decline',
      }),
    ).toEqual({ trainingMax: 180, suggestedTM: 185, status: 'declined' });

    expect(() =>
      decideFiveThreeOneSuggestion({
        currentTM: 180,
        suggestedTM: 185,
        decision: 'edit',
        editedTM: 0,
      }),
    ).toThrow('Edited training max must be a finite number greater than zero.');
  });

  it('blocks next-cycle generation until every lift has a resolved positive suggestion', () => {
    expect(
      canGenerateFiveThreeOneNextCycle([
        { suggestedTM: 185, status: 'accepted' },
        { suggestedTM: 60, status: 'declined' },
        { suggestedTM: null, status: 'pending' },
      ]),
    ).toBe(false);

    expect(
      canGenerateFiveThreeOneNextCycle([
        { suggestedTM: 185, status: 'accepted' },
        { suggestedTM: 60, status: 'edited' },
        { suggestedTM: 100, status: 'declined' },
      ]),
    ).toBe(true);
  });
});
