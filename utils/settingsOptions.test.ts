import {
  DEFAULT_BAR_PROFILE,
  LANGUAGE_OPTIONS,
  ROUNDING_INCREMENTS,
  SETTABLE_BAR_PROFILES,
  WEIGHT_FORMAT_OPTIONS,
  barProfileOptions,
  dateFormatOptions,
  dateFormatSample,
  defaultRoundingIncrement,
  firstWeekdayOptions,
  formatTimeOfDay,
  resolveBarProfile,
  resolveRoundingIncrement,
  roundingIncrementOnUnitChange,
  roundingIncrementOptions,
  routineUnitFor,
  timeFormatOptions,
  weightFormatFor,
} from './settingsOptions';

describe('weight format and routine unit', () => {
  it('maps the stored format onto the routine unit and back', () => {
    expect(routineUnitFor('lbs')).toBe('lb');
    expect(routineUnitFor('kg')).toBe('kg');
    expect(weightFormatFor('lb')).toBe('lbs');
    expect(weightFormatFor('kg')).toBe('kg');
  });

  it('falls back to kg for a stored value it does not recognise', () => {
    expect(routineUnitFor('stones')).toBe('kg');
    expect(routineUnitFor('')).toBe('kg');
  });

  it('offers exactly the two units the app stores', () => {
    expect(WEIGHT_FORMAT_OPTIONS.map((option) => option.value)).toEqual(['kg', 'lbs']);
  });
});

describe('languages', () => {
  it('offers the locales the app registers, named in themselves', () => {
    expect(LANGUAGE_OPTIONS).toEqual([
      { value: 'en', labelKey: 'languageEnglish' },
      { value: 'es', labelKey: 'languageSpanish' },
    ]);
  });
});

describe('rounding increment defaults', () => {
  it('defaults to the unit convention', () => {
    expect(defaultRoundingIncrement('kg')).toBe(2.5);
    expect(defaultRoundingIncrement('lb')).toBe(5);
  });

  it('keeps a stored increment the unit offers', () => {
    expect(resolveRoundingIncrement(1, 'kg')).toBe(1);
    expect(resolveRoundingIncrement(10, 'lb')).toBe(10);
  });

  it('falls back to the default for anything the unit does not offer', () => {
    expect(resolveRoundingIncrement(1, 'lb')).toBe(5);
    expect(resolveRoundingIncrement(undefined, 'kg')).toBe(2.5);
    expect(resolveRoundingIncrement('2.5', 'kg')).toBe(2.5);
    expect(resolveRoundingIncrement(null, 'lb')).toBe(5);
    expect(resolveRoundingIncrement(0, 'kg')).toBe(2.5);
  });

  it('moves an untouched increment to the new unit convention', () => {
    expect(roundingIncrementOnUnitChange(2.5, 'kg', 'lb')).toBe(5);
    expect(roundingIncrementOnUnitChange(5, 'lb', 'kg')).toBe(2.5);
  });

  it('keeps a chosen increment the new unit can express', () => {
    expect(roundingIncrementOnUnitChange(5, 'kg', 'lb')).toBe(5);
    expect(roundingIncrementOnUnitChange(2.5, 'lb', 'kg')).toBe(2.5);
  });

  it('falls back when the chosen increment has no meaning in the new unit', () => {
    expect(roundingIncrementOnUnitChange(1, 'kg', 'lb')).toBe(5);
    expect(roundingIncrementOnUnitChange(10, 'lb', 'kg')).toBe(2.5);
  });

  it('resolves rather than trusts when the unit did not change', () => {
    expect(roundingIncrementOnUnitChange(1, 'kg', 'kg')).toBe(1);
    expect(roundingIncrementOnUnitChange(99, 'kg', 'kg')).toBe(2.5);
  });

  it('labels every option with its value and unit', () => {
    expect(roundingIncrementOptions('kg')).toEqual([
      { value: '1', labelKey: 'settingsIncrementOption', labelParams: { value: '1', unit: 'kg' } },
      { value: '2.5', labelKey: 'settingsIncrementOption', labelParams: { value: '2.5', unit: 'kg' } },
      { value: '5', labelKey: 'settingsIncrementOption', labelParams: { value: '5', unit: 'kg' } },
    ]);
    expect(roundingIncrementOptions('lb').map((option) => option.value)).toEqual([
      '2.5',
      '5',
      '10',
    ]);
  });

  it('offers its own default in every unit', () => {
    expect(ROUNDING_INCREMENTS.kg).toContain(defaultRoundingIncrement('kg'));
    expect(ROUNDING_INCREMENTS.lb).toContain(defaultRoundingIncrement('lb'));
  });
});

