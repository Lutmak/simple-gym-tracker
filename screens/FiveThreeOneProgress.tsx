import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSQLiteContext } from 'expo-sqlite';
import { LineChart } from 'react-native-chart-kit';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { WorkoutStackParamList } from '../App';
import { APP_TEXT_MAX_FONT_SIZE_MULTIPLIER } from '../components/AppTextInput';
import { useTheme } from '../context/ThemeContext';
import { useTranslation } from 'react-i18next';
import {
  buildFiveThreeOneProgressSeries,
  loadFiveThreeOneLiftProgress,
  loadFiveThreeOneProgressProgram,
  type FiveThreeOneProgressPoint,
  type FiveThreeOneProgressProgram,
  type FiveThreeOneProgressSeries,
} from '../utils/fiveThreeOneProgress';

type ProgressNavigationProp = StackNavigationProp<WorkoutStackParamList, 'FiveThreeOneProgress'>;
type ProgressRouteProp = RouteProp<WorkoutStackParamList, 'FiveThreeOneProgress'>;

type ProgressTheme = ReturnType<typeof useTheme>['theme'];

interface ProgressChartColors {
  color: (opacity?: number) => string;
  solid: string;
  shadowFrom: string;
  shadowTo: string;
}

interface ProgressLineChartProps {
  points: readonly FiveThreeOneProgressPoint[];
  colors: ProgressChartColors;
  decimalPlaces: number;
  emptyMessage: string;
  onePointMessage: string;
  scrollHint: string;
  suffix?: string;
  theme: ProgressTheme;
}

const progressChartColors = {
  trainingMax: {
    color: (opacity = 1) => `rgba(0, 123, 255, ${opacity})`,
    solid: 'rgba(0, 123, 255, 1)',
    shadowFrom: 'rgba(0, 123, 255, 0.15)',
    shadowTo: 'rgba(0, 123, 255, 0.02)',
  },
  amrap: {
    color: (opacity = 1) => `rgba(255, 159, 64, ${opacity})`,
    solid: 'rgba(255, 159, 64, 1)',
    shadowFrom: 'rgba(255, 159, 64, 0.15)',
    shadowTo: 'rgba(255, 159, 64, 0.02)',
  },
  estimated1RM: {
    color: (opacity = 1) => `rgba(0, 168, 132, ${opacity})`,
    solid: 'rgba(0, 168, 132, 1)',
    shadowFrom: 'rgba(0, 168, 132, 0.15)',
    shadowTo: 'rgba(0, 168, 132, 0.02)',
  },
} satisfies Record<string, ProgressChartColors>;

const formatMetricValue = (value: number, decimalPlaces: number): string =>
  Number(value.toFixed(decimalPlaces)).toString();

function ProgressLineChart({
  points,
  colors,
  decimalPlaces,
  emptyMessage,
  onePointMessage,
  scrollHint,
  suffix,
  theme,
}: ProgressLineChartProps) {
  if (points.length === 0) {
    return (
      <View style={styles.noDataContainer}>
        <Ionicons name="analytics-outline" size={50} color={theme.text} style={styles.fadedIcon} />
        <Text style={[styles.noDataText, { color: theme.text }]}>{emptyMessage}</Text>
      </View>
    );
  }

  const formattedValue = (point: FiveThreeOneProgressPoint): string => {
    const value = formatMetricValue(point.value, decimalPlaces);
    return suffix ? `${value} ${suffix}` : value;
  };

  if (points.length === 1) {
    const point = points[0];
    if (!point) {
      return null;
    }

    return (
      <View style={styles.singlePointContainer}>
        <Text style={[styles.singlePointValue, { color: theme.text }]}>
          {point.label}: {formattedValue(point)}
        </Text>
        <Text style={[styles.singlePointHint, { color: theme.text }]}>{onePointMessage}</Text>
      </View>
    );
  }

  const chartWidth = Math.max(Dimensions.get('window').width - 40, points.length * 60);
  const chartConfig = {
    backgroundColor: theme.card,
    backgroundGradientFrom: theme.card,
    backgroundGradientTo: theme.card,
    decimalPlaces,
    color: colors.color,
    labelColor: (_opacity = 1) => theme.text,
    style: { borderRadius: 16 },
    propsForDots: {
      r: '4',
      strokeWidth: '4',
      stroke: colors.solid,
    },
    fillShadowGradientFrom: colors.shadowFrom,
    fillShadowGradientTo: colors.shadowTo,
    fillShadowGradientFromOpacity: 0.5,
    fillShadowGradientToOpacity: 0.1,
    useShadowColorFromDataset: true,
    withShadow: true,
    withInnerLines: true,
    withOuterLines: true,
    fromZero: false,
  };

  return (
    <View style={styles.chartContainer}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chartScrollContainer}
      >
        <LineChart
          data={{
            labels: points.map((point) => point.label),
            datasets: [
              {
                data: points.map((point) => point.value),
                color: colors.color,
                strokeWidth: 2,
              },
            ],
          }}
          width={chartWidth}
          height={240}
          chartConfig={chartConfig}
          bezier
          style={styles.chart}
          verticalLabelRotation={30}
          withHorizontalLabels
          segments={4}
        />
      </ScrollView>
      {points.length > 5 && (
        <Text style={[styles.scrollHint, { color: theme.text }]}>{scrollHint}</Text>
      )}
    </View>
  );
}

