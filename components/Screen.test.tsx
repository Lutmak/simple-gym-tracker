import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import { Screen } from './Screen';
import { spacing } from '../utils/scale';

/**
 * These assert the one thing a screen cannot see for itself: that its first line clears the status
 * bar. Android is edge-to-edge and no route in this app has a navigation header, so a Screen that
 * forgets the top inset prints its title across the clock. That was a real defect, found by eye on
 * the emulator, and it is cheaper to keep it out with a test than to find it again on seventeen
 * screens.
 */
const metricsWithTopInset = (top: number): Metrics => ({
  frame: { x: 0, y: 0, width: 1080, height: 2400 },
  insets: { top, left: 0, right: 0, bottom: 0 },
});

function renderWithInsets(top: number, scroll?: boolean) {
  return render(
    <SafeAreaProvider initialMetrics={metricsWithTopInset(top)}>
      <Screen scroll={scroll} testID="screen">
        <Text testID="content">{'content'}</Text>
      </Screen>
    </SafeAreaProvider>,
  );
}

const paddingTopOf = (testID: string) => {
  const style = screen.getByTestId(testID).props.style;
  const flattened = Array.isArray(style) ? Object.assign({}, ...style.flat()) : style;
  return flattened.paddingTop;
};

describe('Screen', () => {
  it('clears the status bar by adding the top inset to its own padding', () => {
    renderWithInsets(48);

    expect(screen.getByTestId('content')).toBeTruthy();
    expect(paddingTopOf('screen-content')).toBe(48 + spacing.section);
  });

  it('keeps its own padding when there is no inset to clear', () => {
    renderWithInsets(0);

    expect(paddingTopOf('screen-content')).toBe(spacing.section);
  });

  it('applies the same inset when scrolling', () => {
    renderWithInsets(48, true);

    expect(paddingTopOf('screen-content')).toBe(48 + spacing.section);
  });
});
