import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { Hero } from './Hero';

describe('Hero', () => {
  it('renders its children', () => {
    render(
      <Hero testID="hero">
        <Text>Press Day</Text>
      </Hero>,
    );

    expect(screen.getByTestId('hero')).toBeTruthy();
    expect(screen.getByText('Press Day')).toBeTruthy();
  });
});
