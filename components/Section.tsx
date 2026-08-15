import React, { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { fontSize, spacing } from '../utils/scale';

/**
 * A group of related content. Hierarchy is expressed by type, weight, spacing and dividers —
 * never by a box. A Section is a heading and the whitespace around its children; it has no
 * surface, no border and no radius, and it must not be placed inside another Section (the
 * exception that makes nesting look like nesting).
 */
export type SectionProps = {
  title?: string;
  /** One line of guidance under the title. */
  hint?: string;
  children: ReactNode;
  testID?: string;
};

export function Section({ title, hint, children, testID }: SectionProps) {
  const { tokens } = useTheme();

  return (
    <View style={styles.section} testID={testID}>
      {title !== undefined && (
        <Text
          style={[styles.title, { color: tokens.textPrimary }]}
          maxFontSizeMultiplier={1.5}
        >
          {title}
        </Text>
      )}
      {hint !== undefined && (
        <Text
          style={[styles.hint, { color: tokens.textSecondary }]}
          maxFontSizeMultiplier={1.5}
        >
          {hint}
        </Text>
      )}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.section,
  },
  title: {
    fontSize: fontSize.sectionTitle,
    fontWeight: '700',
    marginBottom: spacing.cardGap,
  },
  hint: {
    fontSize: fontSize.helper,
    marginTop: -spacing.label,
    marginBottom: spacing.cardGap,
  },
  content: {
    gap: spacing.cardGap,
  },
});
