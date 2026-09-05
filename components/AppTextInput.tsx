import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  TextInput,
  type TextInputProps,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';

export const APP_TEXT_MAX_FONT_SIZE_MULTIPLIER = 1.5;

export type NumericAppTextInputProps = Omit<
  TextInputProps,
  'value' | 'defaultValue' | 'onChangeText' | 'onBlur' | 'onSubmitEditing'
> & {
  variant: 'numeric';
  value?: string;
  defaultValue?: string;
  onRawChange?: (value: string) => void;
  onCommit?: (value: number | null) => void;
  onBlur?: TextInputProps['onBlur'];
  onSubmitEditing?: TextInputProps['onSubmitEditing'];
};

export type TextAppTextInputProps = TextInputProps & {
  variant?: 'text';
};

export type AppTextInputProps =
  | TextAppTextInputProps
  | NumericAppTextInputProps;

export function normalizeNumericInput(value: string): string {
  let normalized = '';
  let hasDecimalSeparator = false;

  for (const character of value) {
    if (character >= '0' && character <= '9') {
      normalized += character;
      continue;
    }

    if (
      (character === '.' || character === ',') &&
      !hasDecimalSeparator
    ) {
      normalized += '.';
      hasDecimalSeparator = true;
    }
  }

  return normalized;
}

export function parseNumericInput(value: string): number | null {
  const normalized = normalizeNumericInput(value);

  if (normalized === '' || normalized === '.') {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

const AppTextInput = React.forwardRef<TextInput, AppTextInputProps>(
  (props, ref) => {
    const { theme } = useTheme();
    const [isFocused, setIsFocused] = useState(false);
    const [rawNumericValue, setRawNumericValue] = useState(() =>
      props.variant === 'numeric'
        ? normalizeNumericInput(props.value ?? props.defaultValue ?? '')
        : '',
    );

    useEffect(() => {
      if (
        props.variant !== 'numeric' ||
        isFocused ||
        props.value === undefined
      ) {
        return;
      }

      const nextValue = normalizeNumericInput(props.value);
      setRawNumericValue((currentValue) =>
        currentValue === nextValue ? currentValue : nextValue,
      );
    }, [props.value, props.variant]);

    const handleFocus: NonNullable<TextInputProps['onFocus']> = (event) => {
      setIsFocused(true);
      props.onFocus?.(event);
    };

    const handleBlur: NonNullable<TextInputProps['onBlur']> = (event) => {
      setIsFocused(false);
      props.onBlur?.(event);
    };

    if (props.variant === 'numeric') {
      const {
        variant: _variant,
        value: _value,
        defaultValue: _defaultValue,
        onRawChange,
        onCommit,
        onSubmitEditing,
        onBlur,
        style,
        ...nativeProps
      } = props;

      // Committing on blur/submit alone missed a typed value whenever nothing fired one:
      // dismissing the Android keyboard with the back key does not blur the input, so
      // typing "100" and pressing back left the field showing 100 while the parent still
      // held null (found on the fresh-install walkthrough, 2026-09-04 — a session's weight
      // sheet stayed disabled with a value visibly typed in). Every valid keystroke now
      // commits immediately; '' commits `null`, the same "not yet entered" state a fresh
      // field starts in, so clearing the field is not a special case either.
      const handleRawChange: NonNullable<TextInputProps['onChangeText']> = (
        value,
      ) => {
        const normalizedValue = normalizeNumericInput(value);
        setRawNumericValue(normalizedValue);
        onRawChange?.(normalizedValue);
        onCommit?.(parseNumericInput(normalizedValue));
      };

      const commitNumericValue = () => {
        onCommit?.(parseNumericInput(rawNumericValue));
      };

      const handleSubmitEditing: NonNullable<
        TextInputProps['onSubmitEditing']
      > = (event) => {
        commitNumericValue();
        onSubmitEditing?.(event);
      };

      const handleNumericBlur: NonNullable<TextInputProps['onBlur']> = (
        event,
      ) => {
        setIsFocused(false);
        commitNumericValue();
        onBlur?.(event);
      };

      return (
        <TextInput
          {...nativeProps}
          ref={ref}
          value={rawNumericValue}
          style={[
            styles.input,
            { color: theme.text },
            style,
            {
              backgroundColor: theme.card,
              borderColor: isFocused ? theme.buttonBackground : theme.border,
              borderWidth: 1,
            },
          ]}
          placeholderTextColor={
            theme.type === 'dark'
              ? 'rgba(255, 255, 255, 0.6)'
              : 'rgba(0, 0, 0, 0.6)'
          }
          maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          onFocus={handleFocus}
          onBlur={handleNumericBlur}
          onChangeText={handleRawChange}
          onSubmitEditing={handleSubmitEditing}
        />
      );
    }

    const { variant: _variant, style, ...nativeProps } = props;

    return (
      <TextInput
        {...nativeProps}
        ref={ref}
        style={[
          styles.input,
          { color: theme.text },
          style,
          {
            backgroundColor: theme.card,
            borderColor: isFocused ? theme.buttonBackground : theme.border,
            borderWidth: 1,
          },
        ]}
        placeholderTextColor={
          theme.type === 'dark'
            ? 'rgba(255, 255, 255, 0.6)'
            : 'rgba(0, 0, 0, 0.6)'
        }
        maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
    );
  },
);

AppTextInput.displayName = 'AppTextInput';

export default AppTextInput;

const styles = StyleSheet.create({
  input: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    minHeight: 44,
  },
});
