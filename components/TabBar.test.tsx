import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TabBar } from './TabBar';
import { ThemeProvider } from '../context/ThemeContext';
import { QueueRevisionProvider } from '../context/QueueRevision';
import { loadSessionQueue, resolvePullForwardSession } from '../utils/today';
import type { SessionQueueState } from '../utils/today';

/**
 * The centre button answers the queue (SPEC.md §4.4); these tests exercise every one of its six
 * states by controlling what `loadSessionQueue` resolves with — a pending review is one of its
 * states (`state.review`), not a separate lookup — and asserting the icon `centreActionFor`/the
 * bar picks and where a press navigates or what it opens. The database and navigation are mocked —
 * this is the bar's own decision logic wired to a live component tree, not an integration test of
 * `expo-sqlite` or React Navigation.
 */

// A stable object, not a fresh one per call: the bar's own effects depend on `db` and
// `navigation` by reference (`reload`'s `useCallback([db])`, the `state`-listener effect's
// `[navigation, reload]`). A mock that hands back a new object every render never lets those
// stabilize, so the load-on-every-render effect never stops firing — the real cause of the
// "not wrapped in act(...)" warning this task fixes, not just something to await around.
const mockDb = {
  runAsync: jest.fn(),
  getFirstAsync: jest.fn(),
  getAllAsync: jest.fn(),
};
jest.mock('expo-sqlite', () => ({
  useSQLiteContext: () => mockDb,
}));

const mockNavigate = jest.fn();
const mockNavigation = { navigate: mockNavigate, addListener: () => () => {} };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
}));

jest.mock('../utils/today', () => {
  const actual = jest.requireActual('../utils/today');
  return {
    ...actual,
    loadSessionQueue: jest.fn(),
    resolvePullForwardSession: jest.fn(),
  };
});

const mockLoadSessionQueue = loadSessionQueue as jest.MockedFunction<typeof loadSessionQueue>;
const mockResolvePullForward = resolvePullForwardSession as jest.MockedFunction<
  typeof resolvePullForwardSession
>;

const routine = { routineId: 1, name: 'Demo', unit: 'kg' as const, roundingIncrement: 2.5 };

const head = (overrides: Partial<SessionQueueState['head']>): SessionQueueState['head'] => ({
  weekSessionId: 7,
  sessionId: 3,
  name: 'Squat Day',
  weekday: 1,
  date: 100,
  originDate: 100,
  doTodayAvailable: true,
  todayOccupiedBy: null,
  exercises: [],
  ...overrides,
});

const barProps = (): BottomTabBarProps =>
  ({
    state: {
      index: 0,
      routes: [
        { key: 'Inicio', name: 'Inicio' },
        { key: 'Progress', name: 'Progress' },
        { key: 'Routines', name: 'Routines' },
        { key: 'Settings', name: 'Settings' },
      ],
    },
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
  }) as unknown as BottomTabBarProps;

// `render` mounts synchronously, but the bar's own initial load resolves the mocked
// `loadSessionQueue` promise on a later microtask, outside that synchronous `act`. Awaiting an
// async `act` here flushes that microtask (and the two `setState` calls it makes) before this
// resolves, so the queue load is always settled by the time a test's first assertion runs — this
// is the fix for the "not wrapped in act(...)" warning (SPEC.md, Phase F carryover), not a filter
// over the console.
const renderBar = async (): Promise<void> => {
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 0, height: 0 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <ThemeProvider>
        <QueueRevisionProvider>
          <TabBar {...barProps()} />
        </QueueRevisionProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
  // `render` returns once mounted, before the bar's own `reload()` promise (the mocked
  // `loadSessionQueue`) settles — an empty async `act` flushes that pending microtask and the two
  // `setState` calls it makes, inside `act`, before any test's first assertion runs.
  await act(async () => {});
};

/** Waits for the centre button's icon to become `name` — the async queue/review load settling. */
const expectCentreIcon = async (name: string): Promise<void> => {
  await waitFor(() => {
    const button = screen.getByTestId('centre-action-button');
    expect(button.findAllByProps({ name }).length).toBeGreaterThan(0);
  });
};

beforeEach(() => {
  mockNavigate.mockClear();
  mockResolvePullForward.mockClear();
});

