import React, { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../utils/scale';

/**
 * The page canvas. Owns the screen surface colour and the page gutters — the only padding that
 * wraps every other element. Content inside a Screen must not add its own horizontal padding;
 * rows are full-bleed within the gutter on purpose.
 *
 * It also owns the **top and bottom safe-area insets**, because no screen in this app has a navigation header
 * (`headerShown: false` on every route — each screen draws its own title). Android is edge-to-edge
 * from SDK 54 and cannot be opted out of, so without this the first line of every screen sits
 * under the clock — observed on the emulator, 2026-08-15, with the Settings section title printed
 * across the status bar. Fixing it in the primitive is what stops all seventeen screens of Phases
 * H–S from each rediscovering it. Add a `header` prop here if a route ever gains a real header;
 * do not paper over it with a magic number in a screen.
 */
export type ScreenProps = {
  children: ReactNode;
  /** Wrap content in a ScrollView. */
  scroll?: boolean;
  /** Let the content own a fixed-header/body/footer layout. */
  fill?: boolean;
  testID?: string;
};

export function Screen({ children, scroll, fill, testID }: ScreenProps) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const padded = [
    styles.padded,
    fill && styles.fill,
    {
      paddingTop: insets.top + spacing.section,
      paddingLeft: spacing.gutter + insets.left,
      paddingRight: spacing.gutter + insets.right,
      paddingBottom: spacing.section + insets.bottom,
    },
  ];

  const content = (
    <View style={padded} testID="screen-content">
      {children}
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: tokens.surface }]} testID={testID}>
      {scroll ? <ScrollView style={styles.scroll}>{content}</ScrollView> : content}
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
    paddingBottom: spacing.section,
  },
  fill: {
    flex: 1,
  },
});
