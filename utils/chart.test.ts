import {
  CHART_RANGES,
  CHART_RANGE_LABEL_MAX,
  chartLabelIndices,
  chartLabelStyle,
  chartLabels,
  chartRangeStart,
  groupByUnit,
  niceAxisBounds,
  windowByRange,
} from './chart';
import { buildDemoRows } from './demoData';
import { DAY_SECONDS } from './today';

const epoch = (ymd: string): number => {
  const [year, month, day] = ymd.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day, 12, 0, 0) / 1000);
};

/**
 * Six months of real seeded history for one main lift: the same rows the demo routine writes,
 * which is what P3's acceptance ("every range renders correctly on six months of demo data") is
 * measured against.
 */
const demoSquatPoints = (): { date: number }[] => {
  const wave = buildDemoRows().routines[0];
  const dates = new Set<number>();
  for (const session of wave.weekSessions) {
    if (session.status !== 'completed') {
      continue;
    }
    for (const key of Object.keys(session.results)) {
      if (key.includes('squat')) {
        dates.add(session.date);
      }
    }
  }
  return [...dates].sort((a, b) => a - b).map((date) => ({ date }));
};

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

  it('blanks a label repeated next to itself, but never the last one', () => {
    const points = Array.from({ length: 40 }, (_, index) => index);
    // Every label the same: only the first and the last survive.
    const labels = chartLabels(points, () => 'ago', 4);
    expect(labels.filter((label) => label !== '')).toEqual(['ago', 'ago']);
    expect(labels[0]).toBe('ago');
    expect(labels[39]).toBe('ago');
  });
});

describe('P3 — the date range a chart is read through', () => {
  const today = epoch('2026-08-16');

  it('offers exactly the four ranges of the spec, in order', () => {
    expect(CHART_RANGES).toEqual(['week', 'month', 'sixMonths', 'all']);
  });

  it('measures each range back from today, and "all" from nothing', () => {
    expect(chartRangeStart('week', today)).toBe(today - 6 * DAY_SECONDS);
    expect(chartRangeStart('month', today)).toBe(today - 29 * DAY_SECONDS);
    expect(chartRangeStart('sixMonths', today)).toBe(today - 181 * DAY_SECONDS);
    expect(chartRangeStart('all', today)).toBeNull();
  });

  it('windows the points a range shows, keeping the boundary day', () => {
    const points = [
      { date: today - 200 * DAY_SECONDS },
      { date: today - 29 * DAY_SECONDS },
      { date: today - 6 * DAY_SECONDS },
      { date: today },
    ];
    expect(windowByRange(points, 'week', today)).toHaveLength(2);
    expect(windowByRange(points, 'month', today)).toHaveLength(3);
    expect(windowByRange(points, 'sixMonths', today)).toHaveLength(3);
    expect(windowByRange(points, 'all', today)).toHaveLength(4);
  });

  it('handles an empty and a single-point series at every range', () => {
    for (const range of CHART_RANGES) {
      expect(windowByRange([], range, today)).toEqual([]);
    }
    expect(windowByRange([{ date: today - 2 * DAY_SECONDS }], 'week', today)).toHaveLength(1);
    // The same one point falls outside a range that starts after it.
    expect(windowByRange([{ date: today - 90 * DAY_SECONDS }], 'week', today)).toEqual([]);
  });

  it('names days on the short ranges and months on the long ones', () => {
    const withinAYear = [{ date: epoch('2026-03-01') }, { date: epoch('2026-08-10') }];
    const overAYear = [{ date: epoch('2024-01-05') }, { date: epoch('2026-08-10') }];
    expect(chartLabelStyle('week', withinAYear)).toBe('day');
    expect(chartLabelStyle('month', overAYear)).toBe('day');
    expect(chartLabelStyle('sixMonths', withinAYear)).toBe('month');
    expect(chartLabelStyle('all', withinAYear)).toBe('month');
    expect(chartLabelStyle('all', overAYear)).toBe('monthYear');
    expect(chartLabelStyle('all', [])).toBe('month');
  });
});

