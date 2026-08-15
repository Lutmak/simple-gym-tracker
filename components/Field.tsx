import React, { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { fontSize, spacing } from '../utils/scale';

/**
 * A labelled control: label above, control below, optional one-line guidance under it.
 * The label is secondary by design — the control is the primary content of the row.
 * A Field is not a box; the control renders its own fill.
 */
export type FieldProps = {
  label: string;
  /** The control — an AppTextInput, a Switch, a NumberStepper. */
  children: ReactNode;
  /** One line of guidance under the control. */
  hint?: string;
  testID?: string;
};

export function Field({ label, children, hint, testID }: FieldProps) {
  const { tokens } = useTheme();

  return (
    <View style={styles.field} testID={testID}>
      <Text style={[styles.label, { color: tokens.textSecondary }]} maxFontSizeMultiplier={1.5}>
        {label}
      </Text>
      {children}
      {hint !== undefined && (
        <Text style={[styles.hint, { color: tokens.textSecondary }]} maxFontSizeMultiplier={1.5}>
          {hint}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    marginBottom: spacing.section,
  },
  label: {
    fontSize: fontSize.label,
    marginBottom: spacing.label,
  },
  hint: {
    fontSize: fontSize.helper,
    marginTop: spacing.label,
  },
});
