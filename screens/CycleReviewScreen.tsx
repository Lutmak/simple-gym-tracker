import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ExerciseSheet } from '../components/ExerciseSheet';
import { Field } from '../components/Field';
import { NumberStepper } from '../components/NumberStepper';
import { Row } from '../components/Row';
import { Screen } from '../components/Screen';
import { Section } from '../components/Section';
import { SegmentedControl, type SegmentedOption } from '../components/SegmentedControl';
import { Stat } from '../components/Stat';
import { fontSize, spacing, tabBar } from '../utils/scale';
import {
  applyReview,
  editProposalValue,
  loadCycleReview,
  resolveProposal,
  startNextCycle,
  type AmrapRow,
  type ReviewData,
  type ReviewProposalView,
} from '../utils/cycleReview';
import type { ProposalStatus } from '../utils/progression';
import type { RoutineDatabase } from '../utils/routineActions';
import type { RoutinesStackParamList } from '../App';

/**
 * U5's rebuild of the cycle/week review (SPEC.md U5, ADR-0047 §4): one flat block per lift — no
 * card holding a bordered table, which was the app's clearest "surface inside a surface" — the
 * three AMRAP weeks as plain rows, current-versus-proposed as a `Stat` pair, and the three
 * resolutions (accept/hold/edit) as one `SegmentedControl` per proposal rather than three buttons.
 * "Editar" reveals a stepper inline instead of committing immediately; the other two commit on tap,
 * same as before. The confirm/start-next action stays pinned above the tab bar in a fixed footer,
 * the same fill/scroll/footer split `SessionRunnerScreen` already uses.
 */

type Props = NativeStackScreenProps<RoutinesStackParamList, 'CycleReview'>;

const formatWeight = (value: number): string => String(Number(value.toFixed(1)));

type ReviewAction = 'accepted' | 'held' | 'edited';

/**
 * `loadCycleReview` throws a plain `Error` (this codebase's convention — see `utils/cycleReview.ts`
 * and `utils/routineActions.ts`) when the routine or cycle this screen was opened for no longer
 * exists — reachable by removing the demo data, or discarding a routine, while this screen sits
 * deeper in the `Routines` stack than the row that led here. That is not a failed load to retry
 * with an alert; the thing being reviewed is simply gone, so the screen renders `EmptyState`
 * with a way back instead of a dead-end error dialog.
 */
const isMissingRoutineOrCycle = (error: unknown): boolean =>
  error instanceof Error &&
  (error.message.startsWith('Unknown routine') || error.message.startsWith('Unknown cycle'));

