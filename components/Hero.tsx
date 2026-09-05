import React, { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius, spacing } from '../utils/scale';

/**
 * The one filled surface a screen may open with (ADR-0047 §4.2/§4.3): today's session on Inicio,
 * the streak/adherence tiles on Progreso, the active routine on Rutinas. Nothing inside it is
 * itself a surface — hierarchy inside stays type and spacing, exactly like every other primitive
 * (`Section`, `Row`); a `Hero` inside a `Hero`, or a `Hero` inside a `Sheet`, is the bug the "no
 * surface inside a surface" rule exists to catch.
 */
export type HeroProps = {
  children: ReactNode;
  testID?: string;
};

export function Hero({ children, testID }: HeroProps) {
  const { tokens } = useTheme();

  return (
    <View
      style={[styles.hero, { backgroundColor: tokens.surfaceRaised }]}
      testID={testID}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: radius.card,
    padding: spacing.card,
    marginBottom: spacing.section,
  },
});
