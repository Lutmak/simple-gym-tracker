import type { SQLiteBindParams } from 'expo-sqlite';

import {
  loadFiveThreeOneCycleReview,
  saveFiveThreeOneSuggestionDecision,
} from './fiveThreeOneProgressionPersistence';
import type { FiveThreeOneDatabase } from './fiveThreeOneGenerationPersistence';

describe('fiveThreeOneProgressionPersistence', () => {
  it('prepares a scoped pending review idempotently without changing training max', async () => {
    const database = new ReviewDatabaseFake();

    const firstReview = await loadFiveThreeOneCycleReview(database, 7, 42);
    const secondReview = await loadFiveThreeOneCycleReview(database, 7, 42);

    expect(firstReview.lifts[0]).toMatchObject({
      liftId: 11,
      currentTM: 180,
      results: [{ targetReps: 5, actualReps: 6, weight: 150, estimated1RM: 180 }],
      suggestion: { suggestedTM: 185, status: 'pending' },
    });
    expect(secondReview.lifts[0]?.suggestion).toMatchObject({ suggestedTM: 185, status: 'pending' });
    expect(database.writes).toHaveLength(1);
    expect(database.writes[0]?.sql).not.toMatch(/SET training_max\s*=/);
    expect(database.writes[0]?.params).toEqual([185, 7, 11]);
  });

  it('declines a suggestion without writing a new training max', async () => {
    const database = new ReviewDatabaseFake();
    await loadFiveThreeOneCycleReview(database, 7, 42);
    const originalTrainingMax = database.lift.training_max;

    const result = await saveFiveThreeOneSuggestionDecision(database, {
      programId: 7,
      cycleId: 42,
      liftId: 11,
      decision: 'decline',
    });

    expect(result).toEqual({ trainingMax: 180, suggestedTM: 185, status: 'declined' });
    expect(database.lift.training_max).toBe(originalTrainingMax);
    expect(database.lift.suggestion_status).toBe('declined');
    expect(database.writes[database.writes.length - 1]?.sql).not.toMatch(/SET training_max\s*=/);
  });
});

class ReviewDatabaseFake implements FiveThreeOneDatabase {
  readonly writes: Array<{ sql: string; params: SQLiteBindParams }> = [];
  readonly lift = {
    lift_id: 11,
    lift_name: 'Squat',
    lift_type: 'lower' as const,
    training_max: 180,
    suggested_training_max: null as number | null,
    suggestion_status: null as 'pending' | 'accepted' | 'edited' | 'declined' | null,
  };

  private readonly cycle = {
    cycle_id: 42,
    program_id: 7,
    program_name: 'Strength',
    unit: 'kg' as const,
    upper_tm_increment: 2.5,
    lower_tm_increment: 5,
    cycle_number: 1,
    status: 'complete' as const,
    current_week: 4,
    include_deload: 1,
  };

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    await task();
  }

  async runAsync(
    sql: string,
    params: SQLiteBindParams,
  ): Promise<{ lastInsertRowId: number; changes: number }> {
    this.writes.push({ sql, params });
    const values = Array.isArray(params) ? params : [];
    if (sql.includes("SET suggested_training_max = ?, suggestion_status = 'pending'")) {
      this.lift.suggested_training_max = values[0] as number;
      this.lift.suggestion_status = 'pending';
    } else if (sql.includes('SET suggested_training_max = ?, suggestion_status = ?')) {
      this.lift.suggested_training_max = values[0] as number;
      this.lift.suggestion_status = values[1] as 'declined';
    } else if (sql.includes('SET training_max = ?, suggested_training_max = ?')) {
      this.lift.training_max = values[0] as number;
      this.lift.suggested_training_max = values[1] as number;
      this.lift.suggestion_status = values[2] as 'accepted' | 'edited';
    }
    return { lastInsertRowId: 0, changes: 1 };
  }

  async getFirstAsync<T>(sql: string): Promise<T | null> {
    if (sql.includes('FROM FiveThreeOne_Cycles c')) {
      return this.cycle as T;
    }
    if (sql.includes('FROM FiveThreeOne_Lifts l')) {
      return this.lift as T;
    }
    throw new Error(`Unexpected first-row query: ${sql}`);
  }

  async getAllAsync<T>(sql: string): Promise<T[]> {
    if (sql.includes('FROM FiveThreeOne_Lifts')) {
      return [this.lift] as T[];
    }
    if (sql.includes('FROM FiveThreeOne_AmrapResults')) {
      return [
        {
          amrap_result_id: 90,
          lift_id: 11,
          week_number: 1,
          target_reps: 5,
          weight: 150,
          reps: 6,
          estimated_1rm: 180,
        },
      ] as T[];
    }
    throw new Error(`Unexpected all-rows query: ${sql}`);
  }
}
