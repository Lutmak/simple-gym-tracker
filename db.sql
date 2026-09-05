-- db.sql — Iteration 3 + M2 schema reference.

-- This file is DOCUMENTATION ONLY and is never executed. The executable DDL lives in
-- utils/schema.ts (SCHEMA_STATEMENTS / DROP_STATEMENTS) and runs from initialiseSchema
-- in App.tsx before any screen renders. Keep both in lockstep.

-- ============================================================================
-- Removed in this iteration (clean install; no migration from the old model)
-- ============================================================================
--   Recurring_Workouts and its four triggers (update_recurring_workout_name,
--     update_recurring_day_name, delete_recurring_workout, delete_recurring_day)
--   Template_Workouts, Template_Days, Template_Exercises
--   FiveThreeOne_Programs, FiveThreeOne_AssistanceTemplates,
--     FiveThreeOne_AssistanceExercises, FiveThreeOne_Lifts, FiveThreeOne_Cycles,
--     FiveThreeOne_WorkoutLink, FiveThreeOne_LiftAssistance, FiveThreeOne_AmrapResults
-- The screens that queried them survive until D1 deletes them; their queries fail
-- by design in the interim.

-- ============================================================================
-- Surviving history tables — shape unchanged (SPECS.md §3.2)
-- ============================================================================
-- History rows copy exercise_name, sets and reps at log time and never reference
-- the plan by ID for display. Workout_Log → Logged_Exercises → Weight_Log keep
-- their columns; Weight_Log gains the per-row unit from §3.7 and the per-set
-- timing columns from §3.9 (started_at / completed_at, epoch milliseconds).
-- Legacy databases (the bundled assets/SimpleDB.db) get the columns via
-- ensureWeightLogUnitColumn / ensureWeightLogTimingColumns, guarded ALTERs that
-- run inside runSchema.

