import {
  PLANNED_JOKERS_MAX,
  plannedJokerWeights,
  proposeJokerWeight,
} from './jokers';

describe('proposeJokerWeight — the next weight step (§3.4)', () => {
  it('adds one rounding increment on the routine grid', () => {
    expect(proposeJokerWeight(100, 2.5)).toBe(102.5);
    expect(proposeJokerWeight(102.5, 2.5)).toBe(105);
    expect(proposeJokerWeight(200, 5)).toBe(205);
    expect(proposeJokerWeight(97.5, 2.5)).toBe(100);
  });
});

describe('plannedJokerWeights — planned ahead, with a cap', () => {
  it('returns the first count steps above the current weight', () => {
    expect(plannedJokerWeights(100, 2.5, 2)).toEqual([102.5, 105]);
    expect(plannedJokerWeights(100, 2.5, 0)).toEqual([]);
  });

  it('never plans more than the cap, whatever the caller asks for', () => {
    expect(plannedJokerWeights(100, 2.5, PLANNED_JOKERS_MAX)).toHaveLength(PLANNED_JOKERS_MAX);
    expect(plannedJokerWeights(100, 2.5, 99)).toHaveLength(PLANNED_JOKERS_MAX);
    expect(plannedJokerWeights(100, 2.5, -1)).toEqual([]);
  });
});
