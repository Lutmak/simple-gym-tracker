/**
 * Creating a cycle (SPECS.md §3.1, §3.3).
 *
 * The plan (Routines/Sessions/SessionExercises) says what to train; the cycle
 * (Cycles/CycleWeeks/WeekSessions) says when. The session queue in
 * utils/today.ts reads only the second one, so a routine with no cycle has no
 * head, no upcoming session and no review — the app is active and offers
 * nothing. Every path that makes a routine active therefore goes through
 * `ensureActiveCycle`, and the explicit next-cycle action
 * (utils/cycleReview.ts `startNextCycle`) goes through `createCycle`: one
 * place that knows what a cycle is made of.
 *
 * Neither function opens a transaction. SQLite has no nested `BEGIN`, and
 * every caller already owns one — the cycle is written atomically with the
 * routine copy or the activation that asked for it.
 */

import type { RoutineDatabase } from './routineActions';

/**
 * How many weeks a cycle spans when nothing else says. This is not a
 * preference: the wave table (utils/fiveThreeOne.ts) defines weeks 1-3 plus
 * the deload week 4 and throws beyond it, `waveProposeNextTargets` walks four
 * entries per cycle, and both demo routines are four-week cycles. A routine
 * stores no week count of its own, so its FIRST cycle takes this value and
 * every later cycle inherits the previous cycle's.
 */
export const DEFAULT_CYCLE_WEEKS = 4;

const num = (value: unknown): number => Number(value);

/**
 * Writes one cycle for a routine: the `Cycles` row (status 'active', current
 * week 1), every `CycleWeeks` row, and one pending `WeekSessions` row per
 * session per week. The cycle number follows the routine's highest existing
 * one; the sessions are the routine's own, in plan order (`sort_order`).
 *
 * `startedAt` is what week 1's dates derive from (`nominalSessionStamp`), so
 * starting a cycle "now" can never produce an already-missed session.
 */
export async function createCycle(
  db: RoutineDatabase,
  routineId: number,
  weeks: number,
  startedAt: number,
): Promise<number> {
  const sessionRows = await db.getAll(
    'SELECT session_id FROM Sessions WHERE routine_id = ? ORDER BY sort_order;',
    [routineId],
  );
  const sessionIds = sessionRows.map((row) => num(row.session_id));

  const highestRow = await db.get(
    'SELECT MAX(cycle_number) AS highest FROM Cycles WHERE routine_id = ?;',
    [routineId],
  );
  const highest =
    highestRow === undefined || highestRow.highest === null || highestRow.highest === undefined
      ? 0
      : num(highestRow.highest);

  await db.run(
    `INSERT INTO Cycles
       (routine_id, cycle_number, weeks, status, current_week, started_at, completed_at)
     VALUES (?, ?, ?, 'active', 1, ?, NULL);`,
    [routineId, highest + 1, weeks, startedAt],
  );
  const cycleRow = await db.get('SELECT last_insert_rowid() AS id;', []);
  if (!cycleRow) {
    throw new Error('Could not read the new cycle id');
  }
  const cycleId = num(cycleRow.id);

  for (let weekNumber = 1; weekNumber <= weeks; weekNumber += 1) {
    await db.run('INSERT INTO CycleWeeks (cycle_id, week_number) VALUES (?, ?);', [
      cycleId,
      weekNumber,
    ]);
    const weekRow = await db.get('SELECT last_insert_rowid() AS id;', []);
    if (!weekRow) {
      throw new Error('Could not read the new cycle week id');
    }
    const cycleWeekId = num(weekRow.id);
    for (const sessionId of sessionIds) {
      await db.run(
        `INSERT INTO WeekSessions (cycle_week_id, session_id, status)
         VALUES (?, ?, 'pending');`,
        [cycleWeekId, sessionId],
      );
    }
  }

  return cycleId;
}

/**
 * Activation's guarantee: the routine that just became active has a cycle to
 * train. Returns the cycle it left in place, or null when the routine has
 * nothing to schedule.
 *
 * The decisions, all of them conservative — this runs over a real training
 * history and must never rewrite one:
 *
 * - **A routine with an unfinished cycle keeps it.** Re-activating is a
 *   no-op: no second cycle, no week reset, no logged session touched. This is
 *   what makes activation idempotent, and it is why switching away from a
 *   routine and back resumes exactly where the user left off — deactivating
 *   never ends a cycle, so the cycle is still there.
 * - **A routine whose cycles are all complete gets the next one.** An active
 *   routine with nothing left to train would offer no session at all, which is
 *   the defect this module exists to close. The completed cycles and every set
 *   logged against them are left untouched; the new cycle is numbered after
 *   them and inherits their week count.
 * - **A routine with no training days gets no cycle.** There is nothing to
 *   put in a week, and an empty cycle would read as a week whose every session
 *   is resolved — it would offer a review of nothing.
 */
export async function ensureActiveCycle(
  db: RoutineDatabase,
  routineId: number,
  startedAt: number,
): Promise<number | null> {
  const openRow = await db.get(
    `SELECT cycle_id FROM Cycles
     WHERE routine_id = ? AND status <> 'complete'
     ORDER BY cycle_number DESC LIMIT 1;`,
    [routineId],
  );
  if (openRow !== undefined) {
    return num(openRow.cycle_id);
  }

  const sessionCountRow = await db.get(
    'SELECT COUNT(*) AS n FROM Sessions WHERE routine_id = ?;',
    [routineId],
  );
  if (sessionCountRow === undefined || num(sessionCountRow.n) === 0) {
    return null;
  }

  const latestRow = await db.get(
    'SELECT weeks FROM Cycles WHERE routine_id = ? ORDER BY cycle_number DESC LIMIT 1;',
    [routineId],
  );
  const weeks = latestRow === undefined ? DEFAULT_CYCLE_WEEKS : num(latestRow.weeks);

  return createCycle(db, routineId, weeks, startedAt);
}
