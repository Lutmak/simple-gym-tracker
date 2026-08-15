import React from 'react';
import { TextInput } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  NumberStepper,
  clampStepperValue,
  nextStepperValue,
} from './NumberStepper';
describe('NumberStepper arithmetic', () => {
  it('steps by the given increment without float drift', () => {
    expect(nextStepperValue(5, 1, 2.5)).toBe(7.5);
    expect(nextStepperValue(7.5, -1, 2.5)).toBe(5);
    expect(nextStepperValue(2.5, 1, 2.5)).toBe(5);
  });

  it('starts from the step when the value is empty', () => {
    expect(nextStepperValue(null, 1, 2.5)).toBe(2.5);
  });

  it('clamps at the boundaries', () => {
    expect(nextStepperValue(8, 1, 2.5, undefined, 10)).toBe(10);
    expect(nextStepperValue(3, -1, 2.5, 0)).toBe(0);
    expect(clampStepperValue(12, undefined, 10)).toBe(10);
    expect(clampStepperValue(-3, 0)).toBe(0);
  });
});

describe('NumberStepper', () => {
  it('increments and decrements on the buttons', () => {
    const onChange = jest.fn();
    render(<NumberStepper value={10} step={2.5} onChange={onChange} />);

    fireEvent.press(screen.getByLabelText('+'));
    expect(onChange).toHaveBeenLastCalledWith(12.5);

    fireEvent.press(screen.getByLabelText('-'));
    expect(onChange).toHaveBeenLastCalledWith(7.5);
  });

  it('does not call onChange when the step cannot move', () => {
    const onChange = jest.fn();
    render(<NumberStepper value={10} step={2.5} max={10} onChange={onChange} />);

    fireEvent.press(screen.getByLabelText('+'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('commits typed values clamped into range', () => {
    const onChange = jest.fn();
    render(<NumberStepper value={10} step={2.5} min={0} max={10} onChange={onChange} />);

    const input = screen.UNSAFE_getByType(TextInput);
    fireEvent.changeText(input, '25');
    fireEvent(input, 'blur');

    expect(onChange).toHaveBeenCalledWith(10);
  });

  it('commits an empty value as null', () => {
    const onChange = jest.fn();
    render(<NumberStepper value={10} onChange={onChange} />);

    const input = screen.UNSAFE_getByType(TextInput);
    fireEvent.changeText(input, '');
    fireEvent(input, 'blur');

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('ignores the buttons while disabled', () => {
    const onChange = jest.fn();
    render(<NumberStepper value={10} disabled onChange={onChange} />);

    fireEvent.press(screen.getByLabelText('+'));
    fireEvent.press(screen.getByLabelText('-'));

    expect(onChange).not.toHaveBeenCalled();
  });
});
