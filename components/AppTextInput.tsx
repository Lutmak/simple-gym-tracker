import React, { useState } from 'react';
import {
  StyleSheet,
  TextInput,
  type TextInputProps,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';

export const APP_TEXT_MAX_FONT_SIZE_MULTIPLIER = 1.5;

export type AppTextInputProps = TextInputProps;

const AppTextInput = React.forwardRef<TextInput, AppTextInputProps>(
  ({ style, onFocus, onBlur, ...props }, ref) => {
    const { theme } = useTheme();
    const [isFocused, setIsFocused] = useState(false);

    const handleFocus: NonNullable<TextInputProps['onFocus']> = (event) => {
      setIsFocused(true);
      onFocus?.(event);
    };

    const handleBlur: NonNullable<TextInputProps['onBlur']> = (event) => {
      setIsFocused(false);
      onBlur?.(event);
    };

    return (
      <TextInput
        {...props}
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
