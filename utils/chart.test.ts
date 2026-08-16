import { chartLabelIndices, chartLabels } from './chart';

describe('chart axis labels', () => {
  it('labels every point while they still fit', () => {
    expect(chartLabelIndices(0)).toEqual([]);
    expect(chartLabelIndices(1)).toEqual([0]);
    expect(chartLabelIndices(6)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('keeps the first and the last point when it has to thin them out', () => {
    const indices = chartLabelIndices(24);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(23);
    expect(indices.length).toBeLessThanOrEqual(6);
  });

  it('never labels more points than the axis holds, at any length', () => {
    for (const count of [7, 13, 26, 52, 180, 365]) {
      expect(chartLabelIndices(count).length).toBeLessThanOrEqual(6);
    }
    expect(chartLabelIndices(180, 3).length).toBeLessThanOrEqual(3);
  });

  it('returns one label per point, blank where there is no room', () => {
    const points = Array.from({ length: 10 }, (_, index) => index);
    const labels = chartLabels(points, (point) => `d${point}`);
    expect(labels).toHaveLength(10);
    expect(labels[0]).toBe('d0');
    expect(labels[9]).toBe('d9');
    expect(labels.filter((label) => label !== '').length).toBeLessThanOrEqual(6);
  });
});
