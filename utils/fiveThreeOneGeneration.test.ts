import {
  decideFiveThreeOneCycleProgress,
  generateFiveThreeOneCyclePlan,
  type FiveThreeOneGenerationSource,
} from './fiveThreeOneGeneration';
import {
  generateFiveThreeOneCycle,
  type FiveThreeOneDatabase,
} from './fiveThreeOneGenerationPersistence';
import type { SQLiteBindParams } from 'expo-sqlite';

const assistanceExercises = [
  { name: 'Dumbbell Row', sets: 5, reps: 10, sortOrder: 1 },
  { name: 'Dips', sets: 3, reps: 12, sortOrder: 2 },
];

const source: FiveThreeOneGenerationSource = {
  program: {
    programId: 7,
    name: 'Strength',
    unit: 'kg',
    roundingIncrement: 2.5,
    roundingDirection: 'nearest',
    includeDeload: true,
  },
  lifts: [
    {
      liftId: 11,
      name: 'Squat',
      category: 'lower',
      trainingMax: 100,
      daySlot: 1,
      warmupEnabled: true,
      assistanceExercises,
    },
    {
      liftId: 12,
      name: 'Bench Press',
      category: 'upper',
      trainingMax: 60,
      daySlot: 2,
      warmupEnabled: true,
      assistanceExercises,
    },
  ],
};