describe('default bar profile', () => {
  it('never offers a custom bar as an app-wide default', () => {
    expect(SETTABLE_BAR_PROFILES).not.toContain('custom');
  });

  it('resolves an unknown or absent stored profile to the olympic bar', () => {
    expect(resolveBarProfile(undefined)).toBe(DEFAULT_BAR_PROFILE);
    expect(resolveBarProfile('custom')).toBe('olympic');
    expect(resolveBarProfile('trap')).toBe('olympic');
    expect(resolveBarProfile(20)).toBe('olympic');
  });

  it('keeps a stored profile it offers', () => {
    expect(resolveBarProfile('ez')).toBe('ez');
    expect(resolveBarProfile('semi-olympic')).toBe('semi-olympic');
  });

  it("states each bar's own weight in the chosen unit, never a conversion", () => {
    expect(barProfileOptions('kg')).toEqual([
      { value: 'olympic', labelKey: 'settingsBarOlympic', labelParams: { weight: '20', unit: 'kg' } },
      {
        value: 'semi-olympic',
        labelKey: 'settingsBarSemiOlympic',
        labelParams: { weight: '15', unit: 'kg' },
      },
      { value: 'smith', labelKey: 'settingsBarSmith', labelParams: { weight: '15', unit: 'kg' } },
      { value: 'ez', labelKey: 'settingsBarEz', labelParams: { weight: '8', unit: 'kg' } },
    ]);
    expect(barProfileOptions('lb').map((option) => option.labelParams?.weight)).toEqual([
      '45',
      '33',
      '33',
      '18',
    ]);
  });
});

describe('date, time and week formats', () => {
  it('shows a date format as the date it produces', () => {
    expect(dateFormatSample('dd-mm-yyyy')).toBe('31-12-2026');
    expect(dateFormatSample('mm-dd-yyyy')).toBe('12-31-2026');
  });

  it('labels both date options with their sample', () => {
    expect(dateFormatOptions()).toEqual([
      {
        value: 'dd-mm-yyyy',
        labelKey: 'settingsDateFormatOption',
        labelParams: { sample: '31-12-2026' },
      },
      {
        value: 'mm-dd-yyyy',
        labelKey: 'settingsDateFormatOption',
        labelParams: { sample: '12-31-2026' },
      },
    ]);
  });

  it('names the clock in both time options', () => {
    expect(timeFormatOptions()).toEqual([
      { value: '24h', labelKey: 'settingsTimeFormat24' },
      { value: 'AM/PM', labelKey: 'settingsTimeFormat12' },
    ]);
  });

  it('offers Monday first, then Sunday, through the shared weekday keys', () => {
    expect(firstWeekdayOptions()).toEqual([
      { value: 'Monday', labelKey: 'weekdayFullMon' },
      { value: 'Sunday', labelKey: 'weekdayFullSun' },
    ]);
  });
});

describe('formatTimeOfDay', () => {
  it('keeps a 24-hour time padded', () => {
    expect(formatTimeOfDay('08:00', '24h')).toBe('08:00');
    expect(formatTimeOfDay('18:30', '24h')).toBe('18:30');
  });

  it('renders a 12-hour time with its suffix', () => {
    expect(formatTimeOfDay('18:30', 'AM/PM')).toBe('6:30 PM');
    expect(formatTimeOfDay('08:05', 'AM/PM')).toBe('8:05 AM');
  });

  it('handles both ends of the day', () => {
    expect(formatTimeOfDay('00:05', 'AM/PM')).toBe('12:05 AM');
    expect(formatTimeOfDay('12:00', 'AM/PM')).toBe('12:00 PM');
    expect(formatTimeOfDay('23:59', 'AM/PM')).toBe('11:59 PM');
  });

  it('returns anything that is not a time of day unchanged', () => {
    expect(formatTimeOfDay('', '24h')).toBe('');
    expect(formatTimeOfDay('25:00', 'AM/PM')).toBe('25:00');
    expect(formatTimeOfDay('8:00', '24h')).toBe('8:00');
  });
});
