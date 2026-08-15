import React from 'react';
import { Switch as NativeSwitch, type SwitchProps as NativeSwitchProps } from 'react-native';
import { useTheme } from '../context/ThemeContext';

/**
 * The themed switch. Its state must be unmistakable in both themes: the on track is the accent,
 * the off track is the disabled grey, and the thumb flips to the accent's counter-colour — a
 * switch that cannot be told apart from a grey rectangle is a defect, not a style choice
 * (maintainer, 2026-08-14).
 */
export type SwitchProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
};

export function Switch({ value, onValueChange, disabled, testID }: SwitchProps) {
  const { tokens } = useTheme();

  const nativeProps: Partial<NativeSwitchProps> = {
    trackColor: { true: tokens.accent, false: tokens.disabled },
    thumbColor: value ? tokens.onAccent : tokens.surface,
    ios_backgroundColor: tokens.disabled,
  };

  return (
    <NativeSwitch
      {...nativeProps}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      testID={testID}
    />
  );
}
