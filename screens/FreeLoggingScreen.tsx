import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { InicioStackParamList } from '../App';
import SessionRunnerScreen from './SessionRunnerScreen';

type Props = NativeStackScreenProps<InicioStackParamList, 'FreeLogging'>;

export default function FreeLoggingScreen(props: Props) {
  return <SessionRunnerScreen mode="free" {...props} />;
}