export default function FiveThreeOneProgress() {
  const navigation = useNavigation<ProgressNavigationProp>();
  const route = useRoute<ProgressRouteProp>();
  const db = useSQLiteContext();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [program, setProgram] = useState<FiveThreeOneProgressProgram | null>(null);
  const [selectedLiftId, setSelectedLiftId] = useState<number | null>(null);
  const [progress, setProgress] = useState<FiveThreeOneProgressSeries | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProgressLoading, setIsProgressLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadProgram = async () => {
      setIsLoading(true);
      try {
        const loadedProgram = await loadFiveThreeOneProgressProgram(db, route.params.programId);
        if (!isMounted) {
          return;
        }

        setProgram(loadedProgram);
        setSelectedLiftId((currentLiftId) =>
          currentLiftId !== null && loadedProgram.lifts.some((lift) => lift.liftId === currentLiftId)
            ? currentLiftId
            : loadedProgram.lifts[0]?.liftId ?? null,
        );
        setError(null);
      } catch (loadError) {
        console.error('Error loading 5/3/1 progress program:', loadError);
        if (isMounted) {
          setError(
            loadError instanceof Error ? loadError.message : t('failedToLoadFiveThreeOneProgress'),
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadProgram();
    return () => {
      isMounted = false;
    };
  }, [db, route.params.programId, t]);

  useEffect(() => {
    if (selectedLiftId === null) {
      setProgress(null);
      setIsProgressLoading(false);
      return;
    }

    let isMounted = true;
    const loadProgress = async () => {
      setIsProgressLoading(true);
      try {
        const source = await loadFiveThreeOneLiftProgress(
          db,
          route.params.programId,
          selectedLiftId,
        );
        if (isMounted) {
          setProgress(
            buildFiveThreeOneProgressSeries({
              currentTrainingMax: source.lift.trainingMax,
              currentTrainingMaxLabel: t('current'),
              trainingMaxSnapshots: source.trainingMaxSnapshots,
              amrapResults: source.amrapResults,
            }),
          );
          setError(null);
        }
      } catch (loadError) {
        console.error('Error loading 5/3/1 lift progress:', loadError);
        if (isMounted) {
          setProgress(null);
          setError(
            loadError instanceof Error ? loadError.message : t('failedToLoadFiveThreeOneProgress'),
          );
        }
      } finally {
        if (isMounted) {
          setIsProgressLoading(false);
        }
      }
    };

    void loadProgress();
    return () => {
      isMounted = false;
    };
  }, [db, route.params.programId, selectedLiftId, t]);

  const selectedLift = program?.lifts.find((lift) => lift.liftId === selectedLiftId) ?? null;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      nestedScrollEnabled
    >
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={t('back')}
        >
          <Ionicons name="arrow-back" size={28} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }]}>{t('fiveThreeOneProgressTitle')}</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color={theme.buttonBackground} />
      ) : error && !program ? (
        <Text style={[styles.errorText, { color: theme.text }]} accessibilityRole="alert">
          {error}
        </Text>
      ) : program ? (
        <>
          <View style={[styles.summaryCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text
              maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
              style={[styles.programName, { color: theme.text }]}
            >
              {program.name}
            </Text>
            <Text style={[styles.detailText, { color: theme.text }]}>
              {program.unit} / {program.lifts.length} {t('configuredLifts')}
            </Text>
          </View>

          <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('fiveThreeOneSelectLift')}</Text>
          {program.lifts.length === 0 ? (
            <Text style={[styles.emptyText, { color: theme.text }]}>{t('noFiveThreeOneLifts')}</Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.liftSelectorContent}
            >
              {program.lifts.map((lift) => {
                const isSelected = lift.liftId === selectedLiftId;
                return (
                  <TouchableOpacity
                    key={lift.liftId}
                    style={[
                      styles.liftButton,
                      {
                        backgroundColor: isSelected ? theme.buttonBackground : theme.card,
                        borderColor: theme.border,
                      },
                    ]}
                    activeOpacity={0.8}
                    onPress={() => {
                      setSelectedLiftId(lift.liftId);
                      setError(null);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={lift.name}
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Text
                      maxFontSizeMultiplier={APP_TEXT_MAX_FONT_SIZE_MULTIPLIER}
                      style={[styles.liftButtonText, { color: isSelected ? theme.buttonText : theme.text }]}
                    >
                      {lift.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {error && program && (
            <Text style={[styles.errorText, { color: theme.text }]} accessibilityRole="alert">
              {error}
            </Text>
          )}

          {isProgressLoading ? (
            <ActivityIndicator size="large" color={theme.buttonBackground} style={styles.progressLoader} />
          ) : progress && selectedLift ? (
            <>
              <View style={[styles.chartCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Text style={[styles.chartTitle, { color: theme.text }]}>
                  {t('fiveThreeOneTrainingMaxTrend')}
                </Text>
                <ProgressLineChart
                  points={progress.trainingMax}
                  colors={progressChartColors.trainingMax}
                  decimalPlaces={1}
                  suffix={program.unit}
                  emptyMessage={t('fiveThreeOneProgressNoData')}
                  onePointMessage={t('fiveThreeOneProgressOnePoint')}
                  scrollHint={t('horizontalScrollHint')}
                  theme={theme}
                />
              </View>

              <View style={[styles.chartCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Text style={[styles.chartTitle, { color: theme.text }]}>
                  {t('fiveThreeOneAmrapTrend')}
                </Text>
                <ProgressLineChart
                  points={progress.amrapReps}
                  colors={progressChartColors.amrap}
                  decimalPlaces={0}
                  suffix={t('Reps')}
                  emptyMessage={t('fiveThreeOneProgressNoData')}
                  onePointMessage={t('fiveThreeOneProgressOnePoint')}
                  scrollHint={t('horizontalScrollHint')}
                  theme={theme}
                />
              </View>

              <View style={[styles.chartCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Text style={[styles.chartTitle, { color: theme.text }]}>
                  {t('fiveThreeOneEstimated1RMTrend')}
                </Text>
                <ProgressLineChart
                  points={progress.estimated1RM}
                  colors={progressChartColors.estimated1RM}
                  decimalPlaces={1}
                  suffix={program.unit}
                  emptyMessage={t('fiveThreeOneProgressNoData')}
                  onePointMessage={t('fiveThreeOneProgressOnePoint')}
                  scrollHint={t('horizontalScrollHint')}
                  theme={theme}
                />
              </View>
            </>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 50,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 28,
  },
  backButton: {
    minWidth: 44,
    minHeight: 44,
    padding: 8,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    flexShrink: 1,
  },
  summaryCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 18,
    marginBottom: 20,
  },
  programName: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
  },
  detailText: {
    fontSize: 15,
    lineHeight: 22,
    opacity: 0.75,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 10,
  },
  liftSelectorContent: {
    paddingBottom: 4,
  },
  liftButton: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  liftButtonText: {
    fontSize: 15,
    fontWeight: '800',
  },
  chartCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginTop: 16,
  },
  chartTitle: {
    fontSize: 19,
    fontWeight: '800',
    marginHorizontal: 6,
    marginBottom: 4,
  },
  chartContainer: {
    marginTop: 4,
  },
  chartScrollContainer: {
    paddingRight: 8,
  },
  chart: {
    borderRadius: 16,
  },
  scrollHint: {
    fontSize: 13,
    opacity: 0.7,
    textAlign: 'center',
    marginTop: 2,
  },
  noDataContainer: {
    minHeight: 150,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  fadedIcon: {
    opacity: 0.5,
  },
  noDataText: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 12,
  },
  singlePointContainer: {
    minHeight: 150,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  singlePointValue: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  singlePointHint: {
    fontSize: 14,
    lineHeight: 21,
    opacity: 0.7,
    textAlign: 'center',
    marginTop: 8,
  },
  progressLoader: {
    marginTop: 24,
  },
  emptyText: {
    fontSize: 15,
    lineHeight: 22,
    opacity: 0.7,
  },
  errorText: {
    fontSize: 15,
    lineHeight: 22,
    opacity: 0.8,
    marginBottom: 16,
  },
});
