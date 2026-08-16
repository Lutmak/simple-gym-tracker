import {
  loadSessionFinishContext,
  reviewAvailableFor,
} from './sessionFinish';
import type { RoutineDatabase } from './routineActions';

describe('reviewAvailableFor', () => {
  it.each([
    ['active', 3, 3, true],
    ['active', 2, 3, false],
    ['complete', 3, 3, false],
  ] as const)('only offers an active fully-resolved current week', (status, week, current, expected) => {
    expect(reviewAvailableFor(status, week, current, 0)).toBe(expected);
  });

  it('does not offer a review while any week session is pending', () => {
    expect(reviewAvailableFor('active', 3, 3, 1)).toBe(false);
  });
});

describe('loadSessionFinishContext', () => {
  it('returns the saved routine week and whether its review is due', async () => {
    const db: RoutineDatabase = {
      run: async () => undefined,
      get: async () => ({
        routine_id: 4,
        cycle_id: 9,
        cycle_number: 2,
        week_number: 3,
        current_week: 3,
        cycle_status: 'active',
      }),
      getAll: async () => [{ pending: 0 }],
    };

    await expect(loadSessionFinishContext(db, 17)).resolves.toEqual({
      routineId: 4,
      cycleId: 9,
      cycleNumber: 2,
      weekNumber: 3,
      reviewAvailable: true,
    });
  });
});
