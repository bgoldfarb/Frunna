import { NativeModule, registerWebModule } from 'expo';

import {
  CalendarWorkoutEvent,
  ExpoAppleIntelligenceModuleEvents,
  HealthSummary,
  QueryResult,
  StepCountRow,
} from './ExpoAppleIntelligence.types';

class ExpoAppleIntelligenceModule extends NativeModule<ExpoAppleIntelligenceModuleEvents> {
  async queryAsync(_: string): Promise<QueryResult> {
    throw new Error('Apple Intelligence querying is only available on iOS development builds.');
  }

  async requestHealthAuthorizationAsync(): Promise<boolean> {
    throw new Error('HealthKit is only available on iOS development builds.');
  }

  async getStepCountsAsync(_: number): Promise<StepCountRow[]> {
    throw new Error('HealthKit is only available on iOS development builds.');
  }

  async getHealthSummaryAsync(_: number): Promise<HealthSummary> {
    throw new Error('HealthKit is only available on iOS development builds.');
  }

  async requestCalendarAccessAsync(): Promise<boolean> {
    throw new Error('Calendar sync is only available on iOS development builds.');
  }

  async syncCalendarEventsAsync(_: CalendarWorkoutEvent[]): Promise<string[]> {
    throw new Error('Calendar sync is only available on iOS development builds.');
  }

  async removeCalendarEventsAsync(_: string[]): Promise<number> {
    throw new Error('Calendar sync is only available on iOS development builds.');
  }

  async setStoredValueAsync(_: string, __: string): Promise<boolean> {
    throw new Error('Native storage is only available on iOS development builds.');
  }

  async getStoredValueAsync(_: string): Promise<string | null> {
    throw new Error('Native storage is only available on iOS development builds.');
  }

  async removeStoredValueAsync(_: string): Promise<boolean> {
    throw new Error('Native storage is only available on iOS development builds.');
  }
}

export default registerWebModule(ExpoAppleIntelligenceModule, 'ExpoAppleIntelligence');
