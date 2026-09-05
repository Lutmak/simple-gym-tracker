import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { WeekStateDiscs } from './WeekStateDiscs';
import { ThemeProvider } from '../context/ThemeContext';

const LABELS = {
  completed: 'Hecha',
  moved: 'Movida',
  discarded: 'Descartada',
  pending: 'Sin resolver',
};

describe('WeekStateDiscs', () => {
  it('renders one disc per status, in order', () => {
    render(
      <ThemeProvider>
        <WeekStateDiscs
          statuses={['completed', 'completed', 'moved', 'discarded']}
          statusLabels={LABELS}
          testID="week-discs"
        />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('week-discs-0')).toBeTruthy();
    expect(screen.getByTestId('week-discs-3')).toBeTruthy();
  });

  it('labels each disc with the word its status reads as — never colour alone', () => {
    render(
      <ThemeProvider>
        <WeekStateDiscs statuses={['pending']} statusLabels={LABELS} testID="week-discs" />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText('Sin resolver')).toBeTruthy();
  });
});
