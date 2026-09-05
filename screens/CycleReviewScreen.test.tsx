import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import CycleReviewScreen from './CycleReviewScreen';
import { ThemeProvider } from '../context/ThemeContext';
import { SettingsProvider } from '../context/SettingsContext';
import '../utils/i18n';
import {
  applyReview,
  editProposalValue,
  loadCycleReview,
  resolveProposal,
  startNextCycle,
  type ReviewData,
} from '../utils/cycleReview';

/**
 * Regression test for the found-in-review defect: resolving one proposal used to call the
 * screen's own `reload()`, which re-runs `loadCycleReview` — the same function that regenerates
 * every proposal back to 'pending' the instant it sees a fully-resolved, still-due review (its
 * signal for "an old, already-applied review has been superseded"). Accepting the LAST pending
 * proposal walked straight into that: the reload it triggered wiped every decision back to
 * pending before the confirm button ever had a chance to enable, and even short of the last one,
 * any reload after a resolve could re-render a sibling lift as unresolved again. The fix patches
 * the one resolved proposal into local state instead of reloading; this test proves it by
 * accepting two lifts in sequence and asserting BOTH still read as accepted afterwards.
 */

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: () => ({
    runAsync: jest.fn(),
    getFirstAsync: jest.fn(),
    getAllAsync: jest.fn(),
  }),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    require('react').useEffect(callback, []);
  },
}));

jest.mock('../utils/cycleReview', () => {
  const actual = jest.requireActual('../utils/cycleReview');
  return {
    ...actual,
    loadCycleReview: jest.fn(),
    resolveProposal: jest.fn(),
    editProposalValue: jest.fn(),
    applyReview: jest.fn(),
    startNextCycle: jest.fn(),
  };
});

const mockLoadCycleReview = loadCycleReview as jest.MockedFunction<typeof loadCycleReview>;
const mockResolveProposal = resolveProposal as jest.MockedFunction<typeof resolveProposal>;
const mockEditProposalValue = editProposalValue as jest.MockedFunction<typeof editProposalValue>;
const mockApplyReview = applyReview as jest.MockedFunction<typeof applyReview>;
const mockStartNextCycle = startNextCycle as jest.MockedFunction<typeof startNextCycle>;

/** Two pending TM proposals — the server's own truth, unaffected by anything the screen does. */
const baseReview = (): ReviewData => ({
  routine: {
    routineId: 1,
    name: 'Demo Routine',
    unit: 'kg',
    roundingIncrement: 2.5,
    progressionRule: 'wave',
    tmIncrementUpper: 2.5,
    tmIncrementLower: 5,
    cycleWeeks: 4,
  },
  cycle: { cycleId: 6, cycleNumber: 6, weeks: 4, status: 'active', currentWeek: 4 },
  atCycleEnd: true,
  proposals: [
    {
      proposalId: 1,
      sessionExerciseId: 10,
      exerciseName: 'Barbell Full Squat',
      role: 'main',
      currentTarget: 100,
      proposedTarget: 105,
      unit: 'kg',
      reason: 'Cumpliste el objetivo, +5 kg',
      status: 'pending',
      advisory: false,
      isTmProposal: true,
    },
    {
      proposalId: 2,
      sessionExerciseId: 11,
      exerciseName: 'Barbell Bench Press',
      role: 'main',
      currentTarget: 70,
      proposedTarget: 72.5,
      unit: 'kg',
      reason: 'Cumpliste el objetivo, +2.5 kg',
      status: 'pending',
      advisory: false,
      isTmProposal: true,
    },
  ],
  amrap: [],
});

const goBackMock = jest.fn();
const route = { params: { routineId: 1, cycleId: 6 } } as never;
const navigation = { goBack: goBackMock } as never;

const renderScreen = () => {
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 0, height: 0 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <ThemeProvider>
        <SettingsProvider>
          <CycleReviewScreen navigation={navigation} route={route} />
        </SettingsProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
};

const acceptedState = (proposalId: number) =>
  within(screen.getByTestId(`review-proposal-${proposalId}`)).getByRole('tab', {
    name: 'Accept',
  });

beforeEach(() => {
  jest.clearAllMocks();
  // Every call returns the SAME still-pending server truth — exactly what a buggy reload would
  // splat back over an in-progress resolution.
  mockLoadCycleReview.mockImplementation(() => Promise.resolve(baseReview()));
  mockResolveProposal.mockResolvedValue(undefined);
  mockEditProposalValue.mockResolvedValue(undefined);
  mockApplyReview.mockResolvedValue({ completed: false });
  mockStartNextCycle.mockResolvedValue(7);
});

describe('CycleReviewScreen — resolving one proposal never reverts another', () => {
  it('keeps both lifts accepted after accepting them one after another', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('review-proposal-1')).toBeTruthy();
      expect(screen.getByTestId('review-proposal-2')).toBeTruthy();
    });

    fireEvent.press(acceptedState(1));
    await waitFor(() => {
      expect(mockResolveProposal).toHaveBeenCalledWith(expect.anything(), 1, 'accepted');
    });
    await waitFor(() => {
      expect(acceptedState(1).props.accessibilityState.selected).toBe(true);
    });

    fireEvent.press(acceptedState(2));
    await waitFor(() => {
      expect(mockResolveProposal).toHaveBeenCalledWith(expect.anything(), 2, 'accepted');
    });

    // The regression: lift 1 must still read accepted after lift 2 was resolved.
    expect(acceptedState(1).props.accessibilityState.selected).toBe(true);
    expect(acceptedState(2).props.accessibilityState.selected).toBe(true);

    // `loadCycleReview` never ran again after the initial load — resolving locally, not reloading,
    // is what makes the above possible even when the real function would regenerate everything.
    expect(mockLoadCycleReview).toHaveBeenCalledTimes(1);
  });
});

describe('CycleReviewScreen — the routine or cycle can be gone by the time this screen loads', () => {
  it('renders EmptyState with a way back instead of an error dialog', async () => {
    mockLoadCycleReview.mockRejectedValue(new Error('Unknown routine 1'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('cycle-review-not-found-empty-state')).toBeTruthy();
    });
    expect(alertSpy).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('Back'));
    expect(goBackMock).toHaveBeenCalledTimes(1);

    alertSpy.mockRestore();
  });

  it('still alerts on a genuine load failure, unrelated to the routine or cycle existing', async () => {
    mockLoadCycleReview.mockRejectedValue(new Error('database is locked'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    renderScreen();

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('cycle-review-not-found-empty-state')).toBeNull();

    alertSpy.mockRestore();
  });
});
