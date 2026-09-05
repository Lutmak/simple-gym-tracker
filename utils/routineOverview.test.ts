import { activeCyclePosition, buildRoutineConfigView } from './routineOverview';
import type { ProgressCycleView, WeekAdherence } from './routineProgress';

const adherence = (over: Partial<WeekAdherence> = {}): WeekAdherence => ({
  planned: 4,
  completed: 4,
  moved: 0,
  discarded: 0,
  pending: 0,
  ...over,
});

const cycleView = (over: {
  cycleNumber: number;
  status: 'planned' | 'active' | 'complete';
  currentWeek: number;
  weeks: { weekNumber: number; adherence: WeekAdherence }[];
}): ProgressCycleView => ({
  cycle: {
    cycleId: over.cycleNumber,
    cycleNumber: over.cycleNumber,
    weeks: over.weeks.length,
    status: over.status,
    currentWeek: over.currentWeek,
    completedAt: over.status === 'complete' ? 1 : null,
  },
  weeks: over.weeks.map((week) => ({
    weekNumber: week.weekNumber,
    adherence: week.adherence,
    resolved: week.adherence.pending === 0,
    isCurrent: over.status === 'active' && week.weekNumber === over.currentWeek,
  })),
});

describe('activeCyclePosition — the list hero and details answer "where in its cycle"', () => {
  it('names the active cycle, its current week and sessions done out of the whole cycle', () => {
    const position = activeCyclePosition([
      cycleView({
        cycleNumber: 6,
        status: 'active',
        currentWeek: 4,
        weeks: [
          { weekNumber: 1, adherence: adherence() },
          { weekNumber: 2, adherence: adherence() },
          { weekNumber: 3, adherence: adherence() },
          { weekNumber: 4, adherence: adherence({ completed: 0, moved: 4, pending: 0 }) },
        ],
      }),
    ]);
    expect(position).toEqual({
      cycleNumber: 6,
      currentWeek: 4,
      sessionsDone: 16,
      sessionsPlanned: 16,
    });
  });

  it('counts an in-progress week as not yet done for its pending sessions', () => {
    const position = activeCyclePosition([
      cycleView({
        cycleNumber: 6,
        status: 'active',
        currentWeek: 4,
        weeks: [
          { weekNumber: 1, adherence: adherence() },
          { weekNumber: 2, adherence: adherence() },
          { weekNumber: 3, adherence: adherence() },
          { weekNumber: 4, adherence: adherence({ completed: 0, pending: 4 }) },
        ],
      }),
    ]);
    expect(position).toEqual({
      cycleNumber: 6,
      currentWeek: 4,
      sessionsDone: 12,
      sessionsPlanned: 16,
    });
  });

  it('ignores a complete cycle — that is the pending-review call, not this one', () => {
    const position = activeCyclePosition([
      cycleView({
        cycleNumber: 5,
        status: 'complete',
        currentWeek: 4,
        weeks: [{ weekNumber: 1, adherence: adherence() }],
      }),
    ]);
    expect(position).toBeNull();
  });

  it('is null for a routine with no cycle at all', () => {
    expect(activeCyclePosition([])).toBeNull();
  });
});

describe('buildRoutineConfigView — the collapsed Configuración row', () => {
  const baseWave = {
    unit: 'kg' as const,
    roundingIncrement: 2.5,
    restMainSeconds: 180,
    restAccessorySeconds: 90,
    progressionRule: 'wave' as const,
    plannedJokers: 0,
    tmIncrementUpper: null,
    tmIncrementLower: null,
    cycleWeeks: 4,
  };

  it('resolves a null TM increment to the wave engine recommended value for the unit', () => {
    const view = buildRoutineConfigView(baseWave);
    expect(view.tmIncrementUpper).toBe(2.5);
    expect(view.tmIncrementLower).toBe(5);
  });

  it('keeps a stored TM increment instead of the recommendation', () => {
    const view = buildRoutineConfigView({ ...baseWave, tmIncrementUpper: 5, tmIncrementLower: 10 });
    expect(view.tmIncrementUpper).toBe(5);
    expect(view.tmIncrementLower).toBe(10);
  });

  it('reads deloadEnabled off a 4-week cycle and off for a 3-week one', () => {
    expect(buildRoutineConfigView(baseWave).deloadEnabled).toBe(true);
    expect(buildRoutineConfigView({ ...baseWave, cycleWeeks: 3 }).deloadEnabled).toBe(false);
  });

  it('passes through rest, unit and rounding unchanged', () => {
    const view = buildRoutineConfigView(baseWave);
    expect(view.unit).toBe('kg');
    expect(view.roundingIncrement).toBe(2.5);
    expect(view.restMainSeconds).toBe(180);
    expect(view.restAccessorySeconds).toBe(90);
  });
});
