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
  /** Rich secondary content, for a detail line with an inline advisory. */
  detailContent?: ReactNode;
  /** Place the secondary text below the label, for explanatory decision rows. */
  detailBelow?: boolean;
  /** A leading marker before the label — a role glyph, a series colour dot (ADR-0047). */
  left?: ReactNode;
  /** A trailing control — a Switch, a chevron, a value chip. */
  right?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** A hairline under this row, for lists where the boundary is real. */
  divided?: boolean;
  testID?: string;
};

export function Row({
  label,
  detail,
  detailContent,
  detailBelow,
  left,
  right,
  onPress,
  onLongPress,
  disabled,
  divided,
  testID,
}: RowProps) {
  const { tokens } = useTheme();

  const text = (
    <>
      <Text
        style={[
          styles.label,
          detailBelow !== true && styles.labelBesideDetail,
          { color: disabled ? tokens.disabled : tokens.textPrimary },
        ]}
        numberOfLines={2}
        maxFontSizeMultiplier={1.5}
      >
        {label}
      </Text>
      {detailContent !== undefined
        ? detailContent
        : detail !== undefined && (
            <Text
              style={[styles.detail, { color: tokens.textSecondary }]}
              numberOfLines={2}
              maxFontSizeMultiplier={1.5}
            >
              {detail}
            </Text>
          )}
    </>
  );
  const content = detailBelow ? <View style={styles.textColumn}>{text}</View> : text;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
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
      {left !== undefined && <View style={styles.left}>{left}</View>}
      {content}
      {right !== undefined && <View style={styles.right}>{right}</View>}
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
  left: {
    marginRight: spacing.inline,
  },
  label: {
    fontSize: fontSize.cardTitle,
  },
  /**
   * Growing to fill the row belongs to the layout context, not to the label's type role: in the
   * row case the label is a direct child of a `flexDirection: 'row'` parent and these govern
   * width, but under `detailBelow` it sits in `textColumn`, where the same pair governs height
   * and collapses the text. `textColumn` already carries the growth for that case.
   */
  labelBesideDetail: {
    flexShrink: 1,
    flexGrow: 1,
  },
  detail: {
    fontSize: fontSize.body,
  },
  textColumn: {
    flexGrow: 1,
    flexShrink: 1,
    gap: spacing.label,
  },
  right: {
    marginLeft: spacing.inline,
  },
});
