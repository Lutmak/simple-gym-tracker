/**
 * What a chart needs before it is drawn: a range, an axis that fits, and a series that is in one
 * unit (SPECS.md P3, solved once here).
 *
 * *"06/04, 13/04, 20/04, 27/04"* crowding into each other is what happens when every point gets a
 * label. A chart of six months of sessions has no room for a hundred of them, so the rule is:
 * label at most `max` points, always including the first and the last, and leave the rest blank.
 * The chart library draws a blank label as nothing at all. How many labels fit depends on the
 * range, and so does what a label should say — `12/08` at one week, `ago` at six months — so the
 * range owns both numbers.
 *
 * The third thing a series must be is **single-unit**. A run of sets logged in kg followed by a
 * machine read in lb is one exercise but two series; drawing them on one axis prints a lie
 * (§3.5 — nothing is ever converted). `groupByUnit` is what lets the callers split them, and the
 * chart that comes out of each group carries its own unit label.
 *
 * Pure and separate from the component so the range selector can be tested without a renderer,
 * and so the exercise charts and the routine charts thin their labels identically.
 */

import { DAY_SECONDS } from './today';

/** The default number of labels a phone-width axis holds without collision. */
export const DEFAULT_CHART_LABELS = 6;

/**
 * The indices that carry a label: first, last, and an even spread between them,
 * never more than `max`.
 */
export function chartLabelIndices(
  count: number,
  max: number = DEFAULT_CHART_LABELS,
): number[] {
  if (count <= 0) {
    return [];
  }
  if (count <= max) {
    return Array.from({ length: count }, (_, index) => index);
  }
  const indices = new Set<number>([0, count - 1]);
  const step = Math.max(1, Math.floor(count / max));
  for (let index = step; index < count - 1 && indices.size < max; index += step) {
    indices.add(index);
  }
  return [...indices].sort((a, b) => a - b);
}

/**
 * One label per point, blank where the axis has no room for it.
 *
 * A label repeated next to itself — two `ago` in a row, once the six-month axis stops naming days
 * — reads as one mislabelled axis, so a repeat is blanked as if there had been no room. The last
 * label is never blanked: the right-hand edge of the axis always says where the series ends.
 */
export function chartLabels<T>(
  points: readonly T[],
  labelOf: (point: T) => string,
  max: number = DEFAULT_CHART_LABELS,
): string[] {
  const labelled = chartLabelIndices(points.length, max);
  const last = labelled.length === 0 ? -1 : labelled[labelled.length - 1];
  const out = points.map(() => '');
  let previous: string | null = null;
  for (const index of labelled) {
    const text = labelOf(points[index]);
    if (text === previous && index !== last) {
      continue;
    }
    out[index] = text;
    previous = text;
  }
  return out;
}

/** The four windows a chart can be read through (SPECS.md P3). */
export type ChartRange = 'week' | 'month' | 'sixMonths' | 'all';

export const CHART_RANGES: readonly ChartRange[] = [
  'week',
  'month',
  'sixMonths',
  'all',
] as const;

/** How many days back each range reaches; `null` is "everything ever logged". */
export const CHART_RANGE_DAYS: Record<ChartRange, number | null> = {
  week: 7,
  month: 30,
  sixMonths: 182,
  all: null,
};

/**
 * How many labels each range's axis holds. Shorter ranges name days and hold a few more of them;
 * the long ranges name months, which are wider on the axis and fewer on the data.
 */
export const CHART_RANGE_LABEL_MAX: Record<ChartRange, number> = {
  week: 5,
  month: 5,
  sixMonths: 4,
  all: 4,
};

/** The oldest day a range includes, or `null` when the range is "everything". */
export function chartRangeStart(
  range: ChartRange,
  todayStamp: number,
): number | null {
  const days = CHART_RANGE_DAYS[range];
  return days === null ? null : todayStamp - (days - 1) * DAY_SECONDS;
}

/**
 * The points a range shows. There is no upper bound: a point stamped after today is data, not
 * noise, and dropping it would make a chart disagree with the log it was built from.
 */
export function windowByRange<T extends { date: number }>(
  points: readonly T[],
  range: ChartRange,
  todayStamp: number,
): T[] {
  const start = chartRangeStart(range, todayStamp);
  return start === null
    ? [...points]
    : points.filter((point) => point.date >= start);
}

/**
 * What a label on this axis should say. Days while the range is short enough for them to differ,
 * months once it is not, and months with their year as soon as the series spans more than one —
 * `ene` twice, a year apart, is worse than no label.
 */
export type ChartLabelStyle = 'day' | 'month' | 'monthYear';

export function chartLabelStyle(
  range: ChartRange,
  points: readonly { date: number }[],
): ChartLabelStyle {
  if (range === 'week' || range === 'month') {
    return 'day';
  }
  if (points.length === 0) {
    return 'month';
  }
  const span = points[points.length - 1].date - points[0].date;
  return span > 365 * DAY_SECONDS ? 'monthYear' : 'month';
}

export interface UnitGroup<T extends { unit: string }> {
  unit: T['unit'];
  rows: T[];
}

/**
 * The rows split by the unit they were logged in, most recently logged unit first.
 *
 * "Most recently logged" is the unit of the last row of the group in the order the rows arrive,
 * which for every caller is date order out of SQLite. The first group is therefore the one the
 * user is training in now, which is the series that should be on top of the screen.
 */
export function groupByUnit<T extends { unit: string }>(
  rows: readonly T[],
): UnitGroup<T>[] {
  const groups = new Map<T['unit'], T[]>();
  const lastIndex = new Map<T['unit'], number>();
  rows.forEach((row, index) => {
    const bucket = groups.get(row.unit);
    if (bucket === undefined) {
      groups.set(row.unit, [row]);
    } else {
      bucket.push(row);
    }
    lastIndex.set(row.unit, index);
  });
  return [...groups.entries()]
    .sort((a, b) => (lastIndex.get(b[0]) ?? 0) - (lastIndex.get(a[0]) ?? 0))
    .map(([unit, bucket]) => ({ unit, rows: bucket }));
}
