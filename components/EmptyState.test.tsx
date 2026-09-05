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

  it('claims the full height and centres when `fill` is set (U2 fix)', () => {
    render(<EmptyState title="Nothing here" fill testID="empty" />);

    const root = screen.getByTestId('empty');
    expect(root.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ flex: 1, justifyContent: 'center' })]),
    );
  });

  it('does not fill by default — a screen composing it inline keeps its own flow', () => {
    render(<EmptyState title="Nothing here" testID="empty" />);

    const root = screen.getByTestId('empty');
    const flatStyle = ([] as unknown[]).concat(root.props.style);
    expect(flatStyle.some((entry) => (entry as Record<string, unknown>)?.flex === 1)).toBe(false);
  });
});
