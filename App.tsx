  // App.tsx
  import React, {useState, useEffect, useRef } from 'react';
  import { View, ActivityIndicator, StatusBar, StyleSheet } from 'react-native';
  import * as FileSystem from 'expo-file-system/legacy';
  import { SQLiteProvider, type SQLiteBindParams, type SQLiteDatabase } from 'expo-sqlite';
  import { Asset } from 'expo-asset';
  import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
  import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  NavigationContainerRef,
  type NavigatorScreenParams,
} from '@react-navigation/native';
  import type { Theme } from '@react-navigation/native';
  import { GestureHandlerRootView } from 'react-native-gesture-handler';
  import './utils/i18n'; // Ensure this is present to initialize i18n
  import i18n from './utils/i18n'; // Import the i18n instance
  import { I18nextProvider, useTranslation } from 'react-i18next';
  import Settings from './screens/Settings';
  import ProgressScreen from './screens/ProgressScreen';
  import InicioScreen from './screens/InicioScreen';
  import StartSessionScreen from './screens/StartSessionScreen';
  import FreeLoggingScreen from './screens/FreeLoggingScreen';
  import RoutinesListScreen from './screens/RoutinesListScreen';
  import RoutineDetailsScreen from './screens/RoutineDetailsScreen';
  import NewRoutineScreen from './screens/NewRoutineScreen';
  import EditRoutineScreen from './screens/EditRoutineScreen';
  import FiveThreeOneSetupScreen from './screens/FiveThreeOneSetupScreen';
import CycleReviewScreen from './screens/CycleReviewScreen';
import SessionSummaryScreen from './screens/SessionSummaryScreen';
  import { SettingsProvider, useSettings } from './context/SettingsContext';
  import { ThemeProvider, useTheme } from './context/ThemeContext';
  import { QueueRevisionProvider } from './context/QueueRevision';
  import * as Notifications from 'expo-notifications';
  import { runSchema } from './utils/schema';
  import { checkAndSyncPermissions } from './utils/notificationUtils';
  import { fontSize } from './utils/scale';
  import { getTokens, type ThemeMode } from './utils/theme';