describe('fiveThreeOneGeneration', () => {
  it('generates all three waves and an optional deload with isolated warmups', () => {
    const plan = generateFiveThreeOneCyclePlan({
      source,
      cycle: { cycleNumber: 1, includeDeload: true },
    });

    expect(plan.weeks.map((week) => week.weekNumber)).toEqual([1, 2, 3, 4]);

    const squatLinks = plan.weeks.map((week) =>
      week.days[0]?.mainLift.links.filter((link) => !link.isWarmup),
    );
    expect(squatLinks).toEqual([
      [
        { setNumber: 4, workSetNumber: 1, percent: 65, targetWeight: 65, targetReps: 5, isAmrap: false, isWarmup: false },
        { setNumber: 5, workSetNumber: 2, percent: 75, targetWeight: 75, targetReps: 5, isAmrap: false, isWarmup: false },
        { setNumber: 6, workSetNumber: 3, percent: 85, targetWeight: 85, targetReps: 5, isAmrap: true, isWarmup: false },
      ],
      [
        { setNumber: 4, workSetNumber: 1, percent: 70, targetWeight: 70, targetReps: 3, isAmrap: false, isWarmup: false },
        { setNumber: 5, workSetNumber: 2, percent: 80, targetWeight: 80, targetReps: 3, isAmrap: false, isWarmup: false },
        { setNumber: 6, workSetNumber: 3, percent: 90, targetWeight: 90, targetReps: 3, isAmrap: true, isWarmup: false },
      ],
      [
        { setNumber: 4, workSetNumber: 1, percent: 75, targetWeight: 75, targetReps: 5, isAmrap: false, isWarmup: false },
        { setNumber: 5, workSetNumber: 2, percent: 85, targetWeight: 85, targetReps: 3, isAmrap: false, isWarmup: false },
        { setNumber: 6, workSetNumber: 3, percent: 95, targetWeight: 95, targetReps: 1, isAmrap: true, isWarmup: false },
      ],
      [
        { setNumber: 4, workSetNumber: 1, percent: 40, targetWeight: 40, targetReps: 5, isAmrap: false, isWarmup: false },
        { setNumber: 5, workSetNumber: 2, percent: 50, targetWeight: 50, targetReps: 5, isAmrap: false, isWarmup: false },
        { setNumber: 6, workSetNumber: 3, percent: 60, targetWeight: 60, targetReps: 5, isAmrap: false, isWarmup: false },
      ],
    ]);

    const warmups = plan.weeks[0]?.days[0]?.mainLift.links.filter((link) => link.isWarmup);
    expect(warmups).toEqual([
      { setNumber: 1, workSetNumber: null, percent: 40, targetWeight: 40, targetReps: 5, isAmrap: false, isWarmup: true },
      { setNumber: 2, workSetNumber: null, percent: 50, targetWeight: 50, targetReps: 5, isAmrap: false, isWarmup: true },
      { setNumber: 3, workSetNumber: null, percent: 60, targetWeight: 60, targetReps: 3, isAmrap: false, isWarmup: true },
    ]);
    expect(plan.weeks[0]?.days[0]?.mainLift.links.map((link) => link.workSetNumber)).toEqual([
      null,
      null,
      null,
      1,
      2,
      3,
    ]);
  });

  it('omits the deload when the cycle does not include one', () => {
    const plan = generateFiveThreeOneCyclePlan({
      source: {
        ...source,
        program: { ...source.program, includeDeload: false },
      },
      cycle: { cycleNumber: 2, includeDeload: false },
    });

    expect(plan.weeks.map((week) => week.weekNumber)).toEqual([1, 2, 3]);
  });

  it('expands assistance exercises as ordinary exercise shapes', () => {
    const day = generateFiveThreeOneCyclePlan({
      source,
      cycle: { cycleNumber: 1, includeDeload: true },
    }).weeks[0]?.days[0];

    expect(day?.assistanceExercises).toEqual([
      { exerciseName: 'Dumbbell Row', sets: 5, reps: 10 },
      { exerciseName: 'Dips', sets: 3, reps: 12 },
    ]);
  });

  it('orders assistance by sort order and accepts a day with none', () => {
    const days = generateFiveThreeOneCyclePlan({
      source: {
        ...source,
        lifts: [
          {
            ...source.lifts[0],
            assistanceExercises: [
              { name: 'Dips', sets: 3, reps: 12, sortOrder: 2 },
              { name: 'Dumbbell Row', sets: 5, reps: 10, sortOrder: 1 },
            ],
          },
          { ...source.lifts[1], assistanceExercises: [] },
        ],
      },
      cycle: { cycleNumber: 1, includeDeload: true },
    }).weeks[0]?.days;

    expect(days?.[0]?.assistanceExercises.map((exercise) => exercise.exerciseName)).toEqual([
      'Dumbbell Row',
      'Dips',
    ]);
    expect(days?.[1]?.assistanceExercises).toEqual([]);
  });

  it('generates warm-ups per day rather than per program', () => {
    const days = generateFiveThreeOneCyclePlan({
      source: {
        ...source,
        lifts: [
          { ...source.lifts[0], warmupEnabled: true },
          { ...source.lifts[1], warmupEnabled: false },
        ],
      },
      cycle: { cycleNumber: 1, includeDeload: true },
    }).weeks[0]?.days;

    expect(days?.[0]?.mainLift.links.filter((link) => link.isWarmup)).toHaveLength(3);
    expect(days?.[1]?.mainLift.links.filter((link) => link.isWarmup)).toHaveLength(0);
    expect(days?.[1]?.mainLift.links.map((link) => link.setNumber)).toEqual([1, 2, 3]);
  });

  it('rejects a duplicated assistance sort order, which the unique index would reject too', () => {
    expect(() =>
      generateFiveThreeOneCyclePlan({
        source: {
          ...source,
          lifts: [
            {
              ...source.lifts[0],
              assistanceExercises: [
                { name: 'Dips', sets: 3, reps: 12, sortOrder: 1 },
                { name: 'Dumbbell Row', sets: 5, reps: 10, sortOrder: 1 },
              ],
            },
          ],
        },
        cycle: { cycleNumber: 1, includeDeload: true },
      }),
    ).toThrow('Assistance sort order 1 is duplicated for Squat.');
  });

  it('decides completion from expected and logged days rather than calendar time', () => {
    expect(
      decideFiveThreeOneCycleProgress({
        currentWeek: 1,
        includeDeload: true,
        expectedDayIds: [10, 11],
        loggedDayIds: [10],
      }),
    ).toEqual({ advanced: false, nextWeek: 1, cycleComplete: false });

    expect(
      decideFiveThreeOneCycleProgress({
        currentWeek: 1,
        includeDeload: true,
        expectedDayIds: [10, 11],
        loggedDayIds: [11, 10, 10],
      }),
    ).toEqual({ advanced: true, nextWeek: 2, cycleComplete: false });

    expect(
      decideFiveThreeOneCycleProgress({
        currentWeek: 3,
        includeDeload: false,
        expectedDayIds: [10],
        loggedDayIds: [10],
      }),
    ).toEqual({ advanced: true, nextWeek: 3, cycleComplete: true });

    expect(
      decideFiveThreeOneCycleProgress({
        currentWeek: 4,
        includeDeload: true,
        expectedDayIds: [10],
        loggedDayIds: [10],
      }),
    ).toEqual({ advanced: true, nextWeek: 4, cycleComplete: true });
  });

  it('does not duplicate a generated cycle when the public persistence call is retried', async () => {
    const database = new GenerationDatabaseFake();

    const first = await generateFiveThreeOneCycle(database, source);
    const second = await generateFiveThreeOneCycle(database, source);

    expect(first.created).toBe(true);
    expect(second).toEqual({
      created: false,
      cycleId: first.cycleId,
      cycleNumber: 1,
      weekCount: 4,
      workoutCount: 4,
    });
    expect(database.cycleInsertCount).toBe(1);
    expect(database.workoutInsertCount).toBe(4);
    expect(database.sqlStatements.some((statement) => statement.includes('Weight_Log'))).toBe(false);
    expect(database.linkParams.slice(0, 6).map((params) => Array.isArray(params) ? params.slice(4, 10) : params)).toEqual([
      [null, null, null, 1, 1, null],
      [null, null, null, 1, 2, null],
      [null, null, null, 1, 3, null],
      [4, null, null, 1, 4, 1],
      [4, null, null, 1, 5, 2],
      [4, null, null, 1, 6, 3],
    ]);
  });

  it('refuses a next cycle while any completed-cycle suggestion is unresolved', async () => {
    const database = new GenerationDatabaseFake();
    await generateFiveThreeOneCycle(database, source);
    database.markCycleComplete([
      { suggested_training_max: 105, suggestion_status: 'accepted' },
      { suggested_training_max: null, suggestion_status: 'pending' },
    ]);

    await expect(generateFiveThreeOneCycle(database, source)).rejects.toThrow(
      'Resolve every lift suggestion before generating the next cycle.',
    );
    expect(database.cycleInsertCount).toBe(1);
  });
});

