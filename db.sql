-- db.sql

-- This is the schema for the database, for reference only.


-- Updated Schema
CREATE TABLE IF NOT EXISTS  Template_Workouts (
    workout_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    workout_name TEXT NOT NULL UNIQUE
    workout_difficulty TEXT NOT NULL
)


CREATE TABLE IF NOT EXISTS Template_Days (
    day_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    workout_id INTEGER NOT NULL,
    day_name TEXT NOT NULL,
    FOREIGN KEY (workout_id) REFERENCES Template_Workouts(workout_id) ON DELETE CASCADE,
    UNIQUE(workout_id, day_name)
);

CREATE TABLE IF NOT EXISTS Template_Exercises (
    exercise_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    day_id INTEGER NOT NULL,
    exercise_name TEXT NOT NULL,
    sets INTEGER NOT NULL,
    reps INTEGER NOT NULL,
    web_link TEXT,
    FOREIGN KEY (day_id) REFERENCES Template_Days(day_id) ON DELETE CASCADE,
    UNIQUE(day_id, exercise_name)
);




CREATE TABLE IF NOT EXISTS Workouts (
    workout_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    workout_name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS Days (
    day_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    workout_id INTEGER NOT NULL,
    day_name TEXT NOT NULL,
    FOREIGN KEY (workout_id) REFERENCES Workouts(workout_id) ON DELETE CASCADE,
    UNIQUE(workout_id, day_name)
);

CREATE TABLE IF NOT EXISTS Exercises (
    exercise_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    day_id INTEGER NOT NULL,
    exercise_name TEXT NOT NULL,
    sets INTEGER NOT NULL,
    reps INTEGER NOT NULL,
    web_link TEXT,
    muscle_group TEXT,
    exercise_notes TEXT,
    FOREIGN KEY (day_id) REFERENCES Days(day_id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS Workout_Log (
    workout_log_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    workout_name TEXT NOT NULL,
    day_name TEXT NOT NULL,
    workout_date INTEGER NOT NULL,
    UNIQUE (workout_date, day_name, workout_name) -- Properly placed UNIQUE constraint
);

CREATE TABLE IF NOT EXISTS Weight_Log (
    weight_log_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, -- Primary Key
    workout_log_id INTEGER NOT NULL, -- Foreign Key to Workout_Log
    logged_exercise_id INTEGER NOT NULL, -- Foreign Key to Logged_Exercises
    exercise_name TEXT NOT NULL, -- Exercise name copied from Logged_Exercises for better redundancy
    set_number INTEGER NOT NULL, -- Which set (e.g., Set 1, Set 2)
    weight_logged REAL NOT NULL, -- Weight for that set
    reps_logged INTEGER NOT NULL, -- Reps for that set
    FOREIGN KEY (workout_log_id) REFERENCES Workout_Log(workout_log_id) ON DELETE CASCADE,
    FOREIGN KEY (logged_exercise_id) REFERENCES Logged_Exercises(logged_exercise_id),
    UNIQUE (workout_log_id, logged_exercise_id, set_number) -- Ensure no duplicate entries for the same set
);



CREATE TABLE IF NOT EXISTS Logged_Exercises (
    logged_exercise_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    workout_log_id INTEGER NOT NULL, -- Foreign Key to Workout_Log
    exercise_name TEXT NOT NULL, -- Store exercise name
    sets INTEGER NOT NULL, -- Store sets at the time of logging
    reps INTEGER NOT NULL, -- Store reps at the time of logging
    web_link TEXT,
    muscle_group TEXT,
    exercise_notes TEXT,
    FOREIGN KEY (workout_log_id) REFERENCES Workout_Log(workout_log_id) ON DELETE CASCADE
);  

ALTER TABLE Workout_Log ADD COLUMN notification_id TEXT;

ALTER TABLE Workout_Log ADD COLUMN completion_time INTEGER;
ALTER TABLE Weight_Log ADD COLUMN completion_time INTEGER;
ALTER TABLE Exercises ADD COLUMN web_link  TEXT;
ALTER TABLE Logged_Exercises ADD COLUMN web_link TEXT;
ALTER TABLE Exercises ADD COLUMN muscle_group TEXT;
ALTER TABLE Exercises ADD COLUMN exercise_notes TEXT;
ALTER TABLE Logged_Exercises ADD COLUMN muscle_group INTEGER;
ALTER TABLE Logged_Exercises ADD COLUMN exercise_notes TEXT;


-- Dedicated 5/3/1 schema. This file is documentation only; the executable
-- CREATE TABLE statements and idempotent seeds live in App.tsx initialiseSchema.
CREATE TABLE IF NOT EXISTS FiveThreeOne_Programs (
    program_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    program_name TEXT NOT NULL UNIQUE,
    unit TEXT NOT NULL CHECK (unit IN ('kg', 'lb')),
    rounding_increment REAL NOT NULL CHECK (rounding_increment > 0),
    rounding_direction TEXT NOT NULL CHECK (rounding_direction IN ('up', 'down', 'nearest')),
    tm_percentage REAL NOT NULL DEFAULT 0.90 CHECK (tm_percentage BETWEEN 0.85 AND 0.90),
    include_deload INTEGER NOT NULL DEFAULT 1 CHECK (include_deload IN (0, 1)),
    upper_tm_increment REAL NOT NULL CHECK (upper_tm_increment > 0),
    lower_tm_increment REAL NOT NULL CHECK (lower_tm_increment > 0),
    warmup_enabled INTEGER NOT NULL DEFAULT 1 CHECK (warmup_enabled IN (0, 1))
);

CREATE TABLE IF NOT EXISTS FiveThreeOne_AssistanceTemplates (
    template_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    template_key TEXT NOT NULL UNIQUE,
    template_name TEXT NOT NULL,
    description TEXT,
    is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1))
);

CREATE TABLE IF NOT EXISTS FiveThreeOne_AssistanceExercises (
    assistance_exercise_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    template_id INTEGER NOT NULL,
    exercise_key TEXT NOT NULL UNIQUE,
    exercise_name TEXT NOT NULL,
    sets INTEGER NOT NULL CHECK (sets > 0),
    reps INTEGER NOT NULL CHECK (reps > 0),
    sort_order INTEGER NOT NULL CHECK (sort_order > 0),
    FOREIGN KEY (template_id) REFERENCES FiveThreeOne_AssistanceTemplates(template_id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS FiveThreeOne_Lifts (
    lift_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    program_id INTEGER NOT NULL,
    lift_name TEXT NOT NULL,
    lift_type TEXT NOT NULL CHECK (lift_type IN ('upper', 'lower')),
    training_max REAL NOT NULL CHECK (training_max > 0),
    -- day_slot is derived: the 1..N position of this training day within the week, recomputed
    -- from weekday whenever the program is saved. weekday (Date.getDay(): 0 = Sunday) is what
    -- the user actually chose, and is nullable only because programs predating it exist.
    day_slot INTEGER NOT NULL CHECK (day_slot > 0),
    weekday INTEGER CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6),
    warmup_enabled INTEGER NOT NULL DEFAULT 1 CHECK (warmup_enabled IN (0, 1)),
    -- Records which built-in template seeded FiveThreeOne_LiftAssistance. Not read when a cycle
    -- is generated: the day owns its accessory list once it has been seeded.
    assistance_template_id INTEGER,
    suggested_training_max REAL CHECK (suggested_training_max IS NULL OR suggested_training_max > 0),
    suggestion_status TEXT CHECK (
        suggestion_status IS NULL
        OR suggestion_status IN ('pending', 'accepted', 'edited', 'declined')
    ),
    FOREIGN KEY (program_id) REFERENCES FiveThreeOne_Programs(program_id)
        ON DELETE CASCADE,
    FOREIGN KEY (assistance_template_id) REFERENCES FiveThreeOne_AssistanceTemplates(template_id)
        ON DELETE SET NULL,
    UNIQUE (program_id, lift_name),
    UNIQUE (program_id, day_slot)
);

CREATE UNIQUE INDEX IF NOT EXISTS FiveThreeOne_Lifts_program_weekday
    ON FiveThreeOne_Lifts (program_id, weekday);

-- The resolved accessory list for one training day. Cascading from the lift is safe here in a way
-- it is not for FiveThreeOne_AmrapResults: this is the plan, not the log.
CREATE TABLE IF NOT EXISTS FiveThreeOne_LiftAssistance (
    lift_assistance_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    lift_id INTEGER NOT NULL,
    exercise_name TEXT NOT NULL,
    sets INTEGER NOT NULL CHECK (sets > 0),
    reps INTEGER NOT NULL CHECK (reps > 0),
    sort_order INTEGER NOT NULL CHECK (sort_order > 0),
    FOREIGN KEY (lift_id) REFERENCES FiveThreeOne_Lifts(lift_id)
        ON DELETE CASCADE,
    UNIQUE (lift_id, sort_order)
);

CREATE TABLE IF NOT EXISTS FiveThreeOne_Cycles (
    cycle_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    program_id INTEGER NOT NULL,
    cycle_number INTEGER NOT NULL CHECK (cycle_number > 0),
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'complete')),
    current_week INTEGER NOT NULL DEFAULT 1 CHECK (current_week BETWEEN 1 AND 4),
    include_deload INTEGER NOT NULL CHECK (include_deload IN (0, 1)),
    started_at INTEGER,
    completed_at INTEGER,
    FOREIGN KEY (program_id) REFERENCES FiveThreeOne_Programs(program_id)
        ON DELETE CASCADE,
    UNIQUE (program_id, cycle_number)
);

