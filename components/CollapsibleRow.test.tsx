import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { CollapsibleRow } from './CollapsibleRow';
import { ThemeProvider } from '../context/ThemeContext';

describe('CollapsibleRow', () => {
  it('hides its content until tapped, then reveals it', () => {
    render(
      <ThemeProvider>
        <CollapsibleRow label="Ciclos anteriores" detail="3 ciclos" testID="past-cycles">
          <Text>Ciclo 3</Text>
        </CollapsibleRow>
      </ThemeProvider>,
    );
    expect(screen.queryByText('Ciclo 3')).toBeNull();

    fireEvent.press(screen.getByTestId('past-cycles-toggle'));
    expect(screen.getByText('Ciclo 3')).toBeTruthy();

    fireEvent.press(screen.getByTestId('past-cycles-toggle'));
    expect(screen.queryByText('Ciclo 3')).toBeNull();
  });

  it('shows the label and detail while collapsed', () => {
    render(
      <ThemeProvider>
        <CollapsibleRow label="Ciclos anteriores" detail="3 ciclos" testID="past-cycles">
          <Text>Ciclo 3</Text>
        </CollapsibleRow>
      </ThemeProvider>,
    );
    expect(screen.getByText('Ciclos anteriores')).toBeTruthy();
    expect(screen.getByText('3 ciclos')).toBeTruthy();
  });
});
