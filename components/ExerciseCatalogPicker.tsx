import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { APP_TEXT_MAX_FONT_SIZE_MULTIPLIER } from './AppTextInput';
import { fontSize, radius, spacing, touchTarget } from '../utils/scale';
import AppTextInput from './AppTextInput';

type CatalogRow = { exerciseKey: string; name: string };

type Props = {
  visible: boolean;
  /** The tapped exercise's catalog id; null opens the whole catalog. */
  catalogExerciseId: string | null;
  onSelect: (exercise: { catalogExerciseId: string | null; name: string }) => void;
  onClose: () => void;
};

/**
 * The D3 catalog picker (SPECS.md D3, §3.5): pre-filtered to the tapped
 * exercise's primary muscles, searchable, with an "all exercises" escape and
 * a free-text custom exercise. Selecting a row snapshots the catalog name
 * into the plan; a custom exercise is a plan row with a NULL catalog id.
 */
export default function ExerciseCatalogPicker({
  visible,
  catalogExerciseId,
  onSelect,
  onClose,
}: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const db = useSQLiteContext();

  const [exercises, setExercises] = useState<CatalogRow[]>([]);
  const [filterMuscles, setFilterMuscles] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customName, setCustomName] = useState('');

  const load = useCallback(async () => {
    const muscleRows = await db.getAllAsync<{ muscle_name: string }>(
      `SELECT DISTINCT muscle_name FROM Catalog_Exercise_Muscles
       WHERE exercise_key = ? AND is_primary = 1;`,
      [catalogExerciseId],
    );
    const muscles = muscleRows.map((row) => row.muscle_name);
    setFilterMuscles(muscles);

    const rows =
      showAll || muscles.length === 0
        ? await db.getAllAsync<{ exercise_key: string; name: string }>(
            'SELECT exercise_key, name FROM Catalog_Exercises ORDER BY name;',
          )
        : await db.getAllAsync<{ exercise_key: string; name: string }>(
            `SELECT DISTINCT e.exercise_key, e.name
             FROM Catalog_Exercises e
             JOIN Catalog_Exercise_Muscles m ON m.exercise_key = e.exercise_key
             WHERE m.muscle_name IN (${muscles.map(() => '?').join(', ')})
             ORDER BY e.name;`,
            muscles,
          );
    setExercises(
      rows.map((row) => ({ exerciseKey: row.exercise_key, name: row.name })),
    );
  }, [db, catalogExerciseId, showAll]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setQuery('');
    setShowAll(false);
    setCustomMode(false);
    setCustomName('');
    load().catch((error: unknown) => {
      console.error('Error loading the exercise catalog:', error);
    });
  }, [visible, load]);

  const selectRow = (exercise: { catalogExerciseId: string | null; name: string }) => {
    onSelect(exercise);
  };

  const addCustom = () => {
    const name = customName.trim();
    if (name === '') {
      Alert.alert(t('pickerCustomNameRequired'));
      return;
    }
    selectRow({ catalogExerciseId: null, name });
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visibleExercises = exercises.filter((exercise) =>
    exercise.name.toLowerCase().includes(normalizedQuery),
  );

  const muscleFilterLabel =
    !showAll && filterMuscles.length > 0 ? filterMuscles.join(', ') : null;

  return (
    <Modal visible={visible} animationType='slide' transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.text }]}>{t('pickerTitle')}</Text>
            <Pressable
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole='button'
            >
              <Ionicons name='close' size={24} color={theme.text} />
            </Pressable>
          </View>

          {muscleFilterLabel !== null && (
            <Text
              style={[styles.filterLabel, { color: theme.text }]}
              maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
            >
              {t('pickerMuscleFilter', { muscles: muscleFilterLabel })}
            </Text>
          )}

          <Pressable
            onPress={() => setShowAll((current) => !current)}
            style={[
              styles.allToggle,
              {
                backgroundColor: showAll ? theme.buttonBackground : theme.card,
                borderColor: theme.border,
              },
            ]}
            accessibilityRole='button'
          >
            <Text
              style={[styles.allToggleText, { color: showAll ? theme.buttonText : theme.text }]}
              maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
            >
              {t('pickerAllExercises')}
            </Text>
          </Pressable>

          {customMode ? (
            <View style={styles.customRow}>
              <AppTextInput
                variant='text'
                style={styles.customInput}
                value={customName}
                onChangeText={setCustomName}
                placeholder={t('pickerCustomNamePlaceholder')}
                autoFocus
              />
              <Pressable
                onPress={addCustom}
                style={({ pressed }) => [
                  styles.customAdd,
                  { backgroundColor: theme.buttonBackground },
                  pressed && styles.pressed,
                ]}
                accessibilityRole='button'
              >
                <Text style={[styles.customAddText, { color: theme.buttonText }]}>
                  {t('pickerAddCustom')}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.searchRow}>
              <AppTextInput
                variant='text'
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder={t('pickerSearchPlaceholder')}
              />
              <Pressable
                onPress={() => setCustomMode(true)}
                style={({ pressed }) => [
                  styles.customButton,
                  { borderColor: theme.border },
                  pressed && styles.pressed,
                ]}
                accessibilityRole='button'
              >
                <Ionicons name='create-outline' size={20} color={theme.text} />
                <Text style={[styles.customButtonText, { color: theme.text }]}>
                  {t('pickerCustomExercise')}
                </Text>
              </Pressable>
            </View>
          )}

          <FlatList
            data={visibleExercises}
            keyExtractor={(item) => item.exerciseKey}
            keyboardShouldPersistTaps='handled'
            ListEmptyComponent={
              <Text style={[styles.empty, { color: theme.text }]}>
                {t('pickerEmpty')}
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => selectRow({ catalogExerciseId: item.exerciseKey, name: item.name })}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: theme.card, borderColor: theme.border },
                  pressed && styles.pressed,
                ]}
                accessibilityRole='button'
              >
                <Text style={[styles.rowName, { color: theme.text }]} numberOfLines={1}>
                  {item.name}
                </Text>
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: spacing.gutter,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.card,
  },
  title: {
    fontSize: fontSize.sectionTitle,
    fontWeight: '900',
    flexShrink: 1,
  },
  closeButton: {
    minHeight: touchTarget.icon,
    minWidth: touchTarget.icon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterLabel: {
    fontSize: fontSize.caption,
    opacity: 0.7,
    marginBottom: spacing.card,
  },
  allToggle: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.card,
    minHeight: touchTarget.control,
    justifyContent: 'center',
    marginBottom: spacing.card,
  },
  allToggleText: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
  searchRow: {
    flexDirection: 'row',
    gap: spacing.cardGap,
    marginBottom: spacing.card,
  },
  searchInput: {
    flex: 1,
  },
  customButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
    borderRadius: radius.control,
    borderWidth: 1,
    paddingHorizontal: spacing.card,
    minHeight: touchTarget.control,
  },
  customButtonText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  customRow: {
    flexDirection: 'row',
    gap: spacing.cardGap,
    marginBottom: spacing.card,
  },
  customInput: {
    flex: 1,
  },
  customAdd: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    paddingHorizontal: spacing.card,
    minHeight: touchTarget.control,
  },
  customAddText: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
  row: {
    borderRadius: radius.control,
    borderWidth: 1,
    paddingHorizontal: spacing.card,
    paddingVertical: spacing.card,
    marginBottom: spacing.cardGap,
  },
  rowName: {
    fontSize: fontSize.body,
  },
  empty: {
    fontSize: fontSize.body,
    opacity: 0.7,
    textAlign: 'center',
    padding: spacing.section,
  },
  pressed: {
    opacity: 0.7,
  },
});