CREATE TABLE IF NOT EXISTS FiveThreeOne_WorkoutLink (
    workout_link_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    cycle_id INTEGER,
    lift_id INTEGER,
    workout_id INTEGER,
    day_id INTEGER,
    exercise_id INTEGER,
    workout_log_id INTEGER,
    weight_log_id INTEGER,
    week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 4),
    set_number INTEGER NOT NULL CHECK (set_number > 0),
    work_set_number INTEGER CHECK (work_set_number IS NULL OR work_set_number > 0),
    training_max REAL NOT NULL CHECK (training_max > 0),
    percentage REAL NOT NULL CHECK (percentage >= 0 AND percentage <= 1),
    target_weight REAL NOT NULL CHECK (target_weight >= 0),
    target_reps INTEGER NOT NULL CHECK (target_reps > 0),
    is_amrap INTEGER NOT NULL DEFAULT 0 CHECK (is_amrap IN (0, 1)),
    is_warmup INTEGER NOT NULL DEFAULT 0 CHECK (is_warmup IN (0, 1)),
    warmup_completed_at INTEGER,
    FOREIGN KEY (cycle_id) REFERENCES FiveThreeOne_Cycles(cycle_id)
        ON DELETE SET NULL,
    FOREIGN KEY (lift_id) REFERENCES FiveThreeOne_Lifts(lift_id)
        ON DELETE SET NULL,
    FOREIGN KEY (workout_id) REFERENCES Workouts(workout_id)
        ON DELETE SET NULL,
    FOREIGN KEY (day_id) REFERENCES Days(day_id)
        ON DELETE SET NULL,
    FOREIGN KEY (exercise_id) REFERENCES Exercises(exercise_id)
        ON DELETE SET NULL,
    FOREIGN KEY (workout_log_id) REFERENCES Workout_Log(workout_log_id)
        ON DELETE SET NULL,
    FOREIGN KEY (weight_log_id) REFERENCES Weight_Log(weight_log_id)
        ON DELETE SET NULL,
    UNIQUE (exercise_id, set_number),
    UNIQUE (weight_log_id),
    CHECK (
        (is_warmup = 1 AND work_set_number IS NULL)
        OR (is_warmup = 0 AND work_set_number IS NOT NULL)
    ),
    CHECK (is_amrap = 0 OR is_warmup = 0),
    CHECK (warmup_completed_at IS NULL OR is_warmup = 1)
);

