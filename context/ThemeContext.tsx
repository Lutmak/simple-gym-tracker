import React, { createContext, useState, useEffect, useContext, ReactNode } from 'react';
import { Appearance, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as NavigationBar from 'expo-navigation-bar';
import {
  getTokens,
  lightTokens,
  darkTokens,
  toLegacyPalette,
  type LegacyPalette,
  type ThemeTokens,
} from '../utils/theme';

// The one colour source is utils/theme.ts. The legacy `theme` object is the pre-design-system
// shape the old screens read; it resolves entirely through the token layer and is deleted
// piece by piece as screens are rebuilt on the primitives (Phases H-S).
const LightTheme: LegacyPalette = toLegacyPalette(lightTokens);
const DarkTheme: LegacyPalette = toLegacyPalette(darkTokens);

type ThemeContextValue = {
  theme: LegacyPalette;
  tokens: ThemeTokens;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: LightTheme,
  tokens: lightTokens,
  toggleTheme: () => {},
});

type ThemeProviderProps = {
  children: ReactNode;
};

export const ThemeProvider = ({ children }: ThemeProviderProps) => {
  const [theme, setTheme] = useState<LegacyPalette>(LightTheme);

  const themeFilePath = `${FileSystem.documentDirectory}theme.json`;

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const storedTheme = await FileSystem.readAsStringAsync(themeFilePath);
        setTheme(storedTheme === 'dark' ? DarkTheme : LightTheme);
      } catch {
        const colorScheme = Appearance.getColorScheme();
        setTheme(colorScheme === 'dark' ? DarkTheme : LightTheme);
      }
    };
    loadTheme();
  }, []);

  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setStyle(theme.type === 'light' ? 'light' : 'dark');
    }
  }, [theme.type]);

  const toggleTheme = async () => {
    const newTheme = theme === LightTheme ? DarkTheme : LightTheme;
    setTheme(newTheme);
    await FileSystem.writeAsStringAsync(themeFilePath, theme === LightTheme ? 'dark' : 'light');
  };

  const tokens = getTokens(theme.type);

  return (
    <ThemeContext.Provider value={{ theme, tokens, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
