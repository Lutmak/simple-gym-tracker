import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { fontSize, radius, spacing, touchTarget } from '../utils/scale';

/**
 * A row of options with exactly one selected. The selected segment is the current position, so it
 * wears the accent; the rest are quiet text. There is no track box around the segments — the
 * pills themselves are the control, which is what keeps a segmented control from becoming a
 * surface inside a surface.
 */
export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
};

export type SegmentedControlProps<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  testID?: string;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled,
  testID,
}: SegmentedControlProps<T>) {
  const { tokens } = useTheme();

  return (
    <View style={styles.container} testID={testID}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            disabled={disabled}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled: disabled === true }}
            style={({ pressed }) => [
              styles.segment,
              selected
                ? { backgroundColor: tokens.accent }
                : pressed && !disabled
                  ? { backgroundColor: tokens.inputFill }
                  : null,
            ]}
          >
            <Text
              style={[
                styles.label,
                selected
                  ? { color: tokens.onAccent }
                  : { color: disabled ? tokens.disabled : tokens.textPrimary },
              ]}
              maxFontSizeMultiplier={1.5}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing.inline,
  },
  segment: {
    flex: 1,
    minHeight: touchTarget.control,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.card,
  },
  label: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
});