CREATE TABLE IF NOT EXISTS FiveThreeOne_AmrapResults (
    amrap_result_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    workout_link_id INTEGER,
    weight_log_id INTEGER NOT NULL,
    program_id INTEGER,
    cycle_id INTEGER,
    lift_id INTEGER,
    lift_name TEXT NOT NULL,
    workout_date INTEGER NOT NULL,
    week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 4),
    work_set_number INTEGER NOT NULL CHECK (work_set_number > 0),
    weight REAL NOT NULL CHECK (weight >= 0),
    reps INTEGER NOT NULL CHECK (reps > 0),
    estimated_1rm REAL NOT NULL CHECK (estimated_1rm >= 0),
    is_pr INTEGER NOT NULL DEFAULT 0 CHECK (is_pr IN (0, 1)),
    FOREIGN KEY (workout_link_id) REFERENCES FiveThreeOne_WorkoutLink(workout_link_id)
        ON DELETE SET NULL,
    FOREIGN KEY (weight_log_id) REFERENCES Weight_Log(weight_log_id)
        ON DELETE CASCADE,
    FOREIGN KEY (program_id) REFERENCES FiveThreeOne_Programs(program_id)
        ON DELETE SET NULL,
    FOREIGN KEY (cycle_id) REFERENCES FiveThreeOne_Cycles(cycle_id)
        ON DELETE SET NULL,
    FOREIGN KEY (lift_id) REFERENCES FiveThreeOne_Lifts(lift_id)
        ON DELETE SET NULL,
    UNIQUE (weight_log_id)
);