class GenerationDatabaseFake implements FiveThreeOneDatabase {
  cycleInsertCount = 0;
  workoutInsertCount = 0;
  nextId = 1;
  sqlStatements: string[] = [];
  linkParams: SQLiteBindParams[] = [];
  private cycle: {
    cycle_id: number;
    cycle_number: number;
    status: 'active' | 'complete';
    include_deload: number;
  } | null = null;
  private suggestions: Array<{
    suggested_training_max: number | null;
    suggestion_status: 'pending' | 'accepted' | 'edited' | 'declined' | null;
  }> = [];

  markCycleComplete(
    suggestions: Array<{
      suggested_training_max: number | null;
      suggestion_status: 'pending' | 'accepted' | 'edited' | 'declined' | null;
    }>,
  ): void {
    if (!this.cycle) {
      throw new Error('A cycle must be generated before it can be completed.');
    }
    this.cycle = { ...this.cycle, status: 'complete' };
    this.suggestions = suggestions;
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    await task();
  }

  async runAsync(
    sql: string,
    params: SQLiteBindParams = [],
  ): Promise<{ lastInsertRowId: number; changes: number }> {
    this.sqlStatements.push(sql);
    if (sql.includes('INSERT INTO FiveThreeOne_WorkoutLink')) {
      this.linkParams.push(params);
    }
    if (sql.includes('INSERT INTO FiveThreeOne_Cycles')) {
      this.cycleInsertCount += 1;
      const cycleId = this.nextId++;
      this.cycle = { cycle_id: cycleId, cycle_number: 1, status: 'active', include_deload: 1 };
      return { lastInsertRowId: cycleId, changes: 1 };
    }
    if (sql.includes('INSERT INTO Workouts')) {
      this.workoutInsertCount += 1;
    }
    if (sql.includes('UPDATE FiveThreeOne_Lifts')) {
      return { lastInsertRowId: 0, changes: 1 };
    }
    return { lastInsertRowId: this.nextId++, changes: 1 };
  }

  async getFirstAsync<T>(sql: string): Promise<T | null> {
    if (sql.includes('FROM FiveThreeOne_Cycles')) {
      return this.cycle as T | null;
    }
    throw new Error(`Unexpected first-row query: ${sql}`);
  }

  async getAllAsync<T>(sql: string): Promise<T[]> {
    if (sql.includes('FROM FiveThreeOne_Lifts')) {
      return this.suggestions as T[];
    }
    throw new Error(`Unexpected all-rows query: ${sql}`);
  }
}
