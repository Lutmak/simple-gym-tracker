/**
 * The 22 preset routines (SPECS.md Phase F3). Committed content, seeded idempotently
 * by `seedPresetRoutines` in utils/schema.ts (INSERT OR IGNORE on stable keys).
 *
 * Content conventions:
 * - English only, like the exercise catalog (§2 of SPECS.md). The app's UI chrome is
 *   translated; catalog-class data is not.
 * - Trademarked and personal names are replaced with descriptive ones (e.g. the 5×5
 *   program known by its app name ships as "Linear 5×5"). "5/3/1" keeps its name by
 *   decision (SPECS.md F3).
 * - `roundingIncrementKg` is the routine's rounding step and its linear increment
 *   (the F2 engine proposes `current + increment`, rounded to the increment). At
 *   activation a lb routine maps 2.5 kg to 5 lb.
 * - `loadSource`: 'training_max_pct' for barbell main lifts (weights entered at
 *   activation; `trainingMaxPct` defaults to 0.90), 'absolute' for assistance,
 *   'bodyweight' for bodyweight work.
 * - `isAmrap` marks the final work set, only on main-role exercises.
 */

export type PresetLevel = 'beginner' | 'intermediate' | 'advanced';
export type PresetProgressionRule = 'wave' | 'linear' | 'none';
export type PresetLoadSource = 'training_max_pct' | 'absolute' | 'bodyweight';
export type PresetRole = 'main' | 'accessory';

export interface PresetExercise {
  /** Must resolve to a Catalog_Exercises.exercise_key; verified by test. */
  catalogKey: string;
  role: PresetRole;
  sets: number;
  reps: number;
  loadSource: PresetLoadSource;
  isAmrap?: boolean;
}

export interface PresetSession {
  /** Date.getDay() convention, 0 = Sunday. */
  weekday: number;
  name: string;
  exercises: PresetExercise[];
}

export interface PresetRoutine {
  key: string;
  name: string;
  /** One paragraph: what the routine is. */
  description: string;
  /** Two or three sentences: the training philosophy. */
  philosophy: string;
  level: PresetLevel;
  recommendedDays: number;
  restMainSeconds: number;
  restAccessorySeconds: number;
  progressionRule: PresetProgressionRule;
  roundingIncrementKg: number;
  sessions: PresetSession[];
}

