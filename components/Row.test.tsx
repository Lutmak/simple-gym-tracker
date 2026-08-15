import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { Row } from './Row';

describe('Row', () => {
  it('renders label, detail and a trailing control', () => {
    render(
      <Row label="Unit" detail="kg" right={<Text>{'trailing'}</Text>} />,
    );

    expect(screen.getByText('Unit')).toBeTruthy();
    expect(screen.getByText('kg')).toBeTruthy();
    expect(screen.getByText('trailing')).toBeTruthy();
  });

  it('is pressable when onPress is given', () => {
    const onPress = jest.fn();
    render(<Row label="Unit" onPress={onPress} />);

    fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is not pressable when onPress is missing', () => {
    render(<Row label="Unit" />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not fire onPress while disabled', () => {
    const onPress = jest.fn();
    render(<Row label="Unit" onPress={onPress} disabled />);

    fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