import { TabBar } from './components/TabBar';
import type { ProgressFocus } from './utils/routineProgress';
import type { SessionSummaryFinishContext } from './utils/sessionFinish';
import type { SessionSummary } from './utils/sessionSummary';



  const Bottom = createBottomTabNavigator<RootTabParamList>();

  /**
   * React Navigation's own palette, derived from the tokens (ENGINEERING.md §4:
   * the container used to mount without a theme prop, so React Navigation kept
   * its light DefaultTheme while the app ran dark). Every colour React
   * Navigation paints — headers, tab-bar defaults, transitions — now resolves
   * through the same tokens as everything else; a screen no longer survives
   * only by overriding each surface by hand.
   */
  const navigationThemeFor = (mode: ThemeMode): Theme => {
    const tokens = getTokens(mode);
    return {
      ...(mode === 'dark' ? DarkTheme : DefaultTheme),
      dark: mode === 'dark',
      colors: {
        primary: tokens.accent,
        background: tokens.surface,
        card: tokens.surfaceRaised,
        text: tokens.textPrimary,
        border: tokens.divider,
        notification: tokens.accent,
      },
    };
  };

  



  

  const resetDatabase = async () => {
    try {
      const dbName = "SimpleDB.db";
      const dbFilePath = `${FileSystem.documentDirectory}SQLite/${dbName}`;


      // Check if the database file exists
      const fileInfo = await FileSystem.getInfoAsync(dbFilePath);
      if (fileInfo.exists) {
        // Delete the existing database file
        console.log("Deleting existing database...");
        await FileSystem.deleteAsync(dbFilePath, { idempotent: true });
        console.log("Database deleted.");
      }

      // Recreate the database folder if necessary
      await FileSystem.makeDirectoryAsync(
        `${FileSystem.documentDirectory}SQLite`,
        { intermediates: true }
      );

      // Initialize a new database (or download a fresh copy)
      const dbAsset = require("./assets/SimpleDB.db");
      const dbUri = Asset.fromModule(dbAsset).uri;

      console.log("Downloading new database...");
      await FileSystem.downloadAsync(dbUri, dbFilePath);
      console.log("New database downloaded.");
    } catch (error) {
      console.error("Error resetting database:", error);
    }
  };



  const loadDatabase = async () => {
    try {
      const dbName = "SimpleDB.db";
      const dbAsset = require("./assets/SimpleDB.db");
      const dbUri = Asset.fromModule(dbAsset).uri;
      const dbFilePath = `${FileSystem.documentDirectory}SQLite/${dbName}`;
  
      const fileInfo = await FileSystem.getInfoAsync(dbFilePath);
  
      if (!fileInfo.exists) {
        await FileSystem.makeDirectoryAsync(
          `${FileSystem.documentDirectory}SQLite`,
          { intermediates: true }
        );
        console.log("Downloading database...");
        await FileSystem.downloadAsync(dbUri, dbFilePath);
        
      } else {
        console.log("Database already exists.");
 
      }
    } catch (error) {
      console.error("Error in loadDatabase:", error);
    }
  };


  


  export type RoutinesStackParamList = {
    RoutinesList: undefined;
    /** R1: the one door to a new routine — from scratch, from a preset, or 5/3/1. */
    NewRoutine: undefined;
    RoutineDetails: { routineId?: number; presetKey?: string };
    EditRoutine: { routineId: number };
    FiveThreeOneSetup: { presetKey: string };
    CycleReview: { routineId: number; cycleId: number };
  };

  export type InicioStackParamList = {
    /** H2 consumes this request and presents its standard resolution Sheet. */
    InicioIndex: { resolutionWeekSessionId?: number } | undefined;
    StartSession: { weekSessionId: number };
    FreeLogging: undefined;
    SessionSummary: SessionSummaryRouteParams;
  };

  export interface SessionSummaryRouteParams {
    sessionName: string;
    routineName: string;
    workoutDate: number;
    sessionKind: 'planned' | 'free';
    summary: SessionSummary;
    finishContext: SessionSummaryFinishContext | null;
  }

  export type RootTabParamList = {
    Inicio: NavigatorScreenParams<InicioStackParamList> | undefined;
    /** `exercise` is R2's link from the shared exercise sheet to that exercise's full chart. */
    Progress: { focus?: ProgressFocus; exercise?: string } | undefined;
    Routines: NavigatorScreenParams<RoutinesStackParamList> | undefined;
    Settings: undefined;
  };

// The schema lives in utils/schema.ts (pure, testable); this is the app-side
// adapter that runs it before any screen renders. The bundled assets/SimpleDB.db
// predates the new model: runSchema drops the obsolete Iteration 2 tables and
// adds the per-row unit column to a legacy Weight_Log.
const initialiseSchema = async (db: SQLiteDatabase) => {
  await runSchema({
    exec: (sql) => db.execAsync(sql),
    run: (sql, params) =>
      db.runAsync(sql, (params ?? []) as unknown as SQLiteBindParams).then(
        () => undefined,
      ),
    getAll: (sql, params) =>
      db.getAllAsync(sql, (params ?? []) as unknown as SQLiteBindParams),
  });
};

// Define AppContent here
const InicioStackNavigator = createNativeStackNavigator<InicioStackParamList>();

const InicioStack = () => {
  const { theme } = useTheme();
  return (
    <InicioStackNavigator.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerTitleStyle: { fontSize: fontSize.cardTitle, fontWeight: '700' },
        contentStyle: { backgroundColor: theme.background },
      }}
    >
      <InicioStackNavigator.Screen
        name="InicioIndex"
        component={InicioScreen}
        options={{ headerShown: false }}
      />
      <InicioStackNavigator.Screen
        name="StartSession"
        component={StartSessionScreen}
        options={{ headerShown: false }}
      />
      <InicioStackNavigator.Screen
        name="FreeLogging"
        component={FreeLoggingScreen}
        options={{ headerShown: false }}
      />
      <InicioStackNavigator.Screen
        name="SessionSummary"
        component={SessionSummaryScreen}
        options={{ headerShown: false }}
      />
    </InicioStackNavigator.Navigator>
  );
};

const RoutinesStackNavigator = createNativeStackNavigator<RoutinesStackParamList>();

