import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import InicioScreen from './InicioScreen';
import { ThemeProvider } from '../context/ThemeContext';
import { QueueRevisionProvider } from '../context/QueueRevision';
import { loadInicioData } from '../utils/inicio';
import { resolvePullForwardSession } from '../utils/today';
import type { InicioData } from '../utils/inicio';

/**
 * SPEC.md U2's six states, driven at the screen level exactly like `TabBar.test.tsx` drives the
 * centre button: the database and navigation are mocked, `loadInicioData` is controlled directly,
 * and the two shared sheets (`SessionDetailSheet`, `ExerciseSheet`) are stubbed to a testID that
 * echoes their props — their own DB-backed internals belong to the tasks that own those files, not
 * to this one. What is asserted here is Inicio's own decision: which state renders for a given
 * queue, and what pressing its controls does.
 */

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: () => ({
    runAsync: jest.fn(),
    getFirstAsync: jest.fn(),
    getAllAsync: jest.fn(),
  }),
}));

jest.mock('../context/SettingsContext', () => ({
  useSettings: () => ({ firstWeekday: 'Monday' }),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => {
    const ReactActual = require('react');
    ReactActual.useEffect(() => {
      callback();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
  },
}));

jest.mock('../utils/inicio', () => {
  const actual = jest.requireActual('../utils/inicio');
  return { ...actual, loadInicioData: jest.fn() };
});

jest.mock('../utils/today', () => {
  const actual = jest.requireActual('../utils/today');
  return { ...actual, resolvePullForwardSession: jest.fn() };
});

jest.mock('../components/SessionDetailSheet', () => {
  const ReactActual = require('react');
  const { Text } = require('react-native');
  return {
    SessionDetailSheet: (props: { target: unknown; visible: boolean }) =>
      props.target === null
        ? null
        : ReactActual.createElement(
            Text,
            { testID: 'mock-session-detail' },
            JSON.stringify({ target: props.target, visible: props.visible }),
          ),
  };
});

jest.mock('../components/ExerciseSheet', () => {
  const ReactActual = require('react');
  const { Text } = require('react-native');
  return {
    ExerciseSheet: (props: { exercise: { name: string } | null }) =>
      props.exercise === null
        ? null
        : ReactActual.createElement(Text, { testID: 'mock-exercise-sheet' }, props.exercise.name),
  };
});

const mockLoadInicioData = loadInicioData as jest.MockedFunction<typeof loadInicioData>;
const mockResolvePullForward = resolvePullForwardSession as jest.MockedFunction<
  typeof resolvePullForwardSession
>;

const routine = { routineId: 1, name: 'Demo', unit: 'kg' as const, roundingIncrement: 2.5 };

const restDay = (offset: number) => ({
  stamp: 1000 + offset,
  weekday: offset,
  status: 'rest' as const,
  sessionName: null,
  target: null,
});

const baseData = (overrides: Partial<InicioData> = {}): InicioData => ({
  queue: {
    routine,
    head: null,
    resolution: null,
    upcoming: null,
    review: null,
    ...(overrides.queue ?? {}),
  },
  week: overrides.week ?? {
    startStamp: 1000,
    days: [0, 1, 2, 3, 4, 5, 6].map(restDay),
    planned: 0,
    completed: 0,
    moved: 0,
    discarded: 0,
    pending: 0,
  },
  streak: overrides.streak ?? { weeks: 3, current: { planned: 0, completed: 0 } },
  cycleStats: overrides.cycleStats ?? { adherencePercent: 80, cyclesCompleted: 2 },
  upcomingSessions: overrides.upcomingSessions ?? [],
  mainLiftColours: overrides.mainLiftColours ?? new Map(),
  durationMinutes: overrides.durationMinutes ?? null,
});

const mockNavigate = jest.fn();
const mockSetParams = jest.fn();
const mockParentNavigate = jest.fn();

const buildNavigation = () => ({
  navigate: mockNavigate,
  setParams: mockSetParams,
  addListener: () => () => {},
  isFocused: () => true,
  getParent: () => ({ navigate: mockParentNavigate }),
});

const renderScreen = async (data: InicioData, params: Record<string, unknown> = {}) => {
  mockLoadInicioData.mockResolvedValue(data);
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 0, height: 0 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <ThemeProvider>
        <QueueRevisionProvider>
          <InicioScreen
            navigation={buildNavigation() as never}
            route={{ key: 'InicioIndex', name: 'InicioIndex', params } as never}
          />
        </QueueRevisionProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
  // `render` returns before the mocked `loadInicioData` promise settles — an empty async `act`
  // flushes that pending microtask and the `setData` it makes, inside `act` (the same fix
  // `TabBar.test.tsx` uses for its own initial queue load).
  await act(async () => {});
};

beforeEach(() => {
  mockNavigate.mockClear();
  mockSetParams.mockClear();
  mockParentNavigate.mockClear();
  mockResolvePullForward.mockClear();
});

describe('Inicio — no routine', () => {
  it('shows the empty state and nothing else', async () => {
    await renderScreen(baseData({ queue: { routine: null, head: null, resolution: null, upcoming: null, review: null } }));

    expect(screen.getByTestId('inicio-no-routine')).toBeTruthy();
    expect(screen.queryByTestId('inicio-hero')).toBeNull();

    fireEvent.press(screen.getByText('goToRoutines'));
    expect(mockParentNavigate).toHaveBeenCalledWith('Routines');
  });
});

describe('Inicio — due today', () => {
  const dueData = baseData({
    queue: {
      routine,
      resolution: 'due',
      upcoming: null,
      review: null,
      head: {
        weekSessionId: 7,
        sessionId: 3,
        name: 'Press Day',
        weekday: 1,
        date: 500,
        originDate: 500,
        doTodayAvailable: true,
        todayOccupiedBy: null,
        exercises: [
          { name: 'Press militar', targetSets: 3, targetReps: 5, targetWeight: 62.5, unit: 'kg', isAmrap: true, sortOrder: 1, role: 'main' },
          { name: 'Jalón al pecho', targetSets: 3, targetReps: 10, targetWeight: 120, unit: 'lb', isAmrap: false, sortOrder: 2, role: 'accessory' },
        ],
      },
    },
    mainLiftColours: new Map([['Press militar', 0]]),
    upcomingSessions: [
      { weekSessionId: 8, sessionId: 4, name: 'Squat Day', weekday: 2, date: 600 },
    ],
  });

  it('shows the session, its exercises with the main lift\'s dot, the stats and "PRÓXIMAS"', async () => {
    await renderScreen(dueData);

    expect(screen.getByTestId('inicio-due')).toBeTruthy();
    expect(screen.getByText('Press Day')).toBeTruthy();
    expect(screen.getByText('Press militar')).toBeTruthy();
    expect(screen.getByTestId('inicio-exercise-dot-Press militar')).toBeTruthy();
    expect(screen.queryByTestId('inicio-exercise-dot-Jalón al pecho')).toBeNull();

    expect(screen.getByTestId('inicio-stat-streak')).toBeTruthy();
    expect(screen.getByText('80')).toBeTruthy();
    expect(screen.getByTestId('inicio-upcoming')).toBeTruthy();

    fireEvent.press(screen.getByText('inicioStartSession'));
    expect(mockNavigate).toHaveBeenCalledWith('StartSession', { weekSessionId: 7 });
  });

  it('opens the shared exercise sheet when a row is tapped', async () => {
    await renderScreen(dueData);
    fireEvent.press(screen.getByText('Jalón al pecho'));
    expect(screen.getByTestId('mock-exercise-sheet')).toHaveTextContent('Jalón al pecho');
  });
});

describe('Inicio — in progress (continue)', () => {
  it('reads "Continue" once the head was moved onto today', async () => {
    await renderScreen(
      baseData({
        queue: {
          routine,
          resolution: 'due',
          upcoming: null,
          review: null,
          head: {
            weekSessionId: 7, sessionId: 3, name: 'Press Day', weekday: 1,
            date: 500, originDate: 400, doTodayAvailable: true, todayOccupiedBy: null, exercises: [],
          },
        },
      }),
    );
    expect(screen.getByText('continueSession')).toBeTruthy();
  });
});

describe('Inicio — unresolved', () => {
  it('opens the H2 resolution request when pressed', async () => {
    await renderScreen(
      baseData({
        queue: {
          routine,
          resolution: 'unresolved',
          upcoming: null,
          review: null,
          head: {
            weekSessionId: 9, sessionId: 3, name: 'Bench Day', weekday: 3,
            date: 300, originDate: 300, doTodayAvailable: true, todayOccupiedBy: null, exercises: [],
          },
        },
      }),
    );

    expect(screen.getByTestId('inicio-unresolved')).toBeTruthy();
    fireEvent.press(screen.getByTestId('inicio-resolve-session'));
    expect(mockNavigate).toHaveBeenCalledWith('InicioIndex', { resolutionWeekSessionId: 9 });
  });
});

describe('Inicio — review pending', () => {
  it('opens the cycle review on the parent navigator', async () => {
    await renderScreen(
      baseData({
        queue: {
          routine, head: null, resolution: null, upcoming: null,
          review: { cycleId: 5, cycleNumber: 2, completedSessions: 16, totalSessions: 16 },
        },
      }),
    );

    expect(screen.getByTestId('inicio-review')).toBeTruthy();
    fireEvent.press(screen.getByTestId('inicio-review-open'));
    expect(mockParentNavigate).toHaveBeenCalledWith('Routines', {
      screen: 'CycleReview',
      params: { routineId: 1, cycleId: 5 },
    });
  });
});

describe('Inicio — rest day', () => {
  it('shows the next session and pulls it forward on press', async () => {
    mockResolvePullForward.mockResolvedValue(42);
    await renderScreen(
      baseData({
        queue: {
          routine, head: null, resolution: null, review: null,
          upcoming: { weekSessionId: 42, sessionId: 5, name: 'Squat Day', weekday: 1, date: 900 },
        },
        upcomingSessions: [{ weekSessionId: 42, sessionId: 5, name: 'Squat Day', weekday: 1, date: 900 }],
      }),
    );

    expect(screen.getByTestId('inicio-rest')).toBeTruthy();
    expect(screen.getByTestId('inicio-adelantar')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('inicio-adelantar'));
    });
    expect(mockResolvePullForward).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('StartSession', { weekSessionId: 42 });
  });

  it('has no "Adelantar" row when there is nothing seeded to pull', async () => {
    await renderScreen(baseData());
    expect(screen.getByTestId('inicio-rest')).toBeTruthy();
    expect(screen.queryByTestId('inicio-adelantar')).toBeNull();
  });
});

describe('Inicio — the week strip opens the session sheet', () => {
  it('passes the tapped day\'s target to SessionDetailSheet', async () => {
    const target = { routineId: 1, cycleId: 1, cycleNumber: 1, weekNumber: 1, sessionId: 3 };
    const days = [0, 1, 2, 3, 4, 5, 6].map(restDay);
    days[0] = { ...days[0], status: 'completed', sessionName: 'Squat Day', target };

    await renderScreen(baseData({ week: { startStamp: 1000, days, planned: 1, completed: 1, moved: 0, discarded: 0, pending: 0 } }));

    expect(screen.queryByTestId('mock-session-detail')).toBeNull();
    fireEvent.press(screen.getByTestId(`inicio-week-overview-day-${1000}`));
    expect(screen.getByTestId('mock-session-detail')).toHaveTextContent(
      JSON.stringify({ target: { kind: 'session', ...target }, visible: true }),
    );
  });
});
