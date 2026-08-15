import { centreActionFor } from './shell';
import type { QueuedSession, SessionQueueState } from './today';

const head = (overrides: Partial<QueuedSession>): QueuedSession => ({
  weekSessionId: 7,
  sessionId: 3,
  name: 'Día A',
  weekday: 1,
  date: 100,
  originDate: 100,
  doTodayAvailable: true,
  exercises: [],
  ...overrides,
});

const state = (overrides: Partial<SessionQueueState>): SessionQueueState => ({
  routine: { routineId: 1, name: 'R', unit: 'kg', roundingIncrement: 2.5 },
  head: null,
  resolution: null,
  upcoming: null,
  ...overrides,
});

describe('centreActionFor', () => {
  it('offers free logging when there is no active routine', () => {
    expect(centreActionFor(state({ routine: null }))).toEqual({
      label: 'freeLog',
      weekSessionId: null,
    });
  });

  it('offers free logging when nothing is pending or scheduled', () => {
    expect(centreActionFor(state({}))).toEqual({ label: 'freeLog', weekSessionId: null });
  });

  it('offers free logging when nothing is pending but the next session is upcoming', () => {
    expect(
      centreActionFor(
        state({
          upcoming: { weekSessionId: null, sessionId: null, name: 'Día A', weekday: 3, date: 200 },
        }),
      ),
    ).toEqual({ label: 'freeLog', weekSessionId: null });
  });

  it('offers to resolve an unresolved past session', () => {
    expect(
      centreActionFor(
        state({
          head: head({ date: 50, originDate: 50 }),
          resolution: 'unresolved',
        }),
      ),
    ).toEqual({ label: 'resolve', weekSessionId: 7 });
  });

  it('offers to start the head when it sits on its nominal day', () => {
    expect(
      centreActionFor(
        state({
          head: head({ date: 100, originDate: 100 }),
          resolution: 'due',
        }),
      ),
    ).toEqual({ label: 'start', weekSessionId: 7 });
  });

  it('offers to continue the head when it was moved onto today', () => {
    expect(
      centreActionFor(
        state({
          head: head({ date: 100, originDate: 60 }),
          resolution: 'due',
        }),
      ),
    ).toEqual({ label: 'continue', weekSessionId: 7 });
  });
});
