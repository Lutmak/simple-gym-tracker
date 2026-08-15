import React from 'react';
import { Button, Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { QueueRevisionProvider, useQueueRevision } from './QueueRevision';

const Probe = () => {
  const { revision, bump } = useQueueRevision();
  return (
    <>
      <Text>{revision}</Text>
      <Button title="bump" onPress={bump} />
    </>
  );
};

describe('QueueRevision', () => {
  it('starts at zero and increments on bump', () => {
    render(
      <QueueRevisionProvider>
        <Probe />
      </QueueRevisionProvider>,
    );

    expect(screen.getByText('0')).toBeTruthy();
    fireEvent.press(screen.getByText('bump'));
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('throws when used outside its provider', () => {
    expect(() => render(<Probe />)).toThrow(
      'useQueueRevision must be used within a QueueRevisionProvider',
    );
  });
});
