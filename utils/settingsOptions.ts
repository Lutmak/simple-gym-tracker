/**
 * S1/S2 — everything the Ajustes screen derives, as pure functions.
 *
 * The screen is composition only (ENGINEERING.md §3.5): it maps these option
 * descriptors through `t()` and hands them to `SegmentedControl`. Nothing here
 * knows about React, and nothing in the screen decides what an option is, what
 * it is called, or what happens when the unit changes.
 *
 * Two decisions are recorded here because they are the substance of S2:
 *
 * 1. **An option's label states the choice it makes.** A time format is
 *    `12 horas (AM/PM)` and `24 horas`, never `AM/PM` against a bare `24`; a
 *    date format shows the date it produces (`31-12-2026`), because a sample is
 *    the shortest possible explanation of a date format; a bar states its
 *    weight in the unit the user just chose. A label that needs a manual is not
 *    a label (§7.5).
 * 2. **These are defaults for new routines, and nothing converts.** The unit,
 *    the rounding increment and the bar profile seed a routine when it is
 *    created; changing them later never rewrites a routine, an exercise or a
 *    logged set. The screen says so under each control; this module never
 *    offers a conversion, which is the mechanical half of the same promise.
 *
 * A **custom bar weight is deliberately not offered as an app-wide default.**
 * A custom bar is one gym's one bar, which is why H4 sets it on the exercise
 * and says "from now on" — an app-wide custom weight would be a number asked
 * for before it can mean anything (§7.3). The four conventional profiles are
 * the defaults; `custom` stays per exercise.
 */

import { BAR_PROFILES, formatWeight, type BarProfileKey } from './barProfiles';
import type { RoutineUnit } from './routineActions';
import { ROUNDING_INCREMENT_OPTIONS, WAVE_UNIT_DEFAULTS } from './waveSetup';

/** The stored weight-format value. `lbs` is the historical spelling and is kept. */
export type WeightFormat = 'kg' | 'lbs';
export type DateFormat = 'dd-mm-yyyy' | 'mm-dd-yyyy';
export type TimeFormat = '24h' | 'AM/PM';
export type FirstWeekday = 'Sunday' | 'Monday';

/**
 * One choice in a settings control: the value that is stored, and the
 * translation key (plus interpolation) that names it. The key never leaves this
 * module as text — `locales/` owns the words, both languages of them.
 */
export interface SettingOption<T extends string> {
  value: T;
  labelKey: string;
  labelParams?: Record<string, string | number>;
}

/**
 * The languages the app ships, named in themselves — a language list that
 * translates its own entries makes the one entry the reader needs unreadable.
 * Mirrors `SUPPORTED_LOCALES` in `utils/i18n.ts`, which cannot be imported here
 * without dragging the i18next runtime into a pure module.
 */
export const LANGUAGE_OPTIONS: readonly SettingOption<string>[] = [
  { value: 'en', labelKey: 'languageEnglish' },
  { value: 'es', labelKey: 'languageSpanish' },
];

/** The routine unit a stored weight format means. */
export function routineUnitFor(weightFormat: string): RoutineUnit {
  return weightFormat === 'lbs' ? 'lb' : 'kg';
}

/** The stored weight format a routine unit means — the inverse, for the control. */
export function weightFormatFor(unit: RoutineUnit): WeightFormat {
  return unit === 'lb' ? 'lbs' : 'kg';
}

export const WEIGHT_FORMAT_OPTIONS: readonly SettingOption<WeightFormat>[] = [
  { value: 'kg', labelKey: 'settingsUnitKg' },
  { value: 'lbs', labelKey: 'settingsUnitLb' },
];

/**
 * The rounding increments offered per unit — the routine editor's own list, not
 * a second one. Ajustes and the editor offered different kg lists for a while
 * (1 kg here, 1.25 kg there), so a user could store a default the editor could
 * not display as selected. There is one list, and it lives with the unit
 * defaults it belongs to.
 */
export const ROUNDING_INCREMENTS = ROUNDING_INCREMENT_OPTIONS;

export function defaultRoundingIncrement(unit: RoutineUnit): number {
  return WAVE_UNIT_DEFAULTS[unit].roundingIncrement;
}

/** A stored increment is honoured only if the current unit actually offers it. */
export function resolveRoundingIncrement(stored: unknown, unit: RoutineUnit): number {
  if (typeof stored === 'number' && ROUNDING_INCREMENTS[unit].includes(stored)) {
    return stored;
  }
  return defaultRoundingIncrement(unit);
}

/**
 * Switching the default unit moves the increment with it: a value the user
 * never changed follows its unit's convention, and a value they chose is kept
 * when the new unit can express it. 2.5 kg becoming 2.5 lb would be a silent
 * halving of the step; 5 lb is what a lb gym actually uses.
 */
