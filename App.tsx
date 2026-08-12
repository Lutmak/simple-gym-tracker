  // App.tsx
  import React, {useState, useEffect, useRef } from 'react';
  import { View, ActivityIndicator, StatusBar, StyleSheet, Pressable, Text, Platform } from 'react-native'; // Import Platform
  import * as FileSystem from 'expo-file-system/legacy';
  import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
  import { Asset } from 'expo-asset';
  import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
  import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
  import Ionicons from 'react-native-vector-icons/Ionicons';
  import Home from './screens/Home'; // Assuming you have a Home screen component
  import Workouts from './screens/Workouts';
  import CreateWorkout from './screens/CreateWorkout';
  import { GestureHandlerRootView } from 'react-native-gesture-handler';
  import { createNativeStackNavigator } from '@react-navigation/native-stack';
  import WorkoutDetails from './screens/WorkoutDetails';
  import MyCalendar from './screens/MyCalendar';
  import LogWorkout from './screens/LogWorkout';
  import MyProgress from './screens/MyProgress';
  import LogWeights from './screens/LogWeights';
  import WeightLogDetail from './screens/WeightLogDetail';
  import RecurringWorkoutOptions from './screens/RecurringWorkoutOptions';
  import CreateRecurringWorkout from './screens/CreateRecurringWorkout';
  import ManageRecurringWorkouts from './screens/ManageRecurringWorkouts';
  import RecurringWorkoutDetails from './screens/RecurringWorkoutDetails';
  import EditRecurringWorkout from './screens/EditRecurringWorkout';
  import StartedWorkoutInterface from './screens/StartedWorkoutInterface';
  import './utils/i18n'; // Ensure this is present to initialize i18n
  import i18n from './utils/i18n'; // Import the i18n instance
  import { I18nextProvider } from 'react-i18next';
  import Settings from './screens/Settings';
  import { SettingsProvider, useSettings } from './context/SettingsContext';
  import { ThemeProvider, useTheme } from './context/ThemeContext';
  import EditWorkout from './screens/EditWorkout';
  import AllLogs from './screens/AllLogs';
  import Difficulty from './screens/Difficulty';
  import Template from './screens/Template';
  import TemplateDetails from './screens/TemplateDetails';
  import Programs from './screens/Programs';
  import FiveThreeOneSetup from './screens/FiveThreeOneSetup';
  import FiveThreeOneCycleGeneration from './screens/FiveThreeOneCycleGeneration';
  import * as Notifications from 'expo-notifications';
  import { useRecurringWorkouts } from './utils/recurringWorkoutUtils';
  import { addRecurringTable, createUpdateTriggers } from './utils/addRecurringTable';
  import { checkAndSyncPermissions } from './utils/notificationUtils';
  import { AppState } from 'react-native';
  import GraphsWorkoutDetails from './screens/GraphsWorkoutDetails';




  const Bottom = createBottomTabNavigator();
  const WorkoutStackScreen = createNativeStackNavigator<WorkoutStackParamList>();
  const WorkoutLogStackScreen= createNativeStackNavigator<WorkoutLogStackParamList>();
  const WeightLogStackScreen= createNativeStackNavigator<WeightLogStackParamList>();
  const StartWorkoutStackScreen = createNativeStackNavigator<StartWorkoutStackParamList>();

  



  

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


  


  export type WorkoutStackParamList = {
    WorkoutsList: undefined; // No parameters for this route
    CreateWorkout: undefined; // No parameters for this route
    WorkoutDetails: { workout_id: number }; // Add this
    EditWorkout: { workout_id: number }; // Only `workout_id` for editing a workout
    TemplateList: undefined;
    DifficultyList: undefined;
    Difficulty: undefined;
    Template: { workout_difficulty: string };
    TemplateDetails: { workout_id: number };
    Programs: undefined;
    FiveThreeOneSetup: undefined;
    FiveThreeOneGeneration: { programId: number };
  };

  export type WorkoutLogStackParamList = {
    MyCalendar: {refresh?:boolean};  // No parameters for this route
    LogWorkout: { selectedDate?: string };
    RecurringWorkoutOptions: undefined;
    CreateRecurringWorkout: undefined;
    ManageRecurringWorkouts: undefined;
    RecurringWorkoutDetails: { recurring_workout_id: number };
    EditRecurringWorkout: { recurring_workout_id: number };
    StartedWorkoutInterface: { workout_log_id: number };
    LogWeights: { workout_log_id?: number };
  };

  export type WeightLogStackParamList = {
    MyProgress: undefined;
    LogWeights: { workout_log_id?: number };
    WeightLogDetail:{ workoutName: string }
    AllLogs: undefined;
    GraphsWorkoutDetails: undefined;
  }

  export type StartWorkoutStackParamList = {
    StartWorkout: { fromNotification?: boolean } | undefined;
    StartedWorkoutInterface: { workout_log_id: number };
  }

  // No SQLiteProvider here: AppContent's provider already wraps every tab. expo-sqlite's suspense
  // path keeps one module-level database instance and reopens it whenever a provider mounts with
  // props that differ from the current one, so a second provider closes the database out from
  // under screens that are still querying it.
  function WorkoutStack() {
    return (
      <WorkoutStackScreen.Navigator screenOptions={{
        headerShown: false, // Disable headers for all screens in this stack
      }}
    >
        <WorkoutStackScreen.Screen
          name="WorkoutsList"
          component={Workouts}
          options={{ headerShown: false }}
        />
        <WorkoutStackScreen.Screen
          name="CreateWorkout"
          component={CreateWorkout}
          options={{ title: 'Create Workout' }}
        />
        <WorkoutStackScreen.Screen
          name='WorkoutDetails'
          component={WorkoutDetails}
          options={{title: 'WorkoutDetails'}}
          />
             <WorkoutStackScreen.Screen
          name='EditWorkout'
          component={EditWorkout}
          options={{title: 'EditWorkout'}}
          />
                       <WorkoutStackScreen.Screen
          name='Difficulty'
          component={Difficulty}
          options={{title: 'Difficulty'}}
          />
                       <WorkoutStackScreen.Screen
          name='Template'
          component={Template}
          options={{title: 'Template'}}
          />
                       <WorkoutStackScreen.Screen
          name='TemplateDetails'
          component={TemplateDetails}
          options={{title: 'TemplateDetails'}}
          />
         <WorkoutStackScreen.Screen
           name="Programs"
           component={Programs}
           options={{ title: 'Programs' }}
         />
         <WorkoutStackScreen.Screen
           name="FiveThreeOneSetup"
           component={FiveThreeOneSetup}
           options={{ title: '5/3/1 Setup' }}
         />
         <WorkoutStackScreen.Screen
           name="FiveThreeOneGeneration"
           component={FiveThreeOneCycleGeneration}
           options={{ title: 'Generate 5/3/1 Cycle' }}
         />
      </WorkoutStackScreen.Navigator>
    );
  }

  function WorkoutLogStack() {
    return (
      <WorkoutLogStackScreen.Navigator
        screenOptions={{
          headerShown: false, // Disable headers for all screens in this stack
        }}
      >
        <WorkoutLogStackScreen.Screen
          name="MyCalendar"
          component={MyCalendar}
          options={{ headerShown: false }} // No header for MyCalendar screen
        />
        <WorkoutLogStackScreen.Screen
          name="LogWorkout"
          component={LogWorkout}
          options={{ title: 'Log a Workout' }} // Title for the LogWorkout screen
        />
        <WorkoutLogStackScreen.Screen
          name="RecurringWorkoutOptions"
          component={RecurringWorkoutOptions}
          options={{ title: 'Recurring Workout Options' }}
        /> 
         <WorkoutLogStackScreen.Screen
          name="CreateRecurringWorkout"
          component={CreateRecurringWorkout}
          options={{ title: 'Create Recurring Workout' }}
        /> 
        <WorkoutLogStackScreen.Screen
          name="ManageRecurringWorkouts"
          component={ManageRecurringWorkouts}
          options={{ title: 'Manage Recurring Workouts' }}
        /> 
         <WorkoutLogStackScreen.Screen
          name="RecurringWorkoutDetails"
          component={RecurringWorkoutDetails}
          options={{ title: 'Recurring Workout Details' }}
        /> 
        <WorkoutLogStackScreen.Screen
          name="EditRecurringWorkout"
          component={EditRecurringWorkout}
          options={{ title: 'Edit Recurring Workout' }}
        />
        <WorkoutLogStackScreen.Screen
          name="StartedWorkoutInterface"
          component={StartedWorkoutInterface}
          options={{ headerShown: false }}
        />
        <WorkoutLogStackScreen.Screen
          name="LogWeights"
          component={LogWeights}
          options={{ headerShown: false }}
        />
      </WorkoutLogStackScreen.Navigator>

      
    );
  }


  function WeightLogStack() {
    return (
      <WeightLogStackScreen.Navigator
        screenOptions={{
          headerShown: false, // Disable headers for all screens in this stack
        }}
      >
        <WeightLogStackScreen.Screen
          name="GraphsWorkoutDetails"
          component={GraphsWorkoutDetails}
          options={{ headerShown: false }}
        />
        <WeightLogStackScreen.Screen
          name="MyProgress"
          component={MyProgress}
          options={{ headerShown: false }} // No header for MyCalendar screen
        />
        <WeightLogStackScreen.Screen
          name="LogWeights"
          component={LogWeights}
          options={{ title: 'Log Weights' }} // Title for the LogWorkout screen
        />

  <WeightLogStackScreen.Screen
          name="WeightLogDetail"
          component={WeightLogDetail}
          options={{ headerShown: false }} // No header for MyCalendar screen
        />
      <WeightLogStackScreen.Screen
          name="AllLogs"
          component={AllLogs}
          options={{ headerShown: false }} // No header for MyCalendar screen
        />    
      
      </WeightLogStackScreen.Navigator>
    );
  }

  /*function StartWorkoutStack() {
    return (
      <StartWorkoutStackScreen.Navigator
        screenOptions={{
          headerShown: false, // Disable headers for all screens in this stack
        }}
      >
        <StartWorkoutStackScreen.Screen
          name="StartWorkout"
          component={StartWorkout}
          options={{ headerShown: false }}
        />
        <StartWorkoutStackScreen.Screen
          name="StartedWorkoutInterface"
          component={StartedWorkoutInterface}
          options={{ headerShown: false }}
        />
      </StartWorkoutStackScreen.Navigator>
    );
  }*/

