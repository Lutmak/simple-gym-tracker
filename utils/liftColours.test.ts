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

  // U2's cases: it builds a session-order-then-in-session-order sorted array before calling
  // (utils/inicio.ts's computeMainLiftColours), so here the array is already in that order and
  // slot assignment follows array position, matching the module's "trusts the order it is given"
  // contract.
  it('assigns slot 0 to the first session\'s main lift', () => {
    const colours = mainLiftColours([{ name: 'Squat', role: 'main' }]);
    expect(colours.get('Squat')).toBe(0);
  });

  it('U2: orders by session order first, then in-session order (pre-sorted by the caller)', () => {
    const colours = mainLiftColours([
      { name: 'Squat', role: 'main' }, // session 0, exercise 0
      { name: 'Bench', role: 'main' }, // session 1, exercise 0
      { name: 'Deadlift', role: 'main' }, // session 1, exercise 1
    ]);
    expect(colours.get('Squat')).toBe(0);
    expect(colours.get('Bench')).toBe(1);
    expect(colours.get('Deadlift')).toBe(2);
  });

  // U5's distinguishing case: a list with no main lifts at all (every row is an accessory),
  // not just a single accessory — the runner's own caller can hand this module a whole session
  // of pure accessory work.
  it('U5: an all-accessory list gets no colours at all', () => {
    const colours = mainLiftColours([
      { name: 'Curl', role: 'accessory' },
      { name: 'Lat Pulldown', role: 'accessory' },
    ]);
    expect(colours.size).toBe(0);
  });
});
