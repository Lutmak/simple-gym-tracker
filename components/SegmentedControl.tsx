import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
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
  /** An Ionicons glyph before the label, for options that are things rather than states (R2). */
  icon?: string;
};

export type SegmentedControlProps<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Wrap longer option sets into compact rows while keeping one selection. */
  wrap?: boolean;
  testID?: string;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled,
  wrap,
  testID,
}: SegmentedControlProps<T>) {
  const { tokens } = useTheme();

  return (
    <View style={[styles.container, wrap && styles.wrappedContainer]} testID={testID}>
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
              wrap && styles.wrappedSegment,
              selected
                ? { backgroundColor: tokens.accent }
                : pressed && !disabled
                  ? { backgroundColor: tokens.inputFill }
                  : null,
            ]}
          >
            {option.icon !== undefined && (
              <Ionicons
                name={option.icon}
                size={fontSize.button}
                color={
                  selected
                    ? tokens.onAccent
                    : disabled
                      ? tokens.disabled
                      : tokens.textPrimary
                }
              />
            )}
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
  wrappedContainer: {
    flexWrap: 'wrap',
  },
  segment: {
    flex: 1,
    minHeight: touchTarget.control,
    borderRadius: radius.control,
    flexDirection: 'row',
    gap: spacing.inline,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.card,
  },
  wrappedSegment: {
    flexBasis: '30%',
  },
  label: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
});
