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
 * The fallback cycle length (§3.2) for a routine whose own `Routines.cycle_weeks`
 * cannot be read (a bare `linear`/`none` routine predating the column, or a row
 * this DB layer's caller does not carry) — every wave routine has its own
 * `cycle_weeks` (3, no deload, or 4) and `ensureActiveCycle`/`startNextCycle`
 * read it directly rather than inheriting whatever the previous cycle ran with,
 * so flipping the deload switch between cycles takes effect on the next one.
 */
export const DEFAULT_CYCLE_WEEKS = 4;

const num = (value: unknown): number => Number(value);
const str = (value: unknown): string => String(value);

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
 *   them and takes the routine's CURRENT `cycle_weeks` (§3.2) — not whatever
 *   the previous cycle happened to run with, so a deload switch flipped
 *   between cycles is honoured for the next one.
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

  const routineRow = await db.get(
    'SELECT cycle_weeks FROM Routines WHERE routine_id = ?;',
    [routineId],
  );
  const weeks =
    routineRow === undefined || routineRow.cycle_weeks === null || routineRow.cycle_weeks === undefined
      ? DEFAULT_CYCLE_WEEKS
      : num(routineRow.cycle_weeks);

  return createCycle(db, routineId, weeks, startedAt);
}

/**
 * §3.4/F4 — `current_week` advances the moment a week's sessions all
 * resolve; it no longer waits for that week's review to be opened and
 * applied. Every caller that resolves a `WeekSessions` row to something
 * other than 'pending' (`saveSessionLog`, `resolveMoveSession`,
 * `resolveDiscardSession`) calls this with that row's id afterwards, inside
 * the same transaction.
 *
 * Before this, skipping one week's review froze `current_week` there
 * forever — every later week's own review-availability check compares
 * against it, so the button never reappeared for any of them, and a cycle
 * could never even be detected as complete (`current_week >= weeks`) if its
 * very first week's review was ever skipped.
 *
 * `current_week` is set to the LATEST week of this cycle with zero pending
 * sessions, capped at the cycle's own `weeks` — never past it: reaching a
 * genuinely new cycle needs the accepted training maxes from a review
 * (`utils/cycleReview.ts` `startNextCycle`), not a bare increment. Applying
 * a review (`applyReview`) can still move it forward on its own, ahead of
 * this — the two cooperate, both only ever moving it forward.
 */
export async function advanceCycleWeek(
  db: RoutineDatabase,
  weekSessionId: number,
): Promise<void> {
  const cycleRow = await db.get(
    `SELECT c.cycle_id, c.current_week, c.weeks, c.status
     FROM WeekSessions ws
     JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
     JOIN Cycles c ON c.cycle_id = cw.cycle_id
     WHERE ws.week_session_id = ?;`,
    [weekSessionId],
  );
  if (cycleRow === undefined || str(cycleRow.status) !== 'active') {
    return;
  }
  const cycleId = num(cycleRow.cycle_id);
  const currentWeek = num(cycleRow.current_week);
  const weeks = num(cycleRow.weeks);
  if (currentWeek >= weeks) {
    return;
  }

  const weekRows = await db.getAll(
    `SELECT cw.week_number AS week_number,
            SUM(CASE WHEN ws.status = 'pending' THEN 1 ELSE 0 END) AS pending
     FROM CycleWeeks cw
     JOIN WeekSessions ws ON ws.cycle_week_id = cw.cycle_week_id
     WHERE cw.cycle_id = ?
     GROUP BY cw.week_number;`,
    [cycleId],
  );
  let latestResolved = 0;
  for (const row of weekRows) {
    if (num(row.pending) === 0 && num(row.week_number) > latestResolved) {
      latestResolved = num(row.week_number);
    }
  }
  const target = Math.min(latestResolved, weeks);
  if (target > currentWeek) {
    await db.run(
      `UPDATE Cycles SET current_week = ? WHERE cycle_id = ? AND current_week < ?;`,
      [target, cycleId, target],
    );
  }
}
