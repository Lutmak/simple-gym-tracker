import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import AppTextInput from './AppTextInput';
import { Button } from './Button';
import { ExerciseSheet } from './ExerciseSheet';
import { Field } from './Field';
import { Row } from './Row';
import { SegmentedControl, type SegmentedOption } from './SegmentedControl';
import { Sheet } from './Sheet';
import { Switch } from './Switch';
import { fontSize, spacing, tabBar, touchTarget } from '../utils/scale';
import { BODY_PARTS, bodyPartLabelKey, type BodyPartKey } from '../utils/bodyParts';
import {
  filterCatalogExercises,
  initialBodyPart,
  loadCatalogExercises,
  type CatalogExercise,
} from '../utils/exerciseCatalog';
import {
  CUSTOM_EQUIPMENT_OPTIONS,
  createCustomExercise,
  usesBarByDefault,
  validateCustomExercise,
  type CustomExerciseDraft,
} from '../utils/customExercise';
import type { RoutineDatabase } from '../utils/routineActions';

/**
 * The exercise picker (SPECS.md R2, §3.5).
 *
 * Two defects shaped this rewrite. The first: the picker asked the database a different question
 * per state and **skipped the muscle filter entirely when no exercise was in context**, so the
 * runner's "add an exercise" opened 870 unfiltered rows. It now loads the catalog once and filters
 * in memory by search and by body part, with the tapped exercise's own region pre-selected and no
 * filter at all when nothing was tapped — a deliberate absence rather than a silent skip.
 *
 * The second: a custom exercise used to be a name and nothing else, which produced an exercise the
 * app could say nothing about, permanently, in history. It is now a catalog row with a primary
 * muscle, equipment and a bar answer, so it appears in these same filters and opens the same
 * `ExerciseSheet` as a seeded one.
 *
 * Every row is one tap from its full description through the info button — the picker is one of
 * R2's six doors into the same sheet.
 */

const ALL_BODY_PARTS = 'all';
type BodyPartFilter = BodyPartKey | typeof ALL_BODY_PARTS;

/**
 * What the picker hands back. It carries the catalog facts the caller would
 * otherwise have to re-query — equipment and the bar answer decide the bar
 * profile of the exercise being added (§3.5), and the primary muscles decide
 * whether a 5/3/1 day is an upper or a lower day. The picker has all three in
 * memory already; making the caller ask the database again is how those two
 * defaults ended up not being applied at all.
 */
export interface ExercisePickerSelection {
  catalogExerciseId: string | null;
  name: string;
  equipment: string | null;
  /** The user's own answer for a custom exercise; null when equipment decides. */
  usesBar: boolean | null;
  primaryMuscles: readonly string[];
}

type Props = {
  visible: boolean;
  /** The tapped exercise's catalog id; null opens the whole catalog. */
  catalogExerciseId: string | null;
  onSelect: (exercise: ExercisePickerSelection) => void;
  onClose: () => void;
};

const emptyDraft = (): CustomExerciseDraft => ({
  name: '',
  primaryMuscle: null,
  equipment: null,
  usesBar: false,
});