CREATE TABLE IF NOT EXISTS Workouts (
    workout_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    workout_name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS Days (
    day_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    workout_id INTEGER NOT NULL,
    day_name TEXT NOT NULL,
    FOREIGN KEY (workout_id) REFERENCES Workouts(workout_id) ON DELETE CASCADE,
    UNIQUE (workout_id, day_name)
);

CREATE TABLE IF NOT EXISTS Exercises (
    exercise_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    day_id INTEGER NOT NULL,
    exercise_name TEXT NOT NULL,
    sets INTEGER NOT NULL,
    reps INTEGER NOT NULL,
    FOREIGN KEY (day_id) REFERENCES Days(day_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Workout_Log (
    workout_log_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    workout_name TEXT NOT NULL,
    day_name TEXT NOT NULL,
    workout_date INTEGER NOT NULL,
    UNIQUE (workout_date, day_name, workout_name)
);

-- role (F2) is copied at log time from the planned SessionExercises row —
-- NULL for a free session with no plan role. It disambiguates two rows that
-- share exercise_name (a preset's main lift and a back-off set on the same
-- catalog exercise, e.g. the shipped '531' preset's FSL rows), which the name
-- alone cannot.
CREATE TABLE IF NOT EXISTS Logged_Exercises (
    logged_exercise_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    workout_log_id INTEGER NOT NULL,
    exercise_name TEXT NOT NULL,
    sets INTEGER NOT NULL,
    reps INTEGER NOT NULL,
    role TEXT CHECK (role IS NULL OR role IN ('main', 'accessory')),
    FOREIGN KEY (workout_log_id) REFERENCES Workout_Log(workout_log_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Weight_Log (
    weight_log_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    workout_log_id INTEGER NOT NULL,
    logged_exercise_id INTEGER NOT NULL,
    exercise_name TEXT NOT NULL,
    set_number INTEGER NOT NULL,
    weight_logged REAL NOT NULL,
    reps_logged INTEGER NOT NULL,
    unit TEXT NOT NULL DEFAULT 'kg' CHECK (unit IN ('kg', 'lb')),
    started_at INTEGER,
    completed_at INTEGER,
    FOREIGN KEY (workout_log_id) REFERENCES Workout_Log(workout_log_id) ON DELETE CASCADE,
    FOREIGN KEY (logged_exercise_id) REFERENCES Logged_Exercises(logged_exercise_id),
    UNIQUE (workout_log_id, logged_exercise_id, set_number)
);

-- ============================================================================
-- Exercise catalog (SPECS.md §3.5)
-- ============================================================================
-- yuhonas/free-exercise-db (Unlicense), normalised at build time by
-- scripts/ingest-catalog.mts into data/catalog-seed.ts. The app never fetches.
-- English only. exercise_key is the source id (stable); name is UNIQUE and the
-- normalizer deduplicates on it (first occurrence wins).

CREATE TABLE IF NOT EXISTS Catalog_Exercises (
    exercise_key TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    level TEXT,
    force TEXT,
    mechanic TEXT,
    equipment TEXT,
    instructions TEXT
);

CREATE TABLE IF NOT EXISTS Catalog_Exercise_Muscles (
    exercise_key TEXT NOT NULL,
    muscle_name TEXT NOT NULL,
    is_primary INTEGER NOT NULL CHECK (is_primary IN (0, 1)),
    FOREIGN KEY (exercise_key) REFERENCES Catalog_Exercises(exercise_key) ON DELETE CASCADE,
    PRIMARY KEY (exercise_key, muscle_name)
);

CREATE INDEX IF NOT EXISTS Catalog_Exercise_Muscles_muscle
    ON Catalog_Exercise_Muscles (muscle_name);

-- ============================================================================
-- The plan (SPECS.md §3.1)
-- ============================================================================
-- A routine is an ordered set of training days plus one progression rule.
-- Exactly one routine is active (partial unique index). routine_key is the
-- stable key for seeded rows (INSERT OR IGNORE); user routines leave it NULL.
-- weekday uses Date.getDay(): 0 = Sunday … 6 = Saturday.
-- planned_jokers (SPECS.md §3.4): how many jokers a wave routine plans ahead,
-- 0 = off. Only meaningful for progression_rule 'wave'; other rules ignore it.
-- tm_increment_upper/lower and cycle_weeks (§3.1/§3.2, F3): a wave routine's
-- own training-max increments and deload choice. NULL increments mean the
-- wave engine's own unit default (2.5/5 kg, 5/10 lb); cycle_weeks is 3 (no
-- deload week) or 4.

CREATE TABLE IF NOT EXISTS Routines (
    routine_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    routine_key TEXT UNIQUE,
    name TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('catalog', 'user')),
    progression_rule TEXT NOT NULL CHECK (progression_rule IN ('wave', 'linear', 'none')),
    unit TEXT NOT NULL CHECK (unit IN ('kg', 'lb')),
    rounding_increment REAL NOT NULL CHECK (rounding_increment > 0),
    rest_main_seconds INTEGER NOT NULL CHECK (rest_main_seconds >= 0),
    rest_accessory_seconds INTEGER NOT NULL CHECK (rest_accessory_seconds >= 0),
    is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
    created_at INTEGER NOT NULL,
    planned_jokers INTEGER NOT NULL DEFAULT 0 CHECK (planned_jokers >= 0),
    tm_increment_upper REAL CHECK (tm_increment_upper IS NULL OR tm_increment_upper > 0),
    tm_increment_lower REAL CHECK (tm_increment_lower IS NULL OR tm_increment_lower > 0),
    cycle_weeks INTEGER NOT NULL DEFAULT 4 CHECK (cycle_weeks IN (3, 4))
);

CREATE UNIQUE INDEX IF NOT EXISTS Routines_single_active
    ON Routines (is_active) WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS Sessions (
    session_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    routine_id INTEGER NOT NULL,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL CHECK (sort_order > 0),
    FOREIGN KEY (routine_id) REFERENCES Routines(routine_id) ON DELETE CASCADE,
    UNIQUE (routine_id, weekday)
);

-- Load derivation: load_source decides which columns are meaningful.
--   training_max_pct → training_max_pct (fraction 0..1 of the training max) +
--                      training_max_weight (the exercise's current training max;
--                      NULL until the first session is logged — targets are
--                      learned, never demanded, SPECS.md §3.2)
--   absolute         → absolute_weight (also NULL until the first log)
--   bodyweight       → neither
-- unit_override is the per-exercise unit from §3.7 (NULL = routine unit).
-- is_amrap marks the final set as AMRAP: target_reps is the minimum, the actual
-- reps are recorded in Weight_Log.
-- bar_profile / bar_weight (SPECS.md §3.5): which bar the exercise is
-- performed with and, for the 'custom' profile, its weight in the exercise's
-- unit. Defaulted from the catalog's equipment field at copy time
-- (utils/barProfiles.ts — only 'barbell' maps to the olympic profile);
-- NULL means no bar. The stored number is always the TOTAL load, bar included.
CREATE TABLE IF NOT EXISTS SessionExercises (
    session_exercise_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    session_id INTEGER NOT NULL,
    catalog_exercise_id TEXT,
    exercise_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('main', 'accessory')),
    target_sets INTEGER NOT NULL CHECK (target_sets > 0),
    target_reps INTEGER NOT NULL CHECK (target_reps > 0),
    load_source TEXT NOT NULL CHECK (load_source IN ('training_max_pct', 'absolute', 'bodyweight')),
    training_max_pct REAL,
    training_max_weight REAL,
    absolute_weight REAL,
    unit_override TEXT CHECK (unit_override IS NULL OR unit_override IN ('kg', 'lb')),
    is_amrap INTEGER NOT NULL DEFAULT 0 CHECK (is_amrap IN (0, 1)),
    sort_order INTEGER NOT NULL CHECK (sort_order > 0),
    bar_profile TEXT CHECK (bar_profile IS NULL OR bar_profile IN ('olympic', 'semi-olympic', 'smith', 'ez', 'custom')),
    bar_weight REAL,
    -- R3/§3.6: NULL means "whatever this role does by default" — on for a main
    -- lift, off for an accessory. 0/1 is the user overriding that per exercise.
    warmups_enabled INTEGER CHECK (warmups_enabled IS NULL OR warmups_enabled IN (0, 1)),
    -- §3.1/F3: the 5/3/1 upper/lower role, chosen at setup, actually used for
    -- the cycle-end TM increment instead of being guessed from the load. NULL
    -- = inferred from the training max, same as before this column existed.
    category TEXT CHECK (category IS NULL OR category IN ('upper', 'lower')),
    FOREIGN KEY (session_id) REFERENCES Sessions(session_id) ON DELETE CASCADE,
    FOREIGN KEY (catalog_exercise_id) REFERENCES Catalog_Exercises(exercise_key) ON DELETE SET NULL,
    UNIQUE (session_id, sort_order),
    CHECK (
      (load_source = 'training_max_pct'
        AND training_max_pct IS NOT NULL
        AND absolute_weight IS NULL)
      OR (load_source = 'absolute'
        AND training_max_pct IS NULL AND training_max_weight IS NULL)
      OR (load_source = 'bodyweight'
        AND absolute_weight IS NULL AND training_max_pct IS NULL AND training_max_weight IS NULL)
    )
);

-- ============================================================================
-- Cycles and weeks (SPECS.md §3.3)
-- ============================================================================
-- wave:   3-week wave + optional deload. linear: fixed review period (default 4
-- weeks). none: plain repeating week. A week advances when its sessions are all
-- resolved — completed, moved or discarded — never by the calendar alone.

CREATE TABLE IF NOT EXISTS Cycles (
    cycle_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    routine_id INTEGER NOT NULL,
    cycle_number INTEGER NOT NULL CHECK (cycle_number > 0),
    weeks INTEGER NOT NULL CHECK (weeks > 0),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planned', 'active', 'complete')),
    current_week INTEGER NOT NULL DEFAULT 1 CHECK (current_week > 0),
    started_at INTEGER,
    completed_at INTEGER,
    FOREIGN KEY (routine_id) REFERENCES Routines(routine_id) ON DELETE CASCADE,
    UNIQUE (routine_id, cycle_number)
);

CREATE TABLE IF NOT EXISTS CycleWeeks (
    cycle_week_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    cycle_id INTEGER NOT NULL,
    week_number INTEGER NOT NULL CHECK (week_number > 0),
    FOREIGN KEY (cycle_id) REFERENCES Cycles(cycle_id) ON DELETE CASCADE,
    UNIQUE (cycle_id, week_number)
);

-- One row per session per week. completed_log_id is a non-destructive link to
-- history: deleting a log nulls it (SET NULL), never the other way round.
-- nominal_date (F7): the session's planned day, snapshot at cycle-seed time
-- instead of derived live from Sessions.weekday. A later weekday edit
-- restamps only this row's value when it is still 'pending'; an
-- already-resolved row's displayed plan position never changes underneath
-- it. NULL on a row from before this column existed.
CREATE TABLE IF NOT EXISTS WeekSessions (
    week_session_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    cycle_week_id INTEGER NOT NULL,
    session_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'moved', 'discarded')),
    resolved_on_date INTEGER,
    completed_log_id INTEGER,
    nominal_date INTEGER,
    FOREIGN KEY (cycle_week_id) REFERENCES CycleWeeks(cycle_week_id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES Sessions(session_id) ON DELETE CASCADE,
    FOREIGN KEY (completed_log_id) REFERENCES Workout_Log(workout_log_id) ON DELETE SET NULL,
    UNIQUE (cycle_week_id, session_id)
);

CREATE INDEX IF NOT EXISTS WeekSessions_week
    ON WeekSessions (cycle_week_id);

-- ============================================================================
-- Progression review (SPECS.md §3.4)
-- ============================================================================
-- The app proposes, the user decides. One proposal per exercise per cycle;
-- status records the outcome (pending until the review, then accepted / held /
-- edited / declined). Nothing is applied without a resolved review. For a
-- 'held' proposal proposed_target equals current_target; for 'edited' it is the
-- value the user entered.
CREATE TABLE IF NOT EXISTS Progression_Proposal (
    proposal_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    routine_id INTEGER NOT NULL,
    cycle_id INTEGER NOT NULL,
    session_exercise_id INTEGER NOT NULL,
    catalog_exercise_id TEXT,
    exercise_name TEXT NOT NULL,
    current_target REAL NOT NULL CHECK (current_target >= 0),
    proposed_target REAL NOT NULL CHECK (proposed_target >= 0),
    unit TEXT NOT NULL CHECK (unit IN ('kg', 'lb')),
    reason TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'held', 'edited', 'declined')),
    created_at INTEGER NOT NULL,
    FOREIGN KEY (routine_id) REFERENCES Routines(routine_id) ON DELETE CASCADE,
    FOREIGN KEY (cycle_id) REFERENCES Cycles(cycle_id) ON DELETE CASCADE,
    FOREIGN KEY (session_exercise_id) REFERENCES SessionExercises(session_exercise_id) ON DELETE CASCADE,
    FOREIGN KEY (catalog_exercise_id) REFERENCES Catalog_Exercises(exercise_key) ON DELETE SET NULL,
    UNIQUE (cycle_id, session_exercise_id)
);

