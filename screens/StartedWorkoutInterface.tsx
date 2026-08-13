import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  TouchableWithoutFeedback,
  ScrollView, 
  ActivityIndicator,
  Alert,
  FlatList,
  Vibration,
  Platform,
  Switch,
  Modal,
  AppState,
  Linking,
  StatusBar
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { displayFontSize, fontSize, radius, spacing, touchTarget } from '../utils/scale';
import { useTranslation } from 'react-i18next';
import { useSQLiteContext } from 'expo-sqlite';
import { StartWorkoutStackParamList } from '../App';
import * as Notifications from 'expo-notifications';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSettings } from '../context/SettingsContext';
import { loadRestTimerPreferences, saveRestTimerPreferences } from '../utils/startedWorkoutPreferenceUtils';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';
import AppTextInput, {
  APP_TEXT_MAX_FONT_SIZE_MULTIPLIER,
  parseNumericInput,
} from '../components/AppTextInput';
import { 
  useTimerPersistence, 
  createTimerState, 
  updateTimerState, 
  timerCalculations,
  TimerState 
} from '../utils/timerPersistenceUtils';
import { AutoSizeText, ResizeTextMode } from 'react-native-auto-size-text';
import { estimate1RM, type WeightUnit } from '../utils/fiveThreeOne';
import { advanceFiveThreeOneCycleAfterSession } from '../utils/fiveThreeOneGenerationPersistence';
import {
  describeFiveThreeOneLink,
  isFiveThreeOneAmrapPr,
  isFiveThreeOneBelowTarget,
  type FiveThreeOneLinkForLogging,
  type FiveThreeOneSetDescription,
} from '../utils/fiveThreeOneLogging';

type StartedWorkoutRouteProps = RouteProp<
  StartWorkoutStackParamList,
  'StartedWorkoutInterface'
>;

// Define interfaces for workout data
interface Exercise {
  exercise_name: string;
  sets: number;
  reps: number;
  logged_exercise_id: number;
  exercise_fully_logged: boolean;
  web_link: string | null;
  muscle_group: string | null;
  exercise_notes: string | null;
}

interface ExerciseSet {
  exercise_name: string;
  exercise_id: number;
  set_number: number;
  total_sets: number;
  reps_goal: number;
  reps_done: string;
  weight: string;
  set_logged: boolean;
  web_link: string | null;
  muscle_group: string | null;
  exercise_notes: string | null;
  five_three_one: FiveThreeOneSetContext | null;
}

interface FiveThreeOneSetContext {
  description: FiveThreeOneSetDescription;
  programId: number;
  cycleId: number;
  liftId: number;
  liftName: string;
  unit: WeightUnit;
  weekNumber: number;
}

interface FiveThreeOneLinkRow {
  program_id: number | null;
  cycle_id: number | null;
  lift_id: number | null;
  lift_name: string | null;
  unit: WeightUnit;
  week_number: number;
  exercise_name: string | null;
  is_amrap: number;
  is_warmup: number;
  workout_link_id: number;
  set_number: number;
  work_set_number: number | null;
  target_weight: number;
  target_reps: number;
  warmup_completed_at: number | null;
}

const hasPositiveIntegerPart = (value: string): boolean =>
  /^[0-9]*[1-9][0-9]*$/.test(value.split('.')[0]);

const hasPositiveDecimalInput = (value: string): boolean =>
  /^(?=.*[1-9])[0-9]*(?:\.[0-9]*)?$/.test(value);

