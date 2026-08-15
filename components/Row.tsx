import React, { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { fontSize, spacing, touchTarget } from '../utils/scale';

/**
 * One tappable list item — the unit of every list in the app. A Row is not a card: it is
 * flat on the screen surface, separated from its siblings by hairlines, never by a box.
 *
 * Owns its minimum height, its press feedback (a quiet surface flash, not a border), its
 * disabled state and its optional divider. Rows are full-bleed inside the Screen/Sheet gutter.
 */
export type RowProps = {
  label: string;
  /** Secondary text on the right side, before any `right` control. */
  detail?: string;
  /** A trailing control — a Switch, a chevron, a value chip. */
  right?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  /** A hairline under this row, for lists where the boundary is real. */
  divided?: boolean;
  testID?: string;
};

export function Row({ label, detail, right, onPress, disabled, divided, testID }: RowProps) {
  const { tokens } = useTheme();

  const content = (
    <>
      <Text
        style={[
          styles.label,
          { color: disabled ? tokens.disabled : tokens.textPrimary },
        ]}
        numberOfLines={2}
        maxFontSizeMultiplier={1.5}
      >
        {label}
      </Text>
      {detail !== undefined && (
        <Text style={[styles.detail, { color: tokens.textSecondary }]} numberOfLines={2} maxFontSizeMultiplier={1.5}>
          {detail}
        </Text>
      )}
      {right !== undefined && <View style={styles.right}>{right}</View>}
    </>
  );

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || onPress === undefined}
      accessibilityRole={onPress !== undefined ? 'button' : undefined}
      accessibilityState={{ disabled: disabled === true || onPress === undefined }}
      testID={testID}
      style={({ pressed }) => [
        styles.row,
        divided && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.divider },
        pressed && onPress !== undefined && { backgroundColor: tokens.inputFill },
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: touchTarget.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
  },
  label: {
    fontSize: fontSize.cardTitle,
    flexShrink: 1,
    flexGrow: 1,
  },
  detail: {
    fontSize: fontSize.body,
  },
  right: {
    marginLeft: spacing.inline,
  },
});
