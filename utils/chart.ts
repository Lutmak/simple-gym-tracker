/**
 * Axis labels that do not overlap (SPECS.md P3's defect, solved once here).
 *
 * *"06/04, 13/04, 20/04, 27/04"* crowding into each other is what happens when every point gets a
 * label. A chart of six months of daily sessions has no room for two hundred of them, so the rule
 * is: label at most `max` points, always including the first and the last, and leave the rest
 * blank. The chart library draws a blank label as nothing at all.
 *
 * Pure and separate from the component so the range selector P3 adds can be tested without a
 * renderer, and so the exercise charts and the routine charts thin their labels identically.
 */

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

/** One label per point, blank where the axis has no room for it. */
export function chartLabels<T>(
  points: readonly T[],
  labelOf: (point: T) => string,
  max: number = DEFAULT_CHART_LABELS,
): string[] {
  const labelled = new Set(chartLabelIndices(points.length, max));
  return points.map((point, index) => (labelled.has(index) ? labelOf(point) : ''));
}
