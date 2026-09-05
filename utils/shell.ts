import type { SessionQueueState } from './today';

/**
 * The centre button of the navigation shell answers the session queue: one action per queue
 * state, never disabled, never a dead end (SPEC.md §4.4). This mapping is pure so it is testable
 * without a database; the shell component only turns the action kind into an icon, a destination,
 * and — for `restDay` — a sheet.
 *
 * The button's **label never varies**: it always reads "Entrenar" (§4.3). What varies is what
 * tapping it does, which is exactly this mapping. `review` is deliberately not decided here: it
 * needs a database read (`loadReviewEntry`, `utils/cycleReview.ts`) that a pure function cannot
 * do, so the shell component checks it only when this function would otherwise answer `restDay`
 * — a cycle can only be complete-and-unreviewed when nothing else is due (see the component for
 * the reasoning behind that ordering).
 *
 * The queue has no explicit in-progress marker, so "start" versus "continue" reads the head's
 * position in the queue: a head that sits on its nominal day is today's planned session, not yet
 * begun — *start* it. A head whose date was moved onto today ("do it today") is the one session
 * the queue considers in progress — *continue* it. Both actions go to the same runner.
 */
export type CentreActionKind = 'start' | 'continue' | 'resolve' | 'restDay' | 'newRoutine';

export interface CentreAction {
  kind: CentreActionKind;
  /**
   * The queue head's week session when the action starts, continues or resolves a session; null
   * for `restDay` (the sheet decides what happens next) and `newRoutine`.
   */
  weekSessionId: number | null;
}

export function centreActionFor(state: SessionQueueState): CentreAction {
  if (state.routine === null) {
    return { kind: 'newRoutine', weekSessionId: null };
  }
  if (state.head === null) {
    return { kind: 'restDay', weekSessionId: null };
  }
  if (state.resolution === 'unresolved') {
    return { kind: 'resolve', weekSessionId: state.head.weekSessionId };
  }
  return {
    kind: state.head.originDate === state.head.date ? 'start' : 'continue',
    weekSessionId: state.head.weekSessionId,
  };
}
