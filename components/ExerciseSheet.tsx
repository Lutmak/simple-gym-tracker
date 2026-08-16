import React, { ReactNode, useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { useSettings } from '../context/SettingsContext';
import { Row } from './Row';
import { Section } from './Section';
import { Sheet } from './Sheet';
import { fontSize, radius, spacing, tabBar } from '../utils/scale';
import { formatWeight } from '../utils/barProfiles';
import { loadExerciseSeries } from '../utils/exerciseHistory';
import { findImagePackImage } from '../utils/imagePackInstaller';
import type { RoutineDatabase, RoutineRole } from '../utils/routineActions';
import {
  accessoryVolumeRationale,
  digestExerciseHistory,
  loadExerciseDetail,
  type ExerciseDetail,
  type ExerciseHistoryDigest,
} from '../utils/exerciseSheet';

/**
 * R2 — the one exercise sheet (SPECS.md R2).
 *
 * *"No sé qué es, no sé qué zona trabaja, no veo información. Eso es esencial."* Before this, an
 * exercise was a string on five different screens and the catalog's muscles, equipment and
 * instructions were seeded into the database and never read. This component is the answer to
 * "what is this?" wherever the question is asked: the routine editor, the session runner, the
 * catalog picker, Inicio, Progreso and the routine detail all mount the same sheet with the same
 * props, so there is one description of an exercise in the app and one place to improve it.
 *
 * It is a `Sheet` — "a decision about the thing you touched" (§3.5) — and it composes `Section` and
 * `Row` only. The caller owns nothing but the trigger; the sheet does its own loading, its own
 * empty states, and its own image lookup, because the alternative is six screens each learning the
 * catalog schema.
 *
 * Exercise facts are the catalog's English strings by decision (SPECS.md §2); every heading and
 * every sentence around them is localised.
 */

export interface ExerciseSheetPlan {
  role: RoutineRole;
  targetSets: number;
  targetReps: number;
  isAmrap?: boolean;
  /** The concrete target line the surface already computes, e.g. the runner's "3 × 5 · 80 kg". */
  line?: string;
}

export interface ExerciseSheetReference {
  name: string;
  catalogExerciseId?: string | null;
}

export type ExerciseSheetProps = {
  /** Null closes the sheet; a reference opens it. One piece of state per caller. */
  exercise: ExerciseSheetReference | null;
  onClose: () => void;
  /** The plan this exercise carries where it was opened from, when it carries one. */
  plan?: ExerciseSheetPlan | null;
  /** Opens the full per-exercise chart. Omitted where the surface has nowhere to send the user. */
  onOpenHistory?: (exerciseName: string) => void;
  /** Extra content the calling surface owns, shown under the plan. */
  children?: ReactNode;
  testID?: string;
};

const formatStamp = (stamp: number, dateFormat: string): string => {
  const date = new Date(stamp * 1000);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return dateFormat === 'mm-dd-yyyy'
    ? `${month}/${day}/${year}`
    : `${day}/${month}/${year}`;
};

export function ExerciseSheet({
  exercise,
  onClose,
  plan,
  onOpenHistory,
  children,
  testID,
}: ExerciseSheetProps) {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const { dateFormat } = useSettings();
  const db = useSQLiteContext();

  const [detail, setDetail] = useState<ExerciseDetail | null>(null);
  const [digest, setDigest] = useState<ExerciseHistoryDigest | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const name = exercise?.name ?? null;
  const catalogExerciseId = exercise?.catalogExerciseId ?? null;

  useEffect(() => {
    if (name === null) {
      return;
    }
    let cancelled = false;
    setLoaded(false);
    setDetail(null);
    setDigest(null);
    setImageUri(null);

    const routineDb: RoutineDatabase = {
      run: (sql, params) => db.runAsync(sql, (params ?? []) as never[]),
      get: async (sql, params) =>
        (await db.getFirstAsync<Record<string, unknown>>(
          sql,
          (params ?? []) as never[],
        )) ?? undefined,
      getAll: async (sql, params) =>
        db.getAllAsync<Record<string, unknown>>(sql, (params ?? []) as never[]),
    };

    const load = async () => {
      const [loadedDetail, series] = await Promise.all([
        loadExerciseDetail(routineDb, { name, catalogExerciseId }),
        loadExerciseSeries(routineDb, name),
      ]);
      const uri = await findImagePackImage(loadedDetail?.exerciseKey ?? null);
      if (cancelled) {
        return;
      }
      setDetail(loadedDetail);
      setDigest(digestExerciseHistory(series));
      setImageUri(uri);
      setLoaded(true);
    };

    load().catch((error: unknown) => {
      console.error('Error loading the exercise sheet:', error);
      if (!cancelled) {
        setLoaded(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [db, name, catalogExerciseId]);

  const rationale =
    plan === undefined || plan === null
      ? null
      : accessoryVolumeRationale({
          role: plan.role,
          targetSets: plan.targetSets,
          targetReps: plan.targetReps,
        });

  const factRow = (labelKey: string, value: string | null) => (
    <Row
      label={t(labelKey)}
      detail={value === null || value === '' ? t('exerciseSheetUnknown') : value}
      divided
    />
  );

  return (
    <Sheet
      visible={exercise !== null}
      title={name ?? undefined}
      onClose={onClose}
      testID={testID ?? 'exercise-sheet'}
    >
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {imageUri !== null && (
          <Image
            source={{ uri: imageUri }}
            style={styles.image}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        )}

        {plan !== undefined && plan !== null && (
          <Section title={t('exerciseSheetPlanTitle')} testID="exercise-sheet-plan">
            <Text style={[styles.planLine, { color: tokens.textPrimary }]}>
              {plan.line ??
                t('exerciseSheetPlanSetsReps', {
                  sets: plan.targetSets,
                  reps: plan.isAmrap === true ? `${plan.targetReps}+` : plan.targetReps,
                })}
            </Text>
            {rationale !== null && (
              <Text style={[styles.helper, { color: tokens.textSecondary }]}>
                {t(`exerciseVolume_${rationale}`)}
              </Text>
            )}
            {children}
          </Section>
        )}
        {(plan === undefined || plan === null) && children}

        {loaded && detail === null && (
          <Text style={[styles.helper, { color: tokens.textSecondary }]}>
            {t('exerciseSheetNoCatalogData')}
          </Text>
        )}

        {detail !== null && (
          <Section title={t('exerciseSheetAboutTitle')} testID="exercise-sheet-about">
            {factRow('exerciseSheetPrimaryMuscles', detail.primaryMuscles.join(', '))}
            {factRow('exerciseSheetSecondaryMuscles', detail.secondaryMuscles.join(', '))}
            {factRow('exerciseSheetEquipment', detail.equipment)}
            {factRow('exerciseSheetMechanic', detail.mechanic)}
            {factRow('exerciseSheetLevel', detail.level)}
            {detail.origin === 'user' && (
              <Text style={[styles.helper, { color: tokens.textSecondary }]}>
                {t('exerciseSheetCustomExercise')}
              </Text>
            )}
          </Section>
        )}

        {digest !== null && (
          <Section title={t('exerciseSheetHistoryTitle')} testID="exercise-sheet-history">
            {digest.sessions === 0 ? (
              <Text style={[styles.helper, { color: tokens.textSecondary }]}>
                {t('exerciseSheetNoHistory')}
              </Text>
            ) : (
              <>
                <Row
                  label={t('exerciseSheetLastSession')}
                  detail={t('exerciseSheetLastSessionValue', {
                    date: formatStamp(digest.lastDate ?? 0, dateFormat),
                    weight: formatWeight(digest.lastWeight ?? 0),
                    unit: digest.unit,
                    reps: digest.lastReps ?? 0,
                  })}
                  divided
                />
                <Row
                  label={t('exerciseSheetBest')}
                  detail={`${formatWeight(digest.bestWeight ?? 0)} ${digest.unit}`}
                  divided
                />
                <Row
                  label={t('exerciseSheetSessions')}
                  detail={String(digest.sessions)}
                  divided
                />
                {digest.mixedUnits && (
                  <Text style={[styles.helper, { color: tokens.textSecondary }]}>
                    {t('exerciseSheetMixedUnits')}
                  </Text>
                )}
                {!digest.chartable && (
                  <Text style={[styles.helper, { color: tokens.textSecondary }]}>
                    {t('exerciseSheetOnePoint')}
                  </Text>
                )}
              </>
            )}
            {onOpenHistory !== undefined && digest.sessions > 0 && name !== null && (
              <Row
                label={t('exerciseSheetOpenChart')}
                right={
                  <Ionicons
                    name="stats-chart-outline"
                    size={tabBar.icon}
                    color={tokens.textSecondary}
                  />
                }
                onPress={() => onOpenHistory(name)}
                testID="exercise-sheet-open-chart"
              />
            )}
          </Section>
        )}

        {detail !== null && detail.instructions.length > 0 && (
          <Section
            title={t('exerciseSheetInstructionsTitle')}
            testID="exercise-sheet-instructions"
          >
            {detail.instructions.map((step, index) => (
              <Text
                key={`${index}-${step.slice(0, 12)}`}
                style={[styles.instruction, { color: tokens.textPrimary }]}
              >
                {`${index + 1}. ${step}`}
              </Text>
            ))}
          </Section>
        )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    flexShrink: 1,
  },
  bodyContent: {
    paddingBottom: spacing.card,
  },
  image: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.card,
    marginBottom: spacing.section,
  },
  planLine: {
    fontSize: fontSize.cardTitle,
    fontWeight: '600',
  },
  helper: {
    fontSize: fontSize.helper,
  },
  instruction: {
    fontSize: fontSize.body,
  },
});
