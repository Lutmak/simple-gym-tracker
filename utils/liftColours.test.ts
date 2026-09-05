import { mainLiftColours } from './liftColours';

describe('mainLiftColours — fixed series slots for a routine main lifts', () => {
  it('assigns slot 0 to the first main lift seen and counts up from there', () => {
    const colours = mainLiftColours([
      { name: 'Squat', role: 'main' },
      { name: 'Curl', role: 'accessory' },
      { name: 'Deadlift', role: 'main' },
    ]);
    expect(colours.get('Squat')).toBe(0);
    expect(colours.get('Deadlift')).toBe(1);
  });

  it('gives accessories no slot at all', () => {
    const colours = mainLiftColours([
      { name: 'Squat', role: 'main' },
      { name: 'Curl', role: 'accessory' },
    ]);
    expect(colours.has('Curl')).toBe(false);
  });

  it('follows the order it is given, not name order', () => {
    const colours = mainLiftColours([
      { name: 'Zercher Squat', role: 'main' },
      { name: 'Bench', role: 'main' },
    ]);
    expect(colours.get('Zercher Squat')).toBe(0);
    expect(colours.get('Bench')).toBe(1);
  });

  it('wraps back to slot 0 past four main lifts, never growing the palette', () => {
    const colours = mainLiftColours([
      { name: 'Squat', role: 'main' },
      { name: 'Bench', role: 'main' },
      { name: 'Deadlift', role: 'main' },
      { name: 'Press', role: 'main' },
      { name: 'Curl', role: 'main' },
    ]);
    expect(colours.get('Squat')).toBe(0);
    expect(colours.get('Bench')).toBe(1);
    expect(colours.get('Deadlift')).toBe(2);
    expect(colours.get('Press')).toBe(3);
    expect(colours.get('Curl')).toBe(0);
  });

  it('colours a repeated name once, from its first occurrence', () => {
    const colours = mainLiftColours([
      { name: 'Squat', role: 'main' },
      { name: 'Bench', role: 'main' },
      { name: 'Squat', role: 'main' },
    ]);
    expect(colours.size).toBe(2);
    expect(colours.get('Squat')).toBe(0);
    expect(colours.get('Bench')).toBe(1);
  });

  it('returns an empty map for no exercises or no main lifts', () => {
    expect(mainLiftColours([]).size).toBe(0);
    expect(mainLiftColours([{ name: 'Curl', role: 'accessory' }]).size).toBe(0);
  });
});
