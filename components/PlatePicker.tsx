import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { fontSize, radius, spacing, touchTarget } from '../utils/scale';

export type PlatePickerOption = {
  value: number;
  label: string;
};

export type PlatePickerProps = {
  options: readonly PlatePickerOption[];
  onPress: (value: number) => void;
  onLongPress?: (value: number) => void;
  longPressHint?: string;
  testID?: string;
};

/** Compact, tokenized actions for adding a standard plate or removing one by long press. */
export function PlatePicker({
  options,
  onPress,
  onLongPress,
  longPressHint,
  testID,
}: PlatePickerProps) {
  const { tokens } = useTheme();

  return (
    <View style={styles.options} testID={testID}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          onPress={() => onPress(option.value)}
          onLongPress={onLongPress === undefined ? undefined : () => onLongPress(option.value)}
          accessibilityRole="button"
          accessibilityLabel={option.label}
          accessibilityHint={longPressHint}
          style={({ pressed }) => [
            styles.option,
            pressed && { backgroundColor: tokens.inputFill },
          ]}
        >
          <Text style={[styles.label, { color: tokens.textPrimary }]} maxFontSizeMultiplier={1.5}>
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.inline,
  },
  option: {
    flexGrow: 1,
    flexBasis: '30%',
    minHeight: touchTarget.control,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.inline,
  },
  label: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
});