// The bundled assets/SimpleDB.db predates Recurring_Workouts, so a fresh install opens a
// database without it. RecurringWorkoutManager queries the table on mount, which is why the
// schema has to exist before any screen renders rather than being created lazily by whichever
// screen happens to be visited first.
const initialiseSchema = async (db: SQLiteDatabase) => {
  await addRecurringTable(db);
  await createUpdateTriggers(db);

  await db.runAsync('PRAGMA foreign_keys = ON;');

  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS FiveThreeOne_Programs (
      program_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      program_name TEXT NOT NULL UNIQUE,
      unit TEXT NOT NULL CHECK (unit IN ('kg', 'lb')),
      rounding_increment REAL NOT NULL CHECK (rounding_increment > 0),
      rounding_direction TEXT NOT NULL CHECK (rounding_direction IN ('up', 'down', 'nearest')),
      tm_percentage REAL NOT NULL DEFAULT 0.90 CHECK (tm_percentage BETWEEN 0.85 AND 0.90),
      include_deload INTEGER NOT NULL DEFAULT 1 CHECK (include_deload IN (0, 1)),
      upper_tm_increment REAL NOT NULL CHECK (upper_tm_increment > 0),
      lower_tm_increment REAL NOT NULL CHECK (lower_tm_increment > 0),
      warmup_enabled INTEGER NOT NULL DEFAULT 1 CHECK (warmup_enabled IN (0, 1))
    );
  `);

  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS FiveThreeOne_AssistanceTemplates (
      template_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      template_key TEXT NOT NULL UNIQUE,
      template_name TEXT NOT NULL,
      description TEXT,
      is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1))
    );
  `);

  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS FiveThreeOne_AssistanceExercises (
      assistance_exercise_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      template_id INTEGER NOT NULL,
      exercise_key TEXT NOT NULL UNIQUE,
      exercise_name TEXT NOT NULL,
      sets INTEGER NOT NULL CHECK (sets > 0),
      reps INTEGER NOT NULL CHECK (reps > 0),
      sort_order INTEGER NOT NULL CHECK (sort_order > 0),
      FOREIGN KEY (template_id) REFERENCES FiveThreeOne_AssistanceTemplates(template_id)
        ON DELETE CASCADE
    );
  `);

  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS FiveThreeOne_Lifts (
      lift_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      program_id INTEGER NOT NULL,
      lift_name TEXT NOT NULL,
      lift_type TEXT NOT NULL CHECK (lift_type IN ('upper', 'lower')),
      training_max REAL NOT NULL CHECK (training_max > 0),
      day_slot INTEGER NOT NULL CHECK (day_slot > 0),
      assistance_template_id INTEGER,
      suggested_training_max REAL CHECK (suggested_training_max IS NULL OR suggested_training_max > 0),
      suggestion_status TEXT CHECK (
        suggestion_status IS NULL
        OR suggestion_status IN ('pending', 'accepted', 'edited', 'declined')
      ),
      FOREIGN KEY (program_id) REFERENCES FiveThreeOne_Programs(program_id)
        ON DELETE CASCADE,
      FOREIGN KEY (assistance_template_id) REFERENCES FiveThreeOne_AssistanceTemplates(template_id)
        ON DELETE SET NULL,
      UNIQUE (program_id, lift_name),
      UNIQUE (program_id, day_slot)
    );
  `);

  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS FiveThreeOne_Cycles (
      cycle_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      program_id INTEGER NOT NULL,
      cycle_number INTEGER NOT NULL CHECK (cycle_number > 0),
      status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'complete')),
      current_week INTEGER NOT NULL DEFAULT 1 CHECK (current_week BETWEEN 1 AND 4),
      include_deload INTEGER NOT NULL CHECK (include_deload IN (0, 1)),
      started_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (program_id) REFERENCES FiveThreeOne_Programs(program_id)
        ON DELETE CASCADE,
      UNIQUE (program_id, cycle_number)
    );
  `);

  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS FiveThreeOne_WorkoutLink (
      workout_link_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      cycle_id INTEGER,
      lift_id INTEGER,
      workout_id INTEGER,
      day_id INTEGER,
      exercise_id INTEGER,
      workout_log_id INTEGER,
      weight_log_id INTEGER,
      week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 4),
      set_number INTEGER NOT NULL CHECK (set_number > 0),
      work_set_number INTEGER CHECK (work_set_number IS NULL OR work_set_number > 0),
      training_max REAL NOT NULL CHECK (training_max > 0),
      percentage REAL NOT NULL CHECK (percentage >= 0 AND percentage <= 1),
      target_weight REAL NOT NULL CHECK (target_weight >= 0),
      target_reps INTEGER NOT NULL CHECK (target_reps > 0),
      is_amrap INTEGER NOT NULL DEFAULT 0 CHECK (is_amrap IN (0, 1)),
      is_warmup INTEGER NOT NULL DEFAULT 0 CHECK (is_warmup IN (0, 1)),
      warmup_completed_at INTEGER,
      FOREIGN KEY (cycle_id) REFERENCES FiveThreeOne_Cycles(cycle_id)
        ON DELETE SET NULL,
      FOREIGN KEY (lift_id) REFERENCES FiveThreeOne_Lifts(lift_id)
        ON DELETE SET NULL,
      FOREIGN KEY (workout_id) REFERENCES Workouts(workout_id)
        ON DELETE SET NULL,
      FOREIGN KEY (day_id) REFERENCES Days(day_id)
        ON DELETE SET NULL,
      FOREIGN KEY (exercise_id) REFERENCES Exercises(exercise_id)
        ON DELETE SET NULL,
      FOREIGN KEY (workout_log_id) REFERENCES Workout_Log(workout_log_id)
        ON DELETE SET NULL,
      FOREIGN KEY (weight_log_id) REFERENCES Weight_Log(weight_log_id)
        ON DELETE SET NULL,
      UNIQUE (exercise_id, set_number),
      UNIQUE (weight_log_id),
      CHECK (
        (is_warmup = 1 AND work_set_number IS NULL)
        OR (is_warmup = 0 AND work_set_number IS NOT NULL)
      ),
      CHECK (is_amrap = 0 OR is_warmup = 0),
      CHECK (warmup_completed_at IS NULL OR is_warmup = 1)
    );
  `);

  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS FiveThreeOne_AmrapResults (
      amrap_result_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      workout_link_id INTEGER,
      weight_log_id INTEGER NOT NULL,
      program_id INTEGER,
      cycle_id INTEGER,
      lift_id INTEGER,
      lift_name TEXT NOT NULL,
      workout_date INTEGER NOT NULL,
      week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 4),
      work_set_number INTEGER NOT NULL CHECK (work_set_number > 0),
      weight REAL NOT NULL CHECK (weight >= 0),
      reps INTEGER NOT NULL CHECK (reps > 0),
      estimated_1rm REAL NOT NULL CHECK (estimated_1rm >= 0),
      is_pr INTEGER NOT NULL DEFAULT 0 CHECK (is_pr IN (0, 1)),
      FOREIGN KEY (workout_link_id) REFERENCES FiveThreeOne_WorkoutLink(workout_link_id)
        ON DELETE SET NULL,
      FOREIGN KEY (weight_log_id) REFERENCES Weight_Log(weight_log_id)
        ON DELETE CASCADE,
      FOREIGN KEY (program_id) REFERENCES FiveThreeOne_Programs(program_id)
        ON DELETE SET NULL,
      FOREIGN KEY (cycle_id) REFERENCES FiveThreeOne_Cycles(cycle_id)
        ON DELETE SET NULL,
      FOREIGN KEY (lift_id) REFERENCES FiveThreeOne_Lifts(lift_id)
        ON DELETE SET NULL,
      UNIQUE (weight_log_id)
    );
  `);

  const builtInAssistanceTemplates = [
    {
      templateKey: 'boring-but-big',
      templateName: 'Boring But Big',
      description: 'High-volume supplemental work with simple accessory movements.',
      exercises: [
        { key: 'dumbbell-row', name: 'Dumbbell Row', sets: 5, reps: 10 },
        { key: 'dips', name: 'Dips', sets: 5, reps: 10 },
        { key: 'hanging-leg-raise', name: 'Hanging Leg Raise', sets: 5, reps: 10 },
      ],
    },
    {
      templateKey: 'triumvirate',
      templateName: 'Triumvirate',
      description: 'Three assistance movements kept deliberately short and repeatable.',
      exercises: [
        { key: 'pull-up', name: 'Pull-up', sets: 5, reps: 10 },
        { key: 'dip', name: 'Dip', sets: 5, reps: 10 },
        { key: 'back-extension', name: 'Back Extension', sets: 5, reps: 15 },
      ],
    },
    {
      templateKey: 'first-set-last',
      templateName: 'First Set Last',
      description: 'A small accessory selection alongside the first-set-last work.',
      exercises: [
        { key: 'face-pull', name: 'Face Pull', sets: 3, reps: 15 },
        { key: 'lateral-raise', name: 'Lateral Raise', sets: 3, reps: 15 },
        { key: 'triceps-pushdown', name: 'Triceps Pushdown', sets: 3, reps: 15 },
      ],
    },
  ];

  for (const template of builtInAssistanceTemplates) {
    await db.runAsync(
      `INSERT OR IGNORE INTO FiveThreeOne_AssistanceTemplates
       (template_key, template_name, description, is_builtin)
       VALUES (?, ?, ?, ?);`,
      [template.templateKey, template.templateName, template.description, 1]
    );

    const templateRow = await db.getFirstAsync<{ template_id: number }>(
      `SELECT template_id
       FROM FiveThreeOne_AssistanceTemplates
       WHERE template_key = ?;`,
      [template.templateKey]
    );

    if (!templateRow) {
      throw new Error(`Could not load seeded assistance template: ${template.templateKey}`);
    }

    for (const [index, exercise] of template.exercises.entries()) {
      await db.runAsync(
        `INSERT OR IGNORE INTO FiveThreeOne_AssistanceExercises
         (template_id, exercise_key, exercise_name, sets, reps, sort_order)
         VALUES (?, ?, ?, ?, ?, ?);`,
        [
          templateRow.template_id,
          `${template.templateKey}:${exercise.key}`,
          exercise.name,
          exercise.sets,
          exercise.reps,
          index + 1,
        ]
      );
    }
  }
};

// First, create a component that will handle the recurring workout checks
function RecurringWorkoutManager() {
  const { checkRecurringWorkouts } = useRecurringWorkouts();
  const appState = useRef(AppState.currentState);
  const initialCheckDone = useRef(false);

  useEffect(() => {
    // Function to check workouts and publish event
    const checkAndNotify = async () => {
      if (!initialCheckDone.current) {
        await checkRecurringWorkouts();
        // Publish event to notify MyCalendar to refresh
        console.log('Initial recurring workout check triggered and event published');
        initialCheckDone.current = true;
      }
    };
    
    checkAndNotify();
    
    // Set up listener for app returning to foreground
   

  }, [checkRecurringWorkouts]);

  return null;
}

// Define AppContent here
const AppContent = () => {
  const { theme } = useTheme();
  const { notificationPermissionGranted, setNotificationPermissionGranted } =
    useSettings();

  useEffect(() => {
    if (notificationPermissionGranted) {
      checkAndSyncPermissions(setNotificationPermissionGranted);
    }
  }, [notificationPermissionGranted, setNotificationPermissionGranted]);

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
        <RecurringWorkoutManager />
        
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
            name="Home"
            component={Home}
            options={{
              tabBarButton: (props) => (
                <TabButton {...props} iconName="home" />
              ),
            }}
          />
          <Bottom.Screen
            name="My Workouts"
            component={WorkoutStack}
            options={{
              tabBarButton: (props) => (
                <TabButton {...props} iconName="barbell" />
              ),
            }}
          />

          <Bottom.Screen
            name="My Calendar"
            component={WorkoutLogStack}
            options={{
              tabBarButton: (props) => (
                <TabButton {...props} iconName="calendar" />
              ),
            }}
          />

          <Bottom.Screen
            name="My Progress"
            component={WeightLogStack}
            options={{
              tabBarButton: (props) => (
                <TabButton {...props} iconName="trending-up" />
              ),
            }}
          />

       <Bottom.Screen
         name="Settings"
         component={Settings}
         options={{
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
