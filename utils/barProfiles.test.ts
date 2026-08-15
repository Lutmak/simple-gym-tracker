import {
  BAR_PROFILES,
  barWeightFor,
  composeLoad,
  convertWeight,
  defaultBarProfileForEquipment,
  suggestPlates,
  STANDARD_PLATES,
} from './barProfiles';

describe('defaultBarProfileForEquipment — the catalog mapping', () => {
  it('maps the barbell family to olympic and everything else to no bar', () => {
    expect(defaultBarProfileForEquipment('barbell')).toBe('olympic');
    for (const equipment of [
      null,
      'dumbbell',
      'machine',
      'cable',
      'kettlebells',
      'body only',
      'other',
      'bands',
      'exercise ball',
      'medicine ball',
      'foam roll',
    ]) {
      expect(defaultBarProfileForEquipment(equipment)).toBeNull();
    }
  });
});

describe('BAR_PROFILES and barWeightFor', () => {
  it('carries the conventional weights per profile', () => {
    expect(BAR_PROFILES.olympic).toEqual({ key: 'olympic', weightKg: 20, weightLb: 45 });
    expect(BAR_PROFILES['semi-olympic']).toEqual({
      key: 'semi-olympic',
      weightKg: 15,
      weightLb: 33,
    });
    expect(BAR_PROFILES.smith.weightKg).toBe(15);
    expect(BAR_PROFILES.ez.weightKg).toBe(8);
  });

  it('resolves the bar weight in the exercise unit, custom bars from the column', () => {
    expect(barWeightFor('olympic', null, 'kg')).toBe(20);
    expect(barWeightFor('olympic', null, 'lb')).toBe(45);
    expect(barWeightFor('semi-olympic', null, 'kg')).toBe(15);
    expect(barWeightFor('custom', 27.5, 'kg')).toBe(27.5);
    expect(barWeightFor('custom', 60, 'lb')).toBe(60);
    expect(barWeightFor(null, null, 'kg')).toBeNull();
    expect(barWeightFor(null, 20, 'kg')).toBeNull();
  });
});

describe('convertWeight', () => {
  it('converts kg to lb and back, and is a no-op within a unit', () => {
    expect(convertWeight(20, 'kg', 'lb')).toBeCloseTo(44.09, 1);
    expect(convertWeight(45, 'lb', 'kg')).toBeCloseTo(20.41, 1);
    expect(convertWeight(20, 'kg', 'kg')).toBe(20);
    expect(convertWeight(45, 'lb', 'lb')).toBe(45);
  });
});

describe('composeLoad — exact arithmetic', () => {
  it('sums bar plus both sides', () => {
    expect(composeLoad(20, [])).toBe(20);
    expect(composeLoad(20, [20])).toBe(60);
    expect(composeLoad(20, [20, 10])).toBe(80);
    expect(composeLoad(20, [20, 20, 1.25])).toBe(102.5);
    expect(composeLoad(45, [45, 25])).toBe(185);
  });
});

describe('suggestPlates — the inverse as a suggestion', () => {
  it('splits a total into the fewest plates per side, larger plates first', () => {
    // 100 total on a 20 kg bar = 40 per side = 20 + 20.
    expect(suggestPlates(100, 20)).toEqual([20, 20]);
    // 102.5 = 41.25 per side = 20 + 20 + 1.25 — the 2.5 kg step the set bottoms out at.
    expect(suggestPlates(102.5, 20)).toEqual([20, 20, 1.25]);
    // 90 = 35 per side: 25 + 10 beats 20 + 10 + 5 (same count? no: two plates win over three).
    expect(suggestPlates(90, 20)).toEqual([25, 10]);
    // 140 = 60 per side: 25 + 25 + 10.
    expect(suggestPlates(140, 20)).toEqual([25, 25, 10]);
  });

  it('handles a bar-only total', () => {
    expect(suggestPlates(20, 20)).toEqual([]);
  });

  it('uses the lb set for lb bars', () => {
    // 135 lb total on a 45 lb bar = 45 per side.
    expect(suggestPlates(135, 45, STANDARD_PLATES.lb)).toEqual([45]);
    // 225 = 90 per side = 45 + 45.
    expect(suggestPlates(225, 45, STANDARD_PLATES.lb)).toEqual([45, 45]);
  });

  it('returns null for a total the standard plates cannot make — never an error', () => {
    // 100.75 on a 20 kg bar needs 40.375 per side; no plate combo sums to it.
    expect(suggestPlates(100.75, 20)).toBeNull();
    // A total below the bar is impossible too.
    expect(suggestPlates(10, 20)).toBeNull();
    // Negative and non-finite inputs fail the same way.
    expect(suggestPlates(-50, 20)).toBeNull();
    expect(suggestPlates(NaN, 20)).toBeNull();
  });

  it('finds an exact composition even where greedy loading would fail', () => {
    // With plates {3, 4}, per side 6: a greedy load takes 4 and then cannot
    // make 2, but 3 + 3 is exact. The search must find it.
    expect(suggestPlates(12, 0, [3, 4])).toEqual([3, 3]);
  });

  it('respects a caller-supplied plate set', () => {
    expect(suggestPlates(80, 20, [5, 10])).toEqual([10, 10, 10]);
    // 30.5 per side cannot be made from 2.5 plates alone.
    expect(suggestPlates(81, 20, [2.5])).toBeNull();
  });
});
