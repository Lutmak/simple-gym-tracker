import type { SQLiteDatabase } from 'expo-sqlite';

const REQUIRED_CORE_SCHEMA: Record<string, readonly string[]> = {
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

type MetadataDatabase = Pick<SQLiteDatabase, 'getAllAsync'>;

export class DatabaseImportValidationError extends Error {
  constructor(message: string) {
    super(`Database import rejected: ${message}`);
    this.name = 'DatabaseImportValidationError';
  }
}

export async function validateImportedDatabase(
  db: MetadataDatabase,
): Promise<void> {
  const tableNames = Object.keys(REQUIRED_CORE_SCHEMA);
  const placeholders = tableNames.map(() => '?').join(', ');
  const tableRows = await db.getAllAsync<{ name: string }>(
    `SELECT name
     FROM sqlite_master
     WHERE type = ? AND name IN (${placeholders})`,
    ['table', ...tableNames],
  );
  const existingTables = new Set(tableRows.map((row) => row.name));
  const missingTables = tableNames.filter(
    (tableName) => !existingTables.has(tableName),
  );
  const missingColumns: string[] = [];

  for (const [tableName, requiredColumns] of Object.entries(
    REQUIRED_CORE_SCHEMA,
  )) {
    if (!existingTables.has(tableName)) {
      continue;
    }

    const columnRows = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info("${tableName}")`,
    );
    const existingColumns = new Set(columnRows.map((row) => row.name));

    for (const columnName of requiredColumns) {
      if (!existingColumns.has(columnName)) {
        missingColumns.push(`${tableName}.${columnName}`);
      }
    }
  }

  const problems = [
    ...missingTables.map((tableName) => `missing required table "${tableName}"`),
    ...missingColumns.map(
      (columnName) => `missing required column "${columnName}"`,
    ),
  ];

  if (problems.length > 0) {
    throw new DatabaseImportValidationError(problems.join('; '));
  }
}
