import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { runSchema, type SchemaExecutor } from './schema';
import {
  activatePresetRoutine,
  createBlankRoutine,
  getActiveRoutine,
  type RoutineDatabase,
} from './routineActions';
import {
  blankRoutineDraft,
  buildPresetLibrary,
  loadPresetLibrary,
  loadRoutineLibrary,
  orderLibrary,
  planActivation,
  ROUTINE_LEVELS,
  weekdaySequence,
  type LibraryRoutine,
  type PresetRow,
} from './routineLibrary';

const withSchema = async (): Promise<{ db: DatabaseSync; routineDb: RoutineDatabase }> => {
  const db = new DatabaseSync(':memory:');
  const executor: SchemaExecutor = {
    exec: (sql) => db.exec(sql),
    run: (sql, params) => {
      db.prepare(sql).run(...((params ?? []) as SQLInputValue[]));
    },
    getAll: <T>(sql: string, params: SQLInputValue[] = []) =>
      Promise.resolve(db.prepare(sql).all(...params) as T[]),
  };
  await runSchema(executor);
  const routineDb: RoutineDatabase = {
    run: (sql, params) => {
      db.prepare(sql).run(...((params ?? []) as SQLInputValue[]));
      return undefined;
    },
    get: (sql, params) =>
      db.prepare(sql).get(...((params ?? []) as SQLInputValue[])) as
        | Record<string, unknown>
        | undefined,
    getAll: (sql, params) =>
      db.prepare(sql).all(...((params ?? []) as SQLInputValue[])) as Record<string, unknown>[],
  };
  return { db, routineDb };
};

const routine = (over: Partial<LibraryRoutine> & { routineId: number; name: string }): LibraryRoutine => ({
  origin: 'user',
  progressionRule: 'linear',
  isActive: false,
  routineKey: null,
  weekdays: [],
  ...over,
});

describe('orderLibrary — the tab answers "what am I training" first', () => {
  it('puts the active routine first and sorts the rest by name', () => {
    const ordered = orderLibrary([
      routine({ routineId: 1, name: 'Upper / Lower' }),
      routine({ routineId: 2, name: 'ancient split' }),
      routine({ routineId: 3, name: 'Push Pull Legs', isActive: true }),
    ]);
    expect(ordered.map((entry) => entry.routineId)).toEqual([3, 2, 1]);
  });

  it('is stable and total when nothing is active', () => {
    const ordered = orderLibrary([
      routine({ routineId: 1, name: 'Zeta' }),
      routine({ routineId: 2, name: 'alpha' }),
    ]);
    expect(ordered.map((entry) => entry.name)).toEqual(['alpha', 'Zeta']);
  });

  it('never drops a routine', () => {
    const input = [
      routine({ routineId: 1, name: 'One', isActive: true }),
      routine({ routineId: 2, name: 'Two' }),
      routine({ routineId: 3, name: 'Three' }),
    ];
    expect(orderLibrary(input)).toHaveLength(3);
  });
});

describe('weekdaySequence', () => {
  it('reads a routine in the user’s own week order', () => {
    expect(weekdaySequence([5, 1, 3], 'Monday')).toEqual([1, 3, 5]);
    expect(weekdaySequence([5, 1, 0], 'Sunday')).toEqual([0, 1, 5]);
    expect(weekdaySequence([5, 1, 0], 'Monday')).toEqual([1, 5, 0]);
  });

  it('drops repeats and anything that is not a weekday', () => {
    expect(weekdaySequence([1, 1, 7, -1, 2.5], 'Monday')).toEqual([1]);
  });

  it('is empty for a routine with no training days', () => {
    expect(weekdaySequence([], 'Monday')).toEqual([]);
  });
});

