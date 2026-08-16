import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import AppTextInput, { parseNumericInput } from '../components/AppTextInput';
import { ExerciseSheet } from '../components/ExerciseSheet';
import { fontSize, radius, spacing, touchTarget } from '../utils/scale';
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
import type { RoutineDatabase } from '../utils/routineActions';
import type { RoutinesStackParamList } from '../App';

type Props = NativeStackScreenProps<RoutinesStackParamList, 'CycleReview'>;

const formatWeight = (value: number): string => String(Number(value.toFixed(1)));

const weightLabel = (value: number, unit: string): string => `${formatWeight(value)} ${unit}`;

const statusKey = (status: ReviewProposalView['status']): string => {
  switch (status) {
    case 'accepted':
      return 'reviewStatusAccepted';
    case 'held':
      return 'reviewStatusHeld';
    case 'edited':
      return 'reviewStatusEdited';
    default:
      return '';
  }
};

export default function CycleReviewScreen({ navigation, route }: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const db = useSQLiteContext();
  const { routineId, cycleId } = route.params;

  const [review, setReview] = useState<ReviewData | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
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
        console.error('Error loading the review:', error);
        Alert.alert(t('errorTitle'), t('reviewLoadFailed'));
      });
  }, [db, routineId, cycleId, t]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const resolve = (proposalId: number, outcome: 'accepted' | 'held') => {
    resolveProposal(routineDb, proposalId, outcome)
      .then(reload)
      .catch((error) => console.error('Error resolving proposal:', error));
  };

  const saveEdit = (proposalId: number) => {
    if (review === null) {
      return;
    }
    const value = parseNumericInput(editDraft);
    if (value === null || value <= 0) {
      return;
    }
    editProposalValue(routineDb, proposalId, value, review.routine.roundingIncrement)
      .then(() => {
        setEditingId(null);
        setEditDraft('');
        reload();
      })
      .catch((error) => console.error('Error editing proposal:', error));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft('');
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

  if (review === null) {
    return <View style={[styles.container, { backgroundColor: theme.background }]} />;
  }

  const amrapById = new Map(review.amrap.map((entry) => [entry.sessionExerciseId, entry.rows]));
  const allResolved = review.proposals.every((proposal) => proposal.status !== 'pending');
  const completed = review.cycle.status === 'complete';
  const tmProposals = review.proposals.filter((proposal) => proposal.isTmProposal);
  const exerciseProposals = review.proposals.filter((proposal) => !proposal.isTmProposal);

  const renderAmrapTable = (rows: AmrapRow[]) => (
    <View style={[styles.amrapTable, { borderColor: theme.border }]}>
      <View style={styles.amrapRow}>
        <Text style={[styles.amrapHeader, { color: theme.text }]}>{t('reviewAmrapWeek')}</Text>
        <Text style={[styles.amrapHeader, { color: theme.text }]}>{t('reviewAmrapReps')}</Text>
        <Text style={[styles.amrapHeader, { color: theme.text }]}>
          {t('reviewAmrapEstimated1rm')}
        </Text>
      </View>
      {rows.map((row) => (
        <View key={row.weekNumber} style={styles.amrapRow}>
          <Text style={[styles.amrapCell, { color: theme.text }]}>{row.weekNumber}</Text>
          <Text style={[styles.amrapCell, { color: theme.text }]}>{row.reps}</Text>
          <Text style={[styles.amrapCell, { color: theme.text }]}>
            {formatWeight(row.estimated1rm)}
          </Text>
        </View>
      ))}
    </View>
  );

  const renderCard = (proposal: ReviewProposalView) => {
    const resolved = proposal.status !== 'pending';
    const isEditing = editingId === proposal.proposalId;
    const amrapRows = amrapById.get(proposal.sessionExerciseId) ?? [];
    return (
      <View
        key={proposal.proposalId}
        style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
      >
        {/* R2: a proposal about an exercise is one tap from what that exercise is. */}
        <Pressable
          onPress={() => setInformation({ name: proposal.exerciseName })}
          accessibilityRole='button'
          accessibilityLabel={t('exerciseInfoAction')}
        >
          <Text style={[styles.cardTitle, { color: theme.text }]}>{proposal.exerciseName}</Text>
        </Pressable>
        {proposal.isTmProposal && amrapRows.length > 0 && renderAmrapTable(amrapRows)}
        <View style={styles.targetRow}>
          <Text style={[styles.helper, { color: theme.text }]}>
            {t('reviewCurrentValue', {
              value: weightLabel(proposal.currentTarget, proposal.unit),
            })}
          </Text>
          <Text style={[styles.helper, { color: theme.text }]}>
            {t('reviewProposedValue', {
              value: weightLabel(proposal.proposedTarget, proposal.unit),
            })}
          </Text>
        </View>
        <Text style={[styles.reason, { color: theme.text }]}>{proposal.reason}</Text>
        {proposal.advisory && (
          <Text style={[styles.advisoryNote, { color: theme.text }]} maxFontSizeMultiplier={1.5}>
            {t('reviewAdvisory')}
          </Text>
        )}
        {isEditing ? (
          <View style={styles.editArea}>
            <AppTextInput
              variant="numeric"
              style={styles.editInput}
              defaultValue={String(proposal.proposedTarget)}
              onRawChange={setEditDraft}
              keyboardType="decimal-pad"
              placeholder={t('reviewEnterOwnValue')}
              autoFocus
            />
            <View style={styles.buttonRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.secondaryButton,
                  styles.grow,
                  { borderColor: theme.border },
                  pressed && styles.pressed,
                ]}
                onPress={cancelEdit}
              >
                <Text style={[styles.secondaryButtonText, { color: theme.text }]}>
                  {t('Cancel')}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.primaryButton,
                  styles.grow,
                  { backgroundColor: theme.buttonBackground },
                  pressed && styles.pressed,
                ]}
                onPress={() => saveEdit(proposal.proposalId)}
              >
                <Text style={[styles.primaryButtonText, { color: theme.buttonText }]}>
                  {t('Save')}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : resolved ? (
          <View style={[styles.statusChip, { backgroundColor: theme.background }]}>
            <Text
              style={[styles.statusChipText, { color: theme.text }]}
              maxFontSizeMultiplier={1.5}
            >
              {t(statusKey(proposal.status))}
            </Text>
          </View>
        ) : (
          <View style={styles.buttonRow}>
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                styles.grow,
                { backgroundColor: theme.buttonBackground },
                pressed && styles.pressed,
              ]}
              onPress={() => resolve(proposal.proposalId, 'accepted')}
            >
              <Text style={[styles.primaryButtonText, { color: theme.buttonText }]}>
                {t('reviewAccept')}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.secondaryButton,
                styles.grow,
                { borderColor: theme.border },
                pressed && styles.pressed,
              ]}
              onPress={() => resolve(proposal.proposalId, 'held')}
            >
              <Text style={[styles.secondaryButtonText, { color: theme.text }]}>
                {t('reviewHold')}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.secondaryButton,
                styles.grow,
                { borderColor: theme.border },
                pressed && styles.pressed,
              ]}
              onPress={() => {
                setEditDraft(String(proposal.proposedTarget));
                setEditingId(proposal.proposalId);
              }}
            >
              <Text style={[styles.secondaryButtonText, { color: theme.text }]}>
                {t('reviewEdit')}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>{review.routine.name}</Text>
        <Text style={[styles.header, { color: theme.text }]}>
          {t('cycleReviewHeader', {
            cycle: review.cycle.cycleNumber,
            week: review.cycle.currentWeek,
          })}
        </Text>

        {review.proposals.length === 0 && (
          <Text style={[styles.helper, { color: theme.text }]}>
            {t('reviewNothingToPropose')}
          </Text>
        )}

        {tmProposals.length > 0 && (
          <Text style={[styles.sectionTitle, { color: theme.text }]}>
            {t('reviewTmSection')}
          </Text>
        )}
        {tmProposals.map(renderCard)}
        {exerciseProposals.map(renderCard)}

        {completed && !busy && (
          <Text style={[styles.helper, { color: theme.text }]}>{t('reviewCycleComplete')}</Text>
        )}
      </ScrollView>

      <View style={[styles.actionBar, { backgroundColor: theme.card, borderColor: theme.border }]}>
        {completed ? (
          <>
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                styles.grow,
                { backgroundColor: theme.buttonBackground },
                pressed && styles.pressed,
                busy && styles.pressed,
              ]}
              disabled={busy}
              onPress={startNext}
            >
              <Text style={[styles.primaryButtonText, { color: theme.buttonText }]}>
                {t('reviewStartNextCycle')}
              </Text>
            </Pressable>
            <Text style={[styles.finishHelper, { color: theme.text }]}>
              {t('reviewNextCycleHint')}
            </Text>
          </>
        ) : (
          <>
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                styles.grow,
                { backgroundColor: theme.buttonBackground },
                pressed && styles.pressed,
                (!allResolved || busy) && styles.pressed,
              ]}
              disabled={!allResolved || busy}
              onPress={confirm}
            >
              <Text style={[styles.primaryButtonText, { color: theme.buttonText }]}>
                {review.atCycleEnd ? t('reviewConfirmCycle') : t('reviewConfirm')}
              </Text>
            </Pressable>
            {!allResolved && (
              <Text style={[styles.finishHelper, { color: theme.text }]}>
                {t('reviewResolveHint')}
              </Text>
            )}
          </>
        )}
      </View>

      {/* R2: the shared exercise sheet. */}
      <ExerciseSheet
        exercise={information}
        onClose={() => setInformation(null)}
      />
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
  },
  header: {
    fontSize: fontSize.helper,
    opacity: 0.7,
    textAlign: 'center',
    marginTop: spacing.label,
    marginBottom: spacing.section,
  },
  sectionTitle: {
    fontSize: fontSize.sectionTitle,
    fontWeight: '900',
    marginTop: spacing.section,
    marginBottom: spacing.card,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.card,
    padding: spacing.card,
    marginBottom: spacing.cardGap,
  },
  cardTitle: {
    fontSize: fontSize.cardTitle,
    fontWeight: '700',
  },
  targetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.card,
    marginTop: spacing.card,
  },
  helper: {
    fontSize: fontSize.helper,
    opacity: 0.7,
    marginTop: spacing.label,
  },
  reason: {
    fontSize: fontSize.helper,
    opacity: 0.7,
    marginTop: spacing.label,
  },
  advisoryNote: {
    fontSize: fontSize.helper,
    opacity: 0.8,
    marginTop: spacing.label,
  },
  amrapTable: {
    marginTop: spacing.card,
    borderWidth: 1,
    borderRadius: radius.control,
  },
  amrapRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.card,
    paddingVertical: spacing.label,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128, 128, 128, 0.3)',
  },
  amrapHeader: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  amrapCell: {
    fontSize: fontSize.caption,
  },
  editArea: {
    marginTop: spacing.card,
  },
  editInput: {
    minHeight: touchTarget.control,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.inline,
    marginTop: spacing.card,
  },
  primaryButton: {
    borderRadius: radius.control,
    paddingHorizontal: spacing.card,
    paddingVertical: spacing.card,
    minHeight: touchTarget.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    borderRadius: radius.control,
    borderWidth: 1,
    paddingHorizontal: spacing.card,
    paddingVertical: spacing.card,
    minHeight: touchTarget.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: {
    flex: 1,
  },
  pressed: {
    opacity: 0.5,
  },
  primaryButtonText: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
  secondaryButtonText: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
  statusChip: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.card,
    paddingVertical: spacing.label,
    marginTop: spacing.card,
  },
  statusChipText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  actionBar: {
    borderTopWidth: 1,
    padding: spacing.card,
  },
  finishHelper: {
    fontSize: fontSize.helper,
    opacity: 0.7,
    textAlign: 'center',
    marginTop: spacing.label,
  },
});
