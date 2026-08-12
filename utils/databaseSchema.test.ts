import type { SQLiteDatabase } from 'expo-sqlite';
import {
  validateImportedDatabase,
} from './databaseSchema';

const validSchema: Record<string, string[]> = {
  Workouts: ['workout_id', 'workout_name'],
  Days: ['day_id', 'workout_id', 'day_name'],
  Exercises: ['exercise_id', 'day_id', 'exercise_name', 'sets', 'reps'],
  Workout_Log: ['workout_log_id', 'workout_name', 'day_name', 'workout_date'],
  Logged_Exercises: [
    'logged_exercise_id',
    'workout_log_id',
    'exercise_name',
    'sets',
    'reps',
  ],
  Weight_Log: [
    'weight_log_id',
    'workout_log_id',
    'logged_exercise_id',
    'exercise_name',
    'set_number',
    'weight_logged',
    'reps_logged',
  ],
};

const metadataDatabase = (
  schema: Record<string, string[]>,
): Pick<SQLiteDatabase, 'getAllAsync'> => ({
  getAllAsync: async <T>(query: string, params?: unknown): Promise<T[]> => {
    if (query.includes('sqlite_master')) {
      const tableNames = (params as string[]).slice(1);
      return tableNames
        .filter((tableName) => tableName in schema)
        .map((name) => ({ name })) as T[];
    }

    const tableName = query.match(/PRAGMA table_info\("([^"]+)"\)/)?.[1];
    return (schema[tableName ?? ''] ?? []).map((name) => ({ name })) as T[];
  },
});

describe('validateImportedDatabase', () => {
  it('accepts a database with the required core schema', async () => {
    await expect(
      validateImportedDatabase(metadataDatabase(validSchema)),
    ).resolves.toBeUndefined();
  });

  it('rejects a database with a missing core table', async () => {
    const { Days: _days, ...schemaWithoutDays } = validSchema;

    await expect(
      validateImportedDatabase(metadataDatabase(schemaWithoutDays)),
    ).rejects.toThrow('missing required table "Days"');
  });

  it('rejects a database with a missing required column', async () => {
    const schemaWithoutExerciseName = {
      ...validSchema,
      Exercises: validSchema.Exercises.filter(
        (column) => column !== 'exercise_name',
      ),
    };

    await expect(
      validateImportedDatabase(metadataDatabase(schemaWithoutExerciseName)),
    ).rejects.toThrow('missing required column "Exercises.exercise_name"');
  });
});
