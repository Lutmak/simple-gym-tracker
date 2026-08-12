import {
  type SQLiteBindParams,
  type SQLiteRunResult,
} from 'expo-sqlite';

import {
  decideFiveThreeOneCycleProgress,
  generateFiveThreeOneCyclePlan,
  type FiveThreeOneCycleProgressDecision,
  type FiveThreeOneGenerationSource,
} from './fiveThreeOneGeneration';

export interface FiveThreeOneDatabase {
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
  runAsync(source: string, params: SQLiteBindParams): Promise<SQLiteRunResult>;
  getFirstAsync<T>(source: string, params: SQLiteBindParams): Promise<T | null>;
  getAllAsync<T>(source: string, params: SQLiteBindParams): Promise<T[]>;
}

export interface FiveThreeOneGenerationResult {
  created: boolean;
  cycleId: number;
  cycleNumber: number;
  weekCount: number;
  workoutCount: number;
}

export interface FiveThreeOneSessionProgressResult {
  applicable: boolean;
  cycleId: number | null;
  currentWeek: number | null;
  nextWeek: number | null;
  advanced: boolean;
  cycleComplete: boolean;
}

interface ProgramRow {
  program_id: number;
  program_name: string;
  unit: string;
  rounding_increment: number;
  rounding_direction: string;
  include_deload: number;
  warmup_enabled: number;
}

interface LiftRow {
  lift_id: number;
  lift_name: string;
  lift_type: string;
  training_max: number;
  day_slot: number;
  assistance_template_id: number | null;
}

interface TemplateRow {
  template_id: number;
  template_name: string;
}

interface AssistanceExerciseRow {
  assistance_exercise_id: number;
  template_id: number;
  exercise_name: string;
  sets: number;
  reps: number;
  sort_order: number;
}

interface CycleRow {
  cycle_id: number;
  cycle_number: number;
  status: 'planned' | 'active' | 'complete';
  current_week: number;
  include_deload: number;
}

interface SessionLinkRow {
  cycle_id: number;
  workout_id: number;
  day_id: number;
  week_number: number;
  current_week: number;
  include_deload: number;
}

interface DayIdRow {
  day_id: number;
}

const assertPositiveId = (value: number, label: string): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
};

const booleanFromDatabase = (value: number, label: string): boolean => {
  if (value !== 0 && value !== 1) {
    throw new Error(`${label} must be 0 or 1.`);
  }
  return value === 1;
};

const cycleResult = (
  created: boolean,
  cycle: CycleRow,
  weekCount: number,
): FiveThreeOneGenerationResult => ({
  created,
  cycleId: cycle.cycle_id,
  cycleNumber: cycle.cycle_number,
  weekCount,
  workoutCount: weekCount,
});

export async function loadFiveThreeOneGenerationSource(
  db: FiveThreeOneDatabase,
  programId: number,
): Promise<FiveThreeOneGenerationSource> {
  assertPositiveId(programId, 'Program ID');

  const program = await db.getFirstAsync<ProgramRow>(
    `SELECT program_id, program_name, unit, rounding_increment, rounding_direction,
            include_deload, warmup_enabled
     FROM FiveThreeOne_Programs
     WHERE program_id = ?;`,
    [programId],
  );
  if (!program) {
    throw new Error('The selected 5/3/1 program was not found.');
  }

  const lifts = await db.getAllAsync<LiftRow>(
    `SELECT lift_id, lift_name, lift_type, training_max, day_slot, assistance_template_id
     FROM FiveThreeOne_Lifts
     WHERE program_id = ?
     ORDER BY day_slot;`,
    [programId],
  );
  if (lifts.length === 0) {
    throw new Error('The selected 5/3/1 program has no configured lifts.');
  }

  const templateIds = lifts
    .map((lift) => lift.assistance_template_id)
    .filter((templateId): templateId is number => templateId !== null);
  const uniqueTemplateIds = [...new Set(templateIds)];
  let templateRows: TemplateRow[] = [];
  let exerciseRows: AssistanceExerciseRow[] = [];

  if (uniqueTemplateIds.length > 0) {
    const placeholders = uniqueTemplateIds.map(() => '?').join(', ');
    templateRows = await db.getAllAsync<TemplateRow>(
      `SELECT template_id, template_name
       FROM FiveThreeOne_AssistanceTemplates
       WHERE template_id IN (${placeholders});`,
      uniqueTemplateIds,
    );
    exerciseRows = await db.getAllAsync<AssistanceExerciseRow>(
      `SELECT assistance_exercise_id, template_id, exercise_name, sets, reps, sort_order
       FROM FiveThreeOne_AssistanceExercises
       WHERE template_id IN (${placeholders})
       ORDER BY template_id, sort_order;`,
      uniqueTemplateIds,
    );
  }

  return {
    program: {
      programId: program.program_id,
      name: program.program_name,
      unit: program.unit as FiveThreeOneGenerationSource['program']['unit'],
      roundingIncrement: program.rounding_increment,
      roundingDirection:
        program.rounding_direction as FiveThreeOneGenerationSource['program']['roundingDirection'],
      includeDeload: booleanFromDatabase(program.include_deload, 'Program deload setting'),
      warmupEnabled: booleanFromDatabase(program.warmup_enabled, 'Program warm-up setting'),
    },
    lifts: lifts.map((lift) => ({
      liftId: lift.lift_id,
      name: lift.lift_name,
      category: lift.lift_type as FiveThreeOneGenerationSource['lifts'][number]['category'],
      trainingMax: lift.training_max,
      daySlot: lift.day_slot,
      assistanceTemplateId: lift.assistance_template_id,
    })),
    assistanceTemplates: templateRows.map((template) => ({
      templateId: template.template_id,
      name: template.template_name,
      exercises: exerciseRows
        .filter((exercise) => exercise.template_id === template.template_id)
        .map((exercise) => ({
          assistanceExerciseId: exercise.assistance_exercise_id,
          name: exercise.exercise_name,
          sets: exercise.sets,
          reps: exercise.reps,
          sortOrder: exercise.sort_order,
        })),
    })),
  };
}

