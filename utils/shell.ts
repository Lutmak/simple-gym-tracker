import type { SessionQueueState } from './today';

/**
 * The centre button of the navigation shell answers the session queue: one action per queue
 * state, never disabled, never a dead end (SPEC.md §4.4). This mapping is pure so it is testable
 * without a database; the shell component only turns the action kind into an icon, a destination,
 * and — for `restDay` — a sheet.
 *
 * The button's **label never varies**: it always reads "Entrenar" (§4.3). What varies is what
 * tapping it does, which is exactly this mapping — including `review` (§3.4/F4): a completed,
 * unreviewed cycle has nothing left to log until the next cycle exists, and the review is what
 * creates it, so the centre button opens the review ahead of anything else. It is checked before
 * `restDay` because a cycle can only be complete-and-unreviewed once nothing else in the routine
 * is due — the same precondition `restDay` already encodes — so the two can never disagree about
 * when to fire.
 *
 * The queue has no explicit in-progress marker, so "start" versus "continue" reads the head's
 * position in the queue: a head that sits on its nominal day is today's planned session, not yet
 * begun — *start* it. A head whose date was moved onto today ("do it today") is the one session
 * the queue considers in progress — *continue* it. Both actions go to the same runner.
 */
export type CentreActionKind =
  | 'start'
  | 'continue'
  | 'resolve'
  | 'review'
  | 'restDay'
  | 'newRoutine';

export interface CentreAction {
  kind: CentreActionKind;
  /**
   * The queue head's week session when the action starts, continues or resolves a session; null
   * for `review`, `restDay` (the sheet decides what happens next) and `newRoutine`.
   */
  weekSessionId: number | null;
  /** The cycle awaiting review, when `kind` is `review`; null otherwise. */
  cycleId: number | null;
  /** The review's routine, when `kind` is `review`; null otherwise. */
  routineId: number | null;
}

export function centreActionFor(state: SessionQueueState): CentreAction {
  if (state.routine === null) {
    return { kind: 'newRoutine', weekSessionId: null, cycleId: null, routineId: null };
  }
  if (state.head === null && state.review !== null) {
    return {
      kind: 'review',
      weekSessionId: null,
      cycleId: state.review.cycleId,
      routineId: state.routine.routineId,
    };
  }
  if (state.head === null) {
    return { kind: 'restDay', weekSessionId: null, cycleId: null, routineId: null };
  }
  if (state.resolution === 'unresolved') {
    return {
      kind: 'resolve',
      weekSessionId: state.head.weekSessionId,
      cycleId: null,
      routineId: null,
    };
  }
  return {
    kind: state.head.originDate === state.head.date ? 'start' : 'continue',
    weekSessionId: state.head.weekSessionId,
    cycleId: null,
    routineId: null,
  };
}
