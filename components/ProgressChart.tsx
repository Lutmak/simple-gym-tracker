import React from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import { hexWithOpacity } from '../utils/theme';
import { APP_TEXT_MAX_FONT_SIZE_MULTIPLIER } from './AppTextInput';
import {
  CHART_RANGE_LABEL_MAX,
  chartLabelStyle,
  chartLabels,
  niceAxisBounds,
  type ChartRange,
} from '../utils/chart';
import { dataMark, fontSize, spacing } from '../utils/scale';

/**
 * One line chart, and the two things that are not a line chart (ADR-0047, SPEC.md U1).
 *
 * Rebuilt for Iteration 5's "drawn to be read" rule: a solid line in a `data.series` colour with
 * a light area fill, markers only at real data points, three horizontal gridlines in `divider`
 * and **no vertical grid** (the dashed graph-paper look was the maintainer's specific complaint —
 * ADR-0047), axis labels thinned by range, and the unit named once in the heading rather than on
 * every tick. Still the existing `react-native-chart-kit`; nothing new was added to draw this.
 *
 * **Multi-series is a first-class shape, not bolted on.** Every series shares one `dates` axis —
 * chart-kit draws one label array against parallel per-series value arrays, so alignment is the
 * caller's job (typically one point per training week, since that is the cadence 5/3/1 actually
 * progresses on); this primitive draws exactly the values it is given and does not invent a
 * value for a date a series has none for. A series may be `style: 'step'` — a dashed, dot-less
 * reference line, for a training max plotted under its estimated-1RM series.
 *
 * **The area fill is drawn only when there is exactly one non-step series.** Overlapping
 * translucent fills from several simultaneous lines read as noise, not signal, so a chart with
 * more than one solid series keeps its lines but not its fills — legend and colour carry identity
 * instead. A legend appears whenever there is more than one distinct **label** — never in the
 * series colour itself (dataviz rule: text wears text tokens, a mark carries identity) — one entry
 * per label, first occurrence wins: a lift's e1RM line and its own `step` training-max line share
 * one legend dot when the caller gives them the same label (SPEC.md U3's combined strength chart),
 * so the legend names lifts, not lines. A legend entry is tappable when its series carries
 * `onPress` (U3: opens that lift's full history).
 *
 * A series of fewer than two points is **not** drawn (B7's rule): the chart says what it has
 * and what is missing instead of sitting under an axis pretending to be a chart.
 */

export interface ProgressChartSeries {
  /** Stable key for React and for telling two series apart; never shown to the user. */
  key: string;
  /** Legend text and the series' accessible name. */
  label: string;
  /** A `data.series` or `data.state` token — never a raw colour (ADR-0047). */
  color: string;
  /** One value per date in the chart's `dates`, same length, same order, aligned by the caller. */
  values: readonly number[];
  /** `solid` (default): the drawn line. `step`: a dashed, dot-less reference line (e.g. a training max). */
  style?: 'solid' | 'step';
  /** Makes this series' legend entry tappable (U3: opens the tapped lift's full history). */
  onPress?: () => void;
}