const RoutinesStack = () => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  return (
    <RoutinesStackNavigator.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerTitleStyle: { fontSize: fontSize.cardTitle, fontWeight: '700' },
        contentStyle: { backgroundColor: theme.background },
      }}
    >
      <RoutinesStackNavigator.Screen
        name="RoutinesList"
        component={RoutinesListScreen}
        options={{ headerShown: false }}
      />
      <RoutinesStackNavigator.Screen
        name="NewRoutine"
        component={NewRoutineScreen}
        options={{ headerShown: false }}
      />
      <RoutinesStackNavigator.Screen
        name="RoutineDetails"
        component={RoutineDetailsScreen}
        options={{ headerShown: false }}
      />
      <RoutinesStackNavigator.Screen
        name="EditRoutine"
        component={EditRoutineScreen}
        options={{ title: t('editRoutineTitle') }}
      />
      <RoutinesStackNavigator.Screen
        name="FiveThreeOneSetup"
        component={FiveThreeOneSetupScreen}
        options={{ title: t('fiveThreeOneSetupTitle') }}
      />
      <RoutinesStackNavigator.Screen
        name="CycleReview"
        component={CycleReviewScreen}
        options={{ title: t('cycleReviewTitle') }}
      />
    </RoutinesStackNavigator.Navigator>
  );
};

const AppContent = () => {
  const { theme, tokens } = useTheme();
  const { notificationPermissionGranted, setNotificationPermissionGranted } =
    useSettings();
  const navigationRef = useRef<NavigationContainerRef<RootTabParamList>>(null);

  useEffect(() => {
    if (notificationPermissionGranted) {
      checkAndSyncPermissions(setNotificationPermissionGranted);
    }
  }, [notificationPermissionGranted, setNotificationPermissionGranted]);

  // No second SQLiteProvider anywhere: expo-sqlite's suspense path keeps one module-level
  // database instance and reopens it whenever a provider mounts with props that differ from the
  // current one, so a second provider closes the database out from under screens that are still
  // querying it. Everything else uses useSQLiteContext().
  return (
    <>
      <StatusBar barStyle={theme.type === 'light' ? "dark-content" : "light-content"} />
      <React.Suspense
        fallback={
          <View style={{ flex:1 }}>
            <ActivityIndicator size={'large'}/>
          </View>
        }
      />
  <SQLiteProvider databaseName="SimpleDB.db" useSuspense onInit={initialiseSchema}>
    <QueueRevisionProvider>
    <NavigationContainer ref={navigationRef} theme={navigationThemeFor(tokens.mode)}>
        <Bottom.Navigator
          tabBar={(props) => <TabBar {...props} />}
          screenOptions={{
            headerShown: false,
          }}
        >
          <Bottom.Screen
            name="Inicio"
            component={InicioStack}
          />
          <Bottom.Screen
            name="Progress"
            component={ProgressScreen}
          />

       <Bottom.Screen
         name="Routines"
         component={RoutinesStack}
       />
       <Bottom.Screen
         name="Settings"
         component={Settings}
       />

                 </Bottom.Navigator>
    </NavigationContainer>
    </QueueRevisionProvider>
                 </SQLiteProvider>
         </>
  );
};



  export default function App() {
    const [dbLoaded, setDbLoaded] = useState(false);
    
    useEffect(() => {
      loadDatabase().then(() => setDbLoaded(true));
      
      // Configure notification permissions
      const setupNotifications = async () => {
        // Don't request permissions on app start - this will be handled when needed
        await Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
          }),
        });
        
      };
      
      setupNotifications();
      
      return () => {
        // Clean up if needed
      };
    }, []);

    React.useEffect(() => {
      (async () => {
        try {
          // await resetDatabase();
          await loadDatabase();
          setDbLoaded(true);
        } catch (e) {
          console.error("Database loading error:", e);
        }
      })();
    }, []);
  
    if (!dbLoaded) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="black" />
        </View>
      );
    }


    return (
      <ThemeProvider>
      <GestureHandlerRootView>
          <SettingsProvider>
          <I18nextProvider i18n={i18n}>
          <AppContent/>
          </I18nextProvider>
          </SettingsProvider>
        
      </GestureHandlerRootView>
    </ThemeProvider>
    );
  }

  const styles = StyleSheet.create({
    permissionBanner: {
      backgroundColor: '#FFF9C4',
      padding: 12,
      borderBottomWidth: 1,
      borderBottomColor: '#E0E0E0',
    },
    permissionText: {
      fontSize: 14,
      color: '#333333',
      textAlign: 'center',
    },
  });
