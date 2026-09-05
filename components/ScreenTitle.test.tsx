import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ScreenTitle } from './ScreenTitle';

describe('ScreenTitle', () => {
  it('renders the title and overline', () => {
    render(<ScreenTitle title="Demo Routine" overline="Rutina activa" />);

    expect(screen.getByText('Demo Routine')).toBeTruthy();
    expect(screen.getByText('Rutina activa')).toBeTruthy();
  });

  it('renders no action button when onAction is omitted', () => {
    render(<ScreenTitle title="Demo Routine" />);

    expect(screen.queryByTestId('screen-title-action')).toBeNull();
  });

  it('fires onAction when the trailing action button is pressed', () => {
    const onAction = jest.fn();
    render(
      <ScreenTitle
        title="Demo Routine"
        actionIcon="ellipsis-horizontal"
        actionAccessibilityLabel="Routine actions"
        onAction={onAction}
      />,
    );

    fireEvent.press(screen.getByTestId('screen-title-action'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