describe('P3 — six months of demo data at all four ranges', () => {
  const points = demoSquatPoints();
  // The seed ends on the last logged wave session; "today" for the demo is the day after it.
  const today = points[points.length - 1].date + DAY_SECONDS;

  it('has a real six-month series to window', () => {
    expect(points.length).toBeGreaterThanOrEqual(20);
    expect(points[points.length - 1].date - points[0].date).toBeGreaterThan(
      150 * DAY_SECONDS,
    );
  });

  it.each(CHART_RANGES)('renders %s without a crowded axis', (range) => {
    const windowed = windowByRange(points, range, today);
    const labels = chartLabels(
      windowed,
      (point) => String(point.date),
      CHART_RANGE_LABEL_MAX[range],
    );
    expect(labels).toHaveLength(windowed.length);
    expect(labels.filter((label) => label !== '').length).toBeLessThanOrEqual(
      CHART_RANGE_LABEL_MAX[range],
    );
    if (windowed.length > 0) {
      // The axis always says where the series starts and where it ends.
      expect(labels[0]).not.toBe('');
      expect(labels[labels.length - 1]).not.toBe('');
    }
  });

  it('narrows monotonically as the range narrows', () => {
    const counts = CHART_RANGES.map(
      (range) => windowByRange(points, range, today).length,
    );
    expect(counts[0]).toBeLessThanOrEqual(counts[1]);
    expect(counts[1]).toBeLessThanOrEqual(counts[2]);
    expect(counts[2]).toBeLessThanOrEqual(counts[3]);
    expect(counts[3]).toBe(points.length);
  });
});

describe('a series never mixes units', () => {
  it('splits rows by unit, most recently logged unit first', () => {
    const groups = groupByUnit([
      { date: 1, unit: 'kg' },
      { date: 2, unit: 'lb' },
      { date: 3, unit: 'kg' },
      { date: 4, unit: 'lb' },
    ]);
    expect(groups.map((group) => group.unit)).toEqual(['lb', 'kg']);
    expect(groups[0].rows.map((row) => row.date)).toEqual([2, 4]);
    expect(groups[1].rows.map((row) => row.date)).toEqual([1, 3]);
  });

  it('returns one group for one unit and none for nothing', () => {
    expect(groupByUnit([])).toEqual([]);
    expect(groupByUnit([{ unit: 'kg' }])).toEqual([
      { unit: 'kg', rows: [{ unit: 'kg' }] },
    ]);
  });
});

describe('niceAxisBounds — a readable y-axis, never the data\'s own raw min/max', () => {
  it('reproduces the exact defect the audit found: 49.1 / 96.0 / 142.9 becomes round kg values', () => {
    // The real spread the strength chart drew before this fix (demo data, all four main lifts).
    expect(niceAxisBounds([49.1, 96.0, 142.9], 'kg')).toEqual({ min: 45, mid: 95, max: 145 });
  });

  it('pads outward, never in — the axis always covers every value', () => {
    const axis = niceAxisBounds([49.1, 96.0, 142.9], 'kg');
    expect(axis.min).toBeLessThanOrEqual(49.1);
    expect(axis.max).toBeGreaterThanOrEqual(142.9);
  });

  it('rounds to 10s for lb, not the kg granularity', () => {
    expect(niceAxisBounds([61, 118], 'lb')).toEqual({ min: 60, mid: 90, max: 120 });
  });

  it('keeps the midpoint exactly halfway — the same step on both sides', () => {
    const axis = niceAxisBounds([12, 88], 'kg');
    expect(axis.mid - axis.min).toBe(axis.max - axis.mid);
  });

  it('falls back to kg steps for an unrecognized unit', () => {
    expect(niceAxisBounds([49.1, 142.9], 'reps')).toEqual(niceAxisBounds([49.1, 142.9], 'kg'));
  });

  it('handles no values without throwing', () => {
    expect(niceAxisBounds([], 'kg')).toEqual({ min: 0, mid: 0, max: 0 });
  });

  it('handles a flat series (every value identical)', () => {
    const axis = niceAxisBounds([100, 100, 100], 'kg');
    expect(axis.min).toBeLessThanOrEqual(100);
    expect(axis.max).toBeGreaterThanOrEqual(100);
  });
});
