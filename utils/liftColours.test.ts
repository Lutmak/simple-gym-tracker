import { mainLiftColours } from './liftColours';
import { lightTokens } from './theme';

describe('mainLiftColours', () => {
  it('assigns the series colours in ascending sort_order, not arrival order', () => {
    const colours = mainLiftColours(
      [
        { name: 'Bench', sortOrder: 5 },
        { name: 'Squat', sortOrder: 1 },
        { name: 'Deadlift', sortOrder: 9 },
        { name: 'Press', sortOrder: 13 },
      ],
      lightTokens.data.series,
    );
    expect(colours.get('Squat')).toBe(lightTokens.data.series[0]);
    expect(colours.get('Bench')).toBe(lightTokens.data.series[1]);
    expect(colours.get('Deadlift')).toBe(lightTokens.data.series[2]);
    expect(colours.get('Press')).toBe(lightTokens.data.series[3]);
  });

  it('colours a repeated name once, from its first occurrence', () => {
    const colours = mainLiftColours(
      [
        { name: 'Squat', sortOrder: 1 },
        { name: 'Squat', sortOrder: 9 },
      ],
      lightTokens.data.series,
    );
    expect(colours.size).toBe(1);
    expect(colours.get('Squat')).toBe(lightTokens.data.series[0]);
  });

  it('wraps past a 5th lift rather than throwing', () => {
    const colours = mainLiftColours(
      [1, 2, 3, 4, 5].map((sortOrder) => ({ name: `Lift ${sortOrder}`, sortOrder })),
      lightTokens.data.series,
    );
    expect(colours.get('Lift 5')).toBe(lightTokens.data.series[0]);
  });

  it('returns an empty map for a routine with no main lifts', () => {
    expect(mainLiftColours([], lightTokens.data.series).size).toBe(0);
  });
});
