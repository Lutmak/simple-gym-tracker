import { buildSessionSummary, type SessionSummary } from './sessionSummary';
import { stampMissingSetTimes, type RunnerDraft, type RunnerSession } from './sessionRunner';

const session: RunnerSession = {
  weekSessionId: 11,
  sessionId: 21,
  sessionName: 'Squat Day',
  workoutName: 'Demo Routine',
  workoutDate: 1_754_000_000,
  weekNumber: 2,
  unit: 'kg',
  progressionRule: 'none',
  roundingIncrement: 2.5,
  restMainSeconds: 120,
  restAccessorySeconds: 60,
  exercises: [
    {
      sessionExerciseId: 31,
      name: 'Squat',
      role: 'main',
      targetSets: 3,
      targetReps: 5,
      loadSource: 'absolute',
      absoluteWeight: 100,
      trainingMaxWeight: null,
      trainingMaxPct: null,
      unitOverride: null,
      isAmrap: false,
      barProfile: 'olympic',
      barWeight: null,
    },
    {
      sessionExerciseId: 32,
      name: 'Row',
      role: 'accessory',
      targetSets: 2,
      targetReps: 8,
      loadSource: 'absolute',
      absoluteWeight: 60,
      trainingMaxWeight: null,
      trainingMaxPct: null,
      unitOverride: 'lb',
      isAmrap: false,
      barProfile: null,
      barWeight: null,
    },
  ],
};

describe('buildSessionSummary', () => {
  it('has no deviations when the concrete plan is kept', () => {
    const summary = buildSessionSummary(session, [
      [
        { reps: 5, weight: 100 },
        { reps: 5, weight: 100 },
        { reps: 5, weight: 100 },
      ],
      [
        { reps: 8, weight: 60, unit: 'lb' },
        { reps: 8, weight: 60, unit: 'lb' },
      ],
    ]);

    expect(summary.deviations).toEqual([]);
  });

  it('counts saved work, keeps units separate, derives duration, and names deviations', () => {
    const draft: RunnerDraft = [
      [
        { reps: 5, weight: 100, startedAt: 1_000, completedAt: 4_000 },
        { reps: 4, weight: 100, startedAt: 5_000, completedAt: 7_000 },
        null,
      ],
      [
        { reps: 8, weight: 60, unit: 'lb', startedAt: 8_000, completedAt: 10_000 },
        { reps: 8, weight: 70, unit: 'lb', startedAt: 11_000, completedAt: 14_000 },
        { reps: 5, weight: 80, unit: 'kg', startedAt: 15_000, completedAt: 18_000 },
      ],
    ];

    const summary: SessionSummary = buildSessionSummary(session, draft);

    expect(summary).toEqual({
      exerciseCount: 2,
      workSetCount: 5,
      notDoneSets: 1,
      unsavedSets: 0,
      durationSeconds: 17,
      volumes: [
        { unit: 'kg', volume: 1300 },
        { unit: 'lb', volume: 1040 },
      ],
      deviations: [
        {
          kind: 'changed',
          exerciseName: 'Squat',
          setNumber: 2,
          actual: { reps: 4, weight: 100, unit: 'kg' },
          target: { reps: 5, weight: 100, unit: 'kg' },
        },
        { kind: 'notDone', exerciseName: 'Squat', setNumber: 3 },
        {
          kind: 'changed',
          exerciseName: 'Row',
          setNumber: 2,
          actual: { reps: 8, weight: 70, unit: 'lb' },
          target: { reps: 8, weight: 60, unit: 'lb' },
        },
        {
          kind: 'extra',
          exerciseName: 'Row',
          setNumber: 3,
          actual: { reps: 5, weight: 80, unit: 'kg' },
        },
      ],
    });
  });

  it('does not invent weighted volume for bodyweight sets', () => {
    const bodyweightSession: RunnerSession = {
      ...session,
      exercises: [
        {
          ...session.exercises[0],
          name: 'Plank',
          targetSets: 1,
          targetReps: 60,
          loadSource: 'bodyweight',
          absoluteWeight: null,
        },
      ],
    };

    expect(
      buildSessionSummary(bodyweightSession, [[{ reps: 60, weight: null }]]),
    ).toMatchObject({
      exerciseCount: 1,
      workSetCount: 1,
      volumes: [],
    });
  });

  it('excludes an untouched, weight-still-unlearned set from what will be saved (F1)', () => {
    // The runner's own default draft for a first-ever exercise: every set
    // arrives "already done" with weight null (`buildPlannedDraft`). Left
    // untouched, none of it is a real deviation and none of it is saved.
    const learningSession: RunnerSession = {
      ...session,
      exercises: [
        { ...session.exercises[0], absoluteWeight: null },
        session.exercises[1],
      ],
    };

    const summary = buildSessionSummary(learningSession, [
      [
        { reps: 5, weight: null },
        { reps: 5, weight: null },
        { reps: 5, weight: null },
      ],
      [
        { reps: 8, weight: 60, unit: 'lb' },
        { reps: 8, weight: 60, unit: 'lb' },
      ],
    ]);

    expect(summary).toMatchObject({
      exerciseCount: 1, // only Row — Squat logged nothing that will be saved
      workSetCount: 2, // Row's two sets only
      notDoneSets: 0, // these are "done" (default), not removed
      unsavedSets: 3, // Squat's three untouched blanks
      deviations: [], // the plan's own default is never a deviation
    });
  });

  it('summarizes a targetless added exercise without inventing a plan deviation', () => {
    const addedExercise: RunnerSession['exercises'][number] = {
      sessionExerciseId: -1,
      name: 'Cable Chest Press',
      role: 'accessory',
      targetSets: 0,
      targetReps: 0,
      loadSource: 'absolute',
      absoluteWeight: null,
      trainingMaxWeight: null,
      trainingMaxPct: null,
      unitOverride: 'kg',
      isAmrap: false,
      barProfile: null,
      barWeight: null,
      isPlanned: false,
    };

    const summary = buildSessionSummary(
      { ...session, exercises: [addedExercise] },
      [[{ reps: 12, weight: 30 }]],
    );

    expect(summary).toMatchObject({
      exerciseCount: 1,
      workSetCount: 1,
      deviations: [],
      volumes: [{ unit: 'kg', volume: 360 }],
    });
  });
});

describe('stampMissingSetTimes', () => {
  it('fills only missing timestamps and leaves existing timing intact', () => {
    expect(
      stampMissingSetTimes(
        [[{ reps: 5, weight: 100, startedAt: 10 }, { reps: 5, weight: 100 }]],
        100,
        200,
      ),
    ).toEqual([
      [
        { reps: 5, weight: 100, startedAt: 10, completedAt: 200 },
        { reps: 5, weight: 100, startedAt: 100, completedAt: 200 },
      ],
    ]);
  });
});
