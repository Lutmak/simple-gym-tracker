import {
  DEFAULT_SETUP_LIFTS,
  normalizeDaySlots,
  validateSetup,
} from './fiveThreeOneSetup';

describe('fiveThreeOneSetup', () => {
  it('provides the four default lifts with unique day slots', () => {
    expect(DEFAULT_SETUP_LIFTS.map((lift) => lift.name)).toEqual([
      'Squat',
      'Bench Press',
      'Deadlift',
      'Overhead Press',
    ]);
    expect(DEFAULT_SETUP_LIFTS.map((lift) => lift.daySlot)).toEqual([1, 2, 3, 4]);
  });

  it('preserves valid slots and fills the next available slot for a new lift', () => {
    const normalized = normalizeDaySlots([
      { id: 'squat', daySlot: 1 },
      { id: 'deadlift', daySlot: 3 },
      { id: 'new', daySlot: null },
    ]);

    expect(normalized).toEqual([
      { id: 'squat', daySlot: 1 },
      { id: 'deadlift', daySlot: 3 },
      { id: 'new', daySlot: 2 },
    ]);
  });

  it('repairs duplicate or invalid slots without changing lift order', () => {
    const normalized = normalizeDaySlots([
      { id: 'first', daySlot: 2 },
      { id: 'second', daySlot: 2 },
      { id: 'third', daySlot: 0 },
    ]);

    expect(normalized.map((lift) => lift.id)).toEqual(['first', 'second', 'third']);
    expect(normalized.map((lift) => lift.daySlot)).toEqual([2, 1, 3]);
  });

  it('rejects missing names, non-positive training maxes, and duplicate slots', () => {
    expect(
      validateSetup({
        programName: 'Strength',
        unit: 'kg',
        roundingIncrement: 2.5,
        roundingDirection: 'nearest',
        tmPercentage: 0.9,
        lifts: [
          {
            name: '',
            category: 'lower',
            trainingMax: 100,
            daySlot: 1,
            assistanceTemplateId: 1,
          },
        ],
      }),
    ).toBe('lift-name-required');

    expect(
      validateSetup({
        programName: 'Strength',
        unit: 'kg',
        roundingIncrement: 2.5,
        roundingDirection: 'nearest',
        tmPercentage: 0.9,
        lifts: [
          {
            name: 'Squat',
            category: 'lower',
            trainingMax: 0,
            daySlot: 1,
            assistanceTemplateId: 1,
          },
        ],
      }),
    ).toBe('training-max-positive');

    expect(
      validateSetup({
        programName: 'Strength',
        unit: 'kg',
        roundingIncrement: 2.5,
        roundingDirection: 'nearest',
        tmPercentage: 0.9,
        lifts: [
          {
            name: 'Squat',
            category: 'lower',
            trainingMax: 100,
            daySlot: 1,
            assistanceTemplateId: 1,
          },
          {
            name: 'Bench Press',
            category: 'upper',
            trainingMax: 70,
            daySlot: 1,
            assistanceTemplateId: 1,
          },
        ],
      }),
    ).toBe('duplicate-day-slot');
  });

  it('accepts a complete setup and rejects invalid unit or rounding choices', () => {
    const validSetup = {
      programName: 'Strength',
      unit: 'kg',
      roundingIncrement: 2.5,
      roundingDirection: 'nearest',
      tmPercentage: 0.9,
      lifts: [
        {
          name: 'Squat',
          category: 'lower',
          trainingMax: 100,
          daySlot: 1,
          assistanceTemplateId: 1,
        },
      ],
    };

    expect(validateSetup(validSetup)).toBeNull();
    expect(validateSetup({ ...validSetup, unit: 'stone' })).toBe('unit-invalid');
    expect(validateSetup({ ...validSetup, roundingIncrement: 0 })).toBe(
      'rounding-increment-positive',
    );
    expect(validateSetup({ ...validSetup, roundingDirection: 'sideways' })).toBe(
      'rounding-direction-invalid',
    );
  });
});
