import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { SegmentedControl } from './SegmentedControl';

const OPTIONS = [
  { value: 'kg', label: 'kg' },
  { value: 'lb', label: 'lb' },
  { value: 'bodyweight', label: 'Bodyweight' },
] as const;

describe('SegmentedControl', () => {
  it('marks the current value as selected and reports changes', () => {
    const onChange = jest.fn();
    render(
      <SegmentedControl options={OPTIONS} value="kg" onChange={onChange} />,
    );

    const selected = screen.getByRole('tab', { selected: true });
    expect(selected).toHaveTextContent('kg');

    fireEvent.press(screen.getByText('lb'));
    expect(onChange).toHaveBeenCalledWith('lb');
  });

  it('ignores presses while disabled', () => {
    const onChange = jest.fn();
    render(
      <SegmentedControl options={OPTIONS} value="kg" onChange={onChange} disabled />,
    );

    fireEvent.press(screen.getByText('lb'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
