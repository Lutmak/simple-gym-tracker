import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { fontSize, radius, spacing, touchTarget } from '../utils/scale';

/**
 * The "nothing here yet" state of a screen or list. Centred, quiet, and clearly a beginning
 * rather than an error. Its optional action is a filled accent button — the primary action is
 * the one place a filled surface is not exceptional, it is what the accent is for.
 *
 * `fill` centres it in whatever space it is given, instead of sitting at the top of the flow —
 * for the case where it is the only thing on the screen (a screen composes this with
 * `<Screen fill>`, which is what supplies that space; `fill` here just claims and centres in it).
 */
export type EmptyStateProps = {
  /** An Ionicons name, shown small in the secondary colour. */
  icon?: string;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Claim the full height available and centre within it, rather than sitting at the top. */
  fill?: boolean;
  testID?: string;
};

export function EmptyState({ icon, title, message, actionLabel, onAction, fill, testID }: EmptyStateProps) {
  const { tokens } = useTheme();

  return (
    <View style={[styles.empty, fill && styles.fill]} testID={testID}>
      {icon !== undefined && (
        <Ionicons name={icon} size={fontSize.screenTitle} color={tokens.textSecondary} />
      )}
      <Text style={[styles.title, { color: tokens.textPrimary }]} maxFontSizeMultiplier={1.5}>
        {title}
      </Text>
      {message !== undefined && (
        <Text style={[styles.message, { color: tokens.textSecondary }]} maxFontSizeMultiplier={1.5}>
          {message}
        </Text>
      )}
      {actionLabel !== undefined && onAction !== undefined && (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          style={({ pressed }) => [styles.action, { backgroundColor: tokens.accent }, pressed && styles.actionPressed]}
        >
          <Text style={[styles.actionLabel, { color: tokens.onAccent }]} maxFontSizeMultiplier={1.5}>
            {actionLabel}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.section,
    gap: spacing.cardGap,
  },
  fill: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: fontSize.sectionTitle,
    fontWeight: '600',
    textAlign: 'center',
  },
  message: {
    fontSize: fontSize.body,
    textAlign: 'center',
  },
  action: {
    minHeight: touchTarget.control,
    borderRadius: radius.control,
    paddingHorizontal: spacing.gutter,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.cardGap,
  },
  actionPressed: {
    opacity: 0.85,
  },
  actionLabel: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
});
