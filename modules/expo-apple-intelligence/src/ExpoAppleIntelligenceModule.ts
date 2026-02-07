import { NativeModule, requireNativeModule } from 'expo';

import {
  CalendarWorkoutEvent,
  ExpoAppleIntelligenceModuleEvents,
  HealthSummary,
  QueryResult,
  StepCountRow,
} from './ExpoAppleIntelligence.types';

declare class ExpoAppleIntelligenceModule extends NativeModule<ExpoAppleIntelligenceModuleEvents> {
  queryAsync(prompt: string): Promise<QueryResult>;
  requestHealthAuthorizationAsync(): Promise<boolean>;
  getStepCountsAsync(days: number): Promise<StepCountRow[]>;
  getHealthSummaryAsync(days: number): Promise<HealthSummary>;
  requestCalendarAccessAsync(): Promise<boolean>;
  syncCalendarEventsAsync(events: CalendarWorkoutEvent[]): Promise<string[]>;
  removeCalendarEventsAsync(eventIds: string[]): Promise<number>;
  setStoredValueAsync(key: string, value: string): Promise<boolean>;
  getStoredValueAsync(key: string): Promise<string | null>;
  removeStoredValueAsync(key: string): Promise<boolean>;
}

export default requireNativeModule<ExpoAppleIntelligenceModule>('ExpoAppleIntelligence');