describe('buildPresetLibrary — the presets live behind the door, grouped by level', () => {
  const presets: PresetRow[] = [
    {
      routineKey: 'zeta',
      name: 'Zeta',
      description: 'z',
      level: 'beginner',
      progressionRule: 'linear',
      weekdays: [1, 3],
    },
    {
      routineKey: 'alpha',
      name: 'alpha',
      description: 'a',
      level: 'beginner',
      progressionRule: 'linear',
      weekdays: [2],
    },
    {
      routineKey: '531',
      name: '5/3/1',
      description: 'waves',
      level: 'intermediate',
      progressionRule: 'wave',
      weekdays: [1, 2, 4, 5],
    },
  ];

  it('returns every level in progression order, even the empty ones', () => {
    const groups = buildPresetLibrary(presets, []);
    expect(groups.map((group) => group.level)).toEqual(ROUTINE_LEVELS);
    expect(groups[2].entries).toEqual([]);
  });

  it('sorts each level by name', () => {
    const groups = buildPresetLibrary(presets, []);
    expect(groups[0].entries.map((entry) => entry.name)).toEqual(['alpha', 'Zeta']);
  });

  it('marks a preset the user already copied with that copy’s id', () => {
    const groups = buildPresetLibrary(presets, [
      routine({ routineId: 42, name: '5/3/1', routineKey: '531', origin: 'catalog' }),
    ]);
    const wave = groups[1].entries[0];
    expect(wave.routineKey).toBe('531');
    expect(wave.copyRoutineId).toBe(42);
    expect(groups[0].entries.every((entry) => entry.copyRoutineId === null)).toBe(true);
  });

  it('drops a preset whose level is not one the tab can group', () => {
    const groups = buildPresetLibrary(
      [...presets, { ...presets[0], routineKey: 'odd', name: 'Odd', level: 'expert' }],
      [],
    );
    const names = groups.flatMap((group) => group.entries.map((entry) => entry.name));
    expect(names).not.toContain('Odd');
  });
});

describe('planActivation — what becomes inactive, and never a number', () => {
  const active = { routineId: 7, name: 'Push Pull Legs' };

  it('names the routine that stops being active', () => {
    expect(planActivation({ kind: 'routine', routineId: 9, name: 'Upper / Lower' }, active)).toEqual({
      outcome: 'activate',
      name: 'Upper / Lower',
      deactivating: active,
      addsToLibrary: false,
    });
  });

  it('has nothing to confirm when no routine is active', () => {
    expect(planActivation({ kind: 'routine', routineId: 9, name: 'Solo' }, null)).toEqual({
      outcome: 'activate',
      name: 'Solo',
      deactivating: null,
      addsToLibrary: false,
    });
  });

  it('reports the routine that is already active instead of re-activating it', () => {
    expect(planActivation({ kind: 'routine', routineId: 7, name: 'Push Pull Legs' }, active)).toEqual({
      outcome: 'alreadyActive',
      name: 'Push Pull Legs',
    });
  });

  it('adds a preset to the library only when no copy exists yet', () => {
    const fresh = planActivation(
      { kind: 'preset', routineKey: '531', name: '5/3/1', copyRoutineId: null },
      active,
    );
    expect(fresh).toEqual({
      outcome: 'activate',
      name: '5/3/1',
      deactivating: active,
      addsToLibrary: true,
    });

    const copied = planActivation(
      { kind: 'preset', routineKey: '531', name: '5/3/1', copyRoutineId: 12 },
      active,
    );
    expect(copied).toEqual({
      outcome: 'activate',
      name: '5/3/1',
      deactivating: active,
      addsToLibrary: false,
    });
  });

  it('recognises the active routine through the preset it was copied from', () => {
    expect(
      planActivation(
        { kind: 'preset', routineKey: 'ppl', name: 'Push Pull Legs', copyRoutineId: 7 },
        active,
      ),
    ).toEqual({ outcome: 'alreadyActive', name: 'Push Pull Legs' });
  });

  it('plans a barbell preset with zero numeric input — the plan carries no weight at all', () => {
    const plan = planActivation(
      { kind: 'preset', routineKey: '531', name: '5/3/1', copyRoutineId: null },
      null,
    );
    expect(plan.outcome).toBe('activate');
    // The acceptance criterion, as a type-level fact the screen cannot violate: every key of the
    // plan is about identity, never about a value to collect.
    expect(Object.keys(plan).sort()).toEqual(['addsToLibrary', 'deactivating', 'name', 'outcome']);
  });
});

