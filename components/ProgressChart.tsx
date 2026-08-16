import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import { APP_TEXT_MAX_FONT_SIZE_MULTIPLIER } from './AppTextInput';
import {
  CHART_RANGE_LABEL_MAX,
  chartLabelStyle,
  chartLabels,
  type ChartRange,
} from '../utils/chart';
import { fontSize, spacing } from '../utils/scale';

/**
 * One line chart, and the two things that are not a line chart.
 *
 * Every chart in Progreso went through the same forty lines of `chartConfig` copied twice into the
 * screen, which is how the empty case and the single-point case came to be handled differently in
 * each copy. This is the one place the app draws a trend: the existing `react-native-chart-kit`
 * (SPECS.md P3 — no second charting stack, no new dependency), the tokens for every colour, and
 * `utils/chart.ts` for an axis that fits.
 *
 * **The chart owns its whole axis.** The caller hands it the points it wants seen and the range
 * they were windowed to; how many labels fit at that range, whether they name a day or a month,
 * and which points get one at all are decided here, once, from `utils/chart.ts`. Two callers
 * formatting their own axes is how *"06/04, 13/04, 20/04, 27/04"* happened.
 *
 * A series of fewer than two points is **not** drawn (B7's rule, `hasChartableSeries`): it says
 * what it has and what is missing, rather than sitting under an axis pretending to be a chart.
 *
 * **One chart draws exactly one series.** The palette is monochrome (§3.5), so two lines on one
 * axis would have to be told apart by dash pattern or stroke weight — legible on a desk, not on a
 * phone held at arm's length in a gym. Two metrics, or one metric in two units, are two charts,
 * each with its own title and its own unit on the axis.
 */

export interface ProgressChartPoint {
  /** Whole-day stamp, used for the axis label. */
  date: number;
  value: number;
}

export type ProgressChartProps = {
  title: string;
  /** Already windowed to `range` by the caller — the chart draws what it is given. */
  points: readonly ProgressChartPoint[];
  /** The unit every point is in — never mixed within one series (§3.7). */
  unit: string;
  /** The range these points were windowed to; it sets the axis density and wording. */
  range: ChartRange;
  /** What to say with nothing logged, and with exactly one session logged. */
  emptyLabel: string;
  singlePointLabel: string;
  /** Extra copy under the title, e.g. the mixed-unit advisory. */
  note?: string;
  testID?: string;
};

const MONTH_SHORT_KEYS = [
  'monthShortJan',
  'monthShortFeb',
  'monthShortMar',
  'monthShortApr',
  'monthShortMay',
  'monthShortJun',
  'monthShortJul',
  'monthShortAug',
  'monthShortSep',
  'monthShortOct',
  'monthShortNov',
  'monthShortDec',
] as const;

const formatValue = (value: number): string => String(Number(value.toFixed(1)));

export function ProgressChart({
  title,
  points,
  unit,
  range,
  emptyLabel,
  singlePointLabel,
  note,
  testID,
}: ProgressChartProps) {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const { dateFormat } = useSettings();
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(200, width - spacing.gutter * 2);

  const heading = (
    <>
      <Text
        style={[styles.title, { color: tokens.textPrimary }]}
        maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
      >
        {title}
      </Text>
      {note !== undefined && (
        <Text
          style={[styles.helper, { color: tokens.textSecondary }]}
          maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        >
          {note}
        </Text>
      )}
    </>
  );

  if (points.length === 0) {
    return (
      <View style={styles.chartBlock} testID={testID}>
        {heading}
        <Text
          style={[styles.helper, { color: tokens.textSecondary }]}
          maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        >
          {emptyLabel}
        </Text>
      </View>
    );
  }

  if (points.length === 1) {
    return (
      <View style={styles.chartBlock} testID={testID}>
        {heading}
        <Text
          style={[styles.singleValue, { color: tokens.textPrimary }]}
          maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        >
          {`${formatValue(points[0].value)} ${unit}`}
        </Text>
        <Text
          style={[styles.helper, { color: tokens.textSecondary }]}
          maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        >
          {singlePointLabel}
        </Text>
      </View>
    );
  }

  const style = chartLabelStyle(range, points);
  const axisLabel = (stamp: number): string => {
    const date = new Date(stamp * 1000);
    if (style === 'day') {
      const day = String(date.getUTCDate()).padStart(2, '0');
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      return dateFormat === 'mm-dd-yyyy' ? `${month}/${day}` : `${day}/${month}`;
    }
    const month = t(MONTH_SHORT_KEYS[date.getUTCMonth()]);
    return style === 'month'
      ? month
      : t('chartAxisMonthYear', {
          month,
          year: String(date.getUTCFullYear()).slice(2),
        });
  };

  return (
    <View style={styles.chartBlock} testID={testID}>
      {heading}
      <LineChart
        data={{
          labels: chartLabels(
            points,
            (point) => axisLabel(point.date),
            CHART_RANGE_LABEL_MAX[range],
          ),
          datasets: [{ data: points.map((point) => point.value) }],
        }}
        width={chartWidth}
        height={180}
        withShadow={false}
        withInnerLines
        withOuterLines
        withDots={points.length <= 30}
        bezier={false}
        fromZero={false}
        yAxisSuffix={` ${unit}`}
        chartConfig={{
          backgroundColor: tokens.surface,
          backgroundGradientFrom: tokens.surface,
          backgroundGradientTo: tokens.surface,
          decimalPlaces: 1,
          color: () => tokens.accent,
          labelColor: () => tokens.textSecondary,
          propsForDots: { r: '3', strokeWidth: '1', stroke: tokens.divider },
        }}
        style={styles.chart}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chartBlock: {
    gap: spacing.label,
  },
  title: {
    fontSize: fontSize.cardTitle,
    fontWeight: '600',
  },
  helper: {
    fontSize: fontSize.helper,
  },
  singleValue: {
    fontSize: fontSize.sectionTitle,
    fontWeight: '600',
  },
  chart: {
    marginLeft: -spacing.card,
  },
});
