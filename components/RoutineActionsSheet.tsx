import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { Row } from './Row';
import { Sheet } from './Sheet';
import { fontSize, spacing } from '../utils/scale';
import {
  planActivation,
  type ActivationTarget,
  type ActiveRoutineRef,
} from '../utils/routineLibrary';

/**
 * R1 — the one action bar a routine has (SPECS.md R1).
 *
 * Before this, activate / edit / duplicate / delete were four bespoke icon buttons pinned to the
 * bottom of the routine detail screen, with their own borders, their own radius and a hard-coded
 * red — a menu that appeared nowhere else in the app, and nowhere at all from the list. They are
 * now one standard `Sheet`, mounted identically by the Rutinas list, by the routine detail and by
 * a preset's detail, so a routine's actions are in one place and read like every other decision in
 * the app (§3.5: a bottom sheet is "a decision about the thing you touched").
 *
 * A **preset** has exactly one action, so it opens straight at the confirmation — the sheet never
 * shows a list of one. It is the same component and the same words, which is the point: there is
 * one description of what activating does, wherever it is done.
 *
 * The sheet owns its confirmations, in its own steps rather than in a system `Alert`:
 *
 * - **Activation confirms what becomes inactive, and asks for nothing else.** The confirmation
 *   exists only because another routine stops being active; when none is, the caller activates
 *   without opening this at all (§7.5 — a confirmation the user cannot fail is friction). It never
 *   collects a weight: `planActivation` has no number in it, and the first logged session learns
 *   the targets (§3.2).
 * - **Deletion always confirms**, because it cannot be undone, and it says plainly that training
 *   history survives. Destructive weight comes from the `warning` token — the palette is
 *   monochrome and red is not in it.
 */

export type RoutineActionsSheetProps = {
  /** Null closes the sheet; a target opens it. One piece of state per caller. */
  target: ActivationTarget | null;
  /** The currently active routine, so activation can name what it replaces. */
  active: ActiveRoutineRef | null;
  onClose: () => void;
  onActivate: (target: ActivationTarget) => void;
  onEdit: (routineId: number) => void;
  onDuplicate: (routineId: number) => void;
  onDelete: (routineId: number) => void;
  /** X3 — a user routine's fifth action: write it to a `.sgtroutine.json` file and share it.
   *  Omitted where the caller has no export door yet; a preset never offers it (ADR-0048 — a
   *  preset is already portable as data, and exporting a curated preset verbatim was not asked
   *  for). No confirmation: export creates nothing and changes nothing (§7.5). */
  onExport?: (routineId: number) => void;
  /** A write is in flight; every action is inert until it lands. */
  busy?: boolean;
  testID?: string;
};

type Step = 'actions' | 'confirmActivate' | 'confirmDelete';

export function RoutineActionsSheet({
  target,
  active,
  onClose,
  onActivate,
  onEdit,
  onDuplicate,
  onDelete,
  onExport,
  busy,
  testID,
}: RoutineActionsSheetProps) {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('actions');
  /** The target is retained while the sheet slides out, so the closing frame is not blank. */
  const [shown, setShown] = useState<ActivationTarget | null>(target);

  useEffect(() => {
    if (target !== null) {
      setShown(target);
      setStep(target.kind === 'preset' ? 'confirmActivate' : 'actions');
    }
  }, [target]);

  if (shown === null) {
    return null;
  }

  const firstStep: Step = shown.kind === 'preset' ? 'confirmActivate' : 'actions';
  const plan = planActivation(shown, active);
  const isActive = plan.outcome === 'alreadyActive';

  const activateDetail = isActive
    ? t('routineActionActivateAlready')
    : plan.deactivating === null
      ? t('routineActionActivateNone')
      : t('routineActionActivateReplaces', { name: plan.deactivating.name });

  const title =
    step === 'actions'
      ? shown.name
      : step === 'confirmActivate'
        ? t('routineConfirmActivateTitle', { name: shown.name })
        : t('deleteRoutineTitle');

  const back = step === firstStep ? undefined : () => setStep(firstStep);

  return (
    <Sheet
      visible={target !== null}
      onClose={onClose}
      onClosed={() => setShown(null)}
      title={title}
      onBack={back}
      backAccessibilityLabel={t('sheetBack')}
      testID={testID}
    >
      {step === 'actions' && shown.kind === 'routine' && (
        <View testID="routine-actions-list">
          <Row
            label={t('activate')}
            detail={activateDetail}
            detailBelow
            onPress={isActive ? undefined : () => setStep('confirmActivate')}
            disabled={busy === true || isActive}
            divided
            testID="routine-action-activate"
          />
          <Row
            label={t('edit')}
            detail={t('routineActionEditDetail')}
            detailBelow
            onPress={() => onEdit(shown.routineId)}
            disabled={busy}
            divided
            testID="routine-action-edit"
          />
          <Row
            label={t('duplicate')}
            detail={t('routineActionDuplicateDetail')}
            detailBelow
            onPress={() => onDuplicate(shown.routineId)}
            disabled={busy}
            divided
            testID="routine-action-duplicate"
          />
          {onExport !== undefined && (
            <Row
              label={t('export')}
              detail={t('routineActionExportDetail')}
              detailBelow
              onPress={() => onExport(shown.routineId)}
              disabled={busy}
              divided
              testID="routine-action-export"
            />
          )}
          <Row
            label={t('delete')}
            detail={t('routineActionDeleteDetail')}
            detailBelow
            onPress={() => setStep('confirmDelete')}
            disabled={busy}
            divided
            testID="routine-action-delete"
          />
        </View>
      )}

      {step === 'confirmActivate' && (
        <View testID="routine-confirm-activate">
          <Text style={[styles.explanation, { color: tokens.textSecondary }]}>
            {isActive
              ? t('routineActionActivateAlready')
              : plan.outcome === 'activate' && plan.deactivating !== null
                ? t('routineConfirmActivateDeactivates', { name: plan.deactivating.name })
                : t('routineActionActivateNone')}
          </Text>
          <Text style={[styles.explanation, { color: tokens.textSecondary }]}>
            {t('routineConfirmActivateNoWeights')}
          </Text>
          {!isActive && (
            <Row
              label={t('activate')}
              onPress={() => onActivate(shown)}
              disabled={busy}
              divided
              testID="routine-confirm-activate-action"
            />
          )}
          <Row label={t('Cancel')} onPress={onClose} disabled={busy} divided />
        </View>
      )}

      {step === 'confirmDelete' && shown.kind === 'routine' && (
        <View testID="routine-confirm-delete">
          <Text style={[styles.explanation, { color: tokens.textSecondary }]}>
            {isActive
              ? t('deleteRoutineActiveMessage', { name: shown.name })
              : t('deleteRoutineMessage', { name: shown.name })}
          </Text>
          <Row
            label={t('routineDeleteConfirmAction')}
            detailBelow
            detailContent={
              <Text style={[styles.destructive, { color: tokens.warning }]}>
                {t('routineDeleteIrreversible')}
              </Text>
            }
            onPress={() => onDelete(shown.routineId)}
            disabled={busy}
            divided
            testID="routine-confirm-delete-action"
          />
          <Row label={t('Cancel')} onPress={() => setStep('actions')} disabled={busy} divided />
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  explanation: {
    fontSize: fontSize.helper,
    marginBottom: spacing.cardGap,
  },
  destructive: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
});
