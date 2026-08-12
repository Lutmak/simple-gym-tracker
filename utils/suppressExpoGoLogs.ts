import { LogBox } from 'react-native';

// expo-notifications emits both of these from module scope the moment it is imported in Expo
// Go: remote push was removed from Expo Go in SDK 53, and DevicePushTokenAutoRegistration
// registers a push-token listener unconditionally. Neither is actionable — this app only uses
// local notifications, which still work — but the first is a console.error, so LogBox raises an
// overlay that sits on top of the bottom tab bar and makes the app unnavigable in development.
//
// They are hidden from LogBox only, not from the console, and only in Expo Go; a development
// build does not emit them at all.
//
// This module must be imported before expo-notifications. LogBox checks its ignore patterns when
// a log is recorded, so registering them from App.tsx would run too late — ES imports are
// evaluated before any statement in the importing module's body.
LogBox.ignoreLogs([
  'expo-notifications: Android Push notifications (remote notifications) functionality',
  '`expo-notifications` functionality is not fully supported in Expo Go',
]);
