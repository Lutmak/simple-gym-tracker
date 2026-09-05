import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import { loadDemoData, type DemoDatabase } from './demoData';
import {
  applyReview,
  buildCycleHistory,
  editProposalValue,
  generateReview,
  loadCycleReview,
  loadReviewEntry,
  plannedWorkSets,
  resolveProposal,
  startNextCycle,
  type PerformedSetGroup,
  type ReviewExercise,
} from './cycleReview';
import { activatePresetRoutine, type RoutineDatabase } from './routineActions';
import { buildPlannedDraft, loadRunnerSession, saveSessionLog, type RunnerSession } from './sessionRunner';

type TestExecutor = SchemaExecutor & {
  get: RoutineDatabase['get'];
};

const connect = (): { db: DatabaseSync; executor: TestExecutor } => {
  const db = new DatabaseSync(':memory:');
  const executor: TestExecutor = {
    exec: (sql) => db.exec(sql),
    run: (sql, params) => {
      db.prepare(sql).run(...((params ?? []) as SQLInputValue[]));
    },
    getAll: <T>(sql: string, params: SQLInputValue[] = []) =>
      Promise.resolve(db.prepare(sql).all(...params) as T[]),
    get: <T>(sql: string, params: SQLInputValue[] = []) =>
      Promise.resolve(db.prepare(sql).get(...params) as T | undefined),
  };
  return { db, executor };
};

const demoDb = (db: DatabaseSync): DemoDatabase => ({
  run: (sql: string, params: SQLInputValue[] = []) =>
    db.prepare(sql).run(...params),
  get: (sql: string, params: SQLInputValue[] = []) =>
    db.prepare(sql).get(...params) as Record<string, unknown> | undefined,
});

const count = (db: DatabaseSync, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

const countWhere = (db: DatabaseSync, table: string, where: string, ...params: SQLInputValue[]): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params) as { n: number }).n;

/** Resolves every session of a demo week as completed without a log. */
const resolveDemoWeek = async (executor: TestExecutor, weekNumber: number): Promise<void> => {
  await executor.run(
    `UPDATE WeekSessions SET status = 'completed', resolved_on_date = 1
     WHERE week_session_id IN (
       SELECT ws.week_session_id FROM WeekSessions ws
       JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
       JOIN Cycles c ON c.cycle_id = cw.cycle_id
       WHERE c.routine_id = 1 AND cw.week_number = ?);`,
    [weekNumber],
  );
};

const proposalOf = async (
  executor: TestExecutor,
  cycleId: number,
  exerciseName: string,
): Promise<{ proposal_id: number; current_target: number; proposed_target: number; status: string }> => {
  const row = await executor.get(
    `SELECT proposal_id, current_target, proposed_target, status
     FROM Progression_Proposal
     WHERE cycle_id = ? AND exercise_name = ?;`,
    [cycleId, exerciseName],
  );
  if (!row) {
    throw new Error(`No proposal row for ${exerciseName}`);
  }
  return {
    proposal_id: Number(row.proposal_id),
    current_target: Number(row.current_target),
    proposed_target: Number(row.proposed_target),
    status: String(row.status),
  };
};

const planWeight = async (
  executor: TestExecutor,
  routineId: number,
  exerciseName: string,
): Promise<{ absolute: number | null; tm: number | null }> => {
  const row = await executor.get(
    `SELECT e.absolute_weight, e.training_max_weight FROM SessionExercises e
     JOIN Sessions s ON s.session_id = e.session_id
     WHERE s.routine_id = ? AND e.exercise_name = ?;`,
    [routineId, exerciseName],
  );
  if (!row) {
    throw new Error(`No plan row for ${exerciseName}`);
  }
  return {
    absolute: row.absolute_weight === null ? null : Number(row.absolute_weight),
    tm: row.training_max_weight === null ? null : Number(row.training_max_weight),
  };
};

