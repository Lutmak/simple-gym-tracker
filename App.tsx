  // App.tsx
  import React, {useState, useEffect, useRef } from 'react';
  import { View, ActivityIndicator, StatusBar, StyleSheet } from 'react-native';
  import * as FileSystem from 'expo-file-system/legacy';
  import { SQLiteProvider, type SQLiteBindParams, type SQLiteDatabase } from 'expo-sqlite';
  import { Asset } from 'expo-asset';
  import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
  import { createNativeStackNavigator } from '@react-navigation/native-stack';
  import { DarkTheme, DefaultTheme, NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
  import type { Theme } from '@react-navigation/native';
  import { GestureHandlerRootView } from 'react-native-gesture-handler';
  import './utils/i18n'; // Ensure this is present to initialize i18n
  import i18n from './utils/i18n'; // Import the i18n instance
  import { I18nextProvider, useTranslation } from 'react-i18next';
  import Settings from './screens/Settings';
  import ProgressScreen from './screens/ProgressScreen';
  import HomeScreen from './screens/HomeScreen';
  import StartSessionScreen from './screens/StartSessionScreen';
  import FreeLoggingScreen from './screens/FreeLoggingScreen';
  import RoutinesListScreen from './screens/RoutinesListScreen';
  import RoutineDetailsScreen from './screens/RoutineDetailsScreen';
  import ActivateRoutineScreen from './screens/ActivateRoutineScreen';
  import EditRoutineScreen from './screens/EditRoutineScreen';
  import FiveThreeOneSetupScreen from './screens/FiveThreeOneSetupScreen';
  import CycleReviewScreen from './screens/CycleReviewScreen';
  import { SettingsProvider, useSettings } from './context/SettingsContext';
  import { ThemeProvider, useTheme } from './context/ThemeContext';
  import * as Notifications from 'expo-notifications';
  import { runSchema } from './utils/schema';
  import { checkAndSyncPermissions } from './utils/notificationUtils';
  import { fontSize } from './utils/scale';
  import { getTokens, type ThemeMode } from './utils/theme';
  import { TabBar } from './components/TabBar';



  const Bottom = createBottomTabNavigator();

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
    RoutineDetails: { routineId?: number; presetKey?: string };
    ActivateRoutine: { presetKey: string };
    EditRoutine: { routineId: number };
    FiveThreeOneSetup: { presetKey: string };
    CycleReview: { routineId: number; cycleId: number };
  };

  export type HomeStackParamList = {
    Home: undefined;
    StartSession: { weekSessionId: number };
    FreeLogging: undefined;
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
const HomeStackNavigator = createNativeStackNavigator<HomeStackParamList>();

const HomeStack = () => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  return (
    <HomeStackNavigator.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerTitleStyle: { fontSize: fontSize.cardTitle, fontWeight: '700' },
        contentStyle: { backgroundColor: theme.background },
      }}
    >
      <HomeStackNavigator.Screen
        name="Home"
        component={HomeScreen}
        options={{ headerShown: false }}
      />
      <HomeStackNavigator.Screen
        name="StartSession"
        component={StartSessionScreen}
        options={{ title: t('todayStartSession') }}
      />
      <HomeStackNavigator.Screen
        name="FreeLogging"
        component={FreeLoggingScreen}
        options={{ title: t('freeLogging') }}
      />
    </HomeStackNavigator.Navigator>
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
        name="RoutineDetails"
        component={RoutineDetailsScreen}
        options={{ title: t('routines') }}
      />
      <RoutinesStackNavigator.Screen
        name="ActivateRoutine"
        component={ActivateRoutineScreen}
        options={{ title: t('setStartingWeights') }}
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
  const navigationRef = useRef<NavigationContainerRef<any>>(null);

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
    <NavigationContainer ref={navigationRef} theme={navigationThemeFor(tokens.mode)}>
        <Bottom.Navigator
          tabBar={(props) => <TabBar {...props} />}
          screenOptions={{
            headerShown: false,
          }}
        >
          <Bottom.Screen
            name="Home"
            component={HomeStack}
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
