import React, { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../utils/scale';

/**
 * The page canvas. Owns the screen surface colour and the page gutters — the only padding that
 * wraps every other element. Content inside a Screen must not add its own horizontal padding;
 * rows are full-bleed within the gutter on purpose.
 */
export type ScreenProps = {
  children: ReactNode;
  /** Wrap content in a ScrollView. */
  scroll?: boolean;
  testID?: string;
};

export function Screen({ children, scroll, testID }: ScreenProps) {
  const { tokens } = useTheme();

  return (
    <View style={[styles.screen, { backgroundColor: tokens.surface }]} testID={testID}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.padded} style={styles.scroll}>
          {children}
        </ScrollView>
      ) : (
        <View style={styles.padded}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.section,
  },
});
