import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { NavigationProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { Button } from '../components/Button';
import { Row } from '../components/Row';
import { Screen } from '../components/Screen';
import { Section } from '../components/Section';
import { Stat } from '../components/Stat';
import { fontSize, spacing } from '../utils/scale';
import { datePartsOfStamp } from '../utils/inicio';
import type { InicioStackParamList, RootTabParamList } from '../App';
import type { SessionSummaryDeviation } from '../utils/sessionSummary';

type Props = NativeStackScreenProps<InicioStackParamList, 'SessionSummary'>;

const MONTH_KEYS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const WEEKDAY_KEYS = [
  'weekdayFullSun',
  'weekdayFullMon',
  'weekdayFullTue',
  'weekdayFullWed',
  'weekdayFullThu',
  'weekdayFullFri',
  'weekdayFullSat',
] as const;

const formatWeight = (value: number): string => String(Number(value.toFixed(1)));

const formatSetValue = (
  value: number | null,
  unit: string,
  noWeight: string,
): string => (value === null ? noWeight : `${formatWeight(value)} ${unit}`);

export default function SessionSummaryScreen({ navigation, route }: Props) {
  const { tokens } = useTheme();
  const { t } = useTranslation();
  const { sessionName, routineName, workoutDate, summary, finishContext } = route.params;
  const date = datePartsOfStamp(workoutDate);
  const dateLabel = t('inicioDate', {
    weekday: t(WEEKDAY_KEYS[date.weekday]),
    day: date.day,
    month: t(MONTH_KEYS[date.month]),
    year: date.year,
  });
  const durationValue =
    summary.durationSeconds === null
      ? { value: t('sessionSummaryTimingUnavailable'), unit: undefined }
      : {
          value: String(Math.max(1, Math.round(summary.durationSeconds / 60))),
          unit: t('sessionSummaryMinuteUnit'),
        };

  const close = () => navigation.popToTop();

  const openProgress = () => {
    const parent = navigation.getParent<NavigationProp<RootTabParamList>>();
    navigation.popToTop();
    parent?.navigate('Progress', {
      focus: {
        routineId: finishContext.routineId,
        cycleId: finishContext.cycleId,
        weekNumber: finishContext.weekNumber,
      },
    });
  };

  const openReview = () => {
    const parent = navigation.getParent<NavigationProp<RootTabParamList>>();
    navigation.popToTop();
    parent?.navigate('Routines', {
      screen: 'CycleReview',
      params: {
        routineId: finishContext.routineId,
        cycleId: finishContext.cycleId,
      },
    });
  };

  const deviationLabel = (deviation: SessionSummaryDeviation): string => {
    const position = t('sessionSummarySet', { n: deviation.setNumber });
    if (deviation.kind === 'notDone') {
      return `${deviation.exerciseName} · ${position}: ${t('sessionSummaryNotDoneDeviation')}`;
    }
    if (deviation.kind === 'extra') {
      const weight = formatSetValue(
        deviation.actual.weight,
        deviation.actual.unit,
        t('sessionSummaryNoWeight'),
      );
      return `${deviation.exerciseName} · ${position}: ${t('sessionSummaryExtraSet', {
        reps: deviation.actual.reps,
        weight,
      })}`;
    }

    const details: string[] = [];
    const repsChanged = deviation.actual.reps !== deviation.target.reps;
    if (repsChanged) {
      details.push(
        t('sessionSummaryRepsChange', {
          actual: deviation.actual.reps,
          target: deviation.target.reps,
        }),
      );
    }
    const weightChanged =
      deviation.actual.weight !== deviation.target.weight ||
      (deviation.target.weight !== null && deviation.actual.unit !== deviation.target.unit);
    if (weightChanged) {
      details.push(
        t('sessionSummaryWeightChange', {
          actual: formatSetValue(
            deviation.actual.weight,
            deviation.actual.unit,
            t('sessionSummaryNoWeight'),
          ),
          target: formatSetValue(
            deviation.target.weight,
            deviation.target.unit,
            t('sessionSummaryNoWeight'),
          ),
        }),
      );
    }
    return `${deviation.exerciseName} · ${position}: ${details.join(' · ')}`;
  };

  return (
    <Screen scroll testID="session-summary">
      <View style={styles.header}>
        <Text style={[styles.title, { color: tokens.textPrimary }]}>{t('sessionSavedTitle')}</Text>
        <Text style={[styles.savedLine, { color: tokens.textSecondary }]}>
          {t('sessionSummarySavedLine', {
            session: sessionName,
            routine: routineName,
            date: dateLabel,
          })}
        </Text>
      </View>

      <View style={styles.stats} testID="session-summary-stats">
        <Stat
          label={t('sessionSummaryDuration')}
          value={durationValue.value}
          unit={durationValue.unit}
        />
        <Stat
          label={t('sessionSummaryExercises')}
          value={String(summary.exerciseCount)}
        />
        <Stat
          label={t('sessionSummarySets')}
          value={String(summary.workSetCount)}
        />
        {summary.volumes.length === 0 ? (
          <Stat
            label={t('sessionSummaryVolume')}
            value={t('sessionSummaryNoVolume')}
            testID="session-summary-volume"
          />
        ) : (
          summary.volumes.map((volume) => (
            <Stat
              key={volume.unit}
              label={t('sessionSummaryVolume')}
              value={formatWeight(volume.volume)}
              unit={volume.unit}
              testID={`session-summary-volume-${volume.unit}`}
            />
          ))
        )}
      </View>

      {summary.deviations.length > 0 && (
        <Section title={t('sessionSummaryChanges')} testID="session-summary-changes">
          {summary.deviations.map((deviation) => (
            <Row
              key={`${deviation.exerciseName}:${deviation.setNumber}:${deviation.kind}`}
              label={deviationLabel(deviation)}
              divided
            />
          ))}
        </Section>
      )}

      {finishContext.reviewAvailable && (
        <Section
          title={t('sessionSummaryNext')}
          hint={t('sessionSummaryNextHint')}
          testID="session-summary-next"
        >
          <Button
            label={t('sessionSummaryReview')}
            onPress={openReview}
            testID="session-summary-review"
          />
        </Section>
      )}

      <Section testID="session-summary-actions">
        <Button
          label={t('sessionSavedSeeProgress')}
          onPress={openProgress}
          testID="session-summary-progress"
        />
        <Row
          label={t('sessionSummaryClose')}
          onPress={close}
          divided
          testID="session-summary-close"
        />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.section,
  },
  title: {
    fontSize: fontSize.screenTitle,
    fontWeight: '700',
  },
  savedLine: {
    fontSize: fontSize.body,
    marginTop: spacing.label,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.section,
    marginBottom: spacing.section,
  },
});
