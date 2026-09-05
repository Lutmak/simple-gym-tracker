import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useSQLiteContext } from 'expo-sqlite';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { useQueueRevision } from '../context/QueueRevision';
import { dayStampOf, loadSessionQueue, resolvePullForwardSession, type SessionQueueState } from '../utils/today';
import { loadReviewEntry, type ReviewEntry } from '../utils/cycleReview';
import { centreActionFor, type CentreActionKind } from '../utils/shell';
import { centreButton, fontSize, spacing, tabBar, tabIndicator } from '../utils/scale';
import type { RoutineDatabase } from '../utils/routineActions';
import { Row } from './Row';
import { Sheet } from './Sheet';

/**
 * The navigation shell (SPEC.md §4.3/§4.4): five slots — four tabs around a raised circular
 * centre action button that answers the session queue. The bar is bespoke because the centre
 * button is not a tab: it is the app's one primary action, contextual, never disabled and never
 * a dead end. Its **label never changes** — it always reads "Entrenar"/"Train" — only its icon
 * and what tapping it does follow the queue (`utils/shell.ts`, `centreActionFor`).
 *
 * The bar loads the queue itself (pure DB reads, no React in `utils/today.ts`): on mount, on
 * every tab switch, and on every navigation state change — a finished or resolved session leaves
 * the bar on the correct action without any screen telling it to reload. Resolutions that happen
 * in place (no navigation event) announce themselves through the queue-revision context; the bar
 * reloads on every revision bump.
 *
 * **Review is not decided by `centreActionFor`.** A pending cycle review (SPEC.md §3.4) needs a
 * database read — `loadReviewEntry` (`utils/cycleReview.ts`), owned by the Phase F work — that a
 * pure function cannot perform. The bar only asks that question when `centreActionFor` would
 * otherwise answer `restDay`: a cycle can only be complete-and-unreviewed once nothing else in
 * the routine is due, which is exactly the same precondition `restDay` already encodes, so the
 * two checks can never disagree about when to fire.
 *
 * **Rest day opens a Sheet, never navigates.** "Adelantar la próxima sesión" pulls the next
 * upcoming session onto today (`resolvePullForwardSession`, SPEC.md §3.3) and opens it directly;
 * "Registro libre" is one row here, never the label on this button (the audit finding this bar
 * exists to fix).
 *
 * The centre button takes a fixed diameter, raised half its height above the bar line so its
 * centre sits on the icon row's centre line (§4.3); the bar reserves that overhang as its own top
 * padding rather than letting the button draw outside the bar's box — a transform does not affect
 * layout, so without the padding the raised part floats over whatever the screen has at its
 * bottom edge (ADR-0038, found on the emulator 2026-08-15).
 */

interface TabConfig {
  routeName: string;
  labelKey: string;
  icon: string;
  iconActive: string;
}

const TAB_CONFIG: readonly TabConfig[] = [
  { routeName: 'Inicio', labelKey: 'home', icon: 'home-outline', iconActive: 'home' },
  {
    routeName: 'Progress',
    labelKey: 'progress',
    icon: 'trending-up-outline',
    iconActive: 'trending-up',
  },
  { routeName: 'Routines', labelKey: 'routines', icon: 'barbell-outline', iconActive: 'barbell' },
  {
    routeName: 'Settings',
    labelKey: 'settings',
    icon: 'settings-outline',
    iconActive: 'settings',
  },
];

/** How many tabs sit to the left of the centre action button. */
const TABS_LEFT_OF_CENTRE = 2;

/** Every reachable state of the centre button (SPEC.md §4.4's table, plus `review`). */
type BarActionKind = CentreActionKind | 'review';

const CENTRE_ICON: Record<BarActionKind, string> = {
  start: 'play',
  continue: 'play',
  resolve: 'alert-circle',
  review: 'ribbon',
  restDay: 'moon',
  newRoutine: 'add',
};

const CENTRE_ACCESSIBILITY_KEY: Record<BarActionKind, string> = {
  start: 'startSession',
  continue: 'continueSession',
  resolve: 'resolveSession',
  review: 'reviewSessionAction',
  restDay: 'restDaySheetTitle',
  newRoutine: 'newRoutineAction',
};

