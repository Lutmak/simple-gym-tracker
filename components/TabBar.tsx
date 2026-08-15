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
import { dayStampOf, loadSessionQueue, type SessionQueueState } from '../utils/today';
import { centreActionFor, type CentreLabelKind } from '../utils/shell';
import { fontSize, spacing, tabBar, tabIndicator, touchTarget } from '../utils/scale';
import type { RoutineDatabase } from '../utils/routineActions';
import { Button } from './Button';

/**
 * The navigation shell (SPECS.md V2): five slots — four tabs around a raised
 * centre action button that answers the session queue (M1). The bar is bespoke
 * because the centre button is not a tab: it is the app's one primary action,
 * contextual, never disabled and never a dead end. Everything it renders comes
 * from the tokens and the scale; the only logic it owns is translating the pure
 * centre action (utils/shell.ts) into copy and a navigation destination.
 *
 * The bar loads the queue itself (pure DB reads, no React in utils/today.ts):
 * on mount, on every tab switch, and on every navigation state change — a
 * finished or resolved session leaves the bar on the correct label without any
 * screen telling it to reload. Resolutions that happen in place (no navigation
 * event) announce themselves through the queue-revision context; the bar
 * reloads on every revision bump.
 *
 * The centre button takes its natural width — the four tabs share the rest —
 * so the pill never overlaps a neighbour, whatever the longest label is. It is
 * raised half its height above the bar line; the hitSlop keeps the raised part
 * inside its touch target.
 *
 * The bar reserves that raised half as its own top padding rather than letting
 * the button draw outside the bar's box. A transform does not affect layout, so
 * without the padding the pill floats over whatever the screen has at its
 * bottom edge — observed on the emulator, 2026-08-15, covering the last card of
 * Settings. Reserving it here fixes every screen at once, including the ones
 * Phases H–S have not rebuilt yet, because React Navigation lays the scene out
 * above the bar's measured height.
 */

interface TabConfig {
  routeName: string;
  labelKey: string;
  icon: string;
  iconActive: string;
}

const TAB_CONFIG: readonly TabConfig[] = [
  { routeName: 'Home', labelKey: 'home', icon: 'home-outline', iconActive: 'home' },
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

const CENTRE_LABEL_KEYS: Record<CentreLabelKind, string> = {
  start: 'startSession',
  continue: 'continueSession',
  resolve: 'resolveSession',
  freeLog: 'freeLogging',
};

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
  const { revision } = useQueueRevision();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const db = useSQLiteContext();
  const [queue, setQueue] = useState<SessionQueueState | null>(null);

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
    loadSessionQueue(routineDb, dayStampOf(new Date()))
      .then(setQueue)
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

  const action = queue === null ? null : centreActionFor(queue);
  const centreLabel =
    action === null ? t('freeLogging') : t(CENTRE_LABEL_KEYS[action.label]);

  const onCentrePress = () => {
    const current = action ?? { label: 'freeLog' as const, weekSessionId: null };
    if (current.label === 'resolve') {
      navigation.navigate('Home');
      return;
    }
    if (current.label === 'freeLog') {
      navigation.navigate('Home', { screen: 'FreeLogging' });
      return;
    }
    navigation.navigate('Home', {
      screen: 'StartSession',
      params: { weekSessionId: current.weekSessionId },
    });
  };

  return (
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
          <Button
            label={centreLabel}
            onPress={onCentrePress}
            style={styles.centreButton}
            hitSlop={{ top: touchTarget.control / 2 }}
            testID="centre-action-button"
          />
        </View>
        {TAB_CONFIG.slice(TABS_LEFT_OF_CENTRE).map(renderTab)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: touchTarget.control / 2,
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
    justifyContent: 'center',
  },
  centreButton: {
    paddingHorizontal: spacing.card,
    transform: [{ translateY: -touchTarget.control / 2 }],
  },
});
