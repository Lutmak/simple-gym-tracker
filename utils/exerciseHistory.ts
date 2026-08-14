/**
 * G3 — Progress: the historical view (SPECS.md G3, §3.2, §3.7).
 *
 * One view across every routine and every free session, keyed on the catalog
 * exercise name: `Logged_Exercises.exercise_name` is the §3.2 snapshot, and
 * both the session runner (D6) and free logging (D7) write it at log time —
 * D7 stores the catalog name, which is what makes the join truthful. The view
 * is never filtered by routine: the three history tables hold both sources
 * and the name join pulls them in automatically.
 *
 * Pure core plus thin database edges, same split as utils/routineProgress.ts.
 * One point per session day: the top weight (G2's tie-break), the session max
 * of per-set Epley estimates (`estimate1RM`, reused from fiveThreeOne.ts), and
 * total volume Σ weight×reps. Values stay in the unit they were logged in
 * (§3.7); the series label unit is the latest log row's unit. Charts are drawn
 * only for a series with at least two points — B7's rule, shared with G2 via
 * `hasChartableSeries`. Bodyweight sets are logged as weight 0 (see
 * sessionRunner.ts) and contribute no 1RM estimate, so a bodyweight-only
 * exercise charts a flat zero line rather than crashing the estimator.
 */

import { estimate1RM } from './fiveThreeOne';
import type { RoutineDatabase, RoutineUnit } from './routineActions';

export interface ExerciseHistoryRow {
  /** Whole UTC day (noon) stamp of the log date. */
  date: number;
  setNumber: number;
  weight: number;
  reps: number;
  unit: RoutineUnit;
}

export interface ExerciseSessionPoint {
  date: number;
  /** The heaviest set of the session. */
  weight: number;
  /** Reps of that heaviest set (G2's tie-break). */
  reps: number;
  /** Session max of per-set Epley estimates; 0 when every set is bodyweight. */
  estimated1RM: number;
  /** Σ weight×reps over the session's sets. */
  volume: number;
}

export interface ExerciseSeriesData {
  /** The series label unit: the latest log row's unit (§3.7). */
  unit: RoutineUnit;
  /** True when the exercise was logged in more than one unit across history. */
  mixedUnits: boolean;
  points: ExerciseSessionPoint[];
}

export interface ExerciseSeries extends ExerciseSeriesData {
  exerciseName: string;
}

export interface ExerciseSummary {
  name: string;
  /** The most recent log date — the picker's recency order. */
  lastDate: number;
}

/**
 * One session-day point per date: top weight (heaviest, then most reps —
 * the same tie-break as G2's `buildLiftSeries`), session-max Epley 1RM, and
 * total volume. Order-independent over the input rows; the points come out
 * ascending by date. Nothing is converted: every value keeps the unit it was
 * logged in, and the label unit is the latest row's.
 */
export function buildExerciseSeries(
  rows: readonly ExerciseHistoryRow[],
): ExerciseSeriesData {
  const bestByDate = new Map<number, ExerciseHistoryRow>();
  const estimated1RMByDate = new Map<number, number>();
  const volumeByDate = new Map<number, number>();
  const units = new Set<RoutineUnit>();
  let latest: ExerciseHistoryRow | null = null;

  for (const row of rows) {
    units.add(row.unit);
    const current = bestByDate.get(row.date);
    if (
      current === undefined ||
      row.weight > current.weight ||
      (row.weight === current.weight && row.reps > current.reps)
    ) {
      bestByDate.set(row.date, row);
    }
    if (row.weight > 0 && row.reps > 0) {
      const estimate = estimate1RM(row.weight, row.reps);
      estimated1RMByDate.set(
        row.date,
        Math.max(estimated1RMByDate.get(row.date) ?? 0, estimate),
      );
    }
    volumeByDate.set(
      row.date,
      (volumeByDate.get(row.date) ?? 0) + row.weight * row.reps,
    );
    if (
      latest === null ||
      row.date > latest.date ||
      (row.date === latest.date && row.setNumber > latest.setNumber)
    ) {
      latest = row;
    }
  }

  const points: ExerciseSessionPoint[] = [...bestByDate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([date, row]) => ({
      date,
      weight: row.weight,
      reps: row.reps,
      estimated1RM: estimated1RMByDate.get(date) ?? 0,
      volume: volumeByDate.get(date) ?? 0,
    }));

  return {
    unit: latest?.unit ?? 'kg',
    mixedUnits: units.size > 1,
    points,
  };
}

const num = (value: unknown): number => Number(value);
const str = (value: unknown): string => String(value);

/** Every exercise with at least one logged set, most recently logged first. */
export async function loadExercisesWithHistory(
  db: RoutineDatabase,
): Promise<ExerciseSummary[]> {
  const rows = await db.getAll(
    `SELECT le.exercise_name AS name, MAX(wol.workout_date) AS last_date
     FROM Logged_Exercises le
     JOIN Workout_Log wol ON wol.workout_log_id = le.workout_log_id
     WHERE EXISTS (
       SELECT 1 FROM Weight_Log wl
       WHERE wl.logged_exercise_id = le.logged_exercise_id
     )
     GROUP BY le.exercise_name
     ORDER BY last_date DESC, le.exercise_name;`,
    [],
  );
  return rows.map((row) => ({
    name: str(row.name),
    lastDate: num(row.last_date),
  }));
}

/**
 * One exercise's whole history, across every routine and every free session,
 * in the units the rows were logged in (§3.7).
 */
export async function loadExerciseSeries(
  db: RoutineDatabase,
  exerciseName: string,
): Promise<ExerciseSeries> {
  const rows = await db.getAll(
    `SELECT wol.workout_date AS date, wl.set_number, wl.weight_logged AS weight,
            wl.reps_logged AS reps, wl.unit
     FROM Logged_Exercises le
     JOIN Workout_Log wol ON wol.workout_log_id = le.workout_log_id
     JOIN Weight_Log wl ON wl.logged_exercise_id = le.logged_exercise_id
     WHERE le.exercise_name = ?
     ORDER BY wol.workout_date, wl.set_number;`,
    [exerciseName],
  );
  const history = buildExerciseSeries(
    rows.map((row) => ({
      date: num(row.date),
      setNumber: num(row.set_number),
      weight: num(row.weight),
      reps: num(row.reps),
      unit: str(row.unit) as RoutineUnit,
    })),
  );
  return { exerciseName, ...history };
}
