import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PlatePicker } from './PlatePicker';

const OPTIONS = [
  { value: 1.25, label: '+1.25 kg' },
  { value: 2.5, label: '+2.5 kg' },
] as const;

describe('PlatePicker', () => {
  it('adds on tap and removes on long press at the public option seam', () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    render(
      <PlatePicker
        options={OPTIONS}
        onPress={onPress}
        onLongPress={onLongPress}
        longPressHint="Tap to add; hold to remove"
      />,
    );

    const plate = screen.getByRole('button', { name: '+1.25 kg' });
    fireEvent.press(plate);
    fireEvent(plate, 'longPress');

    expect(onPress).toHaveBeenCalledWith(1.25);
    expect(onLongPress).toHaveBeenCalledWith(1.25);
  });
});