const setupDemo = async (): Promise<{ db: DatabaseSync; executor: TestExecutor }> => {
  const { db, executor } = connect();
  await runSchema(executor);
  await loadDemoData(demoDb(db));
  return { db, executor };
};

/** The cycle id of the inactive linear routine's cycle. */
const linearCycleId = async (executor: TestExecutor, cycleNumber: number): Promise<number> => {
  const row = await executor.get(
    `SELECT c.cycle_id FROM Cycles c JOIN Routines r ON r.routine_id = c.routine_id
     WHERE r.routine_key = 'demo-linear-3day' AND c.cycle_number = ?;`,
    [cycleNumber],
  );
  if (!row) {
    throw new Error('No linear cycle row');
  }
  return Number(row.cycle_id);
};

interface WaveFixture {
  db: DatabaseSync;
  executor: TestExecutor;
  routineId: number;
  cycleId: number;
  exerciseId: number;
}

/** A minimal wave routine: one main lift at 80 kg TM, one four-week cycle, fully logged. */
const setupWaveFixture = async (
  db: DatabaseSync,
  executor: TestExecutor,
  amrap: { week1: number; week2: number; week3: number },
): Promise<WaveFixture> => {
  await runSchema(executor);
  await executor.run(
    `INSERT INTO Routines
       (routine_key, name, origin, progression_rule, unit, rounding_increment,
        rest_main_seconds, rest_accessory_seconds, is_active, created_at)
     VALUES (NULL, 'Wave Fixture', 'user', 'wave', 'kg', 2.5, 180, 90, 1, 1);`,
    [],
  );
  const routineRow = await executor.get('SELECT last_insert_rowid() AS id;', []);
  const routineId = Number(routineRow?.id);

  await executor.run(
    `INSERT INTO Sessions (routine_id, weekday, name, sort_order) VALUES (?, 1, 'Lift Day', 1);`,
    [routineId],
  );
  const sessionRow = await executor.get('SELECT last_insert_rowid() AS id;', []);
  const sessionId = Number(sessionRow?.id);

  await executor.run(
    `INSERT INTO SessionExercises
       (session_id, catalog_exercise_id, exercise_name, role, target_sets, target_reps,
        load_source, training_max_pct, training_max_weight, absolute_weight,
        unit_override, is_amrap, sort_order)
     VALUES (?, NULL, 'Bench Press', 'main', 3, 5, 'training_max_pct', 0.9, 80, NULL,
             NULL, 1, 1);`,
    [sessionId],
  );
  const exerciseRow = await executor.get('SELECT last_insert_rowid() AS id;', []);
  const exerciseId = Number(exerciseRow?.id);

  await executor.run(
    `INSERT INTO Cycles
       (routine_id, cycle_number, weeks, status, current_week, started_at, completed_at)
     VALUES (?, 1, 4, 'active', 4, 1, NULL);`,
    [routineId],
  );
  const cycleRow = await executor.get('SELECT last_insert_rowid() AS id;', []);
  const cycleId = Number(cycleRow?.id);

  const weekTop = [68, 72, 76, 48];
  const weekAmrap = [amrap.week1, amrap.week2, amrap.week3, 5];
  for (let weekNumber = 1; weekNumber <= 4; weekNumber += 1) {
    await executor.run(
      `INSERT INTO CycleWeeks (cycle_id, week_number) VALUES (?, ?);`,
      [cycleId, weekNumber],
    );
    const weekRow = await executor.get('SELECT last_insert_rowid() AS id;', []);
    const weekId = Number(weekRow?.id);

    await executor.run(
      `INSERT INTO Workout_Log (workout_name, day_name, workout_date)
       VALUES ('Wave Fixture', 'Lift Day', ?);`,
      [weekNumber],
    );
    const logRow = await executor.get('SELECT last_insert_rowid() AS id;', []);
    const logId = Number(logRow?.id);

    await executor.run(
      `INSERT INTO Logged_Exercises (workout_log_id, exercise_name, sets, reps)
       VALUES (?, 'Bench Press', 3, 5);`,
      [logId],
    );
    const loggedRow = await executor.get('SELECT last_insert_rowid() AS id;', []);
    const loggedId = Number(loggedRow?.id);

    const top = weekTop[weekNumber - 1];
    const reps = weekAmrap[weekNumber - 1];
    for (let setNumber = 1; setNumber <= 3; setNumber += 1) {
      await executor.run(
        `INSERT INTO Weight_Log
           (workout_log_id, logged_exercise_id, exercise_name, set_number,
            weight_logged, reps_logged, unit)
         VALUES (?, ?, 'Bench Press', ?, ?, ?, 'kg');`,
        [logId, loggedId, setNumber, top, setNumber === 3 ? reps : (weekNumber === 2 ? 3 : 5)],
      );
    }

    await executor.run(
      `INSERT INTO WeekSessions (cycle_week_id, session_id, status, resolved_on_date, completed_log_id)
       VALUES (?, ?, 'completed', ?, ?);`,
      [weekId, sessionId, weekNumber, logId],
    );
  }

  return { db, executor, routineId, cycleId, exerciseId };
};

