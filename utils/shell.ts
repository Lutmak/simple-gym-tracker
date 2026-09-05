import type { SessionQueueState } from './today';

/**
 * The centre button of the navigation shell (SPECS.md V2) answers the session
 * queue: one label per queue state, never disabled, never a dead end. This
 * mapping is pure so it is testable without a database; the shell component
 * only turns the label kind into copy and a destination.
 *
 * The queue has no explicit in-progress marker, so "start" versus "continue"
 * reads the head's position in the queue: a head that sits on its nominal day
 * is today's planned session, not yet begun — *start* it. A head whose date
 * was moved onto today ("do it today") is the one session the queue considers
 * in progress — *continue* it. Both actions go to the same runner.
 *
 * §3.4/F4: a completed, unreviewed cycle (`state.review`) has nothing left
 * to log until the next cycle exists, and the review is what creates it —
 * so the centre button should open the review, ahead of free logging. That
 * consumption belongs to the component rebuild in progress on `TabBar.tsx`
 * (see CLAUDE.md); this module only exposes the fact via `cycleId`, without
 * adding a new `CentreLabelKind` member, so its exhaustive `Record<CentreLabelKind,
 * ...>` mappings elsewhere are not forced to grow a case out from under that
 * rebuild. A consumer checks `cycleId !== null` before falling back to `label`.
 */
export type CentreLabelKind = 'start' | 'continue' | 'resolve' | 'freeLog';

export interface CentreAction {
  label: CentreLabelKind;
  /**
   * The queue head's week session when the action starts or resolves a
   * session; null for free logging or a pending review.
   */
  weekSessionId: number | null;
  /** The cycle awaiting review (§3.4/F4), when one is pending; null otherwise. */
  cycleId: number | null;
}

export function centreActionFor(state: SessionQueueState): CentreAction {
  if (state.routine === null) {
    return { label: 'freeLog', weekSessionId: null, cycleId: null };
  }
  if (state.head === null) {
    return { label: 'freeLog', weekSessionId: null, cycleId: state.review?.cycleId ?? null };
  }
  if (state.resolution === 'unresolved') {
    return { label: 'resolve', weekSessionId: state.head.weekSessionId, cycleId: null };
  }
  return {
    label: state.head.originDate === state.head.date ? 'start' : 'continue',
    weekSessionId: state.head.weekSessionId,
    cycleId: null,
  };
}