describe('TabBar centre button — the six queue states', () => {
  it('shows "start" and starts the session directly', async () => {
    mockLoadSessionQueue.mockResolvedValue({
      routine,
      head: head({ date: 100, originDate: 100 }),
      resolution: 'due',
      upcoming: null,
      review: null,
      pullForwardAvailable: false,
    });
    await renderBar();
    await expectCentreIcon('play');

    fireEvent.press(screen.getByTestId('centre-action-button'));
    // `initial: false` puts InicioIndex (the stack's own root) beneath StartSession, so a
    // hardware back lands there instead of exiting the app (found on the emulator, 2026-09-05).
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('Inicio', {
      screen: 'StartSession',
      params: { weekSessionId: 7 },
      initial: false,
    });
  });

  it('shows "continue" for a session already moved onto today', async () => {
    mockLoadSessionQueue.mockResolvedValue({
      routine,
      head: head({ date: 100, originDate: 60 }),
      resolution: 'due',
      upcoming: null,
      review: null,
      pullForwardAvailable: false,
    });
    await renderBar();
    await expectCentreIcon('play');

    fireEvent.press(screen.getByTestId('centre-action-button'));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('Inicio', {
      screen: 'StartSession',
      params: { weekSessionId: 7 },
      initial: false,
    });
  });

  it('shows "resolve" and opens the H2 resolution sheet request', async () => {
    mockLoadSessionQueue.mockResolvedValue({
      routine,
      head: head({ date: 50, originDate: 50 }),
      resolution: 'unresolved',
      upcoming: null,
      review: null,
      pullForwardAvailable: false,
    });
    await renderBar();
    await expectCentreIcon('alert-circle');

    fireEvent.press(screen.getByTestId('centre-action-button'));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('Inicio', {
      screen: 'InicioIndex',
      params: { resolutionWeekSessionId: 7 },
      initial: false,
    });
  });

  it('shows "review" when a cycle is complete and unreviewed, and opens the review', async () => {
    mockLoadSessionQueue.mockResolvedValue({
      routine,
      head: null,
      resolution: null,
      upcoming: null,
      review: { cycleId: 9, cycleNumber: 3, completedSessions: 16, totalSessions: 16 },
      pullForwardAvailable: false,
    });
    await renderBar();
    await expectCentreIcon('ribbon');

    fireEvent.press(screen.getByTestId('centre-action-button'));
    // `initial: false` puts RoutinesList beneath CycleReview, so back lands there, not out of
    // the app.
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('Routines', {
      screen: 'CycleReview',
      params: { routineId: 1, cycleId: 9 },
      initial: false,
    });
  });

  it('shows "restDay" and opens the sheet, not a navigation', async () => {
    mockLoadSessionQueue.mockResolvedValue({
      routine,
      head: null,
      resolution: null,
      upcoming: {
        weekSessionId: 42,
        sessionId: 5,
        name: 'Squat Day',
        weekday: 1,
        date: 500,
      },
      review: null,
      pullForwardAvailable: true,
    });
    await renderBar();
    await expectCentreIcon('moon');

    fireEvent.press(screen.getByTestId('centre-action-button'));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('rest-day-pull-forward')).toBeTruthy();
    expect(screen.getByTestId('rest-day-free-log')).toBeTruthy();
  });

  it('offers only "Registro libre" when the resolver\'s own precondition does not hold', async () => {
    // Same shape as the "restDay" case above — an upcoming session exists — but something (a
    // session already resolved onto today, from elsewhere in the queue) makes pulling it forward
    // unsafe. Reproduces the Z2 finding: the row must not appear at all, not just fail on press.
    mockLoadSessionQueue.mockResolvedValue({
      routine,
      head: null,
      resolution: null,
      upcoming: {
        weekSessionId: 42,
        sessionId: 5,
        name: 'Squat Day',
        weekday: 1,
        date: 500,
      },
      review: null,
      pullForwardAvailable: false,
    });
    await renderBar();
    await expectCentreIcon('moon');

    fireEvent.press(screen.getByTestId('centre-action-button'));
    expect(screen.queryByTestId('rest-day-pull-forward')).toBeNull();
    expect(screen.getByTestId('rest-day-free-log')).toBeTruthy();
  });

  it('opens free logging from the rest-day sheet with InicioIndex beneath it', async () => {
    mockLoadSessionQueue.mockResolvedValue({
      routine,
      head: null,
      resolution: null,
      upcoming: null,
      review: null,
      pullForwardAvailable: false,
    });
    await renderBar();
    await expectCentreIcon('moon');

    fireEvent.press(screen.getByTestId('centre-action-button'));
    fireEvent.press(screen.getByTestId('rest-day-free-log'));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('Inicio', {
      screen: 'FreeLogging',
      params: undefined,
      initial: false,
    });
  });

  it('pulling the next session forward resolves it and starts it', async () => {
    mockLoadSessionQueue.mockResolvedValue({
      routine,
      head: null,
      resolution: null,
      upcoming: {
        weekSessionId: 42,
        sessionId: 5,
        name: 'Squat Day',
        weekday: 1,
        date: 500,
      },
      review: null,
      pullForwardAvailable: true,
    });
    mockResolvePullForward.mockResolvedValue(42);
    await renderBar();
    await expectCentreIcon('moon');
    fireEvent.press(screen.getByTestId('centre-action-button'));
    fireEvent.press(screen.getByTestId('rest-day-pull-forward'));

    expect(mockResolvePullForward).toHaveBeenCalled();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    expect(mockNavigate).toHaveBeenCalledWith('Inicio', {
      screen: 'StartSession',
      params: { weekSessionId: 42 },
      initial: false,
    });
  });

  it('shows "newRoutine" and opens the new-routine door when there is no active routine', async () => {
    mockLoadSessionQueue.mockResolvedValue({
      routine: null,
      head: null,
      resolution: null,
      upcoming: null,
      review: null,
      pullForwardAvailable: false,
    });
    await renderBar();
    await expectCentreIcon('add');

    fireEvent.press(screen.getByTestId('centre-action-button'));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('Routines', {
      screen: 'NewRoutine',
      params: undefined,
      initial: false,
    });
  });
});