export default function StartedWorkoutInterface() {
  const navigation = useNavigation();
  const route = useRoute<StartedWorkoutRouteProps>();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const db = useSQLiteContext();
  const { notificationPermissionGranted, weightFormat } = useSettings();
  
  const { workout_log_id } = route.params;
  
  // States for workout data
  const [loading, setLoading] = useState(true);
  const [workout, setWorkout] = useState<{
    workout_name: string;
    workout_date: number;
    day_name: string;
  } | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  
  // Workout flow states
  const [restTime, setRestTime] = useState('30');
  const [exerciseRestTime, setExerciseRestTime] = useState('60');
  const [isExerciseListModalVisible, setIsExerciseListModalVisible] = useState(false);
  const [autoFillWeight, setAutoFillWeight] = useState(true);
  const [autoFillReps, setAutoFillReps] = useState(true);
  const [useLogsForRepInput, setUseLogsForRepInput] = useState(false);
  const [enableSetSwitchSound, setEnableSetSwitchSound] = useState(false);
  
  // User preference toggles
  const [enableVibration, setEnableVibration] = useState(true);
  const [enableNotifications, setEnableNotifications] = useState(false);
  
  // Sets data for tracking workout
  const [allSets, setAllSets] = useState<ExerciseSet[]>([]);
  
  // State for notes modal
  const [isNotesModalVisible, setIsNotesModalVisible] = useState(false);
  const [notesModalContent, setNotesModalContent] = useState('');
  const [notesModalTitle, setNotesModalTitle] = useState('');

  // Timer state using the new utility
  const [timerState, setTimerState] = useState<TimerState>(createTimerState());
  const [isCompletingSet, setIsCompletingSet] = useState(false);
  
  // Timer refs for intervals
  const workoutTimerRef = useRef<NodeJS.Timeout | null>(null);
  const restTimerRef = useRef<NodeJS.Timeout | null>(null);
  const weightMapRef = useRef(new Map<string, string>());
  const repsMapRef = useRef(new Map<string, string>());
  
  const updateExerciseLoggedStatus = (exerciseId: number, currentSets: ExerciseSet[]) => {
    const exerciseSets = currentSets.filter(s => s.exercise_id === exerciseId);
    const allSetsLogged = exerciseSets.every(s => s.set_logged);

    setExercises(prevExercises =>
      prevExercises.map(ex =>
        ex.logged_exercise_id === exerciseId
          ? { ...ex, exercise_fully_logged: allSetsLogged }
          : ex
      )
    );
  };
  
  // Handle timer restoration from background
  const handleTimerRestore = (savedState: TimerState, elapsedSeconds: number) => {
    console.log('=== RESTORING TIMER STATE ===');
    console.log('Saved state:', savedState);
    console.log('Elapsed seconds:', elapsedSeconds);
    
    // Restore workout timer
    if (savedState.workoutStartTime) {
      const newDuration = savedState.workoutDuration + elapsedSeconds;
      const newStartTime = Date.now() - (newDuration * 1000);
      
      setTimerState(prev => updateTimerState(prev, {
        workoutDuration: newDuration,
        workoutStartTime: newStartTime,
        currentSetIndex: savedState.currentSetIndex,
        workoutStage: savedState.workoutStage,
        workoutStarted: savedState.workoutStarted
      }));
      
      // Restart workout timer
      stopWorkoutTimer();
      startWorkoutTimer();
    }
    
    // Restore rest timer if needed
    if (savedState.isResting && savedState.restRemaining !== null && savedState.restRemaining > 0) {
      const newRestTime = Math.max(0, savedState.restRemaining - elapsedSeconds);
      
      if (newRestTime <= 0) {
        // Rest completed in background
        console.log('Rest completed during background');
        handleRestComplete(savedState.isExerciseRest);
      } else {
        // Continue rest timer
        setTimerState(prev => updateTimerState(prev, {
          restRemaining: newRestTime,
          isResting: true,
          isExerciseRest: savedState.isExerciseRest,
          restStartTime: Date.now()
        }));
        
        stopRestTimer();
        startRestTimer(newRestTime);
      }
    }
  };
  
  // Setup timer persistence
  useTimerPersistence(timerState, {
    onRestore: handleTimerRestore,
    onError: (error) => {
      console.error('Timer persistence error:', error);
      Alert.alert('Timer Error', 'There was an issue with timer persistence.');
    }
  }, {
    enabled: timerState.workoutStarted,
    debugMode: __DEV__
  });
  
  // Handle AppState changes for notifications
  useEffect(() => {
    const handleAppStateChange = async (nextAppState: string) => {
      // Going to background - schedule notification if workout is active and notifications are enabled
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        // Stop active intervals when going to background
        // Let useTimerPersistence handle saving the actual current state
        stopWorkoutTimer();
        stopRestTimer();
        // clearRestTimerState(); // Clear timer state when going background // REMOVED

        if (timerState.workoutStarted && 
            timerState.workoutStage !== 'completed' && 
            enableNotifications && 
            notificationPermissionGranted) {
          
          console.log('App going to background - scheduling notification');
          
          try {
            // Clear any existing notifications first
            await Notifications.dismissAllNotificationsAsync();
            
            // Schedule workout progress notification
            await Notifications.scheduleNotificationAsync({
              content: {
                title: t("Workout in Progress"),
                body: t("Workout in Progress Message"),
                priority: 'min',
                data: { 
                  startTime: timerState.workoutStartTime,
                  type: 'workout_timer'
                },
              },
              trigger: null,
            });
            
          } catch (error) {
            console.error('Error scheduling notifications:', error);
          }
        }
      } 
      // Coming to foreground - clear notifications
      else if (nextAppState === 'active') {
        // clearRestTimerState(); // Clear timer state when coming to foreground // REMOVED
        if (enableNotifications) {
          console.log('App returning to foreground - clearing notifications');
          try {
            await Notifications.dismissAllNotificationsAsync();
          } catch (error) {
            console.error('Error clearing notifications:', error);
          }
        }
      }
    };
    
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => {
      // clearRestTimerState(); // Clear on unmount // This was already correctly removed/commented
      subscription.remove();
    };
  }, [
    timerState.workoutStarted, 
    timerState.workoutStage, 
    enableNotifications, 
    notificationPermissionGranted,
    t,
    timerState.workoutStartTime
  ]);
  
  // Update enableNotifications only if permission is granted
  useEffect(() => {
    if (notificationPermissionGranted && !enableNotifications) {
      // Optional: enable notifications by default if permission is granted
      // setEnableNotifications(true);
    }
  }, [notificationPermissionGranted]);
  
  useEffect(() => {
    const loadInitialData = async () => {
        try {
            const preferences = await loadRestTimerPreferences();
            setRestTime(preferences.restTimeBetweenSets);
            setExerciseRestTime(preferences.restTimeBetweenExercises);
            setEnableVibration(preferences.enableVibration);
            setAutoFillWeight(preferences.autoFillWeight);
            setAutoFillReps(preferences.autoFillReps);
            setUseLogsForRepInput(preferences.useLogsForRepInput);
            setEnableSetSwitchSound(preferences.enableSetSwitchSound);
            if (notificationPermissionGranted) {
                setEnableNotifications(preferences.enableNotifications);
            } else {
                setEnableNotifications(false);
            }

            await fetchWorkoutDetails(
              preferences.autoFillWeight, 
              preferences.autoFillReps, 
              preferences.useLogsForRepInput
            );
        } catch (error) {
            console.error('Error loading initial data:', error);
            setLoading(false);
        }
    };

    loadInitialData();

    return () => {
        stopWorkoutTimer();
        stopRestTimer();
        deactivateKeepAwake();
    };
  }, [notificationPermissionGranted]);

  // Setup notification handler and keep awake
  useEffect(() => {
    const configureNotifications = async () => {
      await Notifications.setNotificationHandler({
        handleNotification: async (notification) => {
          // Handle different notification types
          const notificationType = notification.request.content.data?.type;
          
          return {
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: notificationType === 'rest_complete',
            shouldSetBadge: false,
          };
        },
      });
    };
    
    if (timerState.workoutStarted) {
      activateKeepAwakeAsync();
      configureNotifications();
    }
    
    return () => {
      deactivateKeepAwake();
      // Clear notifications when component unmounts
      if (enableNotifications) {
        Notifications.dismissAllNotificationsAsync().catch(console.error);
      }
    };
  }, [timerState.workoutStarted, enableNotifications]);

  // Handle back press when workout is started
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (!timerState.workoutStarted || timerState.workoutStage === 'completed') {
        return;
      }

      e.preventDefault();

      Alert.alert(
        t('exitWorkout'),
        t('exitWorkoutMessage'),
        [
          { text: t('Cancel'), style: 'cancel', onPress: () => {} },
          {
            text: t('exit'),
            style: 'destructive',
            onPress: () => navigation.dispatch(e.data.action),
          },
        ]
      );
    });

    return unsubscribe;
  }, [navigation, timerState.workoutStarted, timerState.workoutStage, t]);
  
  const showNotes = (notes: string, exerciseName: string) => {
    setNotesModalContent(notes);
    setNotesModalTitle(exerciseName);
    setIsNotesModalVisible(true);
  };

  const handleLinkPress = async (url: string | null) => {
    if (!url) {
      Alert.alert(t('noLinkAvailable'));
      return;
    }
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert(`${t('cannotOpenURL')}: ${url}`);
      }
    } catch (error) {
      console.error('Error opening URL:', error);
      Alert.alert(t('errorOpeningURL'));
    }
  };
  
  const fetchWorkoutDetails = async (
    shouldAutoFill: boolean, 
    shouldAutoFillReps: boolean, 
    shouldUseLogsForReps: boolean
  ) => {
    try {
      setLoading(true);
      
      const workoutResult = await db.getAllAsync<{
        workout_name: string;
        workout_date: number;
        day_name: string;
      }>(
        `SELECT workout_name, workout_date, day_name 
         FROM Workout_Log 
         WHERE workout_log_id = ?;`,
        [workout_log_id]
      );
      
      if (workoutResult.length > 0) {
        setWorkout(workoutResult[0]);
        
        const exercisesResult = await db.getAllAsync<Exercise>(
          `SELECT exercise_name, sets, reps, logged_exercise_id, web_link, muscle_group, exercise_notes
           FROM Logged_Exercises 
           WHERE workout_log_id = ?;`,
          [workout_log_id]
        );

        const fiveThreeOneLinkRows = await db.getAllAsync<FiveThreeOneLinkRow>(
          `SELECT wl.workout_link_id, wl.set_number, wl.work_set_number,
                  wl.target_weight, wl.target_reps, wl.is_amrap, wl.is_warmup,
                  wl.warmup_completed_at, wl.week_number,
                  c.program_id, wl.cycle_id, wl.lift_id, l.lift_name, p.unit,
                  e.exercise_name
           FROM FiveThreeOne_WorkoutLink wl
           JOIN Workouts w ON w.workout_id = wl.workout_id
           JOIN Days d ON d.day_id = wl.day_id
           JOIN Workout_Log log
             ON log.workout_log_id = ?
            AND log.workout_name = w.workout_name
            AND log.day_name = d.day_name
           JOIN FiveThreeOne_Cycles c ON c.cycle_id = wl.cycle_id
           JOIN FiveThreeOne_Programs p ON p.program_id = c.program_id
           JOIN FiveThreeOne_Lifts l ON l.lift_id = wl.lift_id
           LEFT JOIN Exercises e ON e.exercise_id = wl.exercise_id
           ORDER BY wl.set_number;`,
          [workout_log_id],
        );

        const fiveThreeOneLinks = fiveThreeOneLinkRows.map((row): {
          context: FiveThreeOneSetContext;
          exerciseName: string | null;
        } => {
          if (row.program_id === null || row.cycle_id === null || row.lift_id === null) {
            throw new Error('The generated 5/3/1 link is missing its program metadata.');
          }
          if (row.unit !== 'kg' && row.unit !== 'lb') {
            throw new Error('The generated 5/3/1 link is missing a valid program unit.');
          }

          const description = describeFiveThreeOneLink({
            workoutLinkId: row.workout_link_id,
            setNumber: row.set_number,
            workSetNumber: row.work_set_number,
            targetWeight: row.target_weight,
            targetReps: row.target_reps,
            isAmrap: row.is_amrap === 1,
            isWarmup: row.is_warmup === 1,
            warmupCompletedAt: row.warmup_completed_at,
          });

          return {
            context: {
              description,
              programId: row.program_id,
              cycleId: row.cycle_id,
              liftId: row.lift_id,
              liftName: row.lift_name ?? row.exercise_name ?? '',
              unit: row.unit,
              weekNumber: row.week_number,
            },
            exerciseName: row.exercise_name,
          };
        });
        const generatedMainExerciseName = fiveThreeOneLinkRows.find(
          (row) => row.is_warmup === 0,
        )?.exercise_name;
        const generatedWarmups = fiveThreeOneLinks
          .filter((link) => link.context.description.isWarmup)
          .map((link) => link.context);
        const generatedWorkLinks = fiveThreeOneLinks.filter(
          (link) => !link.context.description.isWarmup,
        );

        setExercises(exercisesResult.map(e => ({ ...e, exercise_fully_logged: false })));
        
        weightMapRef.current.clear();
        repsMapRef.current.clear();

        if (exercisesResult.length > 0) {
            const exerciseNames = exercisesResult.map(e => e.exercise_name);
            const placeholders = exerciseNames.map(() => '?').join(',');
        
            const lastLogResult = await db.getAllAsync<{ exercise_name: string; set_number: number; weight_logged: number; reps_logged: number }>(
                `SELECT wl.exercise_name, wl.set_number, wl.weight_logged, wl.reps_logged
                 FROM Weight_Log wl
                 INNER JOIN (
                   SELECT exercise_name, set_number, MAX(workout_log_id) as max_log_id
                   FROM Weight_Log
                   WHERE exercise_name IN (${placeholders})
                   GROUP BY exercise_name, set_number
                 ) as latest_logs
                 ON wl.exercise_name = latest_logs.exercise_name 
                 AND wl.set_number = latest_logs.set_number 
                 AND wl.workout_log_id = latest_logs.max_log_id;`,
                exerciseNames
              );
        
              lastLogResult.forEach(row => {
                weightMapRef.current.set(`${row.exercise_name}-${row.set_number}`, row.weight_logged.toString());
                repsMapRef.current.set(`${row.exercise_name}-${row.set_number}`, row.reps_logged.toString());
              });
        }
        
        // Prepare all sets data structure
        const setsData: ExerciseSet[] = [];
        exercisesResult.forEach(exercise => {
          const workLinks = generatedWorkLinks
            .filter((link) => (link.exerciseName ?? '') === exercise.exercise_name)
            .map((link) => link.context);
          const isGeneratedMainLift =
            generatedMainExerciseName !== undefined &&
            exercise.exercise_name === generatedMainExerciseName &&
            (generatedWarmups.length > 0 || workLinks.length > 0);
          const generatedLinks = isGeneratedMainLift
            ? [...generatedWarmups, ...workLinks]
            : [];

          if (generatedLinks.length > 0) {
            generatedLinks.forEach((link) => {
              const { description } = link;
              const databaseSetNumber = description.databaseSetNumber;
              const weight = description.targetWeight.toString();
              let repsDone = '';
              if (description.isWarmup) {
                repsDone = description.targetReps.toString();
              } else if (description.isAmrap) {
                if (shouldAutoFillReps && shouldUseLogsForReps) {
                  repsDone =
                    repsMapRef.current.get(`${exercise.exercise_name}-${databaseSetNumber}`) || '';
                }
              } else if (shouldAutoFillReps) {
                repsDone = shouldUseLogsForReps
                  ? repsMapRef.current.get(`${exercise.exercise_name}-${databaseSetNumber}`) || ''
                  : description.targetReps.toString();
              }

              setsData.push({
                exercise_name: exercise.exercise_name,
                exercise_id: exercise.logged_exercise_id,
                set_number: description.displaySetNumber,
                total_sets: generatedLinks.length,
                reps_goal: description.targetReps,
                reps_done: repsDone,
                weight,
                set_logged: description.isWarmup && description.warmupCompletedAt !== null,
                web_link: exercise.web_link || null,
                muscle_group: exercise.muscle_group || null,
                exercise_notes: exercise.exercise_notes || null,
                five_three_one: link,
              });
            });
            return;
          }

          for (let i = 1; i <= exercise.sets; i++) {
            const weight = shouldAutoFill ? (weightMapRef.current.get(`${exercise.exercise_name}-${i}`) || '') : '';
            
            let reps_done = '';
            if (shouldAutoFillReps) {
                if (shouldUseLogsForReps) {
                    reps_done = repsMapRef.current.get(`${exercise.exercise_name}-${i}`) || '';
                } else {
                    reps_done = exercise.reps.toString();
                }
            }

            setsData.push({
              exercise_name: exercise.exercise_name,
              exercise_id: exercise.logged_exercise_id,
              set_number: i,
              total_sets: exercise.sets,
              reps_goal: exercise.reps,
              reps_done: reps_done,
              weight: weight,
              set_logged: false,
              web_link: exercise.web_link || null,
              muscle_group: exercise.muscle_group || null,
              exercise_notes: exercise.exercise_notes || null,
              five_three_one: null,
            });
          }
        });
        
        setAllSets(setsData);
        const firstUnloggedSetIndex = setsData.findIndex((set) => !set.set_logged);
        setTimerState((prev) =>
          updateTimerState(prev, {
            currentSetIndex: firstUnloggedSetIndex === -1 ? 0 : firstUnloggedSetIndex,
          }),
        );
      }
      
      setLoading(false);
    } catch (error) {
      console.error('Error fetching workout details:', error);
      setLoading(false);
    }
  };
  
  // Timer functions
  const startWorkoutTimer = () => {
    const startTime = Date.now() - (timerState.workoutDuration * 1000);
    setTimerState(prev => updateTimerState(prev, { workoutStartTime: startTime }));
    
    workoutTimerRef.current = setInterval(() => {
      setTimerState(prev => updateTimerState(prev, {
        workoutDuration: prev.workoutDuration + 1
      }));
    }, 1000);
  };
  
  const stopWorkoutTimer = () => {
    if (workoutTimerRef.current) {
      clearInterval(workoutTimerRef.current);
      workoutTimerRef.current = null;
    }
  };
  
  const startRestTimer = (seconds: number) => {
    // We're explicitly setting a number here, not null
    setTimerState(prev => updateTimerState(prev, {
      restRemaining: seconds,  // This is a number
      restStartTime: Date.now(),
      isResting: true
    }));
    
    restTimerRef.current = setInterval(() => {
      setTimerState(prev => {
        if (prev.restRemaining === null) {
          stopRestTimer();
          return prev;
        }
        const newRestTime = prev.restRemaining - 1;
        
        if (newRestTime <= 0) {
          stopRestTimer();
          handleRestComplete(prev.isExerciseRest);
          return updateTimerState(prev, {
            restRemaining: null,  // Only set to null when complete
            isResting: false,
            isExerciseRest: false
          });
        }
        
        return updateTimerState(prev, { restRemaining: newRestTime });
      });
    }, 1000);
  };
  
  const stopRestTimer = () => {
    if (restTimerRef.current) {
      clearInterval(restTimerRef.current);
      restTimerRef.current = null;
    }
  };
  
  const handleRestComplete = (wasExerciseRest: boolean) => {
  
    clearRestTimerState(); // Clear rest timer state before new set
    setTimerState(prev => updateTimerState(prev, {
      workoutStage: 'exercise'
    }));
    
    if (enableVibration) {
      Vibration.vibrate([500, 300, 500]);
    }
    if (enableSetSwitchSound) {
      playSound();
    }
  };
  
  const handleAutoFillToggle = (newValue: boolean) => {
    setAutoFillWeight(newValue);
    setAllSets(currentSets => 
      currentSets.map(set => {
        if (set.set_logged || set.five_three_one?.description.isWarmup) {
          return set;
        }

        const databaseSetNumber = set.five_three_one?.description.databaseSetNumber ?? set.set_number;
        const newWeight = newValue
          ? set.five_three_one?.description.targetWeight.toString() ||
            weightMapRef.current.get(`${set.exercise_name}-${databaseSetNumber}`) ||
            ''
          : '';

        return {
          ...set,
          weight: newWeight,
        };
      })
    );
  };

  const handleAutoFillRepsToggle = (newValue: boolean) => {
    setAutoFillReps(newValue);
    setAllSets(currentSets =>
      currentSets.map(set => {
        if (set.set_logged || set.five_three_one?.description.isWarmup) {
          return set;
        }

        let newReps = '';
        if (newValue) {
          const databaseSetNumber =
            set.five_three_one?.description.databaseSetNumber ?? set.set_number;
          if (useLogsForRepInput) {
            newReps = repsMapRef.current.get(`${set.exercise_name}-${databaseSetNumber}`) || '';
          } else if (!set.five_three_one?.description.isAmrap) {
            newReps = set.reps_goal.toString();
          }
        }

        return {
          ...set,
          reps_done: newReps,
        };
      })
    );
  };

  const handleUseLogsForRepsToggle = (newValue: boolean) => {
    setUseLogsForRepInput(newValue);
    if (autoFillReps) {
      setAllSets(currentSets =>
        currentSets.map(set => {
          if (set.set_logged || set.five_three_one?.description.isWarmup) {
            return set;
          }

          let newReps = '';
          if (newValue) {
            const databaseSetNumber =
              set.five_three_one?.description.databaseSetNumber ?? set.set_number;
            newReps = repsMapRef.current.get(`${set.exercise_name}-${databaseSetNumber}`) || '';
          } else if (!set.five_three_one?.description.isAmrap) {
            newReps = set.reps_goal.toString();
          }

          return {
            ...set,
            reps_done: newReps,
          };
        })
      );
    }
  };

  // Workout flow functions
  const startWorkout = async () => {
    const setRestValue = parseNumericInput(restTime);
    const exerciseRestValue = parseNumericInput(exerciseRestTime);
    const setRestSeconds = setRestValue === null ? NaN : Math.trunc(setRestValue);
    const exerciseRestSeconds =
      exerciseRestValue === null ? NaN : Math.trunc(exerciseRestValue);
    
    if (isNaN(setRestSeconds) || setRestSeconds < 0) {
      Alert.alert(t('invalidRestTime'), t('pleaseEnterValidSeconds'));
      return;
    }
    
    if (isNaN(exerciseRestSeconds) || exerciseRestSeconds < 0) {
      Alert.alert(t('invalidExerciseRestTime'), t('pleaseEnterValidSeconds'));
      return;
    }

    try {
      await saveRestTimerPreferences({
        restTimeBetweenSets: restTime,
        restTimeBetweenExercises: exerciseRestTime,
        enableVibration: enableVibration,
        enableNotifications: enableNotifications,
        autoFillWeight: autoFillWeight,
        enableSetSwitchSound: enableSetSwitchSound,
        autoFillReps: autoFillReps,
        useLogsForRepInput: useLogsForRepInput,
      });
    } catch (error) {
      console.error('Error saving rest timer preferences:', error);
    }
    
    setTimerState(prev => updateTimerState(prev, {
      workoutStarted: true,
      workoutStage: 'exercise'
    }));
    
    startWorkoutTimer();
  };
  
  const handleNotificationToggle = async () => {
    if (!enableNotifications) {
      if (!notificationPermissionGranted) {
        Alert.alert(
          t('Permission Required'),
          t('Notification permission is required. Please enable notifications in the Settings page.'),
          [
            { text: t('Cancel'), style: 'cancel' },
            { 
              text: t('Go to Settings'), 
              onPress: () => navigation.navigate('Settings' as never),
              style: 'default' 
            },
          ]
        );
        return;
      }
      setEnableNotifications(true);
    } else {
      setEnableNotifications(false);
      // Clear any existing notifications when disabling
      try {
        await Notifications.dismissAllNotificationsAsync();
      } catch (error) {
        console.error('Error clearing notifications:', error);
      }
    }
  };
  
  const isDifferentExercise = (currentIndex: number, nextIndex: number): boolean => {
    if (nextIndex >= allSets.length) return false;
    return allSets[currentIndex].exercise_name !== allSets[nextIndex].exercise_name;
  };

  const completeWarmupSet = async (setIndex: number) => {
    const currentSet = allSets[setIndex];
    const fiveThreeOne = currentSet?.five_three_one;
    if (!currentSet || !fiveThreeOne?.description.isWarmup || currentSet.set_logged) {
      return;
    }

    setIsCompletingSet(true);
    try {
      const completedAt = Math.floor(Date.now() / 1000);
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `UPDATE FiveThreeOne_WorkoutLink
           SET warmup_completed_at = ?
           WHERE workout_link_id = ? AND is_warmup = 1;`,
          [completedAt, fiveThreeOne.description.workoutLinkId],
        );
      });

      const updatedSets = [...allSets];
      updatedSets[setIndex] = {
        ...currentSet,
        set_logged: true,
        five_three_one: {
          ...fiveThreeOne,
          description: { ...fiveThreeOne.description, warmupCompletedAt: completedAt },
        },
      };
      setAllSets(updatedSets);
      updateExerciseLoggedStatus(currentSet.exercise_id, updatedSets);

      let nextSetIndex = updatedSets.findIndex(
        (set, index) => index > setIndex && !set.set_logged,
      );
      if (nextSetIndex === -1) {
        nextSetIndex = updatedSets.findIndex((set) => !set.set_logged);
      }

      if (nextSetIndex === -1) {
        setTimerState(prev => updateTimerState(prev, { workoutStage: 'completed' }));
        stopWorkoutTimer();
        return;
      }

      const differentExercise =
        updatedSets[setIndex].exercise_name !== updatedSets[nextSetIndex].exercise_name;
      setTimerState(prev => updateTimerState(prev, {
        workoutStage: 'rest',
        isExerciseRest: differentExercise,
        currentSetIndex: nextSetIndex,
      }));

      const restValue = parseNumericInput(differentExercise ? exerciseRestTime : restTime);
      startRestTimer(restValue === null ? 0 : Math.trunc(restValue));
    } catch (error) {
      console.error('Error completing 5/3/1 warm-up:', error);
      Alert.alert(t('errorTitle'), t('fiveThreeOneWarmupError'));
    } finally {
      setIsCompletingSet(false);
    }
  };

  const muscleGroupData = [
    { label: t('Unspecified'), value: null },
    { label: t('Chest'), value: 'chest' },
    { label: t('Back'), value: 'back' },
    { label: t('Shoulders'), value: 'shoulders' },
    { label: t('Biceps'), value: 'biceps' },
    { label: t('Triceps'), value: 'triceps' },
    { label: t('Forearms'), value: 'forearms' },
    { label: t('Abs'), value: 'abs' },
    { label: t('Legs'), value: 'legs' },
    { label: t('Glutes'), value: 'glutes' },
    { label: t('Hamstrings'), value: 'hamstrings' },
    { label: t('Calves'), value: 'calves' },
    { label: t('Quads'), value: 'quads' },
  ];
  
  // Rest of the render functions remain the same...
  const renderOverview = () => {
    return (
      <View style={styles.overviewContainer}>
        <View style={[styles.workoutHeaderCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.workoutName, { color: theme.text }]}>{workout?.workout_name}</Text>
          <Text style={[styles.workoutDay, { color: theme.text }]}>{workout?.day_name}</Text>
          <View style={styles.workoutStats}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: theme.text }]}>{exercises.length}</Text>
              <Text style={[styles.statLabel, { color: theme.text }]}>{t('exercises')}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: theme.text }]}>
                {allSets.length}
              </Text>
              <Text style={[styles.statLabel, { color: theme.text }]}>{t('totalSets')}</Text>
            </View>
          </View>
        </View>
        
        <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('exercises')}</Text>
        <FlatList
          data={exercises}
          keyExtractor={(item) => item.logged_exercise_id.toString()}
          renderItem={({ item }) => {
            const muscleGroupInfo = muscleGroupData.find(mg => mg.value === item.muscle_group);
            return (
              <View style={[styles.exerciseItem, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1,}}>
                    <Text style={[styles.exerciseName, { color: theme.text, marginRight: 8 }]}>{item.exercise_name}</Text>
                    {muscleGroupInfo && muscleGroupInfo.value && (
                      <View style={[styles.muscleGroupBadgeOverview, { backgroundColor: theme.card, borderColor: theme.border }]}>
                        <Text maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={[styles.muscleGroupBadgeText, { color: theme.text }]}>
                          {t(muscleGroupInfo.label)}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {item.exercise_notes && (
                      <TouchableOpacity onPress={() => showNotes(item.exercise_notes!, item.exercise_name)} style={{ marginLeft: 10 }}>
                        <Ionicons name="bookmark-outline" size={22} color={theme.text} />
                      </TouchableOpacity>
                    )}
                    {item.web_link && (
                      <TouchableOpacity onPress={() => handleLinkPress(item.web_link)} style={{ marginLeft: 10 }}>
                        <Ionicons name="link-outline" size={22} color={theme.text} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
                <Text style={[styles.exerciseDetails, { color: theme.text, marginTop: 4 }]}>
                  {item.sets} {t('Sets')} × {item.reps} {t('Reps')}
                </Text>
              </View>
            )
          }}
          scrollEnabled={false}
          style={styles.exercisesList}
        />
        
        <View style={styles.setupSection}>
          <Text maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={[styles.setupLabel, { color: theme.text }]}>{t('restTimeBetweenSets')}:</Text>
          <AppTextInput
            variant="numeric"
            style={[styles.restTimeInput, { 
              backgroundColor: theme.card,
              color: theme.text,
              borderColor: theme.border
            }]}
            value={restTime}
            onRawChange={setRestTime}
            keyboardType="number-pad"
            maxLength={4}
            placeholderTextColor={theme.type === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'}
          />
          
          <Text maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={[styles.setupLabel, { color: theme.text }]}>{t('restTimeBetweenExercises')}:</Text>
          <AppTextInput
            variant="numeric"
            style={[styles.restTimeInput, { 
              backgroundColor: theme.card,
              color: theme.text,
              borderColor: theme.border
            }]}
            value={exerciseRestTime}
            onRawChange={setExerciseRestTime}
            keyboardType="number-pad"
            maxLength={4}
            placeholderTextColor={theme.type === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'}
          />
          
          <Text maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={[styles.setupLabel, { color: theme.text, marginTop: 15 }]}>{t('workoutSettings')}:</Text>
          
          <View style={[styles.toggleRow, { 
            backgroundColor: theme.type === 'dark' ? '#121212' : '#f0f0f0',
            borderColor: theme.type === 'dark' ? '#000000' : '#e0e0e0'
          }]}>
            <Text maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={[styles.toggleText, { color: theme.text }]}>{t('autoFillWeights')}</Text>
            <Switch
              value={autoFillWeight}
              onValueChange={handleAutoFillToggle}
              trackColor={{ false: theme.type === 'dark' ? '#444' : '#ccc', true: theme.buttonBackground }}
              thumbColor={autoFillWeight ? (theme.type === 'dark' ? '#fff' : '#fff') : (theme.type === 'dark' ? '#888' : '#f4f3f4')}
            />
          </View>

          <View style={[styles.toggleRow, {
            backgroundColor: theme.type === 'dark' ? '#121212' : '#f0f0f0',
            borderColor: theme.type === 'dark' ? '#000000' : '#e0e0e0'
          }]}>
            <Text maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={[styles.toggleText, { color: theme.text }]}>{t('autoFillReps')}</Text>
            <Switch
              value={autoFillReps}
              onValueChange={handleAutoFillRepsToggle}
              trackColor={{ false: theme.type === 'dark' ? '#444' : '#ccc', true: theme.buttonBackground }}
              thumbColor={autoFillReps ? (theme.type === 'dark' ? '#fff' : '#fff') : (theme.type === 'dark' ? '#888' : '#f4f3f4')}
            />
          </View>
          
          {autoFillReps && (
            <View style={[styles.toggleRow, {
              backgroundColor: theme.type === 'dark' ? '#121212' : '#f0f0f0',
              borderColor: theme.type === 'dark' ? '#000000' : '#e0e0e0'
            }]}>
              <Text maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={[styles.toggleText, { color: theme.text }]}>{t('useLogsForRepsTitle')}</Text>
              <Switch
                value={useLogsForRepInput}
                onValueChange={handleUseLogsForRepsToggle}
                trackColor={{ false: theme.type === 'dark' ? '#444' : '#ccc', true: theme.buttonBackground }}
                thumbColor={useLogsForRepInput ? (theme.type === 'dark' ? '#fff' : '#fff') : (theme.type === 'dark' ? '#888' : '#f4f3f4')}
              />
            </View>
          )}

          <View style={[styles.toggleRow, { 
            backgroundColor: theme.type === 'dark' ? '#121212' : '#f0f0f0',
            borderColor: theme.type === 'dark' ? '#000000' : '#e0e0e0'
          }]}>
            <Text maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={[styles.toggleText, { color: theme.text }]}>{t('vibration')}</Text>
            <Switch
              value={enableVibration}
              onValueChange={setEnableVibration}
              trackColor={{ false: theme.type === 'dark' ? '#444' : '#ccc', true: theme.buttonBackground }}
              thumbColor={enableVibration ? (theme.type === 'dark' ? '#fff' : '#fff') : (theme.type === 'dark' ? '#888' : '#f4f3f4')}
            />
          </View>
          
          <View style={[styles.toggleRow, { 
            backgroundColor: theme.type === 'dark' ? '#121212' : '#f0f0f0',
            borderColor: theme.type === 'dark' ? '#000000' : '#e0e0e0'
          }]}>
            <Text maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={[styles.toggleText, { color: theme.text }]}>{t('enableSetSwitchSound')}</Text>
            <Switch
              value={enableSetSwitchSound}
              onValueChange={setEnableSetSwitchSound}
              trackColor={{ false: theme.type === 'dark' ? '#444' : '#ccc', true: theme.buttonBackground }}
              thumbColor={enableSetSwitchSound ? (theme.type === 'dark' ? '#fff' : '#fff') : (theme.type === 'dark' ? '#888' : '#f4f3f4')}
            />
          </View>
          
          <View style={[styles.toggleRow, { 
            backgroundColor: theme.type === 'dark' ? '#121212' : '#f0f0f0',
            borderColor: theme.type === 'dark' ? '#000000' : '#e0e0e0'
          }]}>
            <Text maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={[styles.toggleText, { color: theme.text }]}>{t('notifications')}</Text>
            <Switch
              value={enableNotifications}
              onValueChange={() => handleNotificationToggle()}
              trackColor={{ false: theme.type === 'dark' ? '#444' : '#ccc', true: theme.buttonBackground }}
              thumbColor={enableNotifications ? (theme.type === 'dark' ? '#fff' : '#fff') : (theme.type === 'dark' ? '#888' : '#f4f3f4')}
            />
          </View>
          
          <TouchableOpacity
            style={[styles.startButton, { backgroundColor: theme.buttonBackground }]}
            onPress={startWorkout}
          >
            <Ionicons name="stopwatch-outline" size={20} color={theme.buttonText} style={styles.buttonIcon} />
            <Text style={[styles.buttonText, { color: theme.buttonText }]}>{t('startWorkout')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };
  
  // ... (rest of the render functions remain the same)
  
  const renderExerciseScreen = () => {
    const currentSet = allSets[timerState.currentSetIndex];
    if (!currentSet) return null;

    const fiveThreeOneDescription = currentSet.five_three_one?.description ?? null;
    const isWarmupSet = fiveThreeOneDescription?.isWarmup ?? false;
    const isAmrapSet = fiveThreeOneDescription?.isAmrap ?? false;
    const currentWeightUnit = currentSet.five_three_one?.unit ?? weightFormat;
    const actualRepsValue = parseNumericInput(currentSet.reps_done);
    const actualReps =
      actualRepsValue === null ? null : Math.trunc(actualRepsValue);
    const isBelowTarget =
      fiveThreeOneDescription !== null &&
      !isWarmupSet &&
      actualReps !== null &&
      actualReps > 0 &&
      isFiveThreeOneBelowTarget(currentSet.reps_goal, actualReps);
    const currentSetHasValidInputs = isWarmupSet || (
      hasPositiveIntegerPart(currentSet.reps_done) &&
      hasPositiveDecimalInput(currentSet.weight)
    );
    
    const muscleGroupInfo = muscleGroupData.find(mg => mg.value === currentSet.muscle_group);
    
    const isLastUnloggedSet = allSets.filter(s => !s.set_logged).length === 1;

    const loggedSetsCount = allSets.filter(s => s.set_logged).length;
    const progress = allSets.length > 0 ? (loggedSetsCount / allSets.length) * 100 : 0;
    
    const currentExerciseId = currentSet.exercise_id;
    const currentExerciseIndex = exercises.findIndex(ex => ex.logged_exercise_id === currentExerciseId);
    const isLastExercise = currentExerciseIndex === exercises.length - 1;
    const isLastSetOfExercise = currentSet.set_number === currentSet.total_sets;
    const isLastStructuralSet = isLastExercise && isLastSetOfExercise;

    return (
      <View style={styles.exerciseScreenContainer}>
        <View style={[styles.timerDisplay, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.timerLabel, { color: theme.text }]}>{t('workoutTime')}</Text>
          <Text style={[styles.workoutTimerText, { color: theme.text }]}>
            {timerCalculations.formatTime(timerState.workoutDuration)}
          </Text>
        </View>
        
        <View style={[
          styles.currentExerciseCard,
          {
            backgroundColor: theme.card,
            borderColor: isAmrapSet ? theme.buttonBackground : theme.border,
          },
          isAmrapSet && styles.amrapCard,
        ]}>
          <Text style={[styles.currentExerciseName, { color: theme.text }]}>
            {currentSet.exercise_name}
          </Text>

          <View style={styles.badgeAndIconsContainer}>
            {isAmrapSet && (
              <View style={[styles.amrapBadge, { backgroundColor: theme.buttonBackground }]}>
                <Text
                  maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                  style={[styles.amrapBadgeText, { color: theme.buttonText }]}
                >
                  {t('fiveThreeOneAmrap')}
                </Text>
              </View>
            )}
            {muscleGroupInfo && muscleGroupInfo.value && (
              <View style={[styles.muscleGroupBadgeMain, { backgroundColor: theme.card, borderColor: theme.border, marginRight: 8 }]}>
                <Text maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={[styles.muscleGroupBadgeText, { color: theme.text }]}>
                  {t(muscleGroupInfo.label)}
                </Text>
              </View>
            )}
            {currentSet.exercise_notes && (
              <TouchableOpacity onPress={() => showNotes(currentSet.exercise_notes!, currentSet.exercise_name)} style={{ marginRight: 8 }}>
                <Ionicons name="bookmark-outline" size={22} color={theme.text} />
              </TouchableOpacity>
            )}
            {currentSet.web_link && (
              <TouchableOpacity onPress={() => handleLinkPress(currentSet.web_link)}>
                <Ionicons name="link-outline" size={22} color={theme.text} />
              </TouchableOpacity>
            )}
          </View>
          
          <Text style={[styles.setInfo, { color: theme.text }]}>
           {currentSet.set_number}/{currentSet.total_sets}
          </Text>
          <Text style={[styles.repInfo, { color: theme.text }]}>
            {isAmrapSet ? t('fiveThreeOneAmrapPrompt') : `${t('goal')}: ${currentSet.reps_goal} ${t('Reps')}`}
          </Text>

          {isWarmupSet ? (
            <View style={[styles.warmupTarget, { backgroundColor: theme.inactivetint, borderColor: theme.border }]}>
              <Text maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={[styles.warmupTargetLabel, { color: theme.text }]}>
                {t('fiveThreeOneWarmupTarget')}
              </Text>
              <Text style={[styles.warmupTargetValue, { color: theme.text }]}>
                {currentSet.weight} {currentWeightUnit} × {currentSet.reps_goal} {t('Reps')}
              </Text>
            </View>
          ) : (
            <View style={styles.inputContainer}>
              <View style={styles.inputGroup}>
                <Text maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={[styles.inputLabel, { color: theme.text }]}>{t('repsDone')}</Text>
                <AppTextInput
                  variant="numeric"
                  style={[styles.input, {
                    backgroundColor: theme.card,
                    color: theme.text,
                    borderColor: theme.border
                  }]}
                  value={currentSet.reps_done}
                  onRawChange={(text) => {
                    const updatedSets = [...allSets];
                    updatedSets[timerState.currentSetIndex] = {
                      ...updatedSets[timerState.currentSetIndex],
                      reps_done: text
                    };
                    setAllSets(updatedSets);
                  }}
                  keyboardType="number-pad"
                  maxLength={4}
                  placeholder={isAmrapSet ? t('fiveThreeOneAmrapRepsPlaceholder') : "> 0"}
                  placeholderTextColor={theme.type === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={[styles.inputLabel, { color: theme.text }]}> {t('Weight')} ({currentWeightUnit})</Text>
                <AppTextInput
                  variant="numeric"
                  style={[styles.input, {
                    backgroundColor: theme.card,
                    color: theme.text,
                    borderColor: theme.border
                  }]}
                  value={currentSet.weight}
                  onRawChange={(text) => {
                    const updatedSets = [...allSets];
                    updatedSets[timerState.currentSetIndex] = {
                      ...updatedSets[timerState.currentSetIndex],
                      weight: text
                    };
                    setAllSets(updatedSets);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="> 0.0"
                  placeholderTextColor={theme.type === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'}
                />
              </View>
            </View>
          )}

          {isBelowTarget && (
            <Text style={[styles.belowTargetNote, { color: theme.text, backgroundColor: theme.inactivetint, borderColor: theme.border }]}>
              {t('fiveThreeOneBelowTarget')}
            </Text>
          )}
        </View>
        
        <View style={styles.controlsContainer}>
            {!isLastStructuralSet &&
            <TouchableOpacity
                style={[styles.completeButton, { 
                backgroundColor: 
                    !currentSetHasValidInputs
                    ? theme.inactivetint 
                    : theme.buttonBackground
                }]}
                onPress={() => {
                const pressCurrentSet = allSets[timerState.currentSetIndex];
                if (pressCurrentSet?.five_three_one?.description.isWarmup) {
                  void completeWarmupSet(timerState.currentSetIndex);
                  return;
                }
                const repsValue = pressCurrentSet
                  ? parseNumericInput(pressCurrentSet.reps_done)
                  : null;
                const weightValue = pressCurrentSet
                  ? parseNumericInput(pressCurrentSet.weight)
                  : null;
                const repsDone = repsValue === null ? null : Math.trunc(repsValue);
                if (
                  !pressCurrentSet ||
                  repsDone === null ||
                  repsDone <= 0 ||
                  weightValue === null ||
                  weightValue <= 0
                ) {
                    Alert.alert(t('missingInformation'), t('enterRepsAndWeight'));
                    return;
                }
                
                setIsCompletingSet(true);

                const updatedSets = [...allSets];
                const currentSetIndex = timerState.currentSetIndex;
                const currentSet = { ...updatedSets[currentSetIndex], set_logged: true };
                updatedSets[currentSetIndex] = currentSet;
                
                setAllSets(updatedSets);
                updateExerciseLoggedStatus(currentSet.exercise_id, updatedSets);
                
                const findNextUnloggedSet = (startIndex: number) => {
                    for (let i = startIndex; i < updatedSets.length; i++) {
                    if (!updatedSets[i].set_logged) {
                        return i;
                    }
                    }
                    return -1;
                };

                let nextSetIndex = findNextUnloggedSet(currentSetIndex + 1);

                if (nextSetIndex !== -1) {
                    const differentExercise = isDifferentExercise(currentSetIndex, nextSetIndex);
                    
                    setTimerState(prev => updateTimerState(prev, {
                    workoutStage: 'rest',
                    isExerciseRest: differentExercise,
                    currentSetIndex: nextSetIndex 
                    }));
                    
                    const restValue = parseNumericInput(
                      differentExercise ? exerciseRestTime : restTime,
                    );
                    const restSeconds =
                      restValue === null ? 0 : Math.trunc(restValue);
                    
                    setIsCompletingSet(false);
                    startRestTimer(restSeconds);
                    
                } else {
                    // No more unlogged sets after current one
                    const anyUnlogged = updatedSets.some(s => !s.set_logged);
                    if (anyUnlogged) {
                    Alert.alert(
                        t('unsavedSetsTitle'),
                        t('unsavedSetsMessage'),
                        [
                        {
                            text: t('Yes'),
                            style: 'destructive',
                            onPress: () => {
                            setTimerState(prev => updateTimerState(prev, { workoutStage: 'completed' }));
                            stopWorkoutTimer();
                            },
                        },
                        {
                            text: t('No'),
                            style: 'cancel',
                            onPress: () => {
                            const firstUnloggedIndex = findNextUnloggedSet(0);
                            if (firstUnloggedIndex !== -1) {
                                setTimerState(prev => updateTimerState(prev, {
                                workoutStage: 'exercise',
                                currentSetIndex: firstUnloggedIndex
                                }));
                            }
                            setIsCompletingSet(false);
                            },
                        },
                        ],
                        { onDismiss: () => setIsCompletingSet(false) }
                    );
                    } else {
                    // All sets are logged
                    setTimerState(prev => updateTimerState(prev, { workoutStage: 'completed' }));
                    stopWorkoutTimer();
                    }
                }
                }}
                disabled={
                    isCompletingSet ||
                    !currentSetHasValidInputs
                }
            >
                <Text style={[styles.buttonText, { color: theme.buttonText }]}>
                {isCompletingSet
                  ? `${t('completing')}...`
                  : isWarmupSet
                    ? t('fiveThreeOneCompleteWarmup')
                    : (isLastUnloggedSet ? t('finishWorkout') : t('completeSet'))}
                </Text>
            </TouchableOpacity>
            }
            <View style={styles.secondaryControlsContainer}>
                {!isLastExercise &&
                  <TouchableOpacity
                  style={[styles.secondaryButton, { backgroundColor: theme.card, borderColor: theme.border }]}
                  onPress={handleSkipToNextExercise}
                  >
                    <AutoSizeText
                      fontSize={16}
                      numberOfLines={3}
                      mode={ResizeTextMode.max_lines}
                      style={[styles.secondaryButtonText, { color: theme.text }]}
                    >
                      {t('skipToNextExercise')}
                    </AutoSizeText>
                  </TouchableOpacity>
                }
                <TouchableOpacity
                  style={[
                    styles.secondaryButton, 
                    { backgroundColor: theme.card, borderColor: theme.border },
                    (isLastExercise && !isLastStructuralSet) && { width: '100%' },
                    (isLastExercise && isLastStructuralSet) && { width: '100%' }
                  ]}
                  onPress={handleFinishWorkout}
                >
                  <AutoSizeText
                    fontSize={16}
                    numberOfLines={3}
                    mode={ResizeTextMode.max_lines}
                    style={[styles.secondaryButtonText, { color: theme.text }]}
                  >
                    {t('finishWorkout')}
                  </AutoSizeText>
                </TouchableOpacity>
            </View>
        </View>
        
        <View style={styles.progressContainer}>
          <Text style={[styles.progressText, { color: theme.text }]}>
          %{Math.round(progress)}
          </Text>
          <View style={[styles.progressBar, { backgroundColor: theme.border }]}>
            <View 
              style={[
                styles.progressFill, 
                { 
                  backgroundColor: theme.buttonBackground,
                  width: `${progress}%`
                }
              ]} 
            />
          </View>
        </View>
        <Text style={[styles.tipText, { color: theme.text }]}>{t('startedWorkoutTip')}</Text>
      </View>
    );
  };
  
  const renderRestScreen = () => {
    const nextSet = allSets[timerState.currentSetIndex];
    
    const muscleGroupInfo = nextSet ? muscleGroupData.find(mg => mg.value === nextSet.muscle_group) : null;

    let previousSetReps = null;
    let previousSetWeight = null;
    if (nextSet && !nextSet.five_three_one?.description.isWarmup) {
      const databaseSetNumber =
        nextSet.five_three_one?.description.databaseSetNumber ?? nextSet.set_number;
      const setKey = `${nextSet.exercise_name}-${databaseSetNumber}`;
      previousSetReps = repsMapRef.current.get(setKey) || null;
      previousSetWeight = weightMapRef.current.get(setKey) || null;
    }
    const nextSetWeightUnit = nextSet?.five_three_one?.unit ?? weightFormat;
    
    return (
      <View style={styles.restScreenContainer}>
        <View style={[styles.restCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.restTitle, { color: theme.text }]}>{t('restTime')}</Text>
          
          <View style={styles.restTimerContainer}>
            <Text style={[styles.restTimerText, { color: theme.text }]}>
              {timerState.restRemaining}
            </Text>
            <Text style={[styles.restTimerUnit, { color: theme.text }]}>{t('sec')}</Text>
          </View>
          
          <TouchableOpacity
              style={[styles.addTimeButton, { backgroundColor: theme.type === 'dark' ? 'rgba(255,255,255,0.15)' : theme.border }]}
            onPress={() => setTimerState(prev => updateTimerState(prev, { 
              restRemaining: (prev.restRemaining ?? 0) + 15 
            }))}
          >
            <Text style={[styles.addTimeButtonText, { color: theme.type === 'dark' ? 'white' : 'rgba(255, 255, 255, 0.8)' }]}>{t('addTime')}</Text>
          </TouchableOpacity>
          
          <Text style={[styles.restMessage, { color: theme.text }]}>
            {t('takeBreath')}
          </Text>
        </View>
        
        {nextSet && (
          <View style={[styles.upNextCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.upNextLabel, { color: theme.text }]}>{t('upNext')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
                <Text style={[styles.upNextExercise, { color: theme.text, marginRight: 8 }]}>
                  {nextSet.exercise_name}
                </Text>
                {muscleGroupInfo && muscleGroupInfo.value && (
                  <View style={[styles.muscleGroupBadgeModal, { backgroundColor: theme.card, borderColor: theme.border }]}>
                    <Text maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER} style={[styles.muscleGroupBadgeText, { color: theme.text }]}>
                      {t(muscleGroupInfo.label)}
                    </Text>
                  </View>
                )}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {nextSet.exercise_notes && (
                  <TouchableOpacity onPress={() => showNotes(nextSet.exercise_notes!, nextSet.exercise_name)} style={{ marginLeft: 10 }}>
                    <Ionicons name="bookmark-outline" size={22} color={theme.text} />
                  </TouchableOpacity>
                )}
                {nextSet.web_link && (
                  <TouchableOpacity onPress={() => handleLinkPress(nextSet.web_link)} style={{ marginLeft: 10 }}>
                    <Ionicons name="link-outline" size={22} color={theme.text} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <Text style={[styles.upNextSetInfo, { color: theme.text }]}>
              {t('upcomingSet')}: {nextSet.set_number}
            </Text>
            {(previousSetReps || previousSetWeight) && (
              <Text style={[styles.upNextSetInfo, { color: theme.text }]}>
                {t('lastWorkoutInfo')}:{' '}
                {previousSetReps ? `${previousSetReps} ${t('Reps')}` : ''}
                {previousSetReps && previousSetWeight ? ' / ' : ''}
                {previousSetWeight ? `${previousSetWeight} ${nextSetWeightUnit}` : ''}
              </Text>
            )}
          </View>
        )}
        
        <TouchableOpacity
          style={[styles.skipRestButton, { backgroundColor: theme.buttonBackground }]}
          onPress={() => {
            clearRestTimerState(); // Clear rest timer state when skipping
            setTimerState(prev => updateTimerState(prev, {
              workoutStage: 'exercise'
            }));
          }}
        >
          <Text style={[styles.buttonText, { color: theme.buttonText }]}>{t('skipRest')}</Text>
        </TouchableOpacity>
      </View>
    );
  };
  
  const renderCompletedScreen = () => {
    const loggedSets = allSets.filter(set => set.set_logged);
    const generatedSets = allSets.filter(set => set.five_three_one !== null);
    const generatedSessionFullyLogged =
      generatedSets.length > 0 &&
      generatedSets.every((set) => {
        const description = set.five_three_one?.description;
        return (
          set.set_logged &&
          description !== undefined &&
          (!description.isWarmup || description.warmupCompletedAt !== null)
        );
      });
    
    const saveWorkout = async () => {
      try {
        await db.withTransactionAsync(async () => {
          await db.runAsync(
            `UPDATE Workout_Log
             SET completion_time = ?
             WHERE workout_log_id = ?;`,
            [timerState.workoutDuration, workout_log_id],
          );

          for (const set of loggedSets) {
            const fiveThreeOne = set.five_three_one;
            if (fiveThreeOne?.description.isWarmup) {
              if (fiveThreeOne.description.warmupCompletedAt === null) {
                throw new Error('A completed warm-up is missing its completion timestamp.');
              }
              continue;
            }

            const weight = parseNumericInput(set.weight);
            const repsValue = parseNumericInput(set.reps_done);
            const repsDone = repsValue === null ? null : Math.trunc(repsValue);
            if (weight === null || weight <= 0 || repsDone === null || repsDone <= 0) {
              throw new Error('Numeric input became invalid before saving.');
            }

            const databaseSetNumber = fiveThreeOne?.description.databaseSetNumber ?? set.set_number;
            if (databaseSetNumber === null) {
              throw new Error('A work set is missing its database set number.');
            }

            const weightLogInsert = await db.runAsync(
              `INSERT INTO Weight_Log (
                workout_log_id,
                logged_exercise_id,
                exercise_name,
                set_number,
                weight_logged,
                reps_logged,
                muscle_group
              ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
              [
                workout_log_id,
                set.exercise_id,
                set.exercise_name,
                databaseSetNumber,
                weight,
                repsDone,
                set.muscle_group,
              ],
            );

            if (!fiveThreeOne) {
              continue;
            }

            await db.runAsync(
              `UPDATE FiveThreeOne_WorkoutLink
               SET weight_log_id = ?
               WHERE workout_link_id = ? AND is_warmup = 0;`,
              [weightLogInsert.lastInsertRowId, fiveThreeOne.description.workoutLinkId],
            );

            if (fiveThreeOne.description.isAmrap) {
              if (!workout) {
                throw new Error('The workout date is missing for the AMRAP result.');
              }

              const priorBest = await db.getFirstAsync<{ best_estimated_1rm: number | null }>(
                `SELECT MAX(estimated_1rm) AS best_estimated_1rm
                 FROM FiveThreeOne_AmrapResults
                 WHERE program_id = ? AND lift_id = ?;`,
                [fiveThreeOne.programId, fiveThreeOne.liftId],
              );
              const estimated1rm = estimate1RM(weight, repsDone);
              const isPr = isFiveThreeOneAmrapPr(
                estimated1rm,
                priorBest?.best_estimated_1rm ?? null,
              );

              await db.runAsync(
                `INSERT INTO FiveThreeOne_AmrapResults (
                  workout_link_id,
                  weight_log_id,
                  program_id,
                  cycle_id,
                  lift_id,
                  lift_name,
                  workout_date,
                  week_number,
                  work_set_number,
                  weight,
                  reps,
                  estimated_1rm,
                  is_pr
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
                [
                  fiveThreeOne.description.workoutLinkId,
                  weightLogInsert.lastInsertRowId,
                  fiveThreeOne.programId,
                  fiveThreeOne.cycleId,
                  fiveThreeOne.liftId,
                  fiveThreeOne.liftName || set.exercise_name,
                  workout.workout_date,
                  fiveThreeOne.weekNumber,
                  databaseSetNumber,
                  weight,
                  repsDone,
                  estimated1rm,
                  isPr ? 1 : 0,
                ],
              );
            }
          }

          if (generatedSessionFullyLogged) {
            await advanceFiveThreeOneCycleAfterSession(db, workout_log_id);
          }
        });
        
        Alert.alert(
          t('workoutSaved'),
          t('workoutSavedMessage'),
          [{ text: t('OK'), onPress: () => navigation.goBack() }]
        );
      } catch (error) {
        console.error('Error saving workout:', error);
        Alert.alert(
          t('savingError'),
          t('failedToSaveWorkout'),
        );
      }
    };
    
    return (
      <View style={styles.completedContainer}>
        <Ionicons name="checkmark-circle" size={80} color={theme.buttonBackground} style={styles.completedIcon} />
        
        <Text style={[styles.completedTitle, { color: theme.text }]}>{t('workoutCompleted')}</Text>
        
        <View style={[styles.completedCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.completedWorkoutName, { color: theme.text }]}>
            {workout?.workout_name}
          </Text>
          
          <View style={styles.completedStats}>
            <View style={styles.completedStatItem}>
              <Text style={[styles.completedStatValue, { color: theme.text }]}>
                {timerCalculations.formatTime(timerState.workoutDuration)}
              </Text>
              <Text style={[styles.completedStatLabel, { color: theme.text }]}>{t('totalTime')}</Text>
            </View>
            
            <View style={styles.completedStatItem}>
              <Text style={[styles.completedStatValue, { color: theme.text }]}>
                {loggedSets.length}
              </Text>
              <Text style={[styles.completedStatLabel, { color: theme.text }]}>{t('setsCompleted')}</Text>
            </View>
          </View>
        </View>
        
        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: theme.buttonBackground }]}
          onPress={saveWorkout}
        >
          <Text style={[styles.buttonText, { color: theme.buttonText }]}>
            {t('completeWorkout')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };
  
  const renderExerciseListModal = () => {
    const currentExerciseNameFromSet = allSets[timerState.currentSetIndex]?.exercise_name;

    return (
      <Modal
        visible={isExerciseListModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setIsExerciseListModalVisible(false);
        }}
      >




    {isExerciseListModalVisible && (
          <StatusBar
            barStyle={'light-content'}          />
        )}

        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPressOut={() => setIsExerciseListModalVisible(false)}
        >
          <View 
            style={[styles.modalContainer, { backgroundColor: theme.card, borderColor: theme.border }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>{workout?.day_name }</Text>
              <TouchableOpacity onPress={() => setIsExerciseListModalVisible(false)} style={styles.modalCloseButton}>
                <Ionicons name="close-outline" size={28} color={theme.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              showsVerticalScrollIndicator={false}
              data={exercises}
              keyExtractor={(item) => item.logged_exercise_id.toString()}
              renderItem={({ item }) => {
                const isCurrent = item.exercise_name === currentExerciseNameFromSet;
                const muscleGroupInfo = muscleGroupData.find(mg => mg.value === item.muscle_group);
                const itemStyle = [
                  styles.modalExerciseItem,
                  { borderColor: theme.border },
                  isCurrent
                    ? { 
                        backgroundColor: theme.buttonBackground,
                      }
                    : { backgroundColor: theme.card }
                ];
                const nameStyle = [
                  styles.modalExerciseName,
                  isCurrent
                    ? { color: theme.buttonText }
                    : { color: theme.text }
                ];
                const detailStyle = [
                  styles.modalExerciseDetails,
                  isCurrent
                    ? { color: theme.buttonText }
                    : { color: theme.text }
                ];

                const handlePress = () => {
                  if (item.exercise_fully_logged) {
                    return; // Do nothing if exercise is fully logged
                  }
                  
                  const firstUnloggedSetIndex = allSets.findIndex(
                    s => s.exercise_id === item.logged_exercise_id && !s.set_logged
                  );

                  if (firstUnloggedSetIndex !== -1) {
                    clearRestTimerState();
                    setTimerState(prev =>
                      updateTimerState(prev, {
                        currentSetIndex: firstUnloggedSetIndex,
                        workoutStage: 'exercise',
                      })
                    );
                    setIsExerciseListModalVisible(false);
                  }
                };

                // Use TouchableWithoutFeedback for completed exercises to maintain scrollability
                const TouchableComponent = item.exercise_fully_logged ? TouchableWithoutFeedback : TouchableOpacity;
                const touchableProps = item.exercise_fully_logged 
                  ? {} 
                  : { onPress: handlePress, disabled: item.exercise_fully_logged };

                return (
                  <TouchableComponent {...touchableProps}>
                    <View style={itemStyle}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
                          {item.exercise_fully_logged && (
                            <Ionicons name="checkmark-circle" size={20} color={isCurrent ? theme.buttonText : theme.buttonBackground} style={{ marginRight: 8 }} />
                          )}
                          <Text style={[nameStyle, { marginRight: 8 }]}>{item.exercise_name}</Text>
                          {muscleGroupInfo && muscleGroupInfo.value && (
                            <View style={[
                              styles.muscleGroupBadgeModal,
                              { 
                                backgroundColor: isCurrent ? theme.text : theme.card,
                                borderColor: isCurrent ? theme.buttonText : theme.border,
                              }
                            ]}>
                              <Text style={[
                                styles.muscleGroupBadgeText,
                                { color: isCurrent ? (theme.type === 'dark' ? '#000' : '#fff') : theme.text }
                              ]}>
                                {t(muscleGroupInfo.label)}
                              </Text>
                            </View>
                          )}
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          {item.exercise_notes && (
                            <TouchableOpacity onPress={() => showNotes(item.exercise_notes!, item.exercise_name)} style={{ marginLeft: 10 }}>
                              <Ionicons name="bookmark-outline" size={22} color={isCurrent ? theme.buttonText : theme.text} />
                            </TouchableOpacity>
                          )}
                          {item.web_link && (
                            <TouchableOpacity onPress={() => handleLinkPress(item.web_link)} style={{ marginLeft: 10 }}>
                              <Ionicons name="link-outline" size={22} color={isCurrent ? theme.buttonText : theme.text} />
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                      <Text style={[detailStyle, { marginTop: 4 }]}>
                        {item.sets} {t('Sets')} × {item.reps} {t('Reps')}
                      </Text>
                    </View>
                  </TouchableComponent>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    );
  };
  
  const renderNotesModal = () => {
    return (
      <Modal
        visible={isNotesModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setIsNotesModalVisible(false);
        }}
      >

        
    {isNotesModalVisible && (
          <StatusBar
            barStyle={'light-content'}          />
        )}



        
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPressOut={() => setIsNotesModalVisible(false)}
        >
          <View 
            style={[styles.modalContainer, { backgroundColor: theme.card, borderColor: theme.border }]}
            onStartShouldSetResponder={() => true} // Prevents modal from closing on inner press
          >
            <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>{notesModalTitle}</Text>
              <TouchableOpacity onPress={() => setIsNotesModalVisible(false)} style={styles.modalCloseButton}>
                <Ionicons name="close-outline" size={28} color={theme.text} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.notesSubHeader, { color: theme.text }]}>{t('exerciseNotes')}</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={[styles.notesModalText, { color: theme.text }]}>{notesModalContent}</Text>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    );
  };

  const clearRestTimerState = () => {
    stopRestTimer(); // Clear the interval
    setTimerState(prev => updateTimerState(prev, {
      isResting: false,
      isExerciseRest: false,
      restRemaining: null,
      restStartTime: null
    }));
  };
  
  // Preloaded once so each set switch just rewinds and replays.
  const setSwitchPlayer = useAudioPlayer(require('../assets/sounds/switch.mp3'));

  useEffect(() => {
    const configureAudio = async () => {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          interruptionMode: 'mixWithOthers',
          shouldRouteThroughEarpiece: false,
        });
      } catch (error) {
        console.error("Error configuring audio mode: ", error);
      }
    };

    configureAudio();
  }, []);

  const playSound = async () => {
    try {
      // Rewind first so repeated set switches replay the clip from the start.
      await setSwitchPlayer.seekTo(0);
      setSwitchPlayer.play();
    } catch (error) {
        console.log('Error playing sound', error);
    }
  };

  const handleSkipToNextExercise = () => {
    const currentExerciseId = allSets[timerState.currentSetIndex].exercise_id;
    const currentExerciseInExercisesIndex = exercises.findIndex(e => e.logged_exercise_id === currentExerciseId);

    let nextUnloggedExercise = null;
    for (let i = currentExerciseInExercisesIndex + 1; i < exercises.length; i++) {
        if (!exercises[i].exercise_fully_logged) {
            nextUnloggedExercise = exercises[i];
            break;
        }
    }

    if (nextUnloggedExercise) {
        const firstUnloggedSetIndex = allSets.findIndex(
            s => s.exercise_id === nextUnloggedExercise.logged_exercise_id && !s.set_logged
        );

        if (firstUnloggedSetIndex !== -1) {
            clearRestTimerState();
            setTimerState(prev =>
              updateTimerState(prev, {
                currentSetIndex: firstUnloggedSetIndex,
                workoutStage: 'exercise',
              })
            );
        }
    } else {
        Alert.alert(t('noMoreExercises'), t('allFollowingExercisesLogged'));
    }
  };
  const handleFinishWorkout = () => {
    const currentSetIndex = timerState.currentSetIndex;
    const currentSet = allSets[currentSetIndex];
    if (currentSet?.five_three_one?.description.isWarmup) {
      void completeWarmupSet(currentSetIndex);
      return;
    }

    const repsValue = currentSet
      ? parseNumericInput(currentSet.reps_done)
      : null;
    const weightValue = currentSet
      ? parseNumericInput(currentSet.weight)
      : null;
    const repsDone = repsValue === null ? null : Math.trunc(repsValue);

    if (
      currentSet &&
      repsDone !== null &&
      repsDone > 0 &&
      weightValue !== null &&
      weightValue > 0
    ) {
      const updatedSets = [...allSets];
      updatedSets[currentSetIndex] = { ...currentSet, set_logged: true };
      setAllSets(updatedSets);
      updateExerciseLoggedStatus(currentSet.exercise_id, updatedSets);
    }
    
    stopWorkoutTimer();
    setTimerState(prev => updateTimerState(prev, { workoutStage: 'completed' }));
  };
  
  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.text} />
        <Text style={[styles.loadingText, { color: theme.text }]}>{t('loadingWorkout')}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            navigation.goBack();
          }}
        >
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }]}>
          {timerState.workoutStarted ? (workout ? `${workout.workout_name} - ${workout.day_name}` : 'Workout') : t("startWorkout")}
        </Text>
        {timerState.workoutStarted ? (
          <TouchableOpacity 
            onPress={() => setIsExerciseListModalVisible(true)} 
            style={styles.headerListIcon}
          >
            <Ionicons name="reorder-three-outline" size={23} color={theme.text} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 23 + (styles.headerListIcon.padding * 2), marginLeft: styles.headerListIcon.marginLeft }} />
        )}
      </View>
      
      <ScrollView 
        showsVerticalScrollIndicator={false}
        style={styles.content} 
        contentContainerStyle={[
          styles.scrollContent,
          timerState.workoutStage === 'rest' && styles.restScrollContent
        ]}
      >
        {timerState.workoutStage === 'overview' && renderOverview()}
        {timerState.workoutStage === 'exercise' && renderExerciseScreen()}
        {timerState.workoutStage === 'rest' && renderRestScreen()}
        {timerState.workoutStage === 'completed' && renderCompletedScreen()}
      </ScrollView>
      {renderExerciseListModal()}
      {renderNotesModal()}
    </View>
  );
}

// Styles remain the same...
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacing.label,
    fontSize: fontSize.body,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 32,
    paddingBottom: spacing.card,
    paddingHorizontal: spacing.gutter,
  },
  backButton: {
    padding: 5,
    marginRight: spacing.card,
  },
  title: {
    fontSize: fontSize.cardTitle,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'center',
  },
  headerListIcon: {
    padding: 5,
    marginLeft: spacing.card,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.section,
  },
  restScrollContent: {
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.section,
    justifyContent: 'center',
    flex: 1
  },
  
  // Toggle styles
  toggleRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingVertical: spacing.label, 
    paddingHorizontal: spacing.card, 
    borderRadius: 8, 
    borderWidth: 1, 
    marginBottom: spacing.label 
  },
  toggleText: { 
    fontSize: fontSize.body, 
    fontWeight: '600' 
  },
  
  // Overview screen styles
  overviewContainer: {
    width: '100%',
  },
  workoutHeaderCard: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.card,
    marginBottom: spacing.section,
    alignItems: 'center',
  },
  workoutName: {
    fontSize: fontSize.sectionTitle,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  workoutDay: {
    fontSize: fontSize.cardTitle,
    marginBottom: spacing.card,
    textAlign: 'center',
  },
  workoutStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: spacing.label,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: displayFontSize.stat,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: fontSize.helper,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: fontSize.sectionTitle,
    fontWeight: 'bold',
    marginBottom: spacing.card,
  },
  exercisesList: {
    marginBottom: spacing.card,
  },
  exerciseItem: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.card,
    marginBottom: spacing.label,
  },
  exerciseName: {
    fontSize: fontSize.cardTitle,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  exerciseDetails: {
    fontSize: fontSize.helper,
  },
  setupSection: {
    marginTop: spacing.card,
    marginBottom: spacing.card,
  },
  setupLabel: {
    fontSize: fontSize.label,
    marginBottom: spacing.label,
  },
  restTimeInput: {
    minHeight: touchTarget.row,
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: spacing.card,
    fontSize: fontSize.cardTitle,
    marginBottom: spacing.card,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
    paddingVertical: spacing.card,
    marginTop: spacing.label,
  },
  buttonIcon: {
    marginRight: spacing.label,
  },
  buttonText: {
    fontSize: fontSize.button,
    fontWeight: 'bold',
  },
  
  // Exercise screen styles
  exerciseScreenContainer: {
    width: '100%',
  },
  timerDisplay: {
    alignItems: 'center',
    paddingVertical: spacing.card,
    borderRadius: radius.card,
    borderWidth: 1,
    marginBottom: spacing.card,
  },
  timerLabel: {
    fontSize: fontSize.helper,
    marginBottom: 4,
  },
  workoutTimerText: {
    fontSize: displayFontSize.workoutTimer,
    fontWeight: 'bold',
  },
  badgeAndIconsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 10,
    minHeight: 24, // To prevent layout shifts
  },
  amrapBadge: {
    borderRadius: 12,
    paddingHorizontal: spacing.label,
    paddingVertical: 3,
    marginRight: spacing.inline,
  },
  amrapBadgeText: {
    fontSize: fontSize.caption,
    fontWeight: 'bold',
  },
  currentExerciseCard: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.card,
    marginBottom: spacing.card,
  },
  amrapCard: {
    borderWidth: 2,
  },
  currentExerciseName: {
    fontSize: fontSize.sectionTitle,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  setInfo: {
    fontSize: fontSize.cardTitle,
    textAlign: 'center',
    marginBottom: spacing.label,
  },
  repInfo: {
    fontSize: fontSize.body,
    textAlign: 'center',
    marginBottom: spacing.card,
  },
  inputContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.label,
  },
  inputGroup: {
    width: '48%',
  },
  inputLabel: {
    fontSize: fontSize.helper,
    marginBottom: spacing.label,
  },
  input: {
    minHeight: touchTarget.row,
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: spacing.card,
    fontSize: fontSize.cardTitle,
  },
  warmupTarget: {
    borderRadius: radius.control,
    borderWidth: 1,
    padding: spacing.card,
    marginTop: spacing.label,
    alignItems: 'center',
  },
  warmupTargetLabel: {
    fontSize: fontSize.helper,
    marginBottom: spacing.inline,
  },
  warmupTargetValue: {
    fontSize: fontSize.cardTitle,
    fontWeight: 'bold',
  },
  belowTargetNote: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.label,
    paddingVertical: spacing.label,
    marginTop: spacing.label,
    fontSize: fontSize.helper,
  },
  controlsContainer: {
    marginTop: spacing.label,
    marginBottom: spacing.card,
  },
  completeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
    paddingVertical: spacing.card,
  },
  progressContainer: {
    marginBottom: spacing.card,
  },
  progressText: {
    fontSize: fontSize.helper,
    textAlign: 'center',
    marginBottom: spacing.inline,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    width: '100%',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  secondaryControlsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 32,
  },
  secondaryButton: {
    paddingVertical: spacing.label,
    paddingHorizontal: spacing.gutter,
    borderRadius: radius.card,
    borderWidth: 1,
    width: '48%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  tipText: {
    marginTop: spacing.card,
    textAlign: 'center',
    fontSize: fontSize.helper,
    fontStyle: 'italic',
  },
  
  // Rest screen styles
  restScreenContainer: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  restCard: {
    borderRadius: radius.pill,
    borderWidth: 1,
    padding: spacing.gutter,
    alignItems: 'center',
    marginBottom: spacing.section,
    width: '100%',
  },
  restTitle: {
    fontSize: fontSize.sectionTitle,
    fontWeight: 'bold',
    marginBottom: spacing.card,
  },
  restTimerContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: spacing.label,
  },
  restTimerText: {
    fontSize: displayFontSize.restTimer,
    fontWeight: 'bold',
    lineHeight: 70,
  },
  restTimerUnit: {
    fontSize: displayFontSize.displayUnit,
    marginBottom: spacing.label,
    marginLeft: 4,
  },
  addTimeButton: {
    paddingVertical: spacing.label,
    paddingHorizontal: spacing.card,
    borderRadius: radius.pill,
    marginBottom: spacing.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  addTimeButtonText: {
    fontSize: fontSize.body,
    fontWeight: 'bold',
  },
  restMessage: {
    fontSize: fontSize.body,
    textAlign: 'center',
    fontStyle: 'italic',
    maxWidth: '90%',
  },
  upNextCard: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.card,
    width: '100%',
    marginBottom: spacing.section,
  },
  upNextLabel: {
    fontSize: fontSize.helper,
    marginBottom: 4,
  },
  upNextExercise: {
    fontSize: fontSize.cardTitle,
    fontWeight: 'bold',
  },
  upNextSetInfo: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  skipRestButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
    paddingVertical: spacing.card,
    paddingHorizontal: spacing.section,
  },
  
  // Completed screen styles
  completedContainer: {
    width: '100%',
    alignItems: 'center',
    paddingTop: spacing.section,
  },
  completedIcon: {
    marginBottom: spacing.card,
  },
  completedTitle: {
    fontSize: displayFontSize.completedTitle,
    fontWeight: 'bold',
    marginBottom: spacing.section,
    textAlign: 'center',
  },
  completedCard: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.card,
    width: '100%',
    alignItems: 'center',
    marginBottom: spacing.section,
  },
  completedWorkoutName: {
    fontSize: fontSize.sectionTitle,
    fontWeight: 'bold',
    marginBottom: spacing.card,
    textAlign: 'center',
  },
  completedStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  completedStatItem: {
    alignItems: 'center',
  },
  completedStatValue: {
    fontSize: displayFontSize.stat,
    fontWeight: 'bold',
  },
  completedStatLabel: {
    fontSize: fontSize.helper,
    marginTop: 4,
  },
  saveButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
    paddingVertical: spacing.card,
    paddingHorizontal: 32,
    marginTop: spacing.card,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '90%',
    maxHeight: '70%',
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: spacing.card,
  },
  modalTitle: {
    fontSize: fontSize.sectionTitle,
    fontWeight: 'bold',
  },
  modalCloseButton: {
    padding: 5,
  },
  modalExerciseItem: {
    paddingVertical: spacing.label,
    paddingHorizontal: spacing.card,
    marginBottom: spacing.label,
    borderRadius: radius.control,
    borderWidth: 1,
  },
  modalExerciseName: {
    fontSize: fontSize.cardTitle,
    fontWeight: '600',
  },
  modalExerciseDetails: {
    fontSize: fontSize.helper,
  },
  muscleGroupBadgeMain: {
    paddingVertical: 3,
    paddingHorizontal: spacing.label,
    borderRadius: 12,
    borderWidth: 1,
    alignSelf: 'center',
  },
  muscleGroupBadgeOverview: {
    paddingVertical: 3,
    paddingHorizontal: spacing.label,
    borderRadius: 12,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  muscleGroupBadgeModal: {
    paddingVertical: 3,
    paddingHorizontal: spacing.label,
    borderRadius: 12,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  muscleGroupBadgeText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  notesModalText: {
    fontSize: fontSize.body,
    lineHeight: 21,
  },
  notesSubHeader: {
    fontSize: fontSize.cardTitle,
    fontWeight: 'bold',
    marginBottom: spacing.label,
  },
});