CREATE INDEX IF NOT EXISTS Progression_Proposal_routine
    ON Progression_Proposal (routine_id);

-- ============================================================================
-- Preset routine catalog (SPECS.md F3)
-- ============================================================================
-- The 22 curated routines live in data/presetRoutines.ts and are seeded
-- idempotently by seedPresetRoutines inside runSchema. They are data, never
-- edited in place: activating one (D2) COPIES it into Routines /
-- Sessions / SessionExercises. exercise_name is a snapshot of the catalog
-- name taken at seed time; a key that does not resolve is a seed-time throw
-- and a test failure, never a runtime surprise.

CREATE TABLE IF NOT EXISTS Preset_Routines (
    routine_key TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    philosophy TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('beginner', 'intermediate', 'advanced')),
    recommended_days INTEGER NOT NULL CHECK (recommended_days BETWEEN 1 AND 7),
    rest_main_seconds INTEGER NOT NULL CHECK (rest_main_seconds >= 0),
    rest_accessory_seconds INTEGER NOT NULL CHECK (rest_accessory_seconds >= 0),
    progression_rule TEXT NOT NULL CHECK (progression_rule IN ('wave', 'linear', 'none')),
    rounding_increment_kg REAL NOT NULL CHECK (rounding_increment_kg > 0)
);

