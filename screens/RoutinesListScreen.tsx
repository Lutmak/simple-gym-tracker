import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { fontSize, spacing } from '../utils/scale';
import WeekdayIndicator from '../components/WeekdayIndicator';
import type { RoutinesStackParamList } from '../App';

type Props = NativeStackScreenProps<RoutinesStackParamList, 'RoutinesList'>;

type UserRoutineRow = {
  routineId: number;
  name: string;
  origin: 'catalog' | 'user';
  isActive: boolean;
  weekdays: number[];
};

type PresetRow = {
  routineKey: string;
  name: string;
  description: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  weekdays: number[];
  sessionCount: number;
};

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

const loadUserRoutines = async (db: ReturnType<typeof useSQLiteContext>): Promise<UserRoutineRow[]> => {
  const rows = await db.getAllAsync<{
    routine_id: number;
    name: string;
    origin: string;
    is_active: number;
  }>(
    `SELECT routine_id, name, origin, is_active
     FROM Routines
     ORDER BY is_active DESC, name COLLATE NOCASE;`,
  );
  const sessions = await db.getAllAsync<{ routine_id: number; weekday: number }>(
    'SELECT routine_id, weekday FROM Sessions;',
  );
  return rows.map((row) => ({
    routineId: row.routine_id,
    name: row.name,
    origin: row.origin === 'catalog' ? 'catalog' : 'user',
    isActive: row.is_active === 1,
    weekdays: sessions
      .filter((session) => session.routine_id === row.routine_id)
      .map((session) => session.weekday),
  }));
};

const loadPresets = async (
  db: ReturnType<typeof useSQLiteContext>,
): Promise<PresetRow[]> => {
  const rows = await db.getAllAsync<{
    routine_key: string;
    name: string;
    description: string;
    level: string;
  }>(
    `SELECT routine_key, name, description, level
     FROM Preset_Routines
     ORDER BY name COLLATE NOCASE;`,
  );
  const sessions = await db.getAllAsync<{ routine_key: string; weekday: number }>(
    'SELECT routine_key, weekday FROM Preset_Sessions;',
  );
  return rows.map((row) => {
    const routineSessions = sessions.filter(
      (session) => session.routine_key === row.routine_key,
    );
    return {
      routineKey: row.routine_key,
      name: row.name,
      description: row.description,
      level: row.level as PresetRow['level'],
      weekdays: routineSessions.map((session) => session.weekday),
      sessionCount: routineSessions.length,
    };
  });
};

export default function RoutinesListScreen({ navigation }: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const db = useSQLiteContext();

  const [userRoutines, setUserRoutines] = useState<UserRoutineRow[]>([]);
  const [presets, setPresets] = useState<PresetRow[]>([]);
  const [openLevel, setOpenLevel] = useState<PresetRow['level'] | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadUserRoutines(db).then(setUserRoutines);
      loadPresets(db).then(setPresets);
    }, [db]),
  );

  const toggleLevel = (level: PresetRow['level']) => {
    setOpenLevel((current) => (current === level ? null : level));
  };

  const renderUserRoutine = (routine: UserRoutineRow) => (
    <Pressable
      key={routine.routineId}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.card, borderColor: theme.border },
        pressed && styles.cardPressed,
      ]}
      onPress={() => navigation.navigate('RoutineDetails', { routineId: routine.routineId })}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, { color: theme.text }]} numberOfLines={1}>
          {routine.name}
        </Text>
        {routine.isActive && (
          <View style={[styles.activeBadge, { backgroundColor: theme.buttonBackground }]}>
            <Text
              style={[styles.activeBadgeText, { color: theme.buttonText }]}
              maxFontSizeMultiplier={1.5}
            >
              {t('activeRoutine')}
            </Text>
          </View>
        )}
        <Ionicons name='chevron-forward' size={18} color={theme.text} />
      </View>
      <View style={styles.cardWeekdays}>
        <WeekdayIndicator weekdays={routine.weekdays} />
      </View>
    </Pressable>
  );

  const renderPresetRow = (preset: PresetRow) => (
    <Pressable
      key={preset.routineKey}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.card, borderColor: theme.border },
        pressed && styles.cardPressed,
      ]}
      onPress={() => navigation.navigate('RoutineDetails', { presetKey: preset.routineKey })}
    >
      <Text style={[styles.cardTitle, { color: theme.text }]} numberOfLines={1}>
        {preset.name}
      </Text>
      <Text
        style={[styles.cardSummary, { color: theme.text }]}
        numberOfLines={2}
      >
        {preset.description}
      </Text>
      <View style={styles.cardWeekdays}>
        <WeekdayIndicator weekdays={preset.weekdays} />
      </View>
    </Pressable>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>{t('routines')}</Text>

        <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('myRoutines')}</Text>
        {userRoutines.length === 0 && (
          <Text style={[styles.helper, { color: theme.text }]}>{t('noRoutinesYet')}</Text>
        )}
        {userRoutines.map(renderUserRoutine)}

        <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('presetRoutines')}</Text>
        {LEVELS.map((level) => {
          const levelRoutines = presets.filter((preset) => preset.level === level);
          const isOpen = openLevel === level;
          return (
            <View key={level} style={styles.levelSection}>
              <Pressable
                style={({ pressed }) => [
                  styles.levelHeader,
                  { backgroundColor: theme.card, borderColor: theme.border },
                  pressed && styles.cardPressed,
                ]}
                onPress={() => toggleLevel(level)}
              >
                <Text style={[styles.levelTitle, { color: theme.text }]}>{t(level)}</Text>
                <Text style={[styles.levelCount, { color: theme.text }]}>
                  {levelRoutines.length}
                </Text>
                <Ionicons
                  name={isOpen ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={theme.text}
                />
              </Pressable>
              {isOpen && (
                <View style={styles.levelBody}>
                  {levelRoutines.map(renderPresetRow)}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.gutter,
    paddingBottom: spacing.section * 2,
  },
  title: {
    fontSize: fontSize.screenTitle,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: spacing.section,
  },
  sectionTitle: {
    fontSize: fontSize.sectionTitle,
    fontWeight: '900',
    marginTop: spacing.section,
    marginBottom: spacing.card,
  },
  helper: {
    fontSize: fontSize.helper,
    opacity: 0.7,
    marginBottom: spacing.card,
  },
  levelSection: {
    marginBottom: spacing.cardGap,
  },
  levelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.card,
    minHeight: 48,
  },
  levelTitle: {
    fontSize: fontSize.cardTitle,
    fontWeight: '700',
    flex: 1,
  },
  levelCount: {
    fontSize: fontSize.body,
    opacity: 0.7,
    marginRight: spacing.inline,
  },
  levelBody: {
    marginTop: spacing.cardGap,
    gap: spacing.cardGap,
  },
  card: {
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.card,
  },
  cardPressed: {
    opacity: 0.7,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.inline,
  },
  cardTitle: {
    fontSize: fontSize.cardTitle,
    fontWeight: '700',
    flex: 1,
  },
  cardSummary: {
    fontSize: fontSize.body,
    opacity: 0.7,
    marginTop: spacing.label,
  },
  cardWeekdays: {
    marginTop: spacing.card,
  },
  activeBadge: {
    borderRadius: 100,
    paddingHorizontal: spacing.card,
    paddingVertical: 2,
  },
  activeBadgeText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
});
