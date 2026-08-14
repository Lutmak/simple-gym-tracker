  // App.tsx
  import React, {useState, useEffect, useRef } from 'react';
  import { View, ActivityIndicator, StatusBar, StyleSheet, Pressable, Text, Platform } from 'react-native'; // Import Platform
  import * as FileSystem from 'expo-file-system/legacy';
  import { SQLiteProvider, type SQLiteBindParams, type SQLiteDatabase } from 'expo-sqlite';
  import { Asset } from 'expo-asset';
  import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
  import { createNativeStackNavigator } from '@react-navigation/native-stack';
  import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
  import Ionicons from 'react-native-vector-icons/Ionicons';
  import { GestureHandlerRootView } from 'react-native-gesture-handler';
  import './utils/i18n'; // Ensure this is present to initialize i18n
  import i18n from './utils/i18n'; // Import the i18n instance
  import { I18nextProvider, useTranslation } from 'react-i18next';
  import Settings from './screens/Settings';
  import ProgressScreen from './screens/ProgressScreen';
  import TodayScreen from './screens/TodayScreen';
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



  const Bottom = createBottomTabNavigator();

  



  

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

  export type TodayStackParamList = {
    Today: undefined;
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
const TodayStackNavigator = createNativeStackNavigator<TodayStackParamList>();

const TodayStack = () => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  return (
    <TodayStackNavigator.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerTitleStyle: { fontSize: fontSize.cardTitle, fontWeight: '700' },
        contentStyle: { backgroundColor: theme.background },
      }}
    >
      <TodayStackNavigator.Screen
        name="Today"
        component={TodayScreen}
        options={{ headerShown: false }}
      />
      <TodayStackNavigator.Screen
        name="StartSession"
        component={StartSessionScreen}
        options={{ title: t('todayStartSession') }}
      />
      <TodayStackNavigator.Screen
        name="FreeLogging"
        component={FreeLoggingScreen}
        options={{ title: t('freeLogging') }}
      />
    </TodayStackNavigator.Navigator>
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
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { notificationPermissionGranted, setNotificationPermissionGranted } =
    useSettings();

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
        <Bottom.Navigator
          screenOptions={{
            headerShown: false,
            tabBarStyle: {
              backgroundColor: theme.background, // Dynamically set based on theme
              borderTopWidth: 0, // Removes the top border of the tab bar
              elevation: 0, // Removes shadow on Android
              shadowOpacity: 0, // Removes shadow on iOS
              height: 60,
              paddingVertical: 10,
            },
          }}
        >
          <Bottom.Screen
            name="Today"
            component={TodayStack}
            options={{
              tabBarLabel: t('today'),
              tabBarButton: (props) => (
                <TabButton {...props} iconName="today" />
              ),
            }}
          />
          <Bottom.Screen
            name="Routines"
            component={RoutinesStack}
            options={{
              tabBarLabel: t('routines'),
              tabBarButton: (props) => (
                <TabButton {...props} iconName="barbell" />
              ),
            }}
          />
          <Bottom.Screen
            name="Progress"
            component={ProgressScreen}
            options={{
              tabBarLabel: t('progress'),
              tabBarButton: (props) => (
                <TabButton {...props} iconName="trending-up" />
              ),
            }}
          />

       <Bottom.Screen
         name="Settings"
         component={Settings}
         options={{
           tabBarLabel: t('settings'),
           tabBarButton: (props) => (
             <TabButton {...props} iconName="settings-sharp" />
           ),
         }}
       />

                 </Bottom.Navigator>
                 </SQLiteProvider>
         </>
  );
};



  export default function App() {
    const [dbLoaded, setDbLoaded] = useState(false);
    const navigationRef = useRef<NavigationContainerRef<any>>(null);
    
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
        <NavigationContainer ref={navigationRef}>
          <SettingsProvider>
          <I18nextProvider i18n={i18n}>
          <AppContent/>
          </I18nextProvider>
          </SettingsProvider>
         
        </NavigationContainer>
        
      </GestureHandlerRootView>
    </ThemeProvider>
    );
  }

  // Custom TabButton component to handle icon rendering
  const TabButton = (props: any) => {
    const { accessibilityState, onPress } = props;
    const isSelected = accessibilityState?.selected; // Use optional chaining
    const { theme } = useTheme(); // Retrieve the theme here


    return (
      <Pressable onPress={onPress} style={styles.tabButton}>
        <Ionicons
          name={props.iconName}
          size={24}
          color={theme.text} // Always theme.text
        />
        <View
          style={{
            height: 2,
            width: '40%',
            backgroundColor: isSelected ? theme.text : 'transparent',
            marginTop: 5,
            borderRadius: 100,
          }}
        />
      </Pressable>
    );
  };

  const styles = StyleSheet.create({
    tabBar: {
      backgroundColor: '#ffffff',
      borderTopWidth: 2,
      elevation: 10,
      height: 60, // Adjusted height for a larger tab bar
      paddingVertical: 10, // Reduced padding to balance spacing
    },
    tabButton: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 1,
    },
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
