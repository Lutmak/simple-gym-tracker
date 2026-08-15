import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders the title and message', () => {
    render(<EmptyState title="Nothing here" message="Start with a routine." />);

    expect(screen.getByText('Nothing here')).toBeTruthy();
    expect(screen.getByText('Start with a routine.')).toBeTruthy();
  });

  it('fires the action when pressed', () => {
    const onAction = jest.fn();
    render(
      <EmptyState
        title="Nothing here"
        actionLabel="Browse routines"
        onAction={onAction}
      />,
    );

    fireEvent.press(screen.getByText('Browse routines'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
