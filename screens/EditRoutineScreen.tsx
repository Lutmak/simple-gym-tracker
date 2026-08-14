import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { fontSize, spacing } from '../utils/scale';

/**
 * D3's editor has not landed yet. The button exists so the action bar is
 * complete; this screen is replaced wholesale when D3 lands.
 */
export default function EditRoutineScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={[styles.message, { color: theme.text }]}>{t('editRoutineComing')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.gutter,
  },
  message: {
    fontSize: fontSize.body,
    opacity: 0.7,
    textAlign: 'center',
  },
});
