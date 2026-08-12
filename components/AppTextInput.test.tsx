import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import AppTextInput, {
  normalizeNumericInput,
  parseNumericInput,
} from './AppTextInput';

describe('AppTextInput numeric variant', () => {
  it('keeps an empty value editable and commits null only at the blur boundary', () => {
    const onRawChange = jest.fn();
    const onCommit = jest.fn();
    const { getByTestId } = render(
      <AppTextInput
        testID="numeric-input"
        variant="numeric"
        value="12"
        onRawChange={onRawChange}
        onCommit={onCommit}
      />,
    );
    const input = getByTestId('numeric-input');

    fireEvent.changeText(input, '');

    expect(input.props.value).toBe('');
    expect(onRawChange).toHaveBeenLastCalledWith('');
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.changeText(input, '4');
    expect(input.props.value).toBe('4');
    fireEvent(input, 'blur');

    expect(onCommit).toHaveBeenCalledWith(4);
    expect(input.props.value).toBe('4');
  });

  it('preserves leading zeroes while editing and parses them consistently on commit', () => {
    expect(normalizeNumericInput('007')).toBe('007');
    expect(parseNumericInput('007')).toBe(7);
    expect(parseNumericInput(normalizeNumericInput('007'))).toBe(7);
  });

  it('preserves a trailing decimal point as an editing value', () => {
    expect(normalizeNumericInput('12.')).toBe('12.');
    expect(parseNumericInput('12.')).toBe(12);
  });

  it('strips non-numeric characters from pasted text predictably', () => {
    expect(normalizeNumericInput('12kg')).toBe('12');
    expect(normalizeNumericInput('not a number')).toBe('');
    expect(parseNumericInput('12kg')).toBe(12);
  });

  it('normalizes a locale decimal comma before parsing', () => {
    expect(normalizeNumericInput('12,5')).toBe('12.5');
    expect(parseNumericInput('12,5')).toBe(12.5);
  });
});
