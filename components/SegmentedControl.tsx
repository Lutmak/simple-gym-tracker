import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { fontSize, radius, spacing, touchTarget } from '../utils/scale';

/**
 * A row of options with exactly one selected. The selected segment is the current position, so it
 * wears the accent; the rest are quiet text. There is no track box around the segments — the
 * pills themselves are the control, which is what keeps a segmented control from becoming a
 * surface inside a surface.
 *
 * Longer option sets pick one of two layouts, never both: `wrap` breaks into compact rows (a
 * bounded set read as a whole, e.g. a draft's body-part picker); `scroll` keeps one row and lets
 * it scroll horizontally (a wide filter set where wrapping would strand a lone last option onto
 * its own row — the exercise catalog's body-part filter, SPEC.md U1, was wrapping into three rows
 * for exactly this reason).
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
  /** Keep one row and let it scroll horizontally, instead of wrapping. */
  scroll?: boolean;
  testID?: string;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled,
  wrap,
  scroll,
  testID,
}: SegmentedControlProps<T>) {
  const { tokens } = useTheme();

  const segments = options.map((option) => {
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
          scroll === true && styles.scrolledSegment,
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
  });

  if (scroll === true) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrolledContainer}
        testID={testID}
      >
        {segments}
      </ScrollView>
    );
  }

  return (
    <View style={[styles.container, wrap && styles.wrappedContainer]} testID={testID}>
      {segments}
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
  scrolledContainer: {
    flexDirection: 'row',
    gap: spacing.inline,
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
  scrolledSegment: {
    flex: 0,
  },
  label: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
});
