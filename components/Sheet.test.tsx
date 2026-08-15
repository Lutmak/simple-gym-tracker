import React from 'react';
import { Modal, Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Sheet } from './Sheet';

const renderSheet = (props: React.ComponentProps<typeof Sheet>) =>
  render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <Sheet {...props} />
    </SafeAreaProvider>,
  );

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    renderSheet({ visible: false, onClose: jest.fn(), title: 'Decide', children: <></> });

    expect(screen.queryByText('Decide')).toBeNull();
  });

  it('renders its title and content while open', () => {
    renderSheet({
      visible: true,
      onClose: jest.fn(),
      title: 'Decide',
      children: <Text>{'the decision'}</Text>,
    });

    expect(screen.getByText('Decide')).toBeTruthy();
    expect(screen.getByText('the decision')).toBeTruthy();
  });

  it('closes when the scrim is pressed', () => {
    const onClose = jest.fn();
    renderSheet({
      visible: true,
      onClose,
      title: 'Decide',
      children: <Text>{'the decision'}</Text>,
    });

    fireEvent.press(screen.getByLabelText('sheetClose'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on the Android back button', () => {
    const onClose = jest.fn();
    renderSheet({
      visible: true,
      onClose,
      title: 'Decide',
      children: <Text>{'the decision'}</Text>,
    });

    const modal = screen.UNSAFE_getByType(Modal);
    fireEvent(modal, 'requestClose');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