export async function generateFiveThreeOneCycle(
  db: FiveThreeOneDatabase,
  source: FiveThreeOneGenerationSource,
): Promise<FiveThreeOneGenerationResult> {
  // Validate the persisted shape before opening a write transaction.
  generateFiveThreeOneCyclePlan({
    source,
    cycle: { cycleNumber: 1, includeDeload: source.program.includeDeload },
  });

  let result: FiveThreeOneGenerationResult | null = null;
  await db.withTransactionAsync(async () => {
    const existingCycle = await db.getFirstAsync<CycleRow>(
      `SELECT cycle_id, cycle_number, status, current_week, include_deload
       FROM FiveThreeOne_Cycles
       WHERE program_id = ?
       ORDER BY cycle_number DESC
       LIMIT 1;`,
      [source.program.programId],
    );

    if (existingCycle && existingCycle.status !== 'complete') {
      const includeDeload = booleanFromDatabase(existingCycle.include_deload, 'Cycle deload setting');
      const existingPlan = generateFiveThreeOneCyclePlan({
        source,
        cycle: { cycleNumber: existingCycle.cycle_number, includeDeload },
      });
      result = cycleResult(false, existingCycle, existingPlan.weeks.length);
      return;
    }

    const cycleNumber = (existingCycle?.cycle_number ?? 0) + 1;
    const includeDeload = source.program.includeDeload;
    const plan = generateFiveThreeOneCyclePlan({
      source,
      cycle: { cycleNumber, includeDeload },
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const cycleInsert = await db.runAsync(
      `INSERT INTO FiveThreeOne_Cycles
       (program_id, cycle_number, status, current_week, include_deload, started_at)
       VALUES (?, ?, ?, ?, ?, ?);`,
      [source.program.programId, cycleNumber, 'active', 1, includeDeload ? 1 : 0, timestamp],
    );
    assertPositiveId(cycleInsert.lastInsertRowId, 'Generated cycle ID');

    for (const week of plan.weeks) {
      const workoutInsert = await db.runAsync(
        'INSERT INTO Workouts (workout_name) VALUES (?);',
        [week.workoutName],
      );
      assertPositiveId(workoutInsert.lastInsertRowId, 'Generated workout ID');

      for (const day of week.days) {
        const dayInsert = await db.runAsync(
          'INSERT INTO Days (workout_id, day_name) VALUES (?, ?);',
          [workoutInsert.lastInsertRowId, day.dayName],
        );
        assertPositiveId(dayInsert.lastInsertRowId, 'Generated day ID');

        const mainLiftInsert = await db.runAsync(
          `INSERT INTO Exercises (day_id, exercise_name, sets, reps)
           VALUES (?, ?, ?, ?);`,
          [
            dayInsert.lastInsertRowId,
            day.mainLift.exerciseName,
            day.mainLift.sets,
            day.mainLift.reps,
          ],
        );
        assertPositiveId(mainLiftInsert.lastInsertRowId, 'Generated main exercise ID');
        const configuredLift = source.lifts.find((lift) => lift.liftId === day.liftId);
        if (!configuredLift) {
          throw new Error(`Configured lift ${day.liftId} was not found while persisting the cycle.`);
        }

        for (const assistance of day.assistanceExercises) {
          await db.runAsync(
            `INSERT INTO Exercises (day_id, exercise_name, sets, reps)
             VALUES (?, ?, ?, ?);`,
            [dayInsert.lastInsertRowId, assistance.exerciseName, assistance.sets, assistance.reps],
          );
        }

        for (const link of day.mainLift.links) {
          if (!link.isWarmup && link.workSetNumber === null) {
            throw new Error(`Work set ${link.setNumber} is missing its work-set number.`);
          }

          await db.runAsync(
            `INSERT INTO FiveThreeOne_WorkoutLink
             (cycle_id, lift_id, workout_id, day_id, exercise_id, workout_log_id, weight_log_id,
              week_number, set_number, work_set_number, training_max, percentage, target_weight,
              target_reps, is_amrap, is_warmup, warmup_completed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
              cycleInsert.lastInsertRowId,
              day.liftId,
              workoutInsert.lastInsertRowId,
              dayInsert.lastInsertRowId,
              link.isWarmup ? null : mainLiftInsert.lastInsertRowId,
              null,
              null,
              week.weekNumber,
              link.setNumber,
              link.workSetNumber,
              configuredLift.trainingMax,
              link.percent / 100,
              link.targetWeight,
              link.targetReps,
              link.isAmrap ? 1 : 0,
              link.isWarmup ? 1 : 0,
              null,
            ],
          );
        }
      }
    }

    const generatedCycle: CycleRow = {
      cycle_id: cycleInsert.lastInsertRowId,
      cycle_number: cycleNumber,
      status: 'active',
      current_week: 1,
      include_deload: includeDeload ? 1 : 0,
    };
    result = cycleResult(true, generatedCycle, plan.weeks.length);
  });

  if (!result) {
    throw new Error('The 5/3/1 cycle generation did not return a result.');
  }
  return result;
}

const progressResult = (
  cycleId: number,
  currentWeek: number,
  decision: FiveThreeOneCycleProgressDecision,
): FiveThreeOneSessionProgressResult => ({
  applicable: true,
  cycleId,
  currentWeek,
  nextWeek: decision.nextWeek,
  advanced: decision.advanced,
  cycleComplete: decision.cycleComplete,
});

export async function advanceFiveThreeOneCycleAfterSession(
  db: FiveThreeOneDatabase,
  workoutLogId: number,
): Promise<FiveThreeOneSessionProgressResult> {
  assertPositiveId(workoutLogId, 'Workout log ID');
  const sessionLink = await db.getFirstAsync<SessionLinkRow>(
    `SELECT wl.cycle_id, wl.workout_id, wl.day_id, wl.week_number,
            c.current_week, c.include_deload
     FROM FiveThreeOne_WorkoutLink wl
     JOIN FiveThreeOne_Cycles c ON c.cycle_id = wl.cycle_id
     JOIN Workouts w ON w.workout_id = wl.workout_id
     JOIN Days d ON d.day_id = wl.day_id
     JOIN Workout_Log log
       ON log.workout_name = w.workout_name
      AND log.day_name = d.day_name
     WHERE log.workout_log_id = ?
       AND wl.is_warmup = 0
       AND wl.week_number = c.current_week
       AND c.status <> 'complete'
     LIMIT 1;`,
    [workoutLogId],
  );

  if (!sessionLink) {
    return {
      applicable: false,
      cycleId: null,
      currentWeek: null,
      nextWeek: null,
      advanced: false,
      cycleComplete: false,
    };
  }

  await db.runAsync(
    `UPDATE FiveThreeOne_WorkoutLink
     SET workout_log_id = ?
     WHERE cycle_id = ?
       AND workout_id = ?
       AND day_id = ?
       AND week_number = ?
       AND is_warmup = 0;`,
    [
      workoutLogId,
      sessionLink.cycle_id,
      sessionLink.workout_id,
      sessionLink.day_id,
      sessionLink.week_number,
    ],
  );

  const expectedDays = await db.getAllAsync<DayIdRow>(
    `SELECT DISTINCT day_id
     FROM FiveThreeOne_WorkoutLink
     WHERE cycle_id = ? AND week_number = ? AND is_warmup = 0 AND day_id IS NOT NULL;`,
    [sessionLink.cycle_id, sessionLink.current_week],
  );
  const loggedDays = await db.getAllAsync<DayIdRow>(
    `SELECT DISTINCT day_id
     FROM FiveThreeOne_WorkoutLink
     WHERE cycle_id = ? AND week_number = ? AND is_warmup = 0
       AND day_id IS NOT NULL AND workout_log_id IS NOT NULL;`,
    [sessionLink.cycle_id, sessionLink.current_week],
  );
  const decision = decideFiveThreeOneCycleProgress({
    currentWeek: sessionLink.current_week,
    includeDeload: booleanFromDatabase(sessionLink.include_deload, 'Cycle deload setting'),
    expectedDayIds: expectedDays.map((day) => day.day_id),
    loggedDayIds: loggedDays.map((day) => day.day_id),
  });

  if (decision.advanced) {
    await db.runAsync(
      `UPDATE FiveThreeOne_Cycles
       SET current_week = ?, status = ?, completed_at = ?
       WHERE cycle_id = ?;`,
      [
        decision.nextWeek,
        decision.cycleComplete ? 'complete' : 'active',
        decision.cycleComplete ? Math.floor(Date.now() / 1000) : null,
        sessionLink.cycle_id,
      ],
    );
  }

  return progressResult(sessionLink.cycle_id, sessionLink.current_week, decision);
}
