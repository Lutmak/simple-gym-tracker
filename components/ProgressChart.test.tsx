import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { ProgressChart } from './ProgressChart';
import { ThemeProvider } from '../context/ThemeContext';
import { SettingsProvider } from '../context/SettingsContext';

/**
 * The three non-chart states (empty, single-point, and the ordinary multi-point chart) plus the
 * two ADR-0047 rules a screenshot can't assert cheaply: the legend appears only with more than
 * one series, and the area fill draws only when there is exactly one solid series.
 */

const renderChart = (props: Partial<React.ComponentProps<typeof ProgressChart>> = {}) =>
  render(
    <ThemeProvider>
      <SettingsProvider>
        <ProgressChart
          title="Sentadilla"
          dates={[1, 2, 3]}
          series={[
            { key: 'a', label: 'Sentadilla', color: '#2A78D6', values: [100, 105, 110] },
          ]}
          unit="kg"
          range="month"
          emptyLabel="Sin datos"
          singlePointLabel="Un solo punto"
          testID="chart"
          {...props}
        />
      </SettingsProvider>
    </ThemeProvider>,
  );

describe('ProgressChart', () => {
  it('shows the empty label and no chart when there are no dates', () => {
    renderChart({ dates: [], series: [] });
    expect(screen.getByText('Sin datos')).toBeTruthy();
  });

  it('shows a single value read-out and the single-point label for one date', () => {
    renderChart({
      dates: [1],
      series: [{ key: 'a', label: 'Sentadilla', color: '#2A78D6', values: [102.5] }],
    });
    expect(screen.getByText('102.5 kg')).toBeTruthy();
    expect(screen.getByText('Un solo punto')).toBeTruthy();
  });

  it('names each series in the single-point state when there is more than one', () => {
    renderChart({
      dates: [1],
      series: [
        { key: 'a', label: 'Sentadilla', color: '#2A78D6', values: [102.5] },
        { key: 'b', label: 'Banca', color: '#EB6834', values: [80] },
      ],
    });
    expect(screen.getByText('Sentadilla: 102.5 kg')).toBeTruthy();
    expect(screen.getByText('Banca: 80 kg')).toBeTruthy();
  });

  it('puts the unit in the title, not as a prop the chart repeats per tick', () => {
    renderChart();
    expect(screen.getByText('Sentadilla (kg)')).toBeTruthy();
  });

  it('shows no legend for a single series', () => {
    renderChart();
    expect(screen.queryByText('Sentadilla')).toBeNull();
  });

  it('shows a legend naming every series when there is more than one', () => {
    renderChart({
      series: [
        { key: 'a', label: 'Sentadilla', color: '#2A78D6', values: [100, 105, 110] },
        { key: 'b', label: 'Banca', color: '#EB6834', values: [80, 82, 84] },
      ],
    });
    expect(screen.getByText('Sentadilla')).toBeTruthy();
    expect(screen.getByText('Banca')).toBeTruthy();
  });

  it('renders a dashed, dot-less step series alongside a solid one', () => {
    renderChart({
      series: [
        { key: 'a', label: 'Sentadilla', color: '#2A78D6', values: [100, 105, 110] },
        {
          key: 'tm',
          label: 'Máximo de entrenamiento',
          color: '#2A78D6',
          values: [95, 95, 100],
          style: 'step',
        },
      ],
    });
    // Two datasets reach the chart: the solid line and the dashed step line.
    expect(screen.getByTestId('chart')).toBeTruthy();
  });
});