describe('plannedWorkSets — extra sets never reach a proposal or the AMRAP view (§3.4)', () => {
  const group = (overrides: Partial<PerformedSetGroup> = {}): PerformedSetGroup => ({
    cycleNumber: 1,
    weekNumber: 1,
    exerciseName: 'Barbell Full Squat',
    role: null,
    sets: [
      { weight: 100, reps: 5, unit: 'kg' },
      { weight: 100, reps: 5, unit: 'kg' },
      { weight: 100, reps: 5, unit: 'kg' },
      { weight: 110, reps: 3, unit: 'kg' },
      { weight: 115, reps: 1, unit: 'kg' },
    ],
    ...overrides,
  });

  const exercise = (overrides: Partial<ReviewExercise> = {}): ReviewExercise => ({
    sessionExerciseId: 1,
    catalogExerciseId: 'Barbell_Full_Squat',
    name: 'Barbell Full Squat',
    role: 'main',
    targetSets: 3,
    targetReps: 5,
    loadSource: 'absolute',
    absoluteWeight: 100,
    trainingMaxWeight: null,
    trainingMaxPct: null,
    unitOverride: null,
    isAmrap: true,
    ...overrides,
  });

  it('cuts every group to the exercise planned set count', () => {
    const groups = plannedWorkSets([group()], [exercise()]);
    expect(groups[0].sets).toEqual([
      { weight: 100, reps: 5, unit: 'kg' },
      { weight: 100, reps: 5, unit: 'kg' },
      { weight: 100, reps: 5, unit: 'kg' },
    ]);
  });

  it('leaves a group untouched when no exercise matches its name', () => {
    const groups = plannedWorkSets(
      [group({ exerciseName: 'Mystery Exercise' })],
      [exercise({ name: 'Other Exercise' })],
    );
    expect(groups[0].sets).toHaveLength(5);
  });

  it('the truncated history feeds buildCycleHistory, so the AMRAP set is the last PLANNED set', () => {
    const history = buildCycleHistory(
      'wave',
      [{ cycleId: 1, cycleNumber: 1, weeks: 4, status: 'active', currentWeek: 1 }],
      [exercise()],
      plannedWorkSets([group()], [exercise()]),
      [],
    );
    const sets = history[0].exercises[1].sets;
    expect(sets).toHaveLength(3);
    expect(sets[2]).toEqual({ weight: 100, reps: 5, unit: 'kg' });
  });
});