describe('blankRoutineDraft — "from scratch" asks for nothing but a name', () => {
  it('takes the plate step from the unit', () => {
    expect(blankRoutineDraft('Mi rutina', 'kg').roundingIncrement).toBe(2.5);
    expect(blankRoutineDraft('My routine', 'lb').roundingIncrement).toBe(5);
  });

  it('starts as a linear routine with no training days decided', () => {
    const draft = blankRoutineDraft('Mi rutina', 'kg');
    expect(draft.progressionRule).toBe('linear');
    expect(draft.restMainSeconds).toBeGreaterThan(0);
    expect(draft.restAccessorySeconds).toBeGreaterThan(0);
  });
});

describe('the library against a real database', () => {
  it('lists only the user’s routines, active first, with their training days', async () => {
    const { routineDb } = await withSchema();
    await activatePresetRoutine(routineDb, 'newbie-gains', 'kg', new Map());
    const blankId = await createBlankRoutine(routineDb, blankRoutineDraft('Aardvark', 'kg'));

    const library = await loadRoutineLibrary(routineDb);
    expect(library).toHaveLength(2);
    expect(library[0].name).toBe('Newbie Gains');
    expect(library[0].isActive).toBe(true);
    expect(library[0].routineKey).toBe('newbie-gains');
    expect(library[0].weekdays.length).toBeGreaterThan(0);
    expect(library[1].routineId).toBe(blankId);
    expect(library[1].weekdays).toEqual([]);
  });

  it('groups the 22 presets by level and marks the one already copied', async () => {
    const { routineDb } = await withSchema();
    const { routineId } = await activatePresetRoutine(routineDb, '531', 'kg', new Map());

    const library = await loadRoutineLibrary(routineDb);
    const groups = await loadPresetLibrary(routineDb, library);
    const entries = groups.flatMap((group) => group.entries);
    expect(entries).toHaveLength(22);

    const wave = entries.find((entry) => entry.routineKey === '531');
    expect(wave?.copyRoutineId).toBe(routineId);
    expect(wave?.level).toBe('intermediate');
    expect(wave?.progressionRule).toBe('wave');
    expect(wave?.weekdays).toEqual([1, 2, 4, 5]);
    expect(entries.filter((entry) => entry.copyRoutineId !== null)).toHaveLength(1);
  });

  it('activates a barbell preset with zero numeric input and leaves every weight to be learned', async () => {
    const { routineDb } = await withSchema();
    const library = await loadRoutineLibrary(routineDb);
    const groups = await loadPresetLibrary(routineDb, library);
    const wave = groups
      .flatMap((group) => group.entries)
      .find((entry) => entry.routineKey === '531');
    if (wave === undefined) {
      throw new Error('the 5/3/1 preset is missing from the seed');
    }

    const plan = planActivation(
      { kind: 'preset', routineKey: wave.routineKey, name: wave.name, copyRoutineId: wave.copyRoutineId },
      await getActiveRoutine(routineDb),
    );
    expect(plan).toEqual({
      outcome: 'activate',
      name: '5/3/1',
      deactivating: null,
      addsToLibrary: true,
    });

    // The screen calls exactly this — no weight map, because there is no screen that collects one.
    await activatePresetRoutine(routineDb, wave.routineKey, 'kg', new Map());

    const loads = routineDb.getAll(
      `SELECT e.training_max_weight, e.absolute_weight
       FROM SessionExercises e
       JOIN Sessions s ON s.session_id = e.session_id
       JOIN Routines r ON r.routine_id = s.routine_id
       WHERE r.routine_key = '531';`,
      [],
    ) as Record<string, unknown>[];
    expect(loads.length).toBeGreaterThan(0);
    expect(
      loads.every((row) => row.training_max_weight === null && row.absolute_weight === null),
    ).toBe(true);
  });

  it('a blank routine is a valid, inactive routine with no plan yet', async () => {
    const { routineDb } = await withSchema();
    const routineId = await createBlankRoutine(routineDb, blankRoutineDraft('Mi rutina', 'lb'));
    const row = (await routineDb.get(
      'SELECT name, origin, unit, rounding_increment, is_active FROM Routines WHERE routine_id = ?;',
      [routineId],
    )) as Record<string, unknown>;
    expect(row.name).toBe('Mi rutina');
    expect(row.origin).toBe('user');
    expect(row.unit).toBe('lb');
    expect(row.rounding_increment).toBe(5);
    expect(row.is_active).toBe(0);
    expect(await getActiveRoutine(routineDb)).toBeNull();
  });
});