export default function CycleReviewScreen({ navigation, route }: Props) {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const db = useSQLiteContext();
  const { routineId, cycleId } = route.params;

  const [review, setReview] = useState<ReviewData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState<number | null>(null);
  /** R2: the exercise whose shared sheet is open. */
  const [information, setInformation] = useState<{ name: string } | null>(null);

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

  const reload = useCallback(() => {
    loadCycleReview(routineDb, routineId, cycleId)
      .then(setReview)
      .catch((error) => {
        if (isMissingRoutineOrCycle(error)) {
          setNotFound(true);
          return;
        }
        console.error('Error loading the review:', error);
        Alert.alert(t('errorTitle'), t('reviewLoadFailed'));
      });
  }, [db, routineId, cycleId, t]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  /**
   * Patches the one resolved proposal into local state rather than calling
   * `reload()`. `loadCycleReview` regenerates fresh 'pending' proposals the
   * moment it sees every row of a due review resolved (its own signal for "a
   * new week's review has replaced an already-applied one") — indistinguishable,
   * from the stored rows alone, from "the user just resolved the last one and
   * has not pressed confirm yet". Reloading after every single resolution used
   * to walk straight into that: the instant the last pending proposal
   * resolved, the reload it triggered wiped every decision back to pending
   * before the confirm button ever had a chance to enable. `reload()` still
   * runs on focus and after `confirm`/`startNext`, where the cycle's own state
   * has actually moved on and the guard is safe.
   */
  const patchProposal = (proposalId: number, patch: Partial<ReviewProposalView>): void => {
    setReview((current) =>
      current === null
        ? current
        : {
            ...current,
            proposals: current.proposals.map((proposal) =>
              proposal.proposalId === proposalId ? { ...proposal, ...patch } : proposal,
            ),
          },
    );
  };

  const resolve = (proposalId: number, outcome: 'accepted' | 'held') => {
    resolveProposal(routineDb, proposalId, outcome)
      .then(() => patchProposal(proposalId, { status: outcome }))
      .catch((error) => console.error('Error resolving proposal:', error));
  };

  const openEditor = (proposal: ReviewProposalView) => {
    setEditingId(proposal.proposalId);
    setEditValue(proposal.proposedTarget);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue(null);
  };

  const handleAction = (proposal: ReviewProposalView, action: ReviewAction) => {
    if (action === 'edited') {
      openEditor(proposal);
      return;
    }
    resolve(proposal.proposalId, action);
  };

  const saveEdit = (proposalId: number) => {
    if (review === null || editValue === null || editValue <= 0) {
      return;
    }
    editProposalValue(routineDb, proposalId, editValue, review.routine.roundingIncrement)
      .then(() => {
        patchProposal(proposalId, { status: 'edited', proposedTarget: editValue });
        setEditingId(null);
        setEditValue(null);
      })
      .catch((error) => console.error('Error editing proposal:', error));
  };

  const confirm = () => {
    setBusy(true);
    applyReview(routineDb, routineId, cycleId)
      .then((result) => {
        setBusy(false);
        if (result.completed) {
          reload();
        } else {
          Alert.alert(
            t('reviewWeekConfirmedTitle'),
            t('reviewWeekConfirmedMessage'),
            [{ text: t('ok'), onPress: () => navigation.goBack() }],
          );
        }
      })
      .catch((error) => {
        console.error('Error applying the review:', error);
        setBusy(false);
        Alert.alert(t('errorTitle'), t('reviewApplyFailed'));
      });
  };

  const startNext = () => {
    setBusy(true);
    startNextCycle(routineDb, routineId, cycleId)
      .then((newCycleId) =>
        db.getFirstAsync<{ cycle_number: number }>(
          'SELECT cycle_number FROM Cycles WHERE cycle_id = ?;',
          [newCycleId],
        ),
      )
      .then((row) => {
        setBusy(false);
        Alert.alert(
          t('reviewNextCycleStartedTitle'),
          t('reviewNextCycleStartedMessage', { cycle: row?.cycle_number ?? '' }),
          [{ text: t('ok'), onPress: () => navigation.goBack() }],
        );
      })
      .catch((error) => {
        console.error('Error starting the next cycle:', error);
        setBusy(false);
        Alert.alert(t('errorTitle'), t('reviewStartFailed'));
      });
  };

  if (notFound) {
    return (
      <Screen testID="cycle-review-not-found">
        <EmptyState
          icon="alert-circle-outline"
          title={t('reviewNotFound')}
          actionLabel={t('sheetBack')}
          onAction={() => navigation.goBack()}
          testID="cycle-review-not-found-empty-state"
        />
      </Screen>
    );
  }

  if (review === null) {
    return (
      <Screen fill testID="cycle-review-loading">
        <View style={styles.container} />
      </Screen>
    );
  }

  const amrapById = new Map(review.amrap.map((entry) => [entry.sessionExerciseId, entry.rows]));
  const allResolved = review.proposals.every((proposal) => proposal.status !== 'pending');
  const completed = review.cycle.status === 'complete';
  const tmProposals = review.proposals.filter((proposal) => proposal.isTmProposal);
  const exerciseProposals = review.proposals.filter((proposal) => !proposal.isTmProposal);
  const orderedProposals = [...tmProposals, ...exerciseProposals];

  const actionOptions: SegmentedOption<ProposalStatus>[] = [
    { value: 'accepted', label: t('reviewAccept') },
    { value: 'held', label: t('reviewHold') },
    { value: 'edited', label: t('reviewEdit') },
  ];

  const renderAmrapRow = (row: AmrapRow) => (
    <Row
      key={row.weekNumber}
      label={t('reviewAmrapWeekRow', { week: row.weekNumber })}
      detail={t('reviewAmrapRowDetail', {
        reps: t('reviewAmrapRepsCount', { count: row.reps }),
        weight: formatWeight(row.estimated1rm),
        unit: review.routine.unit,
      })}
      divided
    />
  );

  const renderProposal = (proposal: ReviewProposalView) => {
    const resolved = proposal.status !== 'pending';
    const isEditing = editingId === proposal.proposalId;
    const amrapRows = proposal.isTmProposal ? (amrapById.get(proposal.sessionExerciseId) ?? []) : [];
    const trend: 'up' | 'down' | 'flat' =
      proposal.proposedTarget > proposal.currentTarget
        ? 'up'
        : proposal.proposedTarget < proposal.currentTarget
          ? 'down'
          : 'flat';

    return (
      <Section key={proposal.proposalId} testID={`review-proposal-${proposal.proposalId}`}>
        {/* R2: a proposal about an exercise is one tap from what that exercise is. */}
        <Row
          label={proposal.exerciseName}
          right={
            <Ionicons
              name="information-circle-outline"
              size={tabBar.icon}
              color={tokens.textSecondary}
            />
          }
          onPress={() => setInformation({ name: proposal.exerciseName })}
          divided
        />
        {amrapRows.length > 0 && amrapRows.map(renderAmrapRow)}
        <View style={styles.statPair}>
          <Stat
            label={t('reviewCurrentLabel')}
            value={formatWeight(proposal.currentTarget)}
            unit={proposal.unit}
          />
          <Stat
            label={t('reviewProposedLabel')}
            value={formatWeight(proposal.proposedTarget)}
            unit={proposal.unit}
            trend={trend}
          />
        </View>
        <Text style={[styles.reason, { color: tokens.textSecondary }]}>{proposal.reason}</Text>
        {proposal.advisory && (
          <Text style={[styles.advisory, { color: tokens.warning }]} maxFontSizeMultiplier={1.5}>
            {t('reviewAdvisory')}
          </Text>
        )}
        <SegmentedControl<ProposalStatus>
          options={actionOptions}
          value={isEditing ? 'edited' : proposal.status}
          onChange={(action) => handleAction(proposal, action as ReviewAction)}
          disabled={resolved}
          testID={`review-proposal-${proposal.proposalId}-actions`}
        />
        {isEditing && (
          <View style={styles.editArea}>
            <Field label={t('reviewEnterOwnValue')}>
              <NumberStepper
                value={editValue}
                onChange={setEditValue}
                step={review.routine.roundingIncrement}
                min={0}
                testID={`review-proposal-${proposal.proposalId}-value`}
              />
            </Field>
            <View style={styles.editActions}>
              <Row label={t('Cancel')} onPress={cancelEdit} divided />
              <Button
                label={t('Save')}
                onPress={() => saveEdit(proposal.proposalId)}
                disabled={editValue === null || editValue <= 0}
                testID={`review-proposal-${proposal.proposalId}-save`}
              />
            </View>
          </View>
        )}
      </Section>
    );
  };

  const title = review.atCycleEnd
    ? t('cycleReviewCycleTitle', { cycle: review.cycle.cycleNumber + 1 })
    : t('cycleReviewWeekTitle', { week: review.cycle.currentWeek + 1 });

  return (
    <Screen fill testID="cycle-review-screen">
      <View style={styles.container}>
        <Text style={[styles.overline, { color: tokens.textSecondary }]}>
          {review.routine.name}
        </Text>
        <Text style={[styles.title, { color: tokens.textPrimary }]}>{title}</Text>

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          showsVerticalScrollIndicator={false}
        >
          {review.proposals.length === 0 && (
            <Text style={[styles.helper, { color: tokens.textSecondary }]}>
              {t('reviewNothingToPropose')}
            </Text>
          )}

          {orderedProposals.map(renderProposal)}

          {completed && !busy && (
            <Text style={[styles.helper, { color: tokens.textSecondary }]}>
              {t('reviewCycleComplete')}
            </Text>
          )}
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: tokens.divider }]}>
          {completed ? (
            <>
              <Button
                label={t('reviewStartNextCycle')}
                onPress={startNext}
                disabled={busy}
                style={styles.footerButton}
                testID="review-start-next-cycle"
              />
              <Text style={[styles.footerHint, { color: tokens.textSecondary }]}>
                {t('reviewNextCycleHint')}
              </Text>
            </>
          ) : (
            <>
              <Button
                label={review.atCycleEnd ? t('reviewConfirmCycle') : t('reviewConfirm')}
                onPress={confirm}
                disabled={!allResolved || busy}
                style={styles.footerButton}
                testID="review-confirm"
              />
              {!allResolved && (
                <Text style={[styles.footerHint, { color: tokens.textSecondary }]}>
                  {t('reviewResolveHint')}
                </Text>
              )}
            </>
          )}
        </View>
      </View>

      {/* R2: the shared exercise sheet. */}
      <ExerciseSheet exercise={information} onClose={() => setInformation(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overline: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  title: {
    fontSize: fontSize.screenTitle,
    fontWeight: '700',
    marginTop: spacing.label,
    marginBottom: spacing.section,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingBottom: spacing.section,
  },
  helper: {
    fontSize: fontSize.helper,
    marginBottom: spacing.section,
  },
  statPair: {
    flexDirection: 'row',
    gap: spacing.section,
    marginTop: spacing.cardGap,
  },
  reason: {
    fontSize: fontSize.helper,
    marginTop: spacing.cardGap,
  },
  advisory: {
    fontSize: fontSize.helper,
    marginTop: spacing.label,
  },
  editArea: {
    marginTop: spacing.cardGap,
  },
  editActions: {
    gap: spacing.cardGap,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.cardGap,
    gap: spacing.label,
  },
  footerButton: {
    alignSelf: 'stretch',
  },
  footerHint: {
    fontSize: fontSize.helper,
    textAlign: 'center',
  },
});
