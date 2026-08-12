import * as FileSystem from 'expo-file-system/legacy';
import {
  deserializeDatabaseAsync,
  type SQLiteDatabase,
} from 'expo-sqlite';
import {
  DatabaseImportValidationError,
  validateImportedDatabase,
} from './databaseSchema';

const decodeBase64 = (value: string): Uint8Array => {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

export async function validateDatabaseFile(sourceUri: string): Promise<void> {
  let database: SQLiteDatabase | null = null;

  try {
    const encodedDatabase = await FileSystem.readAsStringAsync(sourceUri, {
      encoding: 'base64',
    });
    database = await deserializeDatabaseAsync(
      decodeBase64(encodedDatabase),
      { useNewConnection: true },
    );
    await validateImportedDatabase(database);
  } catch (error) {
    if (error instanceof DatabaseImportValidationError) {
      throw error;
    }

    throw new DatabaseImportValidationError(
      'the selected file is not a readable SQLite database.',
    );
  } finally {
    if (database) {
      await database.closeAsync();
    }
  }
}

export async function replaceDatabaseFile(
  sourceUri: string,
  databaseFilePath: string,
): Promise<void> {
  await validateDatabaseFile(sourceUri);

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const stagedDatabasePath = `${databaseFilePath}.importing-${suffix}`;
  const backupDatabasePath = `${databaseFilePath}.backup-${suffix}`;
  let originalDatabaseMoved = false;
  let replacementInstalled = false;

  try {
    await FileSystem.copyAsync({
      from: sourceUri,
      to: stagedDatabasePath,
    });

    const liveDatabaseInfo = await FileSystem.getInfoAsync(databaseFilePath);
    if (liveDatabaseInfo.exists) {
      await FileSystem.moveAsync({
        from: databaseFilePath,
        to: backupDatabasePath,
      });
      originalDatabaseMoved = true;
    }

    await FileSystem.moveAsync({
      from: stagedDatabasePath,
      to: databaseFilePath,
    });
    replacementInstalled = true;

    if (originalDatabaseMoved) {
      // A leftover backup is safer than failing after the new database is installed.
      try {
        await FileSystem.deleteAsync(backupDatabasePath, { idempotent: true });
      } catch {
        // Keep the backup available for manual recovery.
      }
    }
  } catch (error) {
    if (originalDatabaseMoved && !replacementInstalled) {
      try {
        const currentDatabaseInfo = await FileSystem.getInfoAsync(databaseFilePath);
        if (currentDatabaseInfo.exists) {
          await FileSystem.deleteAsync(databaseFilePath, { idempotent: true });
        }
        await FileSystem.moveAsync({
          from: backupDatabasePath,
          to: databaseFilePath,
        });
      } catch {
        throw new Error(
          'Database import failed and the original database could not be restored.',
        );
      }
    }

    throw error;
  } finally {
    try {
      await FileSystem.deleteAsync(stagedDatabasePath, { idempotent: true });
    } catch {
      // The staged file is never the live database and can be cleaned up later.
    }
  }
}
