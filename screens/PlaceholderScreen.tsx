import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { fontSize, radius, spacing, touchTarget } from '../utils/scale';

type Props = {
  titleKey: string;
  action?: { labelKey: string; onPress: () => void };
};

export default function PlaceholderScreen({ titleKey, action }: Props) {
  const { t } = useTranslation();
  const { theme } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={[styles.title, { color: theme.text }]}>{t(titleKey)}</Text>
      {action !== undefined && (
        <Pressable
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.buttonBackground },
            pressed && styles.pressed,
          ]}
          onPress={action.onPress}
          accessibilityRole='button'
        >
          <Text style={[styles.buttonText, { color: theme.buttonText }]}>
            {t(action.labelKey)}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: fontSize.screenTitle,
  },
  button: {
    borderRadius: radius.control,
    paddingHorizontal: spacing.card,
    paddingVertical: spacing.card,
    minHeight: touchTarget.control,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.section,
  },
  buttonText: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
  },
});
