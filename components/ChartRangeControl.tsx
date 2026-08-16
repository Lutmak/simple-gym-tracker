import React from 'react';
import { useTranslation } from 'react-i18next';
import { SegmentedControl } from './SegmentedControl';
import { CHART_RANGES, type ChartRange } from '../utils/chart';

/**
 * The date range every chart in Progreso is read through: **1 semana · 1 mes · 6 meses · todo**
 * (SPECS.md P3).
 *
 * It is one `SegmentedControl` and nothing else — the range is a current position, which is what
 * the segmented control already means everywhere else in the app. It exists as its own component
 * only so the routine's main-lift trend and an exercise's own charts cannot drift into two
 * different sets of ranges, in two different orders, with two different labels.
 */

const RANGE_LABEL_KEYS: Record<ChartRange, string> = {
  week: 'chartRangeWeek',
  month: 'chartRangeMonth',
  sixMonths: 'chartRangeSixMonths',
  all: 'chartRangeAll',
};

export type ChartRangeControlProps = {
  value: ChartRange;
  onChange: (range: ChartRange) => void;
  testID?: string;
};

export function ChartRangeControl({ value, onChange, testID }: ChartRangeControlProps) {
  const { t } = useTranslation();

  return (
    <SegmentedControl
      options={CHART_RANGES.map((range) => ({
        value: range,
        label: t(RANGE_LABEL_KEYS[range]),
      }))}
      value={value}
      onChange={onChange}
      testID={testID ?? 'chart-range'}
    />
  );
}