export function roundingIncrementOnUnitChange(
  current: number,
  from: RoutineUnit,
  to: RoutineUnit,
): number {
  if (from === to) {
    return resolveRoundingIncrement(current, to);
  }
  if (current === defaultRoundingIncrement(from)) {
    return defaultRoundingIncrement(to);
  }
  return resolveRoundingIncrement(current, to);
}

/** Increment options for a unit. Values are strings: the control selects on text. */
export function roundingIncrementOptions(unit: RoutineUnit): SettingOption<string>[] {
  return ROUNDING_INCREMENTS[unit].map((increment) => ({
    value: String(increment),
    labelKey: 'settingsIncrementOption',
    labelParams: { value: formatWeight(increment), unit },
  }));
}

/** The bar profiles that can be an app-wide default — `custom` is per exercise. */
export const SETTABLE_BAR_PROFILES: readonly BarProfileKey[] = [
  'olympic',
  'semi-olympic',
  'smith',
  'ez',
];

export const DEFAULT_BAR_PROFILE: BarProfileKey = 'olympic';

const BAR_PROFILE_LABEL_KEYS: Record<string, string> = {
  olympic: 'settingsBarOlympic',
  'semi-olympic': 'settingsBarSemiOlympic',
  smith: 'settingsBarSmith',
  ez: 'settingsBarEz',
};

export function resolveBarProfile(stored: unknown): BarProfileKey {
  if (typeof stored === 'string') {
    const match = SETTABLE_BAR_PROFILES.find((profile) => profile === stored);
    if (match !== undefined) {
      return match;
    }
  }
  return DEFAULT_BAR_PROFILE;
}

/**
 * Bar options carrying their weight in the chosen unit — 20 kg or 45 lb, each
 * bar's own convention rather than a conversion of the other (`barProfiles.ts`).
 */
export function barProfileOptions(unit: RoutineUnit): SettingOption<BarProfileKey>[] {
  return SETTABLE_BAR_PROFILES.map((profile) => {
    const conventions = BAR_PROFILES[profile];
    const weight = unit === 'kg' ? conventions.weightKg : conventions.weightLb;
    return {
      value: profile,
      labelKey: BAR_PROFILE_LABEL_KEYS[profile],
      labelParams: { weight: formatWeight(weight), unit },
    };
  });
}

/**
 * The date a format option shows itself with. The 31st of December is the one
 * date where day and month cannot be mistaken for each other, which is the
 * whole job of the sample.
 */
export const DATE_FORMAT_SAMPLE = { day: 31, month: 12, year: 2026 } as const;

export function dateFormatSample(format: DateFormat): string {
  const day = String(DATE_FORMAT_SAMPLE.day).padStart(2, '0');
  const month = String(DATE_FORMAT_SAMPLE.month).padStart(2, '0');
  const year = String(DATE_FORMAT_SAMPLE.year);
  return format === 'dd-mm-yyyy' ? `${day}-${month}-${year}` : `${month}-${day}-${year}`;
}

/** Date options label themselves with the date they produce. */
export function dateFormatOptions(): SettingOption<DateFormat>[] {
  return (['dd-mm-yyyy', 'mm-dd-yyyy'] as const).map((format) => ({
    value: format,
    labelKey: 'settingsDateFormatOption',
    labelParams: { sample: dateFormatSample(format) },
  }));
}

/** Time options name the clock, never the suffix alone (S1). */
export function timeFormatOptions(): SettingOption<TimeFormat>[] {
  return [
    { value: '24h', labelKey: 'settingsTimeFormat24' },
    { value: 'AM/PM', labelKey: 'settingsTimeFormat12' },
  ];
}

export function firstWeekdayOptions(): SettingOption<FirstWeekday>[] {
  return [
    { value: 'Monday', labelKey: 'weekdayFullMon' },
    { value: 'Sunday', labelKey: 'weekdayFullSun' },
  ];
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * A stored `HH:MM` in the user's chosen clock. Written out rather than handed
 * to `Intl`, because the format is the user's setting and not the device
 * locale's: a Spanish phone set to 12-hour must still read `6:30 PM`.
 * A value that is not a time of day is returned unchanged — the caller has
 * nothing better to show, and inventing a time would be worse.
 */
export function formatTimeOfDay(time: string, format: TimeFormat): string {
  const match = TIME_OF_DAY.exec(time);
  if (match === null) {
    return time;
  }
  const hours = Number(match[1]);
  const minutes = match[2];
  if (format === '24h') {
    return `${String(hours).padStart(2, '0')}:${minutes}`;
  }
  const suffix = hours < 12 ? 'AM' : 'PM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${minutes} ${suffix}`;
}
