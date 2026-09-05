import { mainLiftColours } from './liftColours';

describe('mainLiftColours — fixed series slots for a routine main lifts', () => {
  it('assigns slot 0 to the first main lift seen and counts up from there', () => {
    const colours = mainLiftColours([
      { id: 1, role: 'main' },
      { id: 2, role: 'accessory' },
      { id: 3, role: 'main' },
    ]);
    expect(colours.get(1)).toBe(0);
    expect(colours.get(3)).toBe(1);
  });

  it('gives accessories no slot at all', () => {
    const colours = mainLiftColours([
      { id: 1, role: 'main' },
      { id: 2, role: 'accessory' },
    ]);
    expect(colours.has(2)).toBe(false);
  });

  it('follows the order it is given, not the id order', () => {
    const colours = mainLiftColours([
      { id: 30, role: 'main' },
      { id: 10, role: 'main' },
    ]);
    expect(colours.get(30)).toBe(0);
    expect(colours.get(10)).toBe(1);
  });

  it('wraps back to slot 0 past four main lifts, never growing the palette', () => {
    const colours = mainLiftColours([
      { id: 1, role: 'main' },
      { id: 2, role: 'main' },
      { id: 3, role: 'main' },
      { id: 4, role: 'main' },
      { id: 5, role: 'main' },
    ]);
    expect(colours.get(1)).toBe(0);
    expect(colours.get(2)).toBe(1);
    expect(colours.get(3)).toBe(2);
    expect(colours.get(4)).toBe(3);
    expect(colours.get(5)).toBe(0);
  });

  it('returns an empty map for no exercises or no main lifts', () => {
    expect(mainLiftColours([]).size).toBe(0);
    expect(mainLiftColours([{ id: 1, role: 'accessory' }]).size).toBe(0);
  });
});
