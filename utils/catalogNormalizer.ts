export interface CatalogExerciseInput {
  id: string;
  name: string;
  category: string;
  level: string | null;
  force: string | null;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
}

export interface NormalizedMuscle {
  muscleName: string;
  isPrimary: boolean;
}

export interface NormalizedCatalogExercise {
  exerciseKey: string;
  name: string;
  category: string;
  level: string | null;
  force: string | null;
  mechanic: string | null;
  equipment: string | null;
  instructions: string;
  muscles: NormalizedMuscle[];
}

export interface NormalizedCatalog {
  exercises: NormalizedCatalogExercise[];
  droppedDuplicates: number;
}

/**
 * Normalises the free-exercise-db JSON into catalog rows. Names are the unique
 * identity: the first occurrence of a name wins, later duplicates are dropped
 * (the Catalog_Exercises.name column is UNIQUE, so a duplicate would fail the
 * seed at runtime). The source `id` is the stable key.
 */
export function normalizeCatalog(
  input: readonly CatalogExerciseInput[],
): NormalizedCatalog {
  const seenNames = new Set<string>();
  const exercises: NormalizedCatalogExercise[] = [];
  let droppedDuplicates = 0;

  for (const raw of input) {
    if (seenNames.has(raw.name)) {
      droppedDuplicates += 1;
      continue;
    }
    seenNames.add(raw.name);

    const muscles = new Map<string, boolean>();
    for (const muscle of raw.primaryMuscles) {
      muscles.set(muscle.trim().toLowerCase(), true);
    }
    for (const muscle of raw.secondaryMuscles) {
      const name = muscle.trim().toLowerCase();
      if (!muscles.has(name)) {
        muscles.set(name, false);
      }
    }

    exercises.push({
      exerciseKey: raw.id,
      name: raw.name,
      category: raw.category,
      level: raw.level,
      force: raw.force,
      mechanic: raw.mechanic,
      equipment: raw.equipment,
      instructions: raw.instructions.join('\n'),
      muscles: [...muscles.entries()].map(([muscleName, isPrimary]) => ({
        muscleName,
        isPrimary,
      })),
    });
  }

  return { exercises, droppedDuplicates };
}

export type SqlValue = string | number | null;

/**
 * Builds one batched `INSERT OR IGNORE` statement from generated rows. Values
 * are trusted build-time text, but still SQL-escaped (single quotes doubled)
 * so the artifact is correct for any source content.
 */
export function buildCatalogSeedSql(
  table: string,
  columns: readonly string[],
  rows: readonly Record<string, SqlValue>[],
): string {
  const literal = (value: SqlValue): string => {
    if (value === null) {
      return 'NULL';
    }
    if (typeof value === 'number') {
      return String(value);
    }
    return `'${value.replaceAll("'", "''")}'`;
  };

  const columnList = columns.join(', ');
  const rowList = rows
    .map((row) => `(${columns.map((column) => literal(row[column])).join(', ')})`)
    .join(',\n');

  return `INSERT OR IGNORE INTO ${table}\n  (${columnList})\nVALUES\n${rowList};`;
}