CREATE TABLE IF NOT EXISTS Preset_Sessions (
    preset_session_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    routine_key TEXT NOT NULL,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL CHECK (sort_order > 0),
    FOREIGN KEY (routine_key) REFERENCES Preset_Routines(routine_key) ON DELETE CASCADE,
    UNIQUE (routine_key, weekday),
    UNIQUE (routine_key, sort_order)
);

CREATE TABLE IF NOT EXISTS Preset_SessionExercises (
    preset_session_exercise_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    preset_session_id INTEGER NOT NULL,
    catalog_exercise_id TEXT NOT NULL,
    exercise_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('main', 'accessory')),
    target_sets INTEGER NOT NULL CHECK (target_sets > 0),
    target_reps INTEGER NOT NULL CHECK (target_reps > 0),
    load_source TEXT NOT NULL CHECK (load_source IN ('training_max_pct', 'absolute', 'bodyweight')),
    training_max_pct REAL CHECK (training_max_pct IS NULL OR training_max_pct > 0),
    is_amrap INTEGER NOT NULL DEFAULT 0 CHECK (is_amrap IN (0, 1)),
    sort_order INTEGER NOT NULL CHECK (sort_order > 0),
    FOREIGN KEY (preset_session_id) REFERENCES Preset_Sessions(preset_session_id) ON DELETE CASCADE,
    FOREIGN KEY (catalog_exercise_id) REFERENCES Catalog_Exercises(exercise_key) ON DELETE SET NULL,
    UNIQUE (preset_session_id, sort_order)
);

-- ============================================================================
-- Seeded data
-- ============================================================================
-- Catalog: INSERT OR IGNORE on stable exercise keys, run from runSchema on
-- every launch (idempotent). Source: data/catalog-seed.ts, generated by
-- scripts/ingest-catalog.mts; commit SHA in data/catalog-manifest.json.
-- Demo routine: utils/demoData.ts — buildDemoRows (pure) + loadDemoData /
-- removeDemoData, reachable from Settings. Idempotent, reversible, reloadable.
