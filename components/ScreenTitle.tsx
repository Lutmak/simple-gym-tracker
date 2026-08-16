import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { fontSize, spacing, tabBar, touchTarget } from '../utils/scale';

/**
 * The one big heading at the top of a screen, with the back control when the screen was pushed.
 *
 * Every route in this app runs with `headerShown: false` — each screen draws its own title, and
 * `Screen` owns the safe-area inset above it (see components/Screen.tsx). That leaves a pushed
 * screen with no way back unless it draws one, which the session runner already did by hand. This
 * is that control, in the design system rather than in a screen, so the chevron, its touch target
 * and its distance from the title are decided once.
 *
 * `overline` is the small line above the title that says what kind of thing this is — a marker,
 * not a badge: hierarchy here is type and weight, never a filled pill (§3.5).
 */
export type ScreenTitleProps = {
  title: string;
  /** A short uppercase marker above the title, e.g. "Active routine". */
  overline?: string;
  /** Draws the back chevron. Omitted on a tab root, which has nowhere to go back to. */
  onBack?: () => void;
  testID?: string;
};

export function ScreenTitle({ title, overline, onBack, testID }: ScreenTitleProps) {
  const { tokens } = useTheme();
  const { t } = useTranslation();

  return (
    <View style={styles.header} testID={testID}>
      {onBack !== undefined && (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('sheetBack')}
          hitSlop={spacing.card}
          style={({ pressed }) => [
            styles.back,
            pressed && { backgroundColor: tokens.inputFill },
          ]}
          testID="screen-title-back"
        >
          <Ionicons name="chevron-back" size={tabBar.icon} color={tokens.textPrimary} />
        </Pressable>
      )}
      <View style={styles.text}>
        {overline !== undefined && (
          <Text
            style={[styles.overline, { color: tokens.textSecondary }]}
            maxFontSizeMultiplier={1.5}
          >
            {overline}
          </Text>
        )}
        <Text style={[styles.title, { color: tokens.textPrimary }]} maxFontSizeMultiplier={1.5}>
          {title}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
    marginBottom: spacing.section,
  },
  back: {
    minWidth: touchTarget.icon,
    minHeight: touchTarget.icon,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.label,
  },
  text: {
    flexShrink: 1,
    flexGrow: 1,
    gap: spacing.label,
  },
  overline: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  title: {
    fontSize: fontSize.screenTitle,
    fontWeight: '700',
  },
});