interface BarAction {
  kind: BarActionKind;
  weekSessionId: number | null;
  review: ReviewEntry | null;
}

function TabItem({
  config,
  label,
  focused,
  onPress,
}: {
  config: TabConfig;
  label: string;
  focused: boolean;
  onPress: () => void;
}) {
  const { tokens } = useTheme();
  const color = focused ? tokens.accent : tokens.textSecondary;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.tab, pressed && { backgroundColor: tokens.inputFill }]}
    >
      <Ionicons
        name={focused ? config.iconActive : config.icon}
        size={tabBar.icon}
        color={color}
      />
      <Text
        style={[styles.tabLabel, { color, fontWeight: focused ? '700' : '500' }]}
        maxFontSizeMultiplier={1.5}
      >
        {label}
      </Text>
      <View
        style={[
          styles.indicator,
          { backgroundColor: focused ? tokens.accent : 'transparent' },
        ]}
      />
    </Pressable>
  );
}

export function TabBar({ state, insets }: BottomTabBarProps) {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const { revision, bump } = useQueueRevision();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const db = useSQLiteContext();
  const [queue, setQueue] = useState<SessionQueueState | null>(null);
  const [action, setAction] = useState<BarAction | null>(null);
  const [restDaySheetOpen, setRestDaySheetOpen] = useState(false);
  const [pullingForward, setPullingForward] = useState(false);

  const routineDb: RoutineDatabase = {
    run: (sql, params) => db.runAsync(sql, (params ?? []) as never[]),
    get: async (sql, params) =>
      (await db.getFirstAsync<Record<string, unknown>>(
        sql,
        (params ?? []) as never[],
      )) ?? undefined,
    getAll: async (sql, params) =>
      db.getAllAsync<Record<string, unknown>>(sql, (params ?? []) as never[]),
  };

  const reload = useCallback(() => {
    const today = dayStampOf(new Date());
    loadSessionQueue(routineDb, today)
      .then(async (nextQueue) => {
        setQueue(nextQueue);
        const base = centreActionFor(nextQueue);
        if (base.kind !== 'restDay') {
          setAction({ kind: base.kind, weekSessionId: base.weekSessionId, review: null });
          return;
        }
        const review = await loadReviewEntry(routineDb);
        setAction(
          review === null
            ? { kind: 'restDay', weekSessionId: null, review: null }
            : { kind: 'review', weekSessionId: null, review },
        );
      })
      .catch((error) =>
        console.error('Error loading the session queue for the tab bar:', error),
      );
  }, [db]);

  useEffect(() => {
    reload();
  }, [reload, state.index, revision]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('state', reload);
    return unsubscribe;
  }, [navigation, reload]);

  const renderTab = (config: TabConfig) => {
    const routeIndex = state.routes.findIndex((route) => route.name === config.routeName);
    if (routeIndex === -1) {
      return null;
    }
    return (
      <TabItem
        key={config.routeName}
        config={config}
        label={t(config.labelKey)}
        focused={state.index === routeIndex}
        onPress={() => {
          if (state.index !== routeIndex) {
            navigation.navigate(config.routeName);
          }
        }}
      />
    );
  };

  const onCentrePress = () => {
    if (action === null) {
      return;
    }
    switch (action.kind) {
      case 'start':
      case 'continue':
        navigation.navigate('Inicio', {
          screen: 'StartSession',
          params: { weekSessionId: action.weekSessionId },
        });
        return;
      case 'resolve':
        navigation.navigate('Inicio', {
          screen: 'InicioIndex',
          params: { resolutionWeekSessionId: action.weekSessionId ?? undefined },
        });
        return;
      case 'review':
        if (action.review !== null) {
          navigation.navigate('Routines', {
            screen: 'CycleReview',
            params: { routineId: action.review.routineId, cycleId: action.review.cycleId },
          });
        }
        return;
      case 'restDay':
        setRestDaySheetOpen(true);
        return;
      case 'newRoutine':
        navigation.navigate('Routines', { screen: 'NewRoutine' });
        return;
    }
  };

  const pullForward = async () => {
    if (pullingForward) {
      return;
    }
    setPullingForward(true);
    try {
      const weekSessionId = await resolvePullForwardSession(routineDb, dayStampOf(new Date()));
      bump();
      setRestDaySheetOpen(false);
      navigation.navigate('Inicio', { screen: 'StartSession', params: { weekSessionId } });
    } catch (error) {
      console.error('Error pulling the next session forward:', error);
    } finally {
      setPullingForward(false);
    }
  };

  const upcoming = queue?.upcoming ?? null;

  return (
    <>
      <View
        style={[
          styles.bar,
          {
            backgroundColor: tokens.surface,
            borderTopColor: tokens.divider,
            paddingBottom: insets.bottom,
            paddingHorizontal: Math.max(insets.left, insets.right),
          },
        ]}
      >
        <View style={styles.row}>
          {TAB_CONFIG.slice(0, TABS_LEFT_OF_CENTRE).map(renderTab)}
          <View style={styles.centreSlot}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                action === null ? t('centreButtonLabel') : t(CENTRE_ACCESSIBILITY_KEY[action.kind])
              }
              onPress={onCentrePress}
              hitSlop={{ top: centreButton.diameter - tabBar.icon }}
              testID="centre-action-button"
              style={styles.centreTouch}
            >
              {/*
               * An icon-sized reference box, matching a normal tab's icon height exactly, so the
               * label below it lands at the same row as every other tab's label. The visible
               * circle is the absolutely positioned sibling right after it: its bottom edge pins
               * to this box's bottom (the shared icon baseline) and it extends upward from there,
               * which is what "raised" means — never a transform on the label's own container,
               * or the label would rise with it and stop matching the other four (§4.3).
               */}
              <View style={styles.centreIconSlot}>
                <View style={[styles.centreCircle, { backgroundColor: tokens.accent }]}>
                  <Ionicons
                    name={action === null ? 'ellipse' : CENTRE_ICON[action.kind]}
                    size={centreButton.icon}
                    color={tokens.onAccent}
                  />
                </View>
              </View>
              <Text
                style={[styles.centreLabel, { color: tokens.textSecondary }]}
                maxFontSizeMultiplier={1.5}
              >
                {t('centreButtonLabel')}
              </Text>
            </Pressable>
          </View>
          {TAB_CONFIG.slice(TABS_LEFT_OF_CENTRE).map(renderTab)}
        </View>
      </View>

      <Sheet
        visible={restDaySheetOpen}
        onClose={() => setRestDaySheetOpen(false)}
        title={t('restDaySheetTitle')}
        testID="rest-day-sheet"
      >
        {upcoming !== null && upcoming.weekSessionId !== null && (
          <Row
            label={t('restDayPullForward')}
            detail={t('restDayPullForwardDetail')}
            detailBelow
            onPress={() => void pullForward()}
            disabled={pullingForward}
            divided
            testID="rest-day-pull-forward"
          />
        )}
        <Row
          label={t('freeLogging')}
          onPress={() => {
            setRestDaySheetOpen(false);
            navigation.navigate('Inicio', { screen: 'FreeLogging' });
          }}
          testID="rest-day-free-log"
        />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    // Reserves the circle's overhang above the shared icon baseline, so the raised button never
    // draws over whatever the screen has at its bottom edge (ADR-0038).
    paddingTop: centreButton.diameter - tabBar.icon,
  },
  row: {
    height: tabBar.height,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tab: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.inline,
  },
  tabLabel: {
    fontSize: fontSize.caption,
  },
  indicator: {
    width: tabIndicator.width,
    height: tabIndicator.height,
    borderRadius: tabIndicator.height / 2,
  },
  centreSlot: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: centreButton.diameter + spacing.card,
  },
  centreTouch: {
    alignItems: 'center',
    gap: spacing.inline,
  },
  centreIconSlot: {
    position: 'relative',
    height: tabBar.icon,
    width: centreButton.diameter,
  },
  centreCircle: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: centreButton.diameter,
    height: centreButton.diameter,
    borderRadius: centreButton.diameter / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centreLabel: {
    fontSize: fontSize.caption,
  },
});
