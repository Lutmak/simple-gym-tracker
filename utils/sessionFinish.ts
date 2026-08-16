import type { RoutineDatabase } from './routineActions';

export interface SessionFinishContext {
  routineId: number;
  cycleId: number;
  cycleNumber: number;
  weekNumber: number;
  reviewAvailable: boolean;
}

export type SessionSummaryFinishContext = Pick<
  SessionFinishContext,
  'routineId' | 'cycleId' | 'weekNumber' | 'reviewAvailable'
>;

/** The existing G1 review is due only for the active cycle's resolved current week. */
export function reviewAvailableFor(
  cycleStatus: string,
  weekNumber: number,
  currentWeek: number,
  pendingSessions: number,
): boolean {
  return cycleStatus === 'active' && weekNumber === currentWeek && pendingSessions === 0;
}

/** Reads the exact routine week just saved and whether G1 can be offered next. */
export async function loadSessionFinishContext(
  db: RoutineDatabase,
  weekSessionId: number,
): Promise<SessionFinishContext> {
  const row = await db.get(
    `SELECT c.routine_id, c.cycle_id, c.cycle_number, c.status AS cycle_status,
            c.current_week, cw.week_number
     FROM WeekSessions ws
     JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
     JOIN Cycles c ON c.cycle_id = cw.cycle_id
     WHERE ws.week_session_id = ?;`,
    [weekSessionId],
  );
  if (row === undefined) {
    throw new Error(`Unknown week session ${weekSessionId}`);
  }

  const pendingRows = await db.getAll(
    `SELECT COUNT(*) AS pending
     FROM WeekSessions ws
     JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
     WHERE cw.cycle_id = ? AND cw.week_number = ? AND ws.status = 'pending';`,
    [Number(row.cycle_id), Number(row.week_number)],
  );
  const pendingSessions = Number(pendingRows[0]?.pending ?? 0);
  const weekNumber = Number(row.week_number);
  const currentWeek = Number(row.current_week);

  return {
    routineId: Number(row.routine_id),
    cycleId: Number(row.cycle_id),
    cycleNumber: Number(row.cycle_number),
    weekNumber,
    reviewAvailable: reviewAvailableFor(
      String(row.cycle_status),
      weekNumber,
      currentWeek,
      pendingSessions,
    ),
  };
}
