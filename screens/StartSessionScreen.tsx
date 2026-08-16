import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { InicioStackParamList } from '../App';
import SessionRunnerScreen from './SessionRunnerScreen';

type Props = NativeStackScreenProps<InicioStackParamList, 'StartSession'>;

export default function StartSessionScreen(props: Props) {
  return <SessionRunnerScreen mode="planned" {...props} />;
}