describe('G1 — generation: a resolved week produces pending proposals', () => {
  it('proposes the increment for met targets and a hold with a reason for the linear bench', async () => {
    const { db, executor } = await setupDemo();
    const linearCycle2 = await linearCycleId(executor, 2);
    // Routine 2 is the inactive linear routine; its cycle 2 review regenerates
    // from its own logs: the bench missed the first week of each cycle, the
    // rest met their targets.
    await generateReview(executor, 2, linearCycle2);

    expect(countWhere(db, 'Progression_Proposal', 'cycle_id = ?', linearCycle2)).toBe(8);
    const statuses = db
      .prepare('SELECT status FROM Progression_Proposal WHERE cycle_id = ?;')
      .all(linearCycle2) as { status: string }[];
    expect(statuses.every((row) => row.status === 'pending')).toBe(true);

    const bench = await proposalOf(executor, linearCycle2, 'Barbell Bench Press - Medium Grip');
    expect(bench).toMatchObject({ current_target: 60, proposed_target: 60, status: 'pending' });
    const reason = (await executor.get(
      'SELECT reason FROM Progression_Proposal WHERE cycle_id = ? AND exercise_name = ?;',
      [linearCycle2, 'Barbell Bench Press - Medium Grip'],
    )) as { reason: string };
    expect(reason.reason.length).toBeGreaterThan(0);
    expect(reason.reason).toMatch(/falt/);

    const squat = await proposalOf(executor, linearCycle2, 'Barbell Full Squat');
    expect(squat).toMatchObject({ current_target: 82.5, proposed_target: 85 });
  });

  it('leaves the wave stored reviews untouched and derives the linear consecutive-hold advisory', async () => {
    const { db, executor } = await setupDemo();
    const linearCycle2 = await linearCycleId(executor, 2);
    await resolveDemoWeek(executor, 4);
    await generateReview(executor, 1, 6);

    expect(count(db, 'Progression_Proposal')).toBe(40);
    const cycle1 = db
      .prepare('SELECT status FROM Progression_Proposal WHERE cycle_id = 1;')
      .all() as { status: string }[];
    expect(new Set(cycle1.map((row) => row.status))).toEqual(new Set(['accepted']));
    const cycle6 = db
      .prepare('SELECT status FROM Progression_Proposal WHERE cycle_id = 6;')
      .all() as { status: string }[];
    expect(cycle6.every((row) => row.status === 'pending')).toBe(true);

    // The linear routine's stored cycle-2 review derives the advisory from the
    // consecutive holds: bench was held in cycle 1 and held again in cycle 2.
    const review = await loadCycleReview(executor, 2, linearCycle2);
    expect(review.proposals).toHaveLength(8);
    const bench = review.proposals.find(
      (p) => p.exerciseName === 'Barbell Bench Press - Medium Grip',
    );
    expect(bench?.advisory).toBe(true);
    const squat = review.proposals.find((p) => p.exerciseName === 'Barbell Full Squat');
    expect(squat?.advisory).toBe(false);
  });

  it('regenerating after a generation stores nothing new', async () => {
    const { db, executor } = await setupDemo();
    const linearCycle2 = await linearCycleId(executor, 2);

    await generateReview(executor, 2, linearCycle2);
    await generateReview(executor, 2, linearCycle2);

    expect(countWhere(db, 'Progression_Proposal', 'cycle_id = ?', linearCycle2)).toBe(8);
  });
});

