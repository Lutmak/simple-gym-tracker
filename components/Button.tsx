import React from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { fontSize, radius, spacing, touchTarget } from '../utils/scale';

/**
 * The primary action button — accent-filled, pill-shaped, one label, never a
 * card. It is the "do the one thing this screen is for" control: the raised
 * centre button of the tab bar, the finish-session button, the start button.
 * Anything that needs a secondary or quiet variant will get one when a screen
 * genuinely needs it, not before (coding-principles: no speculative variants).
 *
 * Owns its minimum touch target, its press state and its disabled state.
 */
export type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Layout and positioning only — the look comes from the tokens above. */
  style?: StyleProp<ViewStyle>;
  /** Extends the touch area beyond the layout box, e.g. for a raised button. */
  hitSlop?: number | { top?: number; bottom?: number; left?: number; right?: number };
  testID?: string;
};

export function Button({ label, onPress, disabled, style, hitSlop, testID }: ButtonProps) {
  const { tokens } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled === true }}
      hitSlop={hitSlop}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: disabled ? tokens.disabled : tokens.accent },
        pressed && { opacity: 0.85 },
        style,
      ]}
    >
      <Text
        style={[styles.label, { color: tokens.onAccent }]}
        maxFontSizeMultiplier={1.5}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: touchTarget.control,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.card * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
});