export const PRESET_ROUTINES: readonly PresetRoutine[] = [
  {
    key: 'newbie-gains',
    name: 'Newbie Gains',
    description:
      'A three-day full-body program built from machines and dumbbells, alternating a push-focused and a pull-focused day. Every movement is easy to learn, and nothing requires a spotter.',
    philosophy:
      'First build the habit of training, then build the body. Machine and dumbbell work keeps form simple while the full-body split trains every major muscle three times a week, which is the most productive schedule for a beginner.',
    level: 'beginner',
    recommendedDays: 3,
    restMainSeconds: 90,
    restAccessorySeconds: 60,
    progressionRule: 'linear',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Full Body A',
        exercises: [
          { catalogKey: 'Machine_Bench_Press', role: 'main', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Machine_Shoulder_Military_Press', role: 'main', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Full_Range-Of-Motion_Lat_Pulldown', role: 'main', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Leg_Press', role: 'main', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Triceps_Pushdown', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 3,
        name: 'Full Body B',
        exercises: [
          { catalogKey: 'Seated_Cable_Rows', role: 'main', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Goblet_Squat', role: 'main', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Machine_Bench_Press', role: 'main', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Lying_Leg_Curls', role: 'main', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Dumbbell_Bicep_Curl', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 5,
        name: 'Full Body A',
        exercises: [
          { catalogKey: 'Machine_Bench_Press', role: 'main', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Machine_Shoulder_Military_Press', role: 'main', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Full_Range-Of-Motion_Lat_Pulldown', role: 'main', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Leg_Press', role: 'main', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Triceps_Pushdown', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
        ],
      },
    ],
  },
  {
    key: 'split-it',
    name: 'Split it!',
    description:
      'A simple two-day upper/lower split for beginners who want more time per movement. Upper day covers the push and pull, lower day covers legs and back of the chain.',
    philosophy:
      'Fewer days, more focus. Splitting the body in two halves lets each session spend more time on each exercise, which is how a beginner learns movements properly before volume or intensity grows.',
    level: 'beginner',
    recommendedDays: 2,
    restMainSeconds: 90,
    restAccessorySeconds: 60,
    progressionRule: 'linear',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Upper',
        exercises: [
          { catalogKey: 'Dumbbell_Bench_Press', role: 'main', sets: 3, reps: 10, loadSource: 'training_max_pct' },
          { catalogKey: 'Seated_Dumbbell_Press', role: 'main', sets: 3, reps: 10, loadSource: 'training_max_pct' },
          { catalogKey: 'One-Arm_Dumbbell_Row', role: 'main', sets: 3, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Dumbbell_Bicep_Curl', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Triceps_Pushdown', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 4,
        name: 'Lower',
        exercises: [
          { catalogKey: 'Goblet_Squat', role: 'main', sets: 3, reps: 10, loadSource: 'training_max_pct' },
          { catalogKey: 'Dumbbell_Lunges', role: 'main', sets: 3, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Leg_Press', role: 'main', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Lying_Leg_Curls', role: 'main', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Standing_Calf_Raises', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
        ],
      },
    ],
  },
  {
    key: 'home-alone',
    name: 'Home Alone',
    description:
      'A no-equipment, full-body home workout. Push-ups, bodyweight squats, rows under a sturdy table and core work cover the whole body anywhere there is a floor.',
    philosophy:
      'The equipment you already own is your body. Reps and effort are the load: each exercise has a harder variation to move to, so progress comes from making the movement harder, not heavier.',
    level: 'beginner',
    recommendedDays: 3,
    restMainSeconds: 90,
    restAccessorySeconds: 60,
    progressionRule: 'none',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Full Body A',
        exercises: [
          { catalogKey: 'Pushups', role: 'main', sets: 3, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Bodyweight_Squat', role: 'main', sets: 3, reps: 12, loadSource: 'bodyweight' },
          { catalogKey: 'Inverted_Row', role: 'main', sets: 3, reps: 8, loadSource: 'bodyweight' },
          { catalogKey: 'Crunches', role: 'accessory', sets: 3, reps: 15, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 3,
        name: 'Full Body B',
        exercises: [
          { catalogKey: 'Incline_Push-Up', role: 'main', sets: 3, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Split_Squats', role: 'main', sets: 3, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Chin-Up', role: 'main', sets: 3, reps: 6, loadSource: 'bodyweight' },
          { catalogKey: 'Dead_Bug', role: 'accessory', sets: 3, reps: 10, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 5,
        name: 'Full Body A',
        exercises: [
          { catalogKey: 'Pushups', role: 'main', sets: 3, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Bodyweight_Squat', role: 'main', sets: 3, reps: 12, loadSource: 'bodyweight' },
          { catalogKey: 'Inverted_Row', role: 'main', sets: 3, reps: 8, loadSource: 'bodyweight' },
          { catalogKey: 'Crunches', role: 'accessory', sets: 3, reps: 15, loadSource: 'bodyweight' },
        ],
      },
    ],
  },
  {
    key: 'calisthenics-plus',
    name: 'Calisthenics+',
    description:
      'A three-day calisthenics full body built on pull-ups, dips, push-ups and lunges at higher reps, alternating two sessions with the same movements in different pairings.',
    philosophy:
      'Master the classic bar and floor movements, then own them at volume. Two alternating full-body days keep every movement fresh while the rep ranges build muscular endurance and size together.',
    level: 'intermediate',
    recommendedDays: 3,
    restMainSeconds: 90,
    restAccessorySeconds: 60,
    progressionRule: 'none',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Full Body A',
        exercises: [
          { catalogKey: 'Pullups', role: 'main', sets: 4, reps: 8, loadSource: 'bodyweight' },
          { catalogKey: 'Push-Ups_-_Close_Triceps_Position', role: 'main', sets: 4, reps: 12, loadSource: 'bodyweight' },
          { catalogKey: 'Split_Squats', role: 'main', sets: 4, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Inverted_Row', role: 'accessory', sets: 3, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Crunches', role: 'accessory', sets: 3, reps: 20, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 3,
        name: 'Full Body B',
        exercises: [
          { catalogKey: 'Dips_-_Triceps_Version', role: 'main', sets: 4, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Chin-Up', role: 'main', sets: 4, reps: 8, loadSource: 'bodyweight' },
          { catalogKey: 'Bodyweight_Walking_Lunge', role: 'main', sets: 4, reps: 12, loadSource: 'bodyweight' },
          { catalogKey: 'Russian_Twist', role: 'accessory', sets: 3, reps: 20, loadSource: 'bodyweight' },
          { catalogKey: 'Hanging_Leg_Raise', role: 'accessory', sets: 3, reps: 10, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 5,
        name: 'Full Body A',
        exercises: [
          { catalogKey: 'Pullups', role: 'main', sets: 4, reps: 8, loadSource: 'bodyweight' },
          { catalogKey: 'Push-Ups_-_Close_Triceps_Position', role: 'main', sets: 4, reps: 12, loadSource: 'bodyweight' },
          { catalogKey: 'Split_Squats', role: 'main', sets: 4, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Inverted_Row', role: 'accessory', sets: 3, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Crunches', role: 'accessory', sets: 3, reps: 20, loadSource: 'bodyweight' },
        ],
      },
    ],
  },
  {
    key: 'optimize',
    name: 'Optimize!',
    description:
      'A classic three-day split — chest and arms, back and shoulders, legs — with compound lifts first and isolation work second, four sets in a moderate rep range.',
    philosophy:
      'Train the muscle group, not the movement. Grouping chest with arms and back with shoulders gives each body part one dedicated session a week at a volume it can recover from, which is the reliable engine of growth.',
    level: 'intermediate',
    recommendedDays: 3,
    restMainSeconds: 120,
    restAccessorySeconds: 90,
    progressionRule: 'linear',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Chest & Arms',
        exercises: [
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 4, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Incline_Dumbbell_Press', role: 'main', sets: 3, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Cable_Crossover', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Dumbbell_Bicep_Curl', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Triceps_Pushdown', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 3,
        name: 'Back & Shoulders',
        exercises: [
          { catalogKey: 'Bent_Over_Barbell_Row', role: 'main', sets: 4, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Shoulder_Press', role: 'main', sets: 4, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Full_Range-Of-Motion_Lat_Pulldown', role: 'main', sets: 3, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Side_Lateral_Raise', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Face_Pull', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 5,
        name: 'Legs',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 4, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Romanian_Deadlift', role: 'main', sets: 3, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Leg_Press', role: 'main', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Lying_Leg_Curls', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Standing_Calf_Raises', role: 'accessory', sets: 4, reps: 15, loadSource: 'absolute' },
        ],
      },
    ],
  },
  {
    key: 'push-pull-legs',
    name: 'Push Pull Legs',
    description:
      'The standard three-day split: one push day, one pull day, one legs day. Each session leads with a heavy barbell compound and finishes with isolation work.',
    philosophy:
      'Train movements, not muscles. Grouping every pressing movement on one day and every pulling movement on another means each muscle works with its natural partners, and each session has a clear heavy-to-light arc.',
    level: 'intermediate',
    recommendedDays: 3,
    restMainSeconds: 120,
    restAccessorySeconds: 90,
    progressionRule: 'linear',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Push',
        exercises: [
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 4, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Shoulder_Press', role: 'main', sets: 3, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Incline_Dumbbell_Press', role: 'accessory', sets: 3, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Triceps_Pushdown_-_Rope_Attachment', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Side_Lateral_Raise', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 3,
        name: 'Pull',
        exercises: [
          { catalogKey: 'Barbell_Deadlift', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Bent_Over_Barbell_Row', role: 'main', sets: 4, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Full_Range-Of-Motion_Lat_Pulldown', role: 'accessory', sets: 3, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Face_Pull', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Dumbbell_Bicep_Curl', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 5,
        name: 'Legs',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 4, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Romanian_Deadlift', role: 'main', sets: 3, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Leg_Press', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Standing_Calf_Raises', role: 'accessory', sets: 4, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Hyperextensions_Back_Extensions', role: 'accessory', sets: 3, reps: 15, loadSource: 'bodyweight' },
        ],
      },
    ],
  },
  {
    key: 'bodyweight-beast',
    name: 'Bodyweight Beast',
    description:
      'An advanced three-day bodyweight program: handstand push-ups, heavy pull-up and dip volume, split squats and high-rep core. No equipment beyond a bar and a wall.',
    philosophy:
      'Volume is the strength you are building. Every movement runs at a difficulty where four to six hard sets force progress, and the body itself is the load — advanced variations are how the load grows.',
    level: 'advanced',
    recommendedDays: 3,
    restMainSeconds: 120,
    restAccessorySeconds: 90,
    progressionRule: 'none',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Full Body A',
        exercises: [
          { catalogKey: 'Handstand_Push-Ups', role: 'main', sets: 4, reps: 8, loadSource: 'bodyweight' },
          { catalogKey: 'Pullups', role: 'main', sets: 5, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Dips_-_Chest_Version', role: 'main', sets: 4, reps: 12, loadSource: 'bodyweight' },
          { catalogKey: 'Split_Squats', role: 'main', sets: 4, reps: 12, loadSource: 'bodyweight' },
          { catalogKey: 'Hanging_Leg_Raise', role: 'accessory', sets: 4, reps: 12, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 3,
        name: 'Full Body B',
        exercises: [
          { catalogKey: 'Dips_-_Triceps_Version', role: 'main', sets: 4, reps: 12, loadSource: 'bodyweight' },
          { catalogKey: 'Chin-Up', role: 'main', sets: 4, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Decline_Push-Up', role: 'main', sets: 4, reps: 15, loadSource: 'bodyweight' },
          { catalogKey: 'Bodyweight_Walking_Lunge', role: 'main', sets: 4, reps: 12, loadSource: 'bodyweight' },
          { catalogKey: 'Russian_Twist', role: 'accessory', sets: 4, reps: 20, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 5,
        name: 'Full Body A',
        exercises: [
          { catalogKey: 'Handstand_Push-Ups', role: 'main', sets: 4, reps: 8, loadSource: 'bodyweight' },
          { catalogKey: 'Pullups', role: 'main', sets: 5, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Dips_-_Chest_Version', role: 'main', sets: 4, reps: 12, loadSource: 'bodyweight' },
          { catalogKey: 'Split_Squats', role: 'main', sets: 4, reps: 12, loadSource: 'bodyweight' },
          { catalogKey: 'Hanging_Leg_Raise', role: 'accessory', sets: 4, reps: 12, loadSource: 'bodyweight' },
        ],
      },
    ],
  },
  {
    key: 'bro-split',
    name: 'Bro Split',
    description:
      'The classic five-day bodypart split: chest, back, shoulders, arms and legs each get a dedicated session built around one big lift and generous isolation volume.',
    philosophy:
      'One muscle group, one day, full attention. Each body part recovers for a full week between sessions, which allows the high sets and moderate reps that keep the pumps coming and the arms growing.',
    level: 'advanced',
    recommendedDays: 5,
    restMainSeconds: 120,
    restAccessorySeconds: 90,
    progressionRule: 'linear',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Chest',
        exercises: [
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 5, reps: 6, loadSource: 'training_max_pct' },
          { catalogKey: 'Incline_Dumbbell_Press', role: 'main', sets: 4, reps: 8, loadSource: 'absolute' },
          { catalogKey: 'Dumbbell_Flyes', role: 'accessory', sets: 4, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Cable_Crossover', role: 'accessory', sets: 4, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Dips_-_Chest_Version', role: 'accessory', sets: 4, reps: 10, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 2,
        name: 'Back',
        exercises: [
          { catalogKey: 'Barbell_Deadlift', role: 'main', sets: 4, reps: 6, loadSource: 'training_max_pct' },
          { catalogKey: 'Bent_Over_Barbell_Row', role: 'main', sets: 4, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Full_Range-Of-Motion_Lat_Pulldown', role: 'main', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Seated_Cable_Rows', role: 'accessory', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Face_Pull', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 4,
        name: 'Shoulders',
        exercises: [
          { catalogKey: 'Barbell_Shoulder_Press', role: 'main', sets: 4, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Arnold_Dumbbell_Press', role: 'main', sets: 3, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Side_Lateral_Raise', role: 'accessory', sets: 4, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Front_Dumbbell_Raise', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Reverse_Flyes', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 5,
        name: 'Arms',
        exercises: [
          { catalogKey: 'Close-Grip_Barbell_Bench_Press', role: 'main', sets: 4, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'EZ-Bar_Curl', role: 'main', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'EZ-Bar_Skullcrusher', role: 'main', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Alternate_Hammer_Curl', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Triceps_Pushdown_-_Rope_Attachment', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Concentration_Curls', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 6,
        name: 'Legs',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 5, reps: 6, loadSource: 'training_max_pct' },
          { catalogKey: 'Leg_Press', role: 'main', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Lying_Leg_Curls', role: 'main', sets: 4, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Leg_Extensions', role: 'accessory', sets: 4, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Standing_Calf_Raises', role: 'accessory', sets: 5, reps: 15, loadSource: 'absolute' },
        ],
      },
    ],
  },
  {
    key: 'upper-lower',
    name: 'Upper Lower',
    description:
      'A four-day upper/lower split with a strength day and a hypertrophy day for each half of the body, pairing low-rep barbell work with high-rep dumbbell and cable work.',
    philosophy:
      'Strength and size are trained differently, so train them separately. Two days per body half — one heavy and one high-volume — gives both the heavy loads that build strength and the volume that builds muscle.',
    level: 'advanced',
    recommendedDays: 4,
    restMainSeconds: 180,
    restAccessorySeconds: 90,
    progressionRule: 'linear',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Upper (Strength)',
        exercises: [
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 5, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Bent_Over_Barbell_Row', role: 'main', sets: 5, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Shoulder_Press', role: 'main', sets: 4, reps: 6, loadSource: 'training_max_pct' },
          { catalogKey: 'Pullups', role: 'accessory', sets: 4, reps: 8, loadSource: 'bodyweight' },
          { catalogKey: 'Dumbbell_Shrug', role: 'accessory', sets: 3, reps: 10, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 2,
        name: 'Lower (Strength)',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 5, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Deadlift', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Hip_Thrust', role: 'main', sets: 4, reps: 8, loadSource: 'absolute' },
          { catalogKey: 'Leg_Press', role: 'accessory', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Standing_Calf_Raises', role: 'accessory', sets: 4, reps: 12, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 4,
        name: 'Upper (Hypertrophy)',
        exercises: [
          { catalogKey: 'Incline_Dumbbell_Press', role: 'main', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Seated_Cable_Rows', role: 'main', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Seated_Dumbbell_Press', role: 'main', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Side_Lateral_Raise', role: 'accessory', sets: 4, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Triceps_Pushdown', role: 'accessory', sets: 4, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Dumbbell_Bicep_Curl', role: 'accessory', sets: 4, reps: 12, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 5,
        name: 'Lower (Hypertrophy)',
        exercises: [
          { catalogKey: 'Front_Barbell_Squat', role: 'main', sets: 4, reps: 10, loadSource: 'training_max_pct' },
          { catalogKey: 'Romanian_Deadlift', role: 'main', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Dumbbell_Lunges', role: 'main', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Lying_Leg_Curls', role: 'accessory', sets: 4, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Seated_Calf_Raise', role: 'accessory', sets: 4, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Hyperextensions_Back_Extensions', role: 'accessory', sets: 3, reps: 15, loadSource: 'bodyweight' },
        ],
      },
    ],
  },
  {
    key: '531',
    name: '5/3/1',
    description:
      'The classic four-day Jim Wendler program: bench, squat, overhead press and deadlift each get one day with three wave weeks of percentages off a training max, a deload week, and five-by-ten assistance work.',
    philosophy:
      'Train submaximally and progress slowly. The training max is a planning tool, not a record: weeks one to three climb to a single hard set, the fourth week deloads, and the training max rises only when the review proposes it from what you actually lifted.',
    level: 'intermediate',
    recommendedDays: 4,
    restMainSeconds: 180,
    restAccessorySeconds: 90,
    progressionRule: 'wave',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Bench',
        exercises: [
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct', isAmrap: true },
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'accessory', sets: 5, reps: 10, loadSource: 'training_max_pct' },
          { catalogKey: 'Pullups', role: 'accessory', sets: 5, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Hanging_Leg_Raise', role: 'accessory', sets: 5, reps: 10, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 2,
        name: 'Squat',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct', isAmrap: true },
          { catalogKey: 'Barbell_Squat', role: 'accessory', sets: 5, reps: 10, loadSource: 'training_max_pct' },
          { catalogKey: 'Leg_Press', role: 'accessory', sets: 5, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Crunches', role: 'accessory', sets: 5, reps: 15, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 4,
        name: 'Press',
        exercises: [
          { catalogKey: 'Barbell_Shoulder_Press', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct', isAmrap: true },
          { catalogKey: 'Barbell_Shoulder_Press', role: 'accessory', sets: 5, reps: 10, loadSource: 'training_max_pct' },
          { catalogKey: 'Seated_Cable_Rows', role: 'accessory', sets: 5, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Russian_Twist', role: 'accessory', sets: 5, reps: 15, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 5,
        name: 'Deadlift',
        exercises: [
          { catalogKey: 'Barbell_Deadlift', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct', isAmrap: true },
          { catalogKey: 'Barbell_Deadlift', role: 'accessory', sets: 5, reps: 10, loadSource: 'training_max_pct' },
          { catalogKey: 'Chin-Up', role: 'accessory', sets: 5, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Face_Pull', role: 'accessory', sets: 5, reps: 15, loadSource: 'absolute' },
        ],
      },
    ],
  },
  {
    key: 'novice-barbell-3x5',
    name: 'Novice Barbell 3×5',
    description:
      'The classic starting program: squat every session, alternate bench press and overhead press, deadlift once a week, three sets of five on the big lifts and a short accessory block.',
    philosophy:
      'A novice gets stronger on every visit, so the plan moves every visit. Five reps on three sets is the smallest volume that drives daily progress, and the squat is trained every session because it is the lift that responds first.',
    level: 'beginner',
    recommendedDays: 3,
    restMainSeconds: 240,
    restAccessorySeconds: 120,
    progressionRule: 'linear',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Workout A',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Bent_Over_Barbell_Row', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Crunches', role: 'accessory', sets: 3, reps: 15, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 3,
        name: 'Workout B',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Shoulder_Press', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Deadlift', role: 'main', sets: 1, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Chin-Up', role: 'accessory', sets: 3, reps: 8, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 5,
        name: 'Workout A',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Bent_Over_Barbell_Row', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Crunches', role: 'accessory', sets: 3, reps: 15, loadSource: 'bodyweight' },
        ],
      },
    ],
  },
  {
    key: 'linear-5x5',
    name: 'Linear 5×5',
    description:
      'The best-known beginner barbell program: two alternating workouts, five sets of five on squat, bench, overhead press and rows, and one set of five on the deadlift, three days a week.',
    philosophy:
      'Five sets of five is the sweet spot between volume and fatigue for a beginner who can still add weight to the bar every session. Keep the lifts simple, add a small increment each visit, and the numbers compound fast.',
    level: 'beginner',
    recommendedDays: 3,
    restMainSeconds: 180,
    restAccessorySeconds: 90,
    progressionRule: 'linear',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Workout A',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 5, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 5, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Bent_Over_Barbell_Row', role: 'main', sets: 5, reps: 5, loadSource: 'training_max_pct' },
        ],
      },
      {
        weekday: 3,
        name: 'Workout B',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 5, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Shoulder_Press', role: 'main', sets: 5, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Deadlift', role: 'main', sets: 1, reps: 5, loadSource: 'training_max_pct' },
        ],
      },
      {
        weekday: 5,
        name: 'Workout A',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 5, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 5, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Bent_Over_Barbell_Row', role: 'main', sets: 5, reps: 5, loadSource: 'training_max_pct' },
        ],
      },
    ],
  },
  {
    key: 'weekly-5x5',
    name: 'Weekly 5×5',
    description:
      'The intermediate weekly 5×5: a heavy Monday, a light Wednesday, and a medium Friday built around Friday\'s heavy triple and back-off set. Weight moves once a week instead of every session.',
    philosophy:
      'Weekly progression for the lifter who has outgrown daily increases. The week climbs from a heavy five to a light day for recovery to a medium day whose top set is next Monday\'s first set, inching the whole cycle upward.',
    level: 'intermediate',
    recommendedDays: 3,
    restMainSeconds: 180,
    restAccessorySeconds: 120,
    progressionRule: 'linear',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Heavy',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 5, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 5, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Bent_Over_Barbell_Row', role: 'main', sets: 5, reps: 5, loadSource: 'training_max_pct' },
        ],
      },
      {
        weekday: 3,
        name: 'Light',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 4, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Shoulder_Press', role: 'main', sets: 4, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Deadlift', role: 'main', sets: 4, reps: 5, loadSource: 'training_max_pct' },
        ],
      },
      {
        weekday: 5,
        name: 'Medium',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 5, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Squat', role: 'accessory', sets: 1, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 5, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Bent_Over_Barbell_Row', role: 'main', sets: 5, reps: 5, loadSource: 'training_max_pct' },
        ],
      },
    ],
  },
  {
    key: 'volume-recovery-intensity',
    name: 'Volume/Recovery/Intensity 3-Day',
    description:
      'The three-day weekly progression: a high-volume Monday, a light recovery Wednesday, and a single heavy set Friday. Each week the intensity day attempts a new five-rep record.',
    philosophy:
      'Split the week into three jobs: accumulate volume, recover, then express strength. Volume day builds the base, recovery day keeps the groove fresh, and intensity day is where the logbook moves — one honest set, heavier than last week.',
    level: 'intermediate',
    recommendedDays: 3,
    restMainSeconds: 240,
    restAccessorySeconds: 120,
    progressionRule: 'linear',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Volume',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 5, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 5, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Bent_Over_Barbell_Row', role: 'accessory', sets: 3, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Triceps_Pushdown', role: 'accessory', sets: 3, reps: 10, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 3,
        name: 'Recovery',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 2, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Shoulder_Press', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Pullups', role: 'accessory', sets: 3, reps: 8, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 5,
        name: 'Intensity',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 1, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 1, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Deadlift', role: 'main', sets: 1, reps: 5, loadSource: 'training_max_pct' },
        ],
      },
    ],
  },
  {
    key: 'amrap-linear-progression',
    name: 'AMRAP Linear Progression',
    description:
      'A four-day program built on three tiers: the main lift for five sets of three with an all-out last set, a second lift for three sets of ten, and two accessories for three sets of fifteen.',
    philosophy:
      'The last set is the steering wheel. When the top set of a tier reaches its target reps with an all-out finisher, that tier moves up; when it stalls, the sets get harder before the weight does. Volume, then intensity, then a reset.',
    level: 'beginner',
    recommendedDays: 4,
    restMainSeconds: 240,
    restAccessorySeconds: 90,
    progressionRule: 'linear',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Day A1',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 5, reps: 3, loadSource: 'training_max_pct', isAmrap: true },
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 3, reps: 10, loadSource: 'training_max_pct' },
          { catalogKey: 'Full_Range-Of-Motion_Lat_Pulldown', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Triceps_Pushdown', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 2,
        name: 'Day B1',
        exercises: [
          { catalogKey: 'Barbell_Shoulder_Press', role: 'main', sets: 5, reps: 3, loadSource: 'training_max_pct', isAmrap: true },
          { catalogKey: 'Barbell_Deadlift', role: 'main', sets: 3, reps: 10, loadSource: 'training_max_pct' },
          { catalogKey: 'One-Arm_Dumbbell_Row', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Dumbbell_Bicep_Curl', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 4,
        name: 'Day A2',
        exercises: [
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 5, reps: 3, loadSource: 'training_max_pct', isAmrap: true },
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 3, reps: 10, loadSource: 'training_max_pct' },
          { catalogKey: 'Full_Range-Of-Motion_Lat_Pulldown', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Face_Pull', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 5,
        name: 'Day B2',
        exercises: [
          { catalogKey: 'Barbell_Deadlift', role: 'main', sets: 5, reps: 3, loadSource: 'training_max_pct', isAmrap: true },
          { catalogKey: 'Barbell_Shoulder_Press', role: 'main', sets: 3, reps: 10, loadSource: 'training_max_pct' },
          { catalogKey: 'Bent_Over_Two-Dumbbell_Row', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'EZ-Bar_Curl', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
        ],
      },
    ],
  },
  {
    key: 'tiered-linear-progression',
    name: 'Tiered Linear Progression (T1/T2/T3)',
    description:
      'The four-day tiered method: a primary lift for four sets of three with an all-out finisher, a secondary compound for three sets of ten, and a volume block of three sets of fifteen.',
    philosophy:
      'Every lift has a job. The top tier builds strength with heavy triples, the middle tier reinforces the pattern with volume, and the third tier piles on work for the muscles behind the main lifts — progress on all three is what keeps the whole ladder moving.',
    level: 'intermediate',
    recommendedDays: 4,
    restMainSeconds: 180,
    restAccessorySeconds: 90,
    progressionRule: 'linear',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Day A1',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 4, reps: 3, loadSource: 'training_max_pct', isAmrap: true },
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 3, reps: 10, loadSource: 'training_max_pct' },
          { catalogKey: 'Full_Range-Of-Motion_Lat_Pulldown', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Hanging_Leg_Raise', role: 'accessory', sets: 3, reps: 15, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 2,
        name: 'Day B1',
        exercises: [
          { catalogKey: 'Barbell_Deadlift', role: 'main', sets: 4, reps: 3, loadSource: 'training_max_pct', isAmrap: true },
          { catalogKey: 'Barbell_Shoulder_Press', role: 'main', sets: 3, reps: 10, loadSource: 'training_max_pct' },
          { catalogKey: 'One-Arm_Dumbbell_Row', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Crunches', role: 'accessory', sets: 3, reps: 15, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 4,
        name: 'Day A2',
        exercises: [
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 4, reps: 3, loadSource: 'training_max_pct', isAmrap: true },
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 3, reps: 10, loadSource: 'training_max_pct' },
          { catalogKey: 'Seated_Cable_Rows', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Russian_Twist', role: 'accessory', sets: 3, reps: 15, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 5,
        name: 'Day B2',
        exercises: [
          { catalogKey: 'Barbell_Shoulder_Press', role: 'main', sets: 4, reps: 3, loadSource: 'training_max_pct', isAmrap: true },
          { catalogKey: 'Barbell_Deadlift', role: 'main', sets: 3, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Face_Pull', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Dumbbell_Bicep_Curl', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
        ],
      },
    ],
  },
  {
    key: 'high-volume-531-lp',
    name: 'High-Volume 5/3/1 LP',
    description:
      'The beginner-friendly 5/3/1: three days a week, two main lifts per session in the 5/3/1 wave, five sets of five at the first-set weight, and fifty to one hundred reps of push, pull and leg or core assistance.',
    philosophy:
      'The 5/3/1 wave keeps intensity honest while the five-by-five first-set-last work and the assistance block supply the volume a beginner needs to actually grow. The training max climbs a small step each cycle, so every month is strictly harder than the last.',
    level: 'intermediate',
    recommendedDays: 3,
    restMainSeconds: 180,
    restAccessorySeconds: 90,
    progressionRule: 'wave',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Day 1',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct', isAmrap: true },
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'accessory', sets: 5, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'One-Arm_Dumbbell_Row', role: 'accessory', sets: 5, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Hanging_Leg_Raise', role: 'accessory', sets: 5, reps: 10, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 3,
        name: 'Day 2',
        exercises: [
          { catalogKey: 'Barbell_Shoulder_Press', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct', isAmrap: true },
          { catalogKey: 'Barbell_Deadlift', role: 'accessory', sets: 5, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Chin-Up', role: 'accessory', sets: 5, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Dumbbell_Lunges', role: 'accessory', sets: 5, reps: 10, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 5,
        name: 'Day 3',
        exercises: [
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct', isAmrap: true },
          { catalogKey: 'Barbell_Squat', role: 'accessory', sets: 5, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Bent_Over_Two-Dumbbell_Row', role: 'accessory', sets: 5, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Face_Pull', role: 'accessory', sets: 5, reps: 10, loadSource: 'absolute' },
        ],
      },
    ],
  },
  {
    key: 'power-hypertrophy-upper-lower',
    name: 'Power-Hypertrophy Upper/Lower',
    description:
      'The four-day power/hypertrophy upper-lower: a heavy strength day and a high-rep size day for the upper body, and the same pair for the lower body.',
    philosophy:
      'Power and size need different medicine. Heavy low-rep days teach the nervous system to recruit muscle; high-rep days then feed those muscles the volume that makes them grow — each half of the week does one job.',
    level: 'intermediate',
    recommendedDays: 4,
    restMainSeconds: 180,
    restAccessorySeconds: 90,
    progressionRule: 'linear',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Upper Power',
        exercises: [
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Bent_Over_Barbell_Row', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Shoulder_Press', role: 'main', sets: 3, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Full_Range-Of-Motion_Lat_Pulldown', role: 'accessory', sets: 3, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'EZ-Bar_Curl', role: 'accessory', sets: 2, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'EZ-Bar_Skullcrusher', role: 'accessory', sets: 2, reps: 10, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 2,
        name: 'Lower Power',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Deadlift', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Leg_Press', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Lying_Leg_Curls', role: 'accessory', sets: 3, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Standing_Calf_Raises', role: 'accessory', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Crunches', role: 'accessory', sets: 3, reps: 15, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 4,
        name: 'Upper Hypertrophy',
        exercises: [
          { catalogKey: 'Incline_Dumbbell_Press', role: 'main', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Full_Range-Of-Motion_Lat_Pulldown', role: 'main', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Seated_Dumbbell_Press', role: 'main', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Dumbbell_Flyes', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Side_Lateral_Raise', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Triceps_Pushdown', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Dumbbell_Bicep_Curl', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 5,
        name: 'Lower Hypertrophy',
        exercises: [
          { catalogKey: 'Front_Barbell_Squat', role: 'main', sets: 4, reps: 10, loadSource: 'training_max_pct' },
          { catalogKey: 'Dumbbell_Lunges', role: 'main', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Leg_Extensions', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Lying_Leg_Curls', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Seated_Calf_Raise', role: 'accessory', sets: 4, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Hanging_Leg_Raise', role: 'accessory', sets: 3, reps: 12, loadSource: 'bodyweight' },
        ],
      },
    ],
  },
  {
    key: 'power-hypertrophy-5-day',
    name: 'Power-Hypertrophy 5-Day',
    description:
      'The five-day power/hypertrophy program: two power days, two hypertrophy days and a dedicated chest-and-arms day, covering every muscle group twice a week.',
    philosophy:
      'Twice a week is better than once. Every body part gets one heavy day and one high-volume day per week, and the split finishes with a dedicated arm day so the smaller muscles catch up to the compounds.',
    level: 'advanced',
    recommendedDays: 5,
    restMainSeconds: 180,
    restAccessorySeconds: 90,
    progressionRule: 'linear',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Upper Power',
        exercises: [
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Bent_Over_Barbell_Row', role: 'main', sets: 3, reps: 6, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Shoulder_Press', role: 'main', sets: 3, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Pullups', role: 'accessory', sets: 3, reps: 8, loadSource: 'bodyweight' },
          { catalogKey: 'Close-Grip_Barbell_Bench_Press', role: 'accessory', sets: 2, reps: 10, loadSource: 'training_max_pct' },
          { catalogKey: 'EZ-Bar_Curl', role: 'accessory', sets: 2, reps: 10, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 2,
        name: 'Lower Power',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Deadlift', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Leg_Press', role: 'accessory', sets: 3, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Lying_Leg_Curls', role: 'accessory', sets: 3, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Standing_Calf_Raises', role: 'accessory', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Hyperextensions_Back_Extensions', role: 'accessory', sets: 3, reps: 15, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 4,
        name: 'Back & Shoulders Hypertrophy',
        exercises: [
          { catalogKey: 'One-Arm_Dumbbell_Row', role: 'main', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Seated_Dumbbell_Press', role: 'main', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Full_Range-Of-Motion_Lat_Pulldown', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Seated_Cable_Rows', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Side_Lateral_Raise', role: 'accessory', sets: 4, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Reverse_Flyes', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Face_Pull', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 5,
        name: 'Lower Hypertrophy',
        exercises: [
          { catalogKey: 'Front_Barbell_Squat', role: 'main', sets: 4, reps: 10, loadSource: 'training_max_pct' },
          { catalogKey: 'Dumbbell_Lunges', role: 'main', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Leg_Extensions', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Lying_Leg_Curls', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Seated_Calf_Raise', role: 'accessory', sets: 4, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Barbell_Hip_Thrust', role: 'accessory', sets: 3, reps: 10, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 6,
        name: 'Chest & Arms Hypertrophy',
        exercises: [
          { catalogKey: 'Incline_Dumbbell_Press', role: 'main', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Dumbbell_Flyes', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Cable_Crossover', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Dips_-_Triceps_Version', role: 'accessory', sets: 3, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Triceps_Pushdown', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Dumbbell_Bicep_Curl', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Alternate_Hammer_Curl', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
        ],
      },
    ],
  },
  {
    key: 'classic-6-day',
    name: 'Classic 6-Day Split',
    description:
      'The classic bodybuilding split run twice a week: chest and back, shoulders and arms, legs — three sessions, repeated, six days a week, with one rest day.',
    philosophy:
      'Two passes a week over a three-day bodypart split. Each pair of muscle groups gets one full session with a compound opener and volume to the end of the set, and the doubled frequency is what separates it from a once-a-week split.',
    level: 'advanced',
    recommendedDays: 6,
    restMainSeconds: 90,
    restAccessorySeconds: 60,
    progressionRule: 'linear',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Chest & Back',
        exercises: [
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 4, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Bent_Over_Barbell_Row', role: 'main', sets: 4, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Incline_Dumbbell_Press', role: 'accessory', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Full_Range-Of-Motion_Lat_Pulldown', role: 'accessory', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Dumbbell_Flyes', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Seated_Cable_Rows', role: 'accessory', sets: 4, reps: 10, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 2,
        name: 'Shoulders & Arms',
        exercises: [
          { catalogKey: 'Barbell_Shoulder_Press', role: 'main', sets: 4, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Side_Lateral_Raise', role: 'main', sets: 4, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Arnold_Dumbbell_Press', role: 'accessory', sets: 3, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'EZ-Bar_Curl', role: 'accessory', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Triceps_Pushdown', role: 'accessory', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Alternate_Hammer_Curl', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 3,
        name: 'Legs',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 4, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Romanian_Deadlift', role: 'main', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Leg_Press', role: 'accessory', sets: 4, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Lying_Leg_Curls', role: 'accessory', sets: 4, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Standing_Calf_Raises', role: 'accessory', sets: 5, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Crunches', role: 'accessory', sets: 4, reps: 20, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 4,
        name: 'Chest & Back',
        exercises: [
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 4, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Bent_Over_Barbell_Row', role: 'main', sets: 4, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Incline_Dumbbell_Press', role: 'accessory', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Full_Range-Of-Motion_Lat_Pulldown', role: 'accessory', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Dumbbell_Flyes', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Seated_Cable_Rows', role: 'accessory', sets: 4, reps: 10, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 5,
        name: 'Shoulders & Arms',
        exercises: [
          { catalogKey: 'Barbell_Shoulder_Press', role: 'main', sets: 4, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Side_Lateral_Raise', role: 'main', sets: 4, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Arnold_Dumbbell_Press', role: 'accessory', sets: 3, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'EZ-Bar_Curl', role: 'accessory', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Triceps_Pushdown', role: 'accessory', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Alternate_Hammer_Curl', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 6,
        name: 'Legs',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 4, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Romanian_Deadlift', role: 'main', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Leg_Press', role: 'accessory', sets: 4, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Lying_Leg_Curls', role: 'accessory', sets: 4, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Standing_Calf_Raises', role: 'accessory', sets: 5, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Crunches', role: 'accessory', sets: 4, reps: 20, loadSource: 'bodyweight' },
        ],
      },
    ],
  },
  {
    key: 'push-pull-legs-6-day',
    name: 'Push Pull Legs 6-Day',
    description:
      'The six-day push/pull/legs split: each muscle group twice a week, once with heavier weights and lower reps and once with lighter weights and higher reps.',
    philosophy:
      'Two different doses of the same medicine. The heavy pass builds strength on the main lifts, the lighter pass floods the same muscles with growth volume, and every body part is hit twice before the rest day.',
    level: 'advanced',
    recommendedDays: 6,
    restMainSeconds: 120,
    restAccessorySeconds: 90,
    progressionRule: 'linear',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Push A',
        exercises: [
          { catalogKey: 'Barbell_Bench_Press_-_Medium_Grip', role: 'main', sets: 4, reps: 6, loadSource: 'training_max_pct' },
          { catalogKey: 'Barbell_Shoulder_Press', role: 'main', sets: 3, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Incline_Dumbbell_Press', role: 'accessory', sets: 3, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Side_Lateral_Raise', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Triceps_Pushdown', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 2,
        name: 'Pull A',
        exercises: [
          { catalogKey: 'Barbell_Deadlift', role: 'main', sets: 3, reps: 5, loadSource: 'training_max_pct' },
          { catalogKey: 'Bent_Over_Barbell_Row', role: 'main', sets: 4, reps: 8, loadSource: 'training_max_pct' },
          { catalogKey: 'Full_Range-Of-Motion_Lat_Pulldown', role: 'accessory', sets: 3, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Face_Pull', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Dumbbell_Bicep_Curl', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 3,
        name: 'Legs A',
        exercises: [
          { catalogKey: 'Barbell_Squat', role: 'main', sets: 4, reps: 6, loadSource: 'training_max_pct' },
          { catalogKey: 'Romanian_Deadlift', role: 'main', sets: 3, reps: 8, loadSource: 'absolute' },
          { catalogKey: 'Leg_Press', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Lying_Leg_Curls', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Standing_Calf_Raises', role: 'accessory', sets: 4, reps: 15, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 4,
        name: 'Push B',
        exercises: [
          { catalogKey: 'Incline_Dumbbell_Press', role: 'main', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Seated_Dumbbell_Press', role: 'main', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'Dumbbell_Flyes', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Side_Lateral_Raise', role: 'accessory', sets: 4, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'EZ-Bar_Skullcrusher', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 5,
        name: 'Pull B',
        exercises: [
          { catalogKey: 'Chin-Up', role: 'main', sets: 4, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Seated_Cable_Rows', role: 'main', sets: 4, reps: 10, loadSource: 'absolute' },
          { catalogKey: 'One-Arm_Dumbbell_Row', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Reverse_Flyes', role: 'accessory', sets: 3, reps: 15, loadSource: 'absolute' },
          { catalogKey: 'Concentration_Curls', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
        ],
      },
      {
        weekday: 6,
        name: 'Legs B',
        exercises: [
          { catalogKey: 'Front_Barbell_Squat', role: 'main', sets: 4, reps: 10, loadSource: 'training_max_pct' },
          { catalogKey: 'Dumbbell_Lunges', role: 'main', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Leg_Extensions', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Seated_Leg_Curl', role: 'accessory', sets: 3, reps: 12, loadSource: 'absolute' },
          { catalogKey: 'Seated_Calf_Raise', role: 'accessory', sets: 4, reps: 15, loadSource: 'absolute' },
        ],
      },
    ],
  },
  {
    key: 'bodyweight-basics-3-day',
    name: 'Bodyweight Basics 3-Day',
    description:
      'The three-day bodyweight foundation: pull-ups, squats, dips, hinges, push-ups and rows in pairs, three sets of five to eight, finishing with a core triplet.',
    philosophy:
      'Start with the easiest variation that challenges you and climb. Each movement is done in pairs to keep the session tight, and every exercise has a harder variation waiting, so progress is a ladder of movements rather than a heavier bar.',
    level: 'beginner',
    recommendedDays: 3,
    restMainSeconds: 90,
    restAccessorySeconds: 60,
    progressionRule: 'none',
    roundingIncrementKg: 2.5,
    sessions: [
      {
        weekday: 1,
        name: 'Full Body',
        exercises: [
          { catalogKey: 'Pullups', role: 'main', sets: 3, reps: 5, loadSource: 'bodyweight' },
          { catalogKey: 'Bodyweight_Squat', role: 'main', sets: 3, reps: 5, loadSource: 'bodyweight' },
          { catalogKey: 'Bench_Dips', role: 'main', sets: 3, reps: 5, loadSource: 'bodyweight' },
          { catalogKey: 'Single_Leg_Glute_Bridge', role: 'main', sets: 3, reps: 5, loadSource: 'bodyweight' },
          { catalogKey: 'Pushups', role: 'main', sets: 3, reps: 5, loadSource: 'bodyweight' },
          { catalogKey: 'Inverted_Row', role: 'main', sets: 3, reps: 5, loadSource: 'bodyweight' },
          { catalogKey: 'Crunches', role: 'accessory', sets: 3, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Dead_Bug', role: 'accessory', sets: 3, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Russian_Twist', role: 'accessory', sets: 3, reps: 10, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 3,
        name: 'Full Body',
        exercises: [
          { catalogKey: 'Pullups', role: 'main', sets: 3, reps: 5, loadSource: 'bodyweight' },
          { catalogKey: 'Bodyweight_Squat', role: 'main', sets: 3, reps: 5, loadSource: 'bodyweight' },
          { catalogKey: 'Bench_Dips', role: 'main', sets: 3, reps: 5, loadSource: 'bodyweight' },
          { catalogKey: 'Single_Leg_Glute_Bridge', role: 'main', sets: 3, reps: 5, loadSource: 'bodyweight' },
          { catalogKey: 'Pushups', role: 'main', sets: 3, reps: 5, loadSource: 'bodyweight' },
          { catalogKey: 'Inverted_Row', role: 'main', sets: 3, reps: 5, loadSource: 'bodyweight' },
          { catalogKey: 'Crunches', role: 'accessory', sets: 3, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Dead_Bug', role: 'accessory', sets: 3, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Russian_Twist', role: 'accessory', sets: 3, reps: 10, loadSource: 'bodyweight' },
        ],
      },
      {
        weekday: 5,
        name: 'Full Body',
        exercises: [
          { catalogKey: 'Pullups', role: 'main', sets: 3, reps: 5, loadSource: 'bodyweight' },
          { catalogKey: 'Bodyweight_Squat', role: 'main', sets: 3, reps: 5, loadSource: 'bodyweight' },
          { catalogKey: 'Bench_Dips', role: 'main', sets: 3, reps: 5, loadSource: 'bodyweight' },
          { catalogKey: 'Single_Leg_Glute_Bridge', role: 'main', sets: 3, reps: 5, loadSource: 'bodyweight' },
          { catalogKey: 'Pushups', role: 'main', sets: 3, reps: 5, loadSource: 'bodyweight' },
          { catalogKey: 'Inverted_Row', role: 'main', sets: 3, reps: 5, loadSource: 'bodyweight' },
          { catalogKey: 'Crunches', role: 'accessory', sets: 3, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Dead_Bug', role: 'accessory', sets: 3, reps: 10, loadSource: 'bodyweight' },
          { catalogKey: 'Russian_Twist', role: 'accessory', sets: 3, reps: 10, loadSource: 'bodyweight' },
        ],
      },
    ],
  },
];
