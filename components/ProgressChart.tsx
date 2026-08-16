import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { useTheme } from '../context/ThemeContext';
import { APP_TEXT_MAX_FONT_SIZE_MULTIPLIER } from './AppTextInput';
import { chartLabels } from '../utils/chart';
import { fontSize, spacing } from '../utils/scale';

/**
 * One line chart, and the two things that are not a line chart.
 *
 * Every chart in Progreso went through the same forty lines of `chartConfig` copied twice into the
 * screen, which is how the empty case and the single-point case came to be handled differently in
 * each copy. This is the one place the app draws a trend: the existing `react-native-chart-kit`
 * (SPECS.md P3 — no second charting stack, no new dependency), the tokens for every colour, and
 * `utils/chart.ts` for labels that do not overlap.
 *
 * A series of fewer than two points is **not** drawn (B7's rule, `hasChartableSeries`): it says
 * what it has and what is missing, rather than sitting under an axis pretending to be a chart.
 */

export interface ProgressChartPoint {
  /** Whole-day stamp, used for the axis label. */
  date: number;
  value: number;
}

export type ProgressChartProps = {
  title: string;
  points: readonly ProgressChartPoint[];
  /** The unit every point is in — never mixed within one series (§3.7). */
  unit: string;
  formatDate: (stamp: number) => string;
  /** What to say with nothing logged, and with exactly one session logged. */
  emptyLabel: string;
  singlePointLabel: string;
  /** Extra copy under the title, e.g. the mixed-unit advisory. */
  note?: string;
  testID?: string;
};

const formatValue = (value: number): string => String(Number(value.toFixed(1)));

export function ProgressChart({
  title,
  points,
  unit,
  formatDate,
  emptyLabel,
  singlePointLabel,
  note,
  testID,
}: ProgressChartProps) {
  const { tokens } = useTheme();
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

  return (
    <View style={styles.chartBlock} testID={testID}>
      {heading}
      <LineChart
        data={{
          labels: chartLabels(points, (point) => formatDate(point.date)),
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
