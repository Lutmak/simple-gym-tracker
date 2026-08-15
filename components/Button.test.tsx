import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button } from './Button';

describe('Button', () => {
  it('renders its label', () => {
    render(<Button label="Empezar" onPress={() => {}} />);

    expect(screen.getByText('Empezar')).toBeTruthy();
  });

  it('fires onPress when pressed', () => {
    const onPress = jest.fn();
    render(<Button label="Empezar" onPress={onPress} />);

    fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire onPress while disabled', () => {
    const onPress = jest.fn();
    render(<Button label="Empezar" onPress={onPress} disabled />);

    fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
