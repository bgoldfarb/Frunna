import type { StyleProp, ViewStyle } from 'react-native';

export type QueryResult = {
  text: string;
};

export type StepCountRow = {
  date: string;
  steps: number;
};

export type HeartRateRow = {
  date: string;
  avgBpm: number;
};

export type RestingHeartRateRow = {
  date: string;
  restingBpm: number;
};

export type SleepRow = {
  date: string;
  hoursAsleep: number;
};

export type HrvRow = {
  date: string;
  hrvMs: number;
};

export type Vo2MaxRow = {
  date: string;
  vo2Max: number;
};

export type ActiveEnergyRow = {
  date: string;
  activeKilocalories: number;
};

export type DistanceRow = {
  date: string;
  distanceKm: number;
};

export type WorkoutRow = {
  date: string;
  activityType: string;
  durationMinutes: number;
  energyKilocalories: number;
};

export type CalendarWorkoutEvent = {
  title: string;
  startDate: string;
  endDate: string;
  notes?: string;
};

export type HealthSummary = {
  steps: StepCountRow[];
  restingHeartRate: RestingHeartRateRow[];
  heartRate: HeartRateRow[];
  sleep: SleepRow[];
  hrv: HrvRow[];
  vo2Max: Vo2MaxRow[];
  activeEnergy: ActiveEnergyRow[];
  distanceWalkingRunning: DistanceRow[];
  workouts: WorkoutRow[];
};

export type ExpoAppleIntelligenceModuleEvents = Record<string, never>;

export type OnLoadEventPayload = {
  url: string;
};

export type ExpoAppleIntelligenceViewProps = {
  url: string;
  onLoad: (event: { nativeEvent: OnLoadEventPayload }) => void;
  style?: StyleProp<ViewStyle>;
};
