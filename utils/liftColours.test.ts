import { mainLiftColours } from './liftColours';

const series = ['blue', 'orange', 'teal', 'amber'] as const;

describe('mainLiftColours', () => {
  it('assigns the series colours to main lifts in the order they appear', () => {
    const colours = mainLiftColours(
      [
        { name: 'Squat', role: 'main' },
        { name: 'Row', role: 'accessory' },
        { name: 'Bench', role: 'main' },
        { name: 'Deadlift', role: 'main' },
      ],
      series,
    );
    expect(colours.get('Squat')).toBe('blue');
    expect(colours.get('Bench')).toBe('orange');
    expect(colours.get('Deadlift')).toBe('teal');
    expect(colours.has('Row')).toBe(false);
  });

  it('never assigns a colour to an accessory', () => {
    const colours = mainLiftColours(
      [
        { name: 'Curl', role: 'accessory' },
        { name: 'Lat Pulldown', role: 'accessory' },
      ],
      series,
    );
    expect(colours.size).toBe(0);
  });

  it('keeps the first occurrence\'s colour when the same main lift name repeats', () => {
    const colours = mainLiftColours(
      [
        { name: 'Squat', role: 'main' },
        { name: 'Bench', role: 'main' },
        { name: 'Squat', role: 'main' },
      ],
      series,
    );
    expect(colours.get('Squat')).toBe('blue');
    expect(colours.get('Bench')).toBe('orange');
    expect(colours.size).toBe(2);
  });

  it('cycles back to the first colour past the fourth main lift', () => {
    const colours = mainLiftColours(
      [
        { name: 'A', role: 'main' },
        { name: 'B', role: 'main' },
        { name: 'C', role: 'main' },
        { name: 'D', role: 'main' },
        { name: 'E', role: 'main' },
      ],
      series,
    );
    expect(colours.get('A')).toBe('blue');
    expect(colours.get('E')).toBe('blue');
  });

  it('is empty for no exercises', () => {
    expect(mainLiftColours([], series).size).toBe(0);
  });
});
