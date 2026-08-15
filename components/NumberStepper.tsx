import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import AppTextInput from './AppTextInput';
import { fontSize, spacing, touchTarget } from '../utils/scale';

/**
 * A number that can be nudged or typed. The −/+ buttons are the primary control — one rounding
 * increment per tap (§3.5) — and the input in the middle is the same AppTextInput numeric editor
 * used everywhere, not a replacement for it.
 *
 * Arithmetic rules, so screens never re-derive them:
 * - Stepping from a null (empty) value starts at `step`, then clamps into range.
 * - Stepping snaps the result back onto the step grid, so 2.5 increments never drift.
 * - Typed values are clamped but never snapped: a user may type any number they actually lifted.
 */

/** Clamp a typed value into range. */
export function clampStepperValue(value: number, min?: number, max?: number): number {
  let clamped = value;
  if (min !== undefined) {
    clamped = Math.max(min, clamped);
  }
  if (max !== undefined) {
    clamped = Math.min(max, clamped);
  }
  return clamped;
}

/** The value after one step, on the step grid and within range. */
export function nextStepperValue(
  current: number | null,
  direction: 1 | -1,
  step: number,
  min?: number,
  max?: number,
): number {
  const base = current ?? 0;
  const raw = base + direction * step;
  const snapped = Math.round(raw / step) * step;
  const clamped = clampStepperValue(snapped, min, max);
  return Math.round(clamped * 1000) / 1000;
}

export type NumberStepperProps = {
  value: number | null;
  onChange: (value: number | null) => void;
  /** The size of one step. */
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  testID?: string;
};

export function NumberStepper({
  value,
  onChange,
  step = 1,
  min,
  max,
  disabled,
  testID,
}: NumberStepperProps) {
  const { tokens } = useTheme();

  const stepBy = (direction: 1 | -1) => {
    const next = nextStepperValue(value, direction, step, min, max);
    if (next !== value) {
      onChange(next);
    }
  };

  return (
    <View style={styles.stepper} testID={testID}>
      <Pressable
        onPress={() => stepBy(-1)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="-"
        style={({ pressed }) => [
          styles.stepButton,
          pressed && !disabled ? { backgroundColor: tokens.inputFill } : null,
        ]}
      >
        <Text
          style={[styles.glyph, { color: disabled ? tokens.disabled : tokens.textPrimary }]}
          maxFontSizeMultiplier={1.5}
        >
          -
        </Text>
      </Pressable>
      <AppTextInput
        variant="numeric"
        value={value === null ? '' : String(value)}
        onCommit={(parsed) => {
          if (parsed === null) {
            onChange(null);
          } else {
            onChange(clampStepperValue(parsed, min, max));
          }
        }}
        keyboardType="decimal-pad"
        editable={!disabled}
        style={styles.input}
      />
      <Pressable
        onPress={() => stepBy(1)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="+"
        style={({ pressed }) => [
          styles.stepButton,
          pressed && !disabled ? { backgroundColor: tokens.inputFill } : null,
        ]}
      >
        <Text
          style={[styles.glyph, { color: disabled ? tokens.disabled : tokens.textPrimary }]}
          maxFontSizeMultiplier={1.5}
        >
          +
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
  },
  stepButton: {
    width: touchTarget.control,
    height: touchTarget.control,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  glyph: {
    fontSize: fontSize.sectionTitle,
    fontWeight: '600',
  },
  input: {
    flex: 1,
    textAlign: 'center',
  },
});