export type ProgressChartProps = {
  title: string;
  /** The one date axis every series is plotted against. */
  dates: readonly number[];
  series: readonly ProgressChartSeries[];
  /** The unit every series is in — named once, in the heading, never per tick (§4.5). */
  unit: string;
  /** The range these points were windowed to; it sets the axis density and wording. */
  range: ChartRange;
  /** What to say with nothing logged, and with exactly one point logged. */
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

/** Three gridlines regardless of range or data spread (ADR-0047: "three horizontal gridlines"). */
const GRIDLINE_SEGMENTS = 2;

/** An even-length, >= 2 dash pattern — the minimum Android's `DashPathEffect` accepts. */
const STEP_DASH = [6, 6];

const formatValue = (value: number): string => String(Number(value.toFixed(1)));

export function ProgressChart({
  title,
  dates,
  series,
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
        {unit === '' ? title : `${title} (${unit})`}
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

  if (dates.length === 0) {
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

  if (dates.length === 1) {
    return (
      <View style={styles.chartBlock} testID={testID}>
        {heading}
        {series.map((entry) => (
          <Text
            key={entry.key}
            style={[styles.singleValue, { color: tokens.textPrimary }]}
            maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          >
            {series.length > 1
              ? `${entry.label}: ${formatValue(entry.values[0] ?? 0)} ${unit}`
              : `${formatValue(entry.values[0] ?? 0)} ${unit}`}
          </Text>
        ))}
        <Text
          style={[styles.helper, { color: tokens.textSecondary }]}
          maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        >
          {singlePointLabel}
        </Text>
      </View>
    );
  }

  const labelStyle = chartLabelStyle(range, dates.map((date) => ({ date })));
  const axisLabel = (stamp: number): string => {
    const date = new Date(stamp * 1000);
    if (labelStyle === 'day') {
      const day = String(date.getUTCDate()).padStart(2, '0');
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      return dateFormat === 'mm-dd-yyyy' ? `${month}/${day}` : `${day}/${month}`;
    }
    const month = t(MONTH_SHORT_KEYS[date.getUTCMonth()]);
    return labelStyle === 'month'
      ? month
      : t('chartAxisMonthYear', {
          month,
          year: String(date.getUTCFullYear()).slice(2),
        });
  };

  const solidSeriesCount = series.filter((entry) => entry.style !== 'step').length;
  const drawsAreaFill = solidSeriesCount === 1;

  // chart-kit has no "nice axis" option of its own: it always interpolates its three labels
  // between the plotted data's own raw min and max. The fix is a fourth, invisible dataset whose
  // two values ARE the rounded axis (utils/chart.ts's niceAxisBounds) — chart-kit's min/max
  // widens to include them, which is what pulls the three labels onto round numbers, and
  // `withDots: false` plus a fully transparent stroke keep it undrawn.
  const axis = niceAxisBounds(
    series.flatMap((entry) => entry.values),
    unit,
  );
  const axisPadding = dates.map((_, index) => (index === 0 ? axis.min : axis.max));

  // One legend entry per distinct label, first occurrence wins: a lift's e1RM line and its own
  // `step` training-max line share one dot when the caller gives them the same label.
  const legendEntries = series.filter(
    (entry, index) => series.findIndex((candidate) => candidate.label === entry.label) === index,
  );

  return (
    <View style={styles.chartBlock} testID={testID}>
      {heading}
      {legendEntries.length > 1 && (
        <View style={styles.legend}>
          {legendEntries.map((entry) => (
            <Pressable
              key={entry.key}
              onPress={entry.onPress}
              disabled={entry.onPress === undefined}
              accessibilityRole={entry.onPress === undefined ? undefined : 'button'}
              style={styles.legendItem}
              testID={testID === undefined ? undefined : `${testID}-legend-${entry.key}`}
            >
              <View style={[styles.legendDot, { backgroundColor: entry.color }]} />
              <Text
                style={[
                  styles.legendLabel,
                  { color: entry.onPress === undefined ? tokens.textSecondary : tokens.textPrimary },
                ]}
                maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              >
                {entry.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <LineChart
        data={{
          labels: chartLabels(dates, axisLabel, CHART_RANGE_LABEL_MAX[range]),
          datasets: [
            ...series.map((entry) => ({
              data: entry.values as number[],
              color: (opacity = 1) => hexWithOpacity(entry.color, opacity),
              strokeWidth: entry.style === 'step' ? 1.5 : 2,
              withDots: entry.style !== 'step',
              // react-native-svg's Android DashPathEffect throws on a zero- or one-length dash
              // array (a solid line must simply omit strokeDashArray, never pass `[]`); a step
              // line needs an even-length pair, `[6, 6]` (found on the emulator, 2026-09-05 —
              // `Progreso` crashed the whole app on open with
              // `ArrayIndexOutOfBoundsException` from `DashPathEffect.<init>`).
              ...(entry.style === 'step' ? { strokeDashArray: STEP_DASH } : {}),
            })),
            {
              data: axisPadding,
              color: () => 'rgba(0, 0, 0, 0)',
              strokeWidth: 0,
              withDots: false,
            },
          ],
        }}
        width={chartWidth}
        height={180}
        segments={GRIDLINE_SEGMENTS}
        withShadow={drawsAreaFill}
        withInnerLines
        withOuterLines
        withVerticalLines={false}
        withDots={dates.length <= 30}
        bezier={false}
        fromZero={false}
        chartConfig={{
          backgroundColor: tokens.surface,
          backgroundGradientFrom: tokens.surface,
          backgroundGradientTo: tokens.surface,
          // niceAxisBounds only ever produces whole-number gridlines (multiples of 5 kg/10 lb).
          decimalPlaces: 0,
          color: () => tokens.textSecondary,
          labelColor: () => tokens.textSecondary,
          useShadowColorFromDataset: true,
          fillShadowGradientOpacity: 0.2,
          // `strokeDasharray` must be present (not omitted) so it overrides chart-kit's
          // hardcoded "5, 10" default via its own `Object.assign` merge; `undefined`, not `[]`
          // or `'0'` — see the dataset comment above for why an empty/short array crashes.
          propsForBackgroundLines: {
            stroke: tokens.divider,
            strokeWidth: 1,
            strokeDasharray: undefined,
          },
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
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.card,
    rowGap: spacing.label,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
  },
  legendDot: {
    width: dataMark.dot,
    height: dataMark.dot,
    borderRadius: dataMark.dot / 2,
  },
  legendLabel: {
    fontSize: fontSize.caption,
  },
});