describe('G1 — resolve and apply: nothing changes without confirmation', () => {
  it('accept writes the plan, hold writes nothing, edit rounds the value, and the cycle completes', async () => {
    const { db, executor } = await setupDemo();
    await resolveDemoWeek(executor, 4);
    await generateReview(executor, 1, 6);

    const squat = await proposalOf(executor, 6, 'Barbell Full Squat');
    const bench = await proposalOf(executor, 6, 'Barbell Bench Press - Medium Grip');
    const deadlift = await proposalOf(executor, 6, 'Barbell Deadlift');
    const ohp = await proposalOf(executor, 6, 'Barbell Shoulder Press');
    await resolveProposal(executor, squat.proposal_id, 'accepted');
    await resolveProposal(executor, bench.proposal_id, 'held');
    await editProposalValue(executor, deadlift.proposal_id, 148, 2.5);
    await resolveProposal(executor, ohp.proposal_id, 'accepted');

    const edited = await proposalOf(executor, 6, 'Barbell Deadlift');
    expect(edited).toMatchObject({ proposed_target: 147.5, status: 'edited' });

    const before = await planWeight(executor, 1, 'Barbell Full Squat');
    expect(before.tm).toBe(120);

    const result = await applyReview(executor, 1, 6);
    expect(result.completed).toBe(true);

    const cycle = db
      .prepare('SELECT current_week, status FROM Cycles WHERE cycle_id = 6;')
      .get() as { current_week: number; status: string };
    expect(cycle).toEqual({ current_week: 4, status: 'complete' });

    expect(await planWeight(executor, 1, 'Barbell Full Squat')).toEqual({
      absolute: null,
      tm: 125,
    });
    expect(await planWeight(executor, 1, 'Barbell Bench Press - Medium Grip')).toEqual({
      absolute: null,
      tm: 82.5,
    });
    expect(await planWeight(executor, 1, 'Barbell Deadlift')).toEqual({
      absolute: null,
      tm: 147.5,
    });
    expect(await planWeight(executor, 1, 'Barbell Shoulder Press')).toEqual({
      absolute: null,
      tm: 65,
    });
  });

  it('completes the cycle at its last week and refuses while any proposal is pending', async () => {
    const { db, executor } = await setupDemo();
    await resolveDemoWeek(executor, 4);
    await generateReview(executor, 1, 6);

    await expect(applyReview(executor, 1, 6)).rejects.toThrow(/unresolved/);

    const rows = db
      .prepare('SELECT proposal_id FROM Progression_Proposal WHERE cycle_id = 6;')
      .all() as { proposal_id: number }[];
    for (const row of rows.slice(0, 3)) {
      await resolveProposal(executor, row.proposal_id, 'accepted');
    }
    await expect(applyReview(executor, 1, 6)).rejects.toThrow(/unresolved/);

    for (const row of rows.slice(3)) {
      await resolveProposal(executor, row.proposal_id, 'accepted');
    }
    const result = await applyReview(executor, 1, 6);
    expect(result.completed).toBe(true);

    const cycle = db
      .prepare('SELECT status, completed_at FROM Cycles WHERE cycle_id = 6;')
      .get() as { status: string; completed_at: number };
    expect(cycle.status).toBe('complete');
    expect(cycle.completed_at).toBeGreaterThan(0);
  });
});

describe('G1 — wave TM flow', () => {
  it('proposes the TM from the AMRAP results and accept updates training_max_weight', async () => {
    const { db, executor } = connect();
    const { routineId, cycleId } = await setupWaveFixture(db, executor, {
      week1: 5,
      week2: 3,
      week3: 5,
    });

    const review = await loadCycleReview(executor, routineId, cycleId);

    expect(review.atCycleEnd).toBe(true);
    expect(review.proposals).toHaveLength(1);
    expect(review.proposals[0]).toMatchObject({
      exerciseName: 'Bench Press',
      currentTarget: 80,
      proposedTarget: 82.5,
      unit: 'kg',
      isTmProposal: true,
      advisory: false,
      status: 'pending',
    });
    expect(review.amrap).toHaveLength(1);
    expect(review.amrap[0].rows).toEqual([
      { weekNumber: 1, reps: 5, estimated1rm: expect.any(Number) },
      { weekNumber: 2, reps: 3, estimated1rm: expect.any(Number) },
      { weekNumber: 3, reps: 5, estimated1rm: expect.any(Number) },
    ]);
    expect(review.amrap[0].rows[0].estimated1rm).toBeCloseTo(79.33, 1);
    expect(review.amrap[0].rows[2].estimated1rm).toBeCloseTo(88.67, 1);

    await resolveProposal(executor, review.proposals[0].proposalId, 'accepted');
    const result = await applyReview(executor, routineId, cycleId);
    expect(result.completed).toBe(true);

    expect(await planWeight(executor, routineId, 'Bench Press')).toEqual({ absolute: null, tm: 82.5 });
    const status = db
      .prepare('SELECT status FROM Cycles WHERE cycle_id = ?;')
      .get(cycleId) as { status: string };
    expect(status.status).toBe('complete');
  });

  it('flags an advisory on two AMRAP misses and never drops the TM', async () => {
    const { db, executor } = connect();
    const { routineId, cycleId } = await setupWaveFixture(db, executor, {
      week1: 4,
      week2: 2,
      week3: 5,
    });

    const review = await loadCycleReview(executor, routineId, cycleId);
    expect(review.proposals[0]).toMatchObject({
      proposedTarget: 80,
      advisory: true,
    });
    expect(review.proposals[0].reason).toMatch(/sin cumplir 2 objetivos/);

    await resolveProposal(executor, review.proposals[0].proposalId, 'accepted');
    await applyReview(executor, routineId, cycleId);
    expect(await planWeight(executor, routineId, 'Bench Press')).toEqual({ absolute: null, tm: 80 });
  });
});

