import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { Switch } from './Switch';

describe('Switch', () => {
  it('reports the new value', () => {
    const onValueChange = jest.fn();
    render(<Switch value={false} onValueChange={onValueChange} testID="switch" />);

    fireEvent(screen.getByTestId('switch'), 'valueChange', true);
    expect(onValueChange).toHaveBeenCalledWith(true);
  });

  it('forwards the disabled state to the native switch', () => {
    const onValueChange = jest.fn();
    render(
      <Switch value={false} onValueChange={onValueChange} disabled testID="switch" />,
    );

    expect(screen.getByTestId('switch').props.disabled).toBe(true);
  });
});
