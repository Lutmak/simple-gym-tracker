import { mainLiftColours, type MainLiftOrderRow } from './liftColours';

const row = (overrides: Partial<MainLiftOrderRow>): MainLiftOrderRow => ({
  sessionSortOrder: 0,
  exerciseSortOrder: 0,
  name: 'Squat',
  role: 'main',
  ...overrides,
});

describe('mainLiftColours', () => {
  test('assigns slot 0 to the first session\'s main lift', () => {
    const colours = mainLiftColours([row({ name: 'Squat', sessionSortOrder: 0 })]);
    expect(colours.get('Squat')).toBe(0);
  });

  test('orders by session order first, then in-session order', () => {
    const colours = mainLiftColours([
      row({ name: 'Bench', sessionSortOrder: 1, exerciseSortOrder: 0 }),
      row({ name: 'Squat', sessionSortOrder: 0, exerciseSortOrder: 0 }),
      row({ name: 'Deadlift', sessionSortOrder: 1, exerciseSortOrder: 1, role: 'main' }),
    ]);
    expect(colours.get('Squat')).toBe(0);
    expect(colours.get('Bench')).toBe(1);
    expect(colours.get('Deadlift')).toBe(2);
  });

  test('ignores accessories entirely — they never take a slot', () => {
    const colours = mainLiftColours([
      row({ name: 'Squat', sessionSortOrder: 0, exerciseSortOrder: 0, role: 'main' }),
      row({ name: 'Leg Curl', sessionSortOrder: 0, exerciseSortOrder: 1, role: 'accessory' }),
    ]);
    expect(colours.has('Leg Curl')).toBe(false);
    expect(colours.size).toBe(1);
  });

  test('the same lift named as main in two sessions keeps its first slot', () => {
    const colours = mainLiftColours([
      row({ name: 'Squat', sessionSortOrder: 0, exerciseSortOrder: 0 }),
      row({ name: 'Bench', sessionSortOrder: 1, exerciseSortOrder: 0 }),
      row({ name: 'Squat', sessionSortOrder: 2, exerciseSortOrder: 0 }),
    ]);
    expect(colours.get('Squat')).toBe(0);
    expect(colours.get('Bench')).toBe(1);
    expect(colours.size).toBe(2);
  });

  test('a fifth distinct main lift wraps back to slot 0', () => {
    const colours = mainLiftColours(
      ['Squat', 'Bench', 'Deadlift', 'Press', 'Row'].map((name, index) =>
        row({ name, sessionSortOrder: index, exerciseSortOrder: 0 }),
      ),
    );
    expect(colours.get('Row')).toBe(0);
    expect(colours.get('Press')).toBe(3);
  });

  test('no main lifts at all — an empty map, not an error', () => {
    expect(mainLiftColours([]).size).toBe(0);
    expect(mainLiftColours([row({ role: 'accessory' })]).size).toBe(0);
  });
});