describe('G1 — the review is stored state and survives a restart', () => {
  it('re-loads the resolved proposals from the database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sgt-g1-review-'));
    const file = join(dir, 'review.db');
    try {
      const open = (): { db: DatabaseSync; executor: TestExecutor } => {
        const db = new DatabaseSync(file);
        const executor: TestExecutor = {
          exec: (sql) => db.exec(sql),
          run: (sql, params) => {
            db.prepare(sql).run(...((params ?? []) as SQLInputValue[]));
          },
          getAll: <T>(sql: string, params: SQLInputValue[] = []) =>
            Promise.resolve(db.prepare(sql).all(...params) as T[]),
          get: <T>(sql: string, params: SQLInputValue[] = []) =>
            Promise.resolve(db.prepare(sql).get(...params) as T | undefined),
        };
        return { db, executor };
      };

      let { db, executor } = open();
      await runSchema(executor);
      await loadDemoData(demoDb(db));
      await resolveDemoWeek(executor, 4);

      const generated = await loadCycleReview(executor, 1, 6);
      expect(generated.proposals).toHaveLength(4);

      const squat = await proposalOf(executor, 6, 'Barbell Full Squat');
      const bench = await proposalOf(executor, 6, 'Barbell Bench Press - Medium Grip');
      const deadlift = await proposalOf(executor, 6, 'Barbell Deadlift');
      await resolveProposal(executor, squat.proposal_id, 'accepted');
      await resolveProposal(executor, bench.proposal_id, 'held');
      await editProposalValue(executor, deadlift.proposal_id, 148, 2.5);
      db.close();

      ({ db, executor } = open());
      const resumed = await loadCycleReview(executor, 1, 6);
      expect(resumed.proposals).toHaveLength(4);
      expect(countWhere(db, 'Progression_Proposal', 'cycle_id = 6 AND status = \'pending\'')).toBe(1);

      const squatView = resumed.proposals.find((p) => p.exerciseName === 'Barbell Full Squat');
      expect(squatView).toMatchObject({ status: 'accepted', proposedTarget: 125 });
      const benchView = resumed.proposals.find(
        (p) => p.exerciseName === 'Barbell Bench Press - Medium Grip',
      );
      expect(benchView).toMatchObject({ status: 'held', advisory: false });
      const deadliftView = resumed.proposals.find((p) => p.exerciseName === 'Barbell Deadlift');
      expect(deadliftView).toMatchObject({ status: 'edited', proposedTarget: 147.5 });
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('G1 — the next cycle is generated only on explicit action', () => {
  it('startNextCycle inserts the new cycle, its weeks and pending sessions', async () => {
    const { db, executor } = await setupDemo();
    await resolveDemoWeek(executor, 4);
    await generateReview(executor, 1, 6);
    const rows = db
      .prepare('SELECT proposal_id FROM Progression_Proposal WHERE cycle_id = 6;')
      .all() as { proposal_id: number }[];
    for (const row of rows) {
      await resolveProposal(executor, row.proposal_id, 'accepted');
    }
    await applyReview(executor, 1, 6);

    const newCycleId = await startNextCycle(executor, 1, 6);

    // 6 wave cycles + 2 linear cycles + the new one.
    expect(count(db, 'Cycles')).toBe(9);
    const cycle = db
      .prepare('SELECT * FROM Cycles WHERE cycle_id = ?;')
      .get(newCycleId) as Record<string, unknown>;
    expect(cycle).toMatchObject({
      routine_id: 1,
      cycle_number: 7,
      weeks: 4,
      status: 'active',
      current_week: 1,
    });
    expect(countWhere(db, 'CycleWeeks', 'cycle_id = ?', newCycleId)).toBe(4);
    expect(countWhere(db, 'WeekSessions', 'cycle_week_id IN (SELECT cycle_week_id FROM CycleWeeks WHERE cycle_id = ?) AND status = \'pending\'', newCycleId)).toBe(16);

    expect(await planWeight(executor, 1, 'Barbell Full Squat')).toEqual({ absolute: null, tm: 125 });
  });

  it('refuses to start a next cycle before the current one is complete', async () => {
    const { executor } = await setupDemo();
    await expect(startNextCycle(executor, 1, 6)).rejects.toThrow(/not complete/);
  });
});

describe('G1 — the Today entry point', () => {
  it('surfaces the review when the current week is resolved and hides it otherwise', async () => {
    const { executor } = await setupDemo();
    expect(await loadReviewEntry(executor)).toBeNull();

    await resolveDemoWeek(executor, 4);
    const entry = await loadReviewEntry(executor);
    expect(entry).toEqual({
      routineId: 1,
      cycleId: 6,
      cycleNumber: 6,
      currentWeek: 4,
      routineName: 'Demo Routine',
    });

    await generateReview(executor, 1, 6);
    const resumed = await loadReviewEntry(executor);
    expect(resumed?.cycleId).toBe(6);
  });
});

describe('F2 — the shipped 531 preset does not corrupt its own review', () => {
  const TODAY = Math.floor(Date.UTC(2026, 7, 14, 12, 0, 0) / 1000);

  /**
   * One week of the real '531' preset, logged through the real
   * `saveSessionLog` write path: every main lift's three sets (weight 100,
   * last set's reps = `mainAmrapReps`) and its FSL back-off's five sets
   * (weight 70, reps always 3 — deliberately different from the main's
   * AMRAP reps, so a grouping bug that merges the two blocks is caught).
   * Bodyweight/absolute accessories are left as the runner's own default
   * (§7.3) — untouched is a real, supported way to finish a session.
   */
  const logWeek531 = async (
    executor: TestExecutor,
    routineId: number,
    cycleId: number,
    weekNumber: number,
    mainAmrapReps: number,
  ): Promise<void> => {
    const weekSessions = await executor.getAll<{ week_session_id: number }>(
      `SELECT ws.week_session_id FROM WeekSessions ws
       JOIN CycleWeeks cw ON cw.cycle_week_id = ws.cycle_week_id
       WHERE cw.cycle_id = ? AND cw.week_number = ? AND ws.status = 'pending'
       ORDER BY ws.week_session_id;`,
      [cycleId, weekNumber],
    );
    expect(weekSessions.length).toBe(4);
    // Workout_Log is UNIQUE(workout_date, day_name, workout_name) — each week
    // needs its own calendar day so four weeks of the same day names (Bench,
    // Squat, Press, Deadlift) don't collide.
    const weekStamp = TODAY + (weekNumber - 1) * 7 * 86400;

    for (const { week_session_id: weekSessionId } of weekSessions) {
      const session: RunnerSession = await loadRunnerSession(executor, weekSessionId, weekStamp);
      const mainIndex = session.exercises.findIndex((exercise) => exercise.role === 'main');
      const fslIndex = session.exercises.findIndex(
        (exercise) => exercise.role === 'accessory' && exercise.loadSource === 'training_max_pct',
      );
      expect(mainIndex).toBeGreaterThanOrEqual(0);
      expect(fslIndex).toBeGreaterThanOrEqual(0);

      const draft = buildPlannedDraft(session);
      draft[mainIndex] = [
        { reps: 5, weight: 100 },
        { reps: 5, weight: 100 },
        { reps: mainAmrapReps, weight: 100 },
      ];
      draft[fslIndex] = [
        { reps: 3, weight: 70 },
        { reps: 3, weight: 70 },
        { reps: 3, weight: 70 },
        { reps: 3, weight: 70 },
        { reps: 3, weight: 70 },
      ];

      await saveSessionLog(executor, weekSessionId, session, draft);
    }
  };

  /** Accepts every pending proposal of the cycle and advances/completes it. */
  const acceptWeekReview = async (
    executor: TestExecutor,
    routineId: number,
    cycleId: number,
  ): Promise<void> => {
    await generateReview(executor, routineId, cycleId);
    const pending = await executor.getAll<{ proposal_id: number }>(
      `SELECT proposal_id FROM Progression_Proposal WHERE cycle_id = ? AND status = 'pending';`,
      [cycleId],
    );
    for (const { proposal_id: proposalId } of pending) {
      await resolveProposal(executor, proposalId, 'accepted');
    }
    await applyReview(executor, routineId, cycleId);
  };

  it(
    'reads the main lift\'s last work set as the AMRAP for all four lifts — ' +
      "not the FSL back-off row that shares its catalog exercise",
    async () => {
      const { executor } = connect();
      await runSchema(executor);
      const { routineId } = await activatePresetRoutine(executor, '531', 'kg', new Map());
      const cycleRow = await executor.get(
        `SELECT cycle_id FROM Cycles WHERE routine_id = ? AND status = 'active';`,
        [routineId],
      );
      if (cycleRow === undefined) {
        throw new Error('531 preset activation did not seed a cycle');
      }
      const cycleId = Number(cycleRow.cycle_id);

      // Weeks 1-3: log the real preset's four sessions, then resolve and
      // apply that week's review so the cycle reaches week 4 — the real
      // path a maintainer's phone would have gone through, not a shortcut.
      const weekAmrapReps = [8, 6, 4];
      for (const [index, reps] of weekAmrapReps.entries()) {
        await logWeek531(executor, routineId, cycleId, index + 1, reps);
        await acceptWeekReview(executor, routineId, cycleId);
      }
      // Week 4 (deload) has no AMRAP set, but its sessions must resolve too —
      // atCycleEnd's review is due only once the current week has no pending
      // sessions left.
      await logWeek531(executor, routineId, cycleId, 4, 5);

      const review = await loadCycleReview(executor, routineId, cycleId);
      expect(review.atCycleEnd).toBe(true);
      expect(review.amrap.length).toBe(4);
      for (const lift of review.amrap) {
        expect(lift.rows.map((row) => row.reps)).toEqual(weekAmrapReps);
      }

      // The corruption the audit found is not only "main shows the wrong
      // AMRAP" — merging the two blocks means the FSL row's OWN cycle-end
      // proposal reads main's 100 kg/AMRAP-rep sets instead of its own real
      // 70 kg/3-rep sets. This holds regardless of which of the two rows a
      // SQL tie-break for an equal set_number happens to sort first, since
      // main's first two sets (set_number 1-2) are never in dispute either
      // way and would still leak into the FSL group under the bug.
      const fslProposals = await executor.getAll<{
        session_exercise_id: number;
        reason: string;
      }>(
        `SELECT session_exercise_id, reason FROM Progression_Proposal
         WHERE cycle_id = ? AND session_exercise_id IN (
           SELECT session_exercise_id FROM SessionExercises
           WHERE role = 'accessory' AND load_source = 'training_max_pct'
         );`,
        [cycleId],
      );
      expect(fslProposals.length).toBe(4);
      for (const proposal of fslProposals) {
        expect(proposal.reason).toContain('70 kg');
        expect(proposal.reason).not.toContain('100 kg');
      }
    },
  );
});
