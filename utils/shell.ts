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
 */
export type CentreLabelKind = 'start' | 'continue' | 'resolve' | 'freeLog';

export interface CentreAction {
  label: CentreLabelKind;
  /**
   * The queue head's week session when the action starts or resolves a
   * session; null for free logging.
   */
  weekSessionId: number | null;
}

export function centreActionFor(state: SessionQueueState): CentreAction {
  if (state.routine === null || state.head === null) {
    return { label: 'freeLog', weekSessionId: null };
  }
  if (state.resolution === 'unresolved') {
    return { label: 'resolve', weekSessionId: state.head.weekSessionId };
  }
  return {
    label: state.head.originDate === state.head.date ? 'start' : 'continue',
    weekSessionId: state.head.weekSessionId,
  };
}
