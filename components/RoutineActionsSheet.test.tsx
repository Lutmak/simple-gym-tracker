import React from 'react';
import { TextInput } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RoutineActionsSheet } from './RoutineActionsSheet';
import type { ActivationTarget } from '../utils/routineLibrary';

const active = { routineId: 1, name: 'Push Pull Legs' };

const renderSheet = (
  overrides: Partial<React.ComponentProps<typeof RoutineActionsSheet>> & {
    target: ActivationTarget | null;
  },
) => {
  const props: React.ComponentProps<typeof RoutineActionsSheet> = {
    active,
    onClose: jest.fn(),
    onActivate: jest.fn(),
    onEdit: jest.fn(),
    onDuplicate: jest.fn(),
    onDelete: jest.fn(),
    ...overrides,
  };
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <RoutineActionsSheet {...props} />
    </SafeAreaProvider>,
  );
  return props;
};

const routineTarget: ActivationTarget = { kind: 'routine', routineId: 2, name: 'Upper / Lower' };
const presetTarget: ActivationTarget = {
  kind: 'preset',
  routineKey: '531',
  name: '5/3/1',
  copyRoutineId: null,
};

describe('RoutineActionsSheet — one action bar per routine', () => {
  it('renders nothing until a routine is touched', () => {
    renderSheet({ target: null });
    expect(screen.queryByTestId('routine-actions-list')).toBeNull();
  });

  it('offers the four actions for one of the user’s routines', () => {
    renderSheet({ target: routineTarget });
    expect(screen.getByTestId('routine-action-activate')).toBeTruthy();
    expect(screen.getByTestId('routine-action-edit')).toBeTruthy();
    expect(screen.getByTestId('routine-action-duplicate')).toBeTruthy();
    expect(screen.getByTestId('routine-action-delete')).toBeTruthy();
  });

  it('says which routine activation replaces, before anything is confirmed', () => {
    renderSheet({ target: routineTarget });
    expect(screen.getByText('routineActionActivateReplaces')).toBeTruthy();
  });

  it('reports an already-active routine instead of offering to activate it again', () => {
    renderSheet({
      target: { kind: 'routine', routineId: active.routineId, name: active.name },
    });
    expect(screen.getByText('routineActionActivateAlready')).toBeTruthy();
    expect(screen.getByTestId('routine-action-activate').props.accessibilityState.disabled).toBe(
      true,
    );
  });

  it('confirms what becomes inactive before activating', () => {
    const props = renderSheet({ target: routineTarget });
    fireEvent.press(screen.getByTestId('routine-action-activate'));
    expect(props.onActivate).not.toHaveBeenCalled();
    expect(screen.getByText('routineConfirmActivateDeactivates')).toBeTruthy();

    fireEvent.press(screen.getByTestId('routine-confirm-activate-action'));
    expect(props.onActivate).toHaveBeenCalledWith(routineTarget);
  });

  it('never asks for a number: no input exists anywhere in the activation flow', () => {
    renderSheet({ target: routineTarget });
    expect(screen.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);

    fireEvent.press(screen.getByTestId('routine-action-activate'));
    expect(screen.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
    expect(screen.getByText('routineConfirmActivateNoWeights')).toBeTruthy();
  });

  it('confirms a deletion before it happens, and says it cannot be undone', () => {
    const props = renderSheet({ target: routineTarget });
    fireEvent.press(screen.getByTestId('routine-action-delete'));
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('routineDeleteIrreversible')).toBeTruthy();

    fireEvent.press(screen.getByTestId('routine-confirm-delete-action'));
    expect(props.onDelete).toHaveBeenCalledWith(2);
  });

  it('opens a preset straight at its one action, with nothing to edit or delete', () => {
    const props = renderSheet({ target: presetTarget });
    expect(screen.queryByTestId('routine-actions-list')).toBeNull();
    expect(screen.queryByTestId('routine-action-edit')).toBeNull();
    expect(screen.queryByTestId('routine-action-delete')).toBeNull();
    expect(screen.getByTestId('routine-confirm-activate')).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);

    fireEvent.press(screen.getByTestId('routine-confirm-activate-action'));
    expect(props.onActivate).toHaveBeenCalledWith(presetTarget);
  });

  it('holds every action while a write is in flight', () => {
    renderSheet({ target: routineTarget, busy: true });
    expect(screen.getByTestId('routine-action-edit').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId('routine-action-delete').props.accessibilityState.disabled).toBe(
      true,
    );
  });
});