export default function ExerciseCatalogPicker({
  visible,
  catalogExerciseId,
  onSelect,
  onClose,
}: Props) {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const db = useSQLiteContext();

  const [exercises, setExercises] = useState<CatalogExercise[]>([]);
  const [query, setQuery] = useState('');
  const [bodyPart, setBodyPart] = useState<BodyPartFilter>(ALL_BODY_PARTS);
  const [customMode, setCustomMode] = useState(false);
  const [draft, setDraft] = useState<CustomExerciseDraft>(emptyDraft);
  const [draftBodyPart, setDraftBodyPart] = useState<BodyPartKey | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [information, setInformation] = useState<CatalogExercise | null>(null);

  const routineDb: RoutineDatabase = useMemo(
    () => ({
      run: (sql, params) => db.runAsync(sql, (params ?? []) as never[]),
      get: async (sql, params) =>
        (await db.getFirstAsync<Record<string, unknown>>(
          sql,
          (params ?? []) as never[],
        )) ?? undefined,
      getAll: async (sql, params) =>
        db.getAllAsync<Record<string, unknown>>(sql, (params ?? []) as never[]),
    }),
    [db],
  );

  const load = useCallback(async () => {
    const rows = await loadCatalogExercises(routineDb);
    setExercises(rows);
    setBodyPart(initialBodyPart(rows, catalogExerciseId) ?? ALL_BODY_PARTS);
  }, [routineDb, catalogExerciseId]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setQuery('');
    setCustomMode(false);
    setDraft(emptyDraft());
    setDraftBodyPart(null);
    setProblem(null);
    setInformation(null);
    load().catch((error: unknown) => {
      console.error('Error loading the exercise catalog:', error);
    });
  }, [visible, load]);

  const visibleExercises = useMemo(
    () =>
      filterCatalogExercises(exercises, {
        query,
        bodyPart: bodyPart === ALL_BODY_PARTS ? null : bodyPart,
      }),
    [exercises, query, bodyPart],
  );

  const filterOptions: SegmentedOption<BodyPartFilter>[] = [
    { value: ALL_BODY_PARTS, label: t('pickerAllBodyParts'), icon: 'apps-outline' },
    ...BODY_PARTS.map((part) => ({
      value: part.key,
      label: t(bodyPartLabelKey(part.key)),
      icon: part.icon,
    })),
  ];

  const saveCustom = async () => {
    const failure = validateCustomExercise(
      draft,
      new Set(exercises.map((exercise) => exercise.name)),
    );
    if (failure !== null) {
      setProblem(t(`pickerCustom_${failure}`));
      return;
    }
    try {
      const created = await createCustomExercise(
        routineDb,
        draft,
        new Set(exercises.map((exercise) => exercise.exerciseKey)),
      );
      onSelect({
        catalogExerciseId: created.exerciseKey,
        name: created.name,
        equipment: created.equipment,
        usesBar: created.usesBar,
        primaryMuscles: created.primaryMuscles,
      });
    } catch (error: unknown) {
      console.error('Error creating a custom exercise:', error);
      setProblem(t('pickerCustom_save-failed'));
    }
  };

  const patchDraft = (patch: Partial<CustomExerciseDraft>) => {
    setProblem(null);
    setDraft((current) => ({ ...current, ...patch }));
  };

  const chooseEquipment = (equipment: string) => {
    patchDraft({ equipment, usesBar: usesBarByDefault(equipment) });
  };

  if (customMode) {
    return (
      <Sheet
        visible={visible}
        title={t('pickerCustomTitle')}
        onBack={() => {
          setCustomMode(false);
          setProblem(null);
        }}
        backAccessibilityLabel={t('pickerBackToCatalog')}
        onClose={onClose}
        testID="exercise-picker-custom"
      >
        <ScrollView
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Field label={t('pickerCustomNameLabel')}>
            <AppTextInput
              variant="text"
              value={draft.name}
              onChangeText={(name) => patchDraft({ name })}
              placeholder={t('pickerCustomNamePlaceholder')}
              autoFocus
            />
          </Field>

          <Field label={t('pickerCustomBodyPartLabel')} hint={t('pickerCustomMuscleHint')}>
            <SegmentedControl<string>
              options={BODY_PARTS.map((part) => ({
                value: part.key,
                label: t(bodyPartLabelKey(part.key)),
                icon: part.icon,
              }))}
              value={draftBodyPart ?? ''}
              onChange={(key) => {
                const part = BODY_PARTS.find((candidate) => candidate.key === key);
                if (part === undefined) {
                  return;
                }
                setDraftBodyPart(part.key);
                patchDraft({ primaryMuscle: part.muscles[0] ?? null });
              }}
              wrap
            />
          </Field>

          {draftBodyPart !== null && (
            <Field label={t('pickerCustomMuscleLabel')}>
              <SegmentedControl<string>
                options={(
                  BODY_PARTS.find((part) => part.key === draftBodyPart)?.muscles ?? []
                ).map((muscle) => ({ value: muscle, label: muscle }))}
                value={draft.primaryMuscle ?? ''}
                onChange={(muscle) => patchDraft({ primaryMuscle: muscle })}
                wrap
              />
            </Field>
          )}

          <Field label={t('pickerCustomEquipmentLabel')}>
            <SegmentedControl<string>
              options={CUSTOM_EQUIPMENT_OPTIONS.map((equipment) => ({
                value: equipment,
                label: equipment,
              }))}
              value={draft.equipment ?? ''}
              onChange={chooseEquipment}
              wrap
            />
          </Field>

          <Row
            label={t('pickerCustomUsesBar')}
            detail={t('pickerCustomUsesBarHint')}
            detailBelow
            right={
              <Switch
                value={draft.usesBar}
                onValueChange={(usesBar) => patchDraft({ usesBar })}
                testID="picker-custom-uses-bar"
              />
            }
          />

          {problem !== null && (
            <Text style={[styles.problem, { color: tokens.warning }]}>{problem}</Text>
          )}

          <Button
            label={t('pickerCustomSave')}
            onPress={() => void saveCustom()}
            style={styles.save}
            testID="picker-custom-save"
          />
        </ScrollView>
      </Sheet>
    );
  }

  return (
    <>
      <Sheet
        visible={visible && information === null}
        title={t('pickerTitle')}
        onClose={onClose}
        testID="exercise-picker"
      >
        <AppTextInput
          variant="text"
          value={query}
          onChangeText={setQuery}
          placeholder={t('pickerSearchPlaceholder')}
        />

        <View style={styles.filters}>
          <SegmentedControl<BodyPartFilter>
            options={filterOptions}
            value={bodyPart}
            onChange={setBodyPart}
            wrap
            testID="picker-body-part-filter"
          />
        </View>

        <FlatList
          style={styles.list}
          data={visibleExercises}
          keyExtractor={(item) => item.exerciseKey}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text style={[styles.empty, { color: tokens.textSecondary }]}>
              {t('pickerEmpty')}
            </Text>
          }
          ListFooterComponent={
            <Row
              label={t('pickerCustomExercise')}
              right={
                <Ionicons name="add-outline" size={tabBar.icon} color={tokens.textPrimary} />
              }
              onPress={() => {
                setDraft(emptyDraft());
                setDraftBodyPart(null);
                setCustomMode(true);
              }}
              testID="picker-add-custom"
            />
          }
          renderItem={({ item }) => (
            <Row
              label={item.name}
              detail={
                item.primaryMuscles.length === 0 ? undefined : item.primaryMuscles.join(', ')
              }
              detailBelow
              onPress={() =>
                onSelect({
                  catalogExerciseId: item.exerciseKey,
                  name: item.name,
                  equipment: item.equipment,
                  usesBar: item.usesBar,
                  primaryMuscles: item.primaryMuscles,
                })
              }
              right={
                <Pressable
                  onPress={() => setInformation(item)}
                  style={styles.info}
                  hitSlop={spacing.inline}
                  accessibilityRole="button"
                  accessibilityLabel={t('pickerOpenInfo', { name: item.name })}
                >
                  <Ionicons
                    name="information-circle-outline"
                    size={tabBar.icon}
                    color={tokens.textSecondary}
                  />
                </Pressable>
              }
              divided
            />
          )}
        />
      </Sheet>

      <ExerciseSheet
        exercise={
          information === null
            ? null
            : { name: information.name, catalogExerciseId: information.exerciseKey }
        }
        onClose={() => setInformation(null)}
        testID="picker-exercise-sheet"
      />
    </>
  );
}

const styles = StyleSheet.create({
  filters: {
    marginTop: spacing.cardGap,
    marginBottom: spacing.cardGap,
  },
  list: {
    flexShrink: 1,
  },
  info: {
    minWidth: touchTarget.icon,
    minHeight: touchTarget.icon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    fontSize: fontSize.body,
    textAlign: 'center',
    paddingVertical: spacing.section,
  },
  problem: {
    fontSize: fontSize.helper,
    marginBottom: spacing.cardGap,
  },
  save: {
    marginTop: spacing.cardGap,
  },
});
