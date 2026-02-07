import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  Vibration,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import ExpoAppleIntelligence from './modules/expo-apple-intelligence';
import type { CalendarWorkoutEvent, HealthSummary } from './modules/expo-apple-intelligence';
import { buildAdaptiveRunningCoachPrompt, WEEK_PARTS } from './prompts/adaptiveRunningCoachPrompt';

const normalizeSummary = (summary: Partial<HealthSummary>): HealthSummary => ({
  steps: summary.steps ?? [],
  restingHeartRate: summary.restingHeartRate ?? [],
  heartRate: summary.heartRate ?? [],
  sleep: summary.sleep ?? [],
  hrv: summary.hrv ?? [],
  vo2Max: summary.vo2Max ?? [],
  activeEnergy: summary.activeEnergy ?? [],
  distanceWalkingRunning: summary.distanceWalkingRunning ?? [],
  workouts: summary.workouts ?? [],
});

const GOAL_OPTIONS = ['5K', '10K', 'Half Marathon', 'Marathon'] as const;
type GoalOption = (typeof GOAL_OPTIONS)[number];
const RUNNING_LEVEL_OPTIONS = ['Beginner', 'Intermediate', 'Advanced', 'Elite'] as const;
type RunningLevelOption = (typeof RUNNING_LEVEL_OPTIONS)[number];
const LONG_RUN_OPTIONS = ['Saturday', 'Sunday'] as const;
type LongRunOption = (typeof LONG_RUN_OPTIONS)[number];
const DISTANCE_UNIT_OPTIONS = ['km', 'miles'] as const;
type DistanceUnitOption = (typeof DISTANCE_UNIT_OPTIONS)[number];
const LOOKBACK_DAY_OPTIONS = [14, 30, 60, 90] as const;
type LookbackDaysOption = (typeof LOOKBACK_DAY_OPTIONS)[number];
const PLAN_LENGTH_OPTIONS = [8, 10, 12] as const;
type PlanLengthOption = (typeof PLAN_LENGTH_OPTIONS)[number];
const TRAIN_DAYS_OPTIONS = [1, 2, 3, 4, 5, 6, 7] as const;
type PlanTable = {
  headers: string[];
  rows: string[][];
};
type DisplayPlanTable = {
  title: string;
  headers: string[];
  rows: string[][];
};
type WeeklyDebugPrompt = {
  week: number;
  mode: 'full' | 'compact' | 'full-corrective' | 'compact-corrective';
  prompt: string;
};
type PlanSegment = 'weeks1to4' | 'weeks5to8';
type AppScreen = 'setup' | 'plan';
type PlanView = 'overview' | 'today' | 'progress' | 'calendar';
type BannerType = 'info' | 'success' | 'error';
type StructuredPlanDay = {
  day: string;
  workoutType: string;
  details: string;
  rationale: string;
};
type StructuredPlanWeek = {
  week: number;
  verdict: string;
  reasoning: string;
  days: StructuredPlanDay[];
};
type SavedPlan = {
  id: string;
  createdAt: string;
  goal: GoalOption;
  planLengthWeeks: number;
  runDaysPerWeek: string;
  longRunDay: LongRunOption;
  distanceUnit: DistanceUnitOption;
  planStartDate: string;
  response: string;
  tables: PlanTable[];
};
type WorkoutCheckin = {
  completedAt: string;
  rpe: number;
  soreness: number;
  sleepQuality: number;
  notes: string;
};
type CompletionMap = Record<string, WorkoutCheckin>;
type CalendarWeekCell = {
  dayName: string;
  workoutType: string;
  details: string;
  isRest: boolean;
};
type CalendarWeekRow = {
  title: string;
  cells: CalendarWeekCell[];
};
type SelectedCalendarCell = {
  weekTitle: string;
  dayName: string;
  workoutType: string;
  details: string;
};
const TABLE_COLUMN_WIDTHS = [80, 110, 130, 220, 220];
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const STORAGE_PLANS_KEY = 'frunna_saved_plans_v1';
const STORAGE_COMPLETIONS_KEY = 'frunna_completions_v1';
const DAY_INDEX: Record<string, number> = {
  monday: 0,
  mon: 0,
  tuesday: 1,
  tue: 1,
  tues: 1,
  wednesday: 2,
  wed: 2,
  thursday: 3,
  thu: 3,
  thurs: 3,
  friday: 4,
  fri: 4,
  saturday: 5,
  sat: 5,
  sunday: 6,
  sun: 6,
};

const average = (values: number[]): number => {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const trendLine = (label: string, values: number[], unit: string): string => {
  if (!values.length) {
    return `${label}: no data`;
  }

  const midpoint = Math.floor(values.length / 2);
  if (midpoint < 1 || values.length - midpoint < 1) {
    return `${label}: ${average(values).toFixed(1)} ${unit} (not enough data for trend)`;
  }

  const previous = average(values.slice(0, midpoint));
  const recent = average(values.slice(midpoint));

  if (previous === 0) {
    return `${label}: ${recent.toFixed(1)} ${unit} recent avg`;
  }

  const deltaPercent = ((recent - previous) / previous) * 100;
  const direction = deltaPercent >= 0 ? 'up' : 'down';
  return `${label}: ${recent.toFixed(1)} ${unit} recent avg (${direction} ${Math.abs(deltaPercent).toFixed(1)}% vs prior period)`;
};

const summarizeWorkouts = (summary: HealthSummary, lookbackDays: number): string[] => {
  if (!summary.workouts.length) {
    return ['No workouts logged in this period.'];
  }

  const totalMinutes = summary.workouts.reduce((sum, workout) => sum + workout.durationMinutes, 0);
  const totalKcal = summary.workouts.reduce((sum, workout) => sum + workout.energyKilocalories, 0);
  const avgMinutes = totalMinutes / summary.workouts.length;

  const activityCounts = summary.workouts.reduce<Record<string, number>>((acc, workout) => {
    acc[workout.activityType] = (acc[workout.activityType] ?? 0) + 1;
    return acc;
  }, {});

  const topActivities = Object.entries(activityCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([activity, count]) => `${activity} x${count}`)
    .join(', ');

  const recentSessions = summary.workouts
    .slice(0, 6)
    .map((workout) => {
      const date = workout.date.slice(0, 10);
      return `${date}: ${workout.activityType}, ${workout.durationMinutes}min, ${workout.energyKilocalories}kcal`;
    });

  return [
    `${summary.workouts.length} workouts completed over ${lookbackDays} days.`,
    `Total workout time ${totalMinutes} min (avg ${avgMinutes.toFixed(0)} min per session).`,
    `Total workout energy ${totalKcal} kcal.`,
    `Most frequent sessions: ${topActivities || 'none'}.`,
    'Recent sessions:',
    ...recentSessions,
  ];
};

const parseCells = (line: string) =>
  line
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());

const parseMarkdownTables = (text: string): PlanTable[] => {
  const rawLines = text.split('\n').map((line) => line.trim());
  const tables: PlanTable[] = [];
  let index = 0;

  while (index < rawLines.length) {
    if (!(rawLines[index].startsWith('|') && rawLines[index].endsWith('|'))) {
      index += 1;
      continue;
    }

    const block: string[] = [];
    while (index < rawLines.length && rawLines[index].startsWith('|') && rawLines[index].endsWith('|')) {
      block.push(rawLines[index]);
      index += 1;
    }

    if (block.length < 3 || !block[1].includes('---')) {
      continue;
    }

    const headers = parseCells(block[0]);
    const rows = block
      .slice(2)
      .map(parseCells)
      .map((row) => {
        if (row.length === headers.length) {
          return row;
        }
        if (row.length > headers.length) {
          const normalized = row.slice(0, headers.length - 1);
          normalized.push(row.slice(headers.length - 1).join(' | '));
          return normalized;
        }
        return [...row, ...Array.from({ length: headers.length - row.length }, () => '')];
      })
      .filter((row) => row.length === headers.length);

    if (rows.length) {
      tables.push({ headers, rows });
    }
  }

  return tables;
};

const normalizeDayName = (value: string): string | null => {
  const normalized = value.trim().toLowerCase();
  const index = DAY_INDEX[normalized];
  return index === undefined ? null : WEEKDAY_NAMES[index];
};

const parseWeekJsonFromText = (text: string, expectedWeek: number): StructuredPlanWeek | null => {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const withoutFence = trimmed
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .trim();

  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const candidate = withoutFence.slice(firstBrace, lastBrace + 1);

  try {
    const parsed = JSON.parse(candidate) as {
      week?: number;
      verdict?: string;
      reasoning?: string;
      days?: Array<{
        day?: string;
        workoutType?: string;
        details?: string;
        rationale?: string;
      }>;
    };

    if (!Array.isArray(parsed.days)) {
      return null;
    }

    const byDay = new Map<string, StructuredPlanDay>();
    parsed.days.forEach((entry) => {
      const normalizedDay = normalizeDayName(entry.day ?? '');
      if (!normalizedDay || byDay.has(normalizedDay)) {
        return;
      }
      byDay.set(normalizedDay, {
        day: normalizedDay,
        workoutType: (entry.workoutType ?? 'Rest Day').trim() || 'Rest Day',
        details: (entry.details ?? '').trim() || 'Recovery / mobility',
        rationale: (entry.rationale ?? '').trim() || 'Load management',
      });
    });

    const days: StructuredPlanDay[] = WEEKDAY_NAMES.map((day) => {
      const existing = byDay.get(day);
      if (existing) {
        return existing;
      }
      return {
        day,
        workoutType: 'Rest Day',
        details: 'Recovery / mobility',
        rationale: 'Load management',
      };
    });

    return {
      week: Number.isFinite(parsed.week) ? Number(parsed.week) : expectedWeek,
      verdict: (parsed.verdict ?? 'Maintenance').trim() || 'Maintenance',
      reasoning: (parsed.reasoning ?? 'Balanced load and recovery.').trim() || 'Balanced load and recovery.',
      days,
    };
  } catch {
    return null;
  }
};

const structuredWeekToTable = (weekPlan: StructuredPlanWeek): PlanTable => ({
  headers: ['Week', 'Day', 'Workout Type', 'Details (Distance/Pace/Zone)', 'Rationale'],
  rows: weekPlan.days.map((day) => [
    `Week ${weekPlan.week}`,
    day.day,
    day.workoutType,
    day.details,
    day.rationale,
  ]),
});

const tableToStructuredWeek = (table: PlanTable, fallbackWeek: number): StructuredPlanWeek => {
  const weekIndex = table.headers.findIndex((header) => header.toLowerCase() === 'week');
  const dayIndex = table.headers.findIndex((header) => header.toLowerCase() === 'day');
  const workoutIndex = table.headers.findIndex((header) => header.toLowerCase().includes('workout'));
  const detailsIndex = table.headers.findIndex((header) => header.toLowerCase().includes('details'));
  const rationaleIndex = table.headers.findIndex((header) => header.toLowerCase().includes('rationale'));

  const parsedWeek =
    weekIndex === -1
      ? fallbackWeek
      : extractWeekNumber(table.rows.find((row) => row[weekIndex])?.[weekIndex] ?? `Week ${fallbackWeek}`, fallbackWeek);

  const byDay = new Map<string, StructuredPlanDay>();
  table.rows.forEach((row) => {
    const normalizedDay = normalizeDayName(row[dayIndex] ?? '');
    if (!normalizedDay || byDay.has(normalizedDay)) {
      return;
    }
    byDay.set(normalizedDay, {
      day: normalizedDay,
      workoutType: row[workoutIndex] ?? 'Rest Day',
      details: row[detailsIndex] ?? '',
      rationale: row[rationaleIndex] ?? '',
    });
  });

  return {
    week: parsedWeek,
    verdict: 'Maintenance',
    reasoning: 'Generated via fallback parsing.',
    days: WEEKDAY_NAMES.map((day) => {
      const existing = byDay.get(day);
      if (existing) {
        return existing;
      }
      return {
        day,
        workoutType: 'Rest Day',
        details: 'Recovery / mobility',
        rationale: 'Load management',
      };
    }),
  };
};

const buildAdaptationContext = (activePlanId: string | null, completions: CompletionMap): string => {
  const entries = Object.entries(completions).filter(([key]) =>
    activePlanId ? key.startsWith(`${activePlanId}:`) : true
  );

  if (!entries.length) {
    return 'No completed workouts or check-ins recorded yet.';
  }

  const stats = entries.reduce(
    (acc, [, value]) => {
      acc.rpe += value.rpe;
      acc.soreness += value.soreness;
      acc.sleep += value.sleepQuality;
      return acc;
    },
    { rpe: 0, soreness: 0, sleep: 0 }
  );

  const count = entries.length;
  const avgRpe = stats.rpe / count;
  const avgSoreness = stats.soreness / count;
  const avgSleep = stats.sleep / count;

  const recentNotes = entries
    .slice(-5)
    .map(([, value]) => value.notes.trim())
    .filter(Boolean)
    .map((note) => `- ${note}`)
    .join('\n');

  return [
    `Completed workouts with check-ins: ${count}.`,
    `Average RPE: ${avgRpe.toFixed(1)} / 10.`,
    `Average soreness: ${avgSoreness.toFixed(1)} / 10.`,
    `Average sleep quality: ${avgSleep.toFixed(1)} / 5.`,
    recentNotes ? `Recent subjective notes:\n${recentNotes}` : 'Recent subjective notes: none.',
  ].join('\n');
};

const completionKey = (planId: string, weekNumber: number, dayName: string): string =>
  `${planId}:week-${weekNumber}:${dayName.toLowerCase()}`;

const buildCalendarWeekRows = (tables: DisplayPlanTable[]): CalendarWeekRow[] =>
  tables.map((table) => {
    const dayIndex = table.headers.findIndex((header) => header.toLowerCase() === 'day');
    const workoutIndex = table.headers.findIndex((header) => header.toLowerCase().includes('workout'));
    const detailsIndex = table.headers.findIndex((header) => header.toLowerCase().includes('details'));

    const dayMap = new Map<string, { workoutType: string; details: string }>();
    if (dayIndex !== -1 && workoutIndex !== -1) {
      table.rows.forEach((row) => {
        const normalizedDay = normalizeDayName(row[dayIndex] ?? '');
        if (!normalizedDay || dayMap.has(normalizedDay)) {
          return;
        }
        dayMap.set(normalizedDay, {
          workoutType: row[workoutIndex] ?? 'Rest Day',
          details: detailsIndex === -1 ? '' : row[detailsIndex] ?? '',
        });
      });
    }

    const cells: CalendarWeekCell[] = WEEKDAY_NAMES.map((dayName) => {
      const value = dayMap.get(dayName);
      const workoutType = value?.workoutType ?? 'Rest Day';
      return {
        dayName,
        workoutType,
        details: value?.details ?? '',
        isRest: isRestLikeWorkout(workoutType),
      };
    });

    return {
      title: table.title,
      cells,
    };
  });

const buildDisplayTables = (tables: PlanTable[]): DisplayPlanTable[] => {
  const output: DisplayPlanTable[] = [];

  tables.forEach((table, tableIndex) => {
    const weekColumnIndex = table.headers.findIndex((header) => header.toLowerCase() === 'week');
    if (weekColumnIndex === -1) {
      output.push({
        title: `Plan ${tableIndex + 1}`,
        headers: table.headers,
        rows: table.rows,
      });
      return;
    }

    const groupedRows = table.rows.reduce<Record<string, string[][]>>((acc, row) => {
      const weekKey = row[weekColumnIndex] || `Week ${tableIndex + 1}`;
      acc[weekKey] = acc[weekKey] ?? [];
      acc[weekKey].push(row);
      return acc;
    }, {});

    const headersWithoutWeek = table.headers.filter((_, index) => index !== weekColumnIndex);

    Object.entries(groupedRows).forEach(([weekTitle, rows]) => {
      output.push({
        title: weekTitle,
        headers: headersWithoutWeek,
        rows: rows.map((row) => row.filter((_, index) => index !== weekColumnIndex)),
      });
    });
  });

  return output;
};

const nextMonday = (): Date => {
  const base = new Date();
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const weekday = start.getDay();
  let daysUntilMonday = (8 - weekday) % 7;
  if (daysUntilMonday === 0) {
    daysUntilMonday = 7;
  }
  start.setDate(start.getDate() + daysUntilMonday);
  return start;
};

const extractWeekNumber = (title: string, fallback: number): number => {
  const match = title.match(/week\s+(\d+)/i);
  if (!match) {
    return fallback;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isRestLikeWorkout = (workoutType: string): boolean => {
  const normalized = workoutType.toLowerCase();
  return normalized.includes('rest') || normalized.includes('off');
};

const estimatedDurationMinutes = (workoutType: string): number => {
  const normalized = workoutType.toLowerCase();
  if (normalized.includes('long')) {
    return 90;
  }
  if (normalized.includes('interval') || normalized.includes('tempo') || normalized.includes('speed')) {
    return 70;
  }
  if (normalized.includes('recovery') || normalized.includes('easy')) {
    return 50;
  }
  if (normalized.includes('strength')) {
    return 45;
  }
  return 60;
};

const toCalendarEvents = (tables: DisplayPlanTable[], planStartDateIso?: string): CalendarWorkoutEvent[] => {
  const planStartMonday = planStartDateIso ? new Date(planStartDateIso) : nextMonday();
  const events: CalendarWorkoutEvent[] = [];

  tables.forEach((table, tableIndex) => {
    const weekNumber = extractWeekNumber(table.title, tableIndex + 1);
    const weekOffset = (weekNumber - 1) * 7;
    const dayIndex = table.headers.findIndex((header) => header.toLowerCase() === 'day');
    const workoutTypeIndex = table.headers.findIndex((header) => header.toLowerCase().includes('workout'));
    const detailsIndex = table.headers.findIndex((header) => header.toLowerCase().includes('details'));
    const rationaleIndex = table.headers.findIndex((header) => header.toLowerCase().includes('rationale'));

    if (dayIndex === -1 || workoutTypeIndex === -1) {
      return;
    }

    table.rows.forEach((row) => {
      const dayLabel = (row[dayIndex] ?? '').trim().toLowerCase();
      const dayOffset = DAY_INDEX[dayLabel];
      if (dayOffset === undefined) {
        return;
      }

      const workoutType = row[workoutTypeIndex] ?? 'Run';
      if (isRestLikeWorkout(workoutType)) {
        return;
      }

      const details = detailsIndex === -1 ? '' : row[detailsIndex] ?? '';
      const rationale = rationaleIndex === -1 ? '' : row[rationaleIndex] ?? '';
      const startDate = new Date(planStartMonday);
      startDate.setDate(startDate.getDate() + weekOffset + dayOffset);
      startDate.setHours(7, 0, 0, 0);

      const endDate = new Date(startDate);
      endDate.setMinutes(endDate.getMinutes() + estimatedDurationMinutes(workoutType));

      const notesParts = [details, rationale].filter(Boolean);
      events.push({
        title: `Frunna W${weekNumber}: ${workoutType}`,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        notes: notesParts.join('\n'),
      });
    });
  });

  return events;
};

const getVisibleTables = (tables: DisplayPlanTable[], segment: PlanSegment): DisplayPlanTable[] =>
  tables.filter((table, tableIndex) => {
    const weekNumber = extractWeekNumber(table.title, tableIndex + 1);
    return segment === 'weeks1to4' ? weekNumber <= 4 : weekNumber >= 5;
  });

const enforceExpectedWeek = (tables: PlanTable[], weekNumber: number): PlanTable[] =>
  tables.map((table) => {
    const weekIndex = table.headers.findIndex((header) => header.toLowerCase() === 'week');
    if (weekIndex === -1) {
      return {
        headers: ['Week', ...table.headers],
        rows: table.rows.map((row) => [`Week ${weekNumber}`, ...row]),
      };
    }

    return {
      headers: table.headers,
      rows: table.rows.map((row) => {
        const nextRow = [...row];
        nextRow[weekIndex] = `Week ${weekNumber}`;
        return nextRow;
      }),
    };
  });

const parseRunDayCap = (value: string): number => {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed)) {
    return 4;
  }
  return Math.min(Math.max(parsed, 1), 7);
};

const clampWeekToRunDayCap = (tables: PlanTable[], runDayCap: number, longRunDay: string): PlanTable[] =>
  tables.map((table) => {
    const dayIndex = table.headers.findIndex((header) => header.toLowerCase() === 'day');
    const workoutIndex = table.headers.findIndex((header) => header.toLowerCase().includes('workout'));
    const detailsIndex = table.headers.findIndex((header) => header.toLowerCase().includes('details'));
    const rationaleIndex = table.headers.findIndex((header) => header.toLowerCase().includes('rationale'));

    if (dayIndex === -1 || workoutIndex === -1) {
      return table;
    }

    const activeRows = table.rows
      .map((row, idx) => ({ row, idx }))
      .filter(({ row }) => !isRestLikeWorkout(row[workoutIndex] ?? ''));

    if (activeRows.length <= runDayCap) {
      return table;
    }

    const longRunDayIndex = DAY_INDEX[longRunDay.toLowerCase()] ?? 6;
    const qualityPattern = /(interval|tempo|threshold|hill|speed)/i;

    const scoredRows = activeRows.map(({ row, idx }) => {
      const workout = row[workoutIndex] ?? '';
      const day = (row[dayIndex] ?? '').toString().toLowerCase();
      const dayOrder = DAY_INDEX[day] ?? 7;
      const isLong = /long/i.test(workout);
      const isLongOnPreferredDay = isLong && dayOrder === longRunDayIndex;
      const isQuality = qualityPattern.test(workout);
      const score = (isLongOnPreferredDay ? 100 : 0) + (isQuality ? 50 : 0) + (isLong ? 25 : 0) - dayOrder * 0.1 - idx * 0.01;

      return { idx, score };
    });

    scoredRows.sort((a, b) => b.score - a.score);
    const keepIndexes = new Set(scoredRows.slice(0, runDayCap).map((entry) => entry.idx));

    const rows = table.rows.map((row, idx) => {
      if (keepIndexes.has(idx) || isRestLikeWorkout(row[workoutIndex] ?? '')) {
        return row;
      }

      const nextRow = [...row];
      nextRow[workoutIndex] = 'Rest Day';
      if (detailsIndex !== -1) {
        nextRow[detailsIndex] = 'Recovery / optional mobility';
      }
      if (rationaleIndex !== -1) {
        nextRow[rationaleIndex] = `Respect ${runDayCap} training days/week`;
      }
      return nextRow;
    });

    return { headers: table.headers, rows };
  });

const countPlannedRunDays = (tables: PlanTable[]): number => {
  const runDays = new Set<string>();

  tables.forEach((table) => {
    const dayIndex = table.headers.findIndex((header) => header.toLowerCase() === 'day');
    const workoutIndex = table.headers.findIndex((header) => header.toLowerCase().includes('workout'));
    if (dayIndex === -1 || workoutIndex === -1) {
      return;
    }

    table.rows.forEach((row) => {
      const day = (row[dayIndex] ?? '').trim().toLowerCase();
      const workout = row[workoutIndex] ?? '';
      if (!day || isRestLikeWorkout(workout)) {
        return;
      }
      runDays.add(day);
    });
  });

  return runDays.size;
};

const withRunDayCorrection = (prompt: string, weekNumber: number, runDayCap: number): string =>
  [
    prompt,
    '',
    `Critical Fix: Rewrite Week ${weekNumber} so it has EXACTLY ${runDayCap} run days.`,
    `Critical Fix: The other ${7 - runDayCap} days must be Rest or non-running cross-training.`,
    'Critical Fix: Return ONLY corrected JSON for that week using the same schema.',
  ].join('\n');

const summarizeWeekForHistory = (tables: PlanTable[], weekNumber: number): string => {
  const summaryLines: string[] = [];

  tables.forEach((table) => {
    const weekIndex = table.headers.findIndex((header) => header.toLowerCase() === 'week');
    const dayIndex = table.headers.findIndex((header) => header.toLowerCase() === 'day');
    const workoutIndex = table.headers.findIndex((header) => header.toLowerCase().includes('workout'));
    const detailsIndex = table.headers.findIndex((header) => header.toLowerCase().includes('details'));

    table.rows.forEach((row) => {
      if (weekIndex !== -1 && row[weekIndex] && !row[weekIndex].toLowerCase().includes(`week ${weekNumber}`.toLowerCase())) {
        return;
      }
      const day = dayIndex === -1 ? 'Day' : row[dayIndex] ?? 'Day';
      const workout = workoutIndex === -1 ? 'Run' : row[workoutIndex] ?? 'Run';
      const details = detailsIndex === -1 ? '' : row[detailsIndex] ?? '';
      summaryLines.push(`- ${day}: ${workout}${details ? ` (${details})` : ''}`);
    });
  });

  return [`Week ${weekNumber} Summary:`, ...summaryLines.slice(0, 7)].join('\n');
};

const parseDurationSecondsFromInputs = (hoursRaw: string, minutesRaw: string, secondsRaw: string): number | null => {
  const hoursText = hoursRaw.trim();
  const minutesText = minutesRaw.trim();
  const secondsText = secondsRaw.trim();
  if (!hoursText && !minutesText && !secondsText) {
    return null;
  }

  const hours = hoursText ? Number.parseInt(hoursText, 10) : 0;
  const minutes = minutesText ? Number.parseInt(minutesText, 10) : 0;
  const seconds = secondsText ? Number.parseInt(secondsText, 10) : 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds) || hours < 0 || minutes < 0 || seconds < 0) {
    return null;
  }

  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  return totalSeconds > 0 ? totalSeconds : null;
};

const formatDuration = (totalSeconds: number): string => {
  const bounded = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(bounded / 3600);
  const minutes = Math.floor((bounded % 3600) / 60);
  const seconds = bounded % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('setup');
  const [lookbackDays, setLookbackDays] = useState<LookbackDaysOption>(30);
  const [planLengthWeeks, setPlanLengthWeeks] = useState<PlanLengthOption>(8);
  const [selectedGoal, setSelectedGoal] = useState<GoalOption>('5K');
  const [runningLevel, setRunningLevel] = useState<RunningLevelOption>('Intermediate');
  const [targetHours, setTargetHours] = useState('');
  const [targetMinutes, setTargetMinutes] = useState('');
  const [targetSeconds, setTargetSeconds] = useState('');
  const [runDaysPerWeek, setRunDaysPerWeek] = useState('4');
  const [longRunDay, setLongRunDay] = useState<LongRunOption>('Sunday');
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnitOption>('miles');
  const [planQuestion, setPlanQuestion] = useState('');
  const [followUpAnswer, setFollowUpAnswer] = useState('');
  const [response, setResponse] = useState('');
  const [planTables, setPlanTables] = useState<PlanTable[]>([]);
  const [healthSummary, setHealthSummary] = useState<HealthSummary | null>(null);
  const [error, setError] = useState('');
  const [healthLoading, setHealthLoading] = useState(false);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [syncedEventIds, setSyncedEventIds] = useState<string[]>([]);
  const [visibleSegment, setVisibleSegment] = useState<PlanSegment>('weeks1to4');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPlanAssistant, setShowPlanAssistant] = useState(false);
  const [showDebugPrompts, setShowDebugPrompts] = useState(false);
  const [debugPrompts, setDebugPrompts] = useState<WeeklyDebugPrompt[]>([]);
  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>([]);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [planStartDate, setPlanStartDate] = useState<string>(nextMonday().toISOString());
  const [planView, setPlanView] = useState<PlanView>('overview');
  const [completions, setCompletions] = useState<CompletionMap>({});
  const [showCheckinForm, setShowCheckinForm] = useState(false);
  const [checkinRpe, setCheckinRpe] = useState('6');
  const [checkinSoreness, setCheckinSoreness] = useState('4');
  const [checkinSleep, setCheckinSleep] = useState('3');
  const [checkinNotes, setCheckinNotes] = useState('');
  const [bannerMessage, setBannerMessage] = useState('');
  const [bannerType, setBannerType] = useState<BannerType>('info');
  const [selectedCalendarCell, setSelectedCalendarCell] = useState<SelectedCalendarCell | null>(null);
  const [loadingDots, setLoadingDots] = useState('');
  const { width } = useWindowDimensions();
  const pagerRef = useRef<ScrollView | null>(null);
  const displayTables = useMemo(() => buildDisplayTables(planTables), [planTables]);
  const visibleTables = useMemo(() => getVisibleTables(displayTables, visibleSegment), [displayTables, visibleSegment]);
  const calendarWeekRows = useMemo(() => buildCalendarWeekRows(visibleTables), [visibleTables]);
  const pageWidth = Math.max(width, 1);
  const parsedTargetTimeSeconds = parseDurationSecondsFromInputs(targetHours, targetMinutes, targetSeconds);
  const trainingLiftPercent = Math.max(2, Math.min(12, planLengthWeeks * 0.5 + parseRunDayCap(runDaysPerWeek) * 0.6));
  const levelAdjustment: Record<RunningLevelOption, number> = {
    Beginner: 1.03,
    Intermediate: 1.0,
    Advanced: 0.985,
    Elite: 0.97,
  };
  const predictedSeconds = parsedTargetTimeSeconds
    ? parsedTargetTimeSeconds * (1 - trainingLiftPercent / 100) * levelAdjustment[runningLevel]
    : null;
  const predictionRange = predictedSeconds
    ? `${formatDuration(predictedSeconds * 0.99)} - ${formatDuration(predictedSeconds * 1.01)}`
    : '--:--:-- - --:--:--';
  const today = new Date();
  const planStart = new Date(planStartDate);
  const elapsedDays = Math.floor((today.getTime() - planStart.getTime()) / (1000 * 60 * 60 * 24));
  const computedWeekNumber = elapsedDays < 0 ? 1 : Math.floor(elapsedDays / 7) + 1;
  const todayWeekNumber = Math.max(1, computedWeekNumber);
  const todayDayName = today.toLocaleDateString('en-US', { weekday: 'long' });
  const todayTable = displayTables.find((table, tableIndex) => extractWeekNumber(table.title, tableIndex + 1) === todayWeekNumber);
  const todayHeaders = todayTable?.headers ?? [];
  const todayDayIndex = todayHeaders.findIndex((header) => header.toLowerCase() === 'day');
  const todayWorkoutTypeIndex = todayHeaders.findIndex((header) => header.toLowerCase().includes('workout'));
  const todayDetailsIndex = todayHeaders.findIndex((header) => header.toLowerCase().includes('details'));
  const todayRationaleIndex = todayHeaders.findIndex((header) => header.toLowerCase().includes('rationale'));
  const todayRow =
    todayTable?.rows.find((row) => normalizeDayName(row[todayDayIndex] ?? '') === todayDayName) ??
    todayTable?.rows.find((row) => !isRestLikeWorkout(row[todayWorkoutTypeIndex] ?? '')) ??
    null;
  const todayWorkout = todayRow
    ? {
        week: todayWeekNumber,
        day: todayRow[todayDayIndex] ?? todayDayName,
        workoutType: todayRow[todayWorkoutTypeIndex] ?? 'Rest Day',
        details: todayRow[todayDetailsIndex] ?? '',
        rationale: todayRow[todayRationaleIndex] ?? '',
      }
    : null;
  const todayCompletionKey =
    activePlanId && todayWorkout ? completionKey(activePlanId, todayWorkout.week, todayWorkout.day) : null;
  const todayCompletion = todayCompletionKey ? completions[todayCompletionKey] : undefined;
  const plannedWorkoutCount = displayTables.reduce((sum, table) => {
    const workoutIndex = table.headers.findIndex((header) => header.toLowerCase().includes('workout'));
    if (workoutIndex === -1) {
      return sum;
    }
    return sum + table.rows.filter((row) => !isRestLikeWorkout(row[workoutIndex] ?? '')).length;
  }, 0);
  const completionEntries = Object.entries(completions).filter(([key]) =>
    activePlanId ? key.startsWith(`${activePlanId}:`) : false
  );
  const completedWorkoutCount = completionEntries.length;
  const adherencePercent = plannedWorkoutCount ? Math.min(100, Math.round((completedWorkoutCount / plannedWorkoutCount) * 100)) : 0;
  const avgCheckin = completionEntries.length
    ? completionEntries.reduce(
        (acc, [, value]) => {
          acc.rpe += value.rpe;
          acc.soreness += value.soreness;
          acc.sleep += value.sleepQuality;
          return acc;
        },
        { rpe: 0, soreness: 0, sleep: 0 }
      )
    : { rpe: 0, soreness: 0, sleep: 0 };
  const avgRpe = completionEntries.length ? (avgCheckin.rpe / completionEntries.length).toFixed(1) : '0.0';
  const avgSoreness = completionEntries.length ? (avgCheckin.soreness / completionEntries.length).toFixed(1) : '0.0';
  const avgSleepQuality = completionEntries.length ? (avgCheckin.sleep / completionEntries.length).toFixed(1) : '0.0';

  useEffect(() => {
    const x = screen === 'setup' ? 0 : pageWidth;
    pagerRef.current?.scrollTo({ x, animated: true });
  }, [screen, pageWidth]);

  useEffect(() => {
    if (!healthLoading) {
      setLoadingDots('');
      return;
    }

    const intervalId = setInterval(() => {
      setLoadingDots((current) => {
        if (current.length >= 3) {
          return '.';
        }
        return `${current}.`;
      });
    }, 350);

    return () => clearInterval(intervalId);
  }, [healthLoading]);

  useEffect(() => {
    if (!bannerMessage) {
      return;
    }
    const timeoutId = setTimeout(() => {
      setBannerMessage('');
    }, 2200);
    return () => clearTimeout(timeoutId);
  }, [bannerMessage]);

  const fireTactile = () => {
    Vibration.vibrate(10);
  };

  const showBanner = (message: string, type: BannerType = 'info') => {
    setBannerType(type);
    setBannerMessage(message);
  };

  useEffect(() => {
    let mounted = true;

    const loadPersistedState = async () => {
      try {
        const [rawPlans, rawCompletions] = await Promise.all([
          ExpoAppleIntelligence.getStoredValueAsync(STORAGE_PLANS_KEY),
          ExpoAppleIntelligence.getStoredValueAsync(STORAGE_COMPLETIONS_KEY),
        ]);

        if (mounted && rawPlans) {
          const parsedPlans = JSON.parse(rawPlans) as SavedPlan[];
          if (Array.isArray(parsedPlans)) {
            setSavedPlans(parsedPlans);
            if (parsedPlans[0]) {
              const latest = parsedPlans[0];
              setActivePlanId(latest.id);
              setPlanStartDate(latest.planStartDate);
              setResponse(latest.response);
              setPlanTables(latest.tables);
              setSelectedGoal(latest.goal);
              setPlanLengthWeeks(latest.planLengthWeeks as PlanLengthOption);
              setRunDaysPerWeek(latest.runDaysPerWeek);
              setLongRunDay(latest.longRunDay);
              setDistanceUnit(latest.distanceUnit);
            }
          }
        }

        if (mounted && rawCompletions) {
          const parsedCompletions = JSON.parse(rawCompletions) as CompletionMap;
          if (parsedCompletions && typeof parsedCompletions === 'object') {
            setCompletions(parsedCompletions);
          }
        }
      } catch {
        // best-effort load; ignore malformed persisted state
      }
    };

    void loadPersistedState();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!savedPlans.length) {
      return;
    }
    void ExpoAppleIntelligence.setStoredValueAsync(STORAGE_PLANS_KEY, JSON.stringify(savedPlans)).catch(() => {
      // best-effort persistence
    });
  }, [savedPlans]);

  useEffect(() => {
    void ExpoAppleIntelligence.setStoredValueAsync(STORAGE_COMPLETIONS_KEY, JSON.stringify(completions)).catch(() => {
      // best-effort persistence
    });
  }, [completions]);

  const queryModel = async (textPrompt: string): Promise<string> => {
    const result = await ExpoAppleIntelligence.queryAsync(textPrompt);
    return result.text;
  };

  const looksLikeContextWindowError = (message: string): boolean => {
    const normalized = message.toLowerCase();
    return normalized.includes('context window') || normalized.includes('model size') || normalized.includes('token');
  };

  type PlanInput = {
    lookbackDays: number;
    planLengthWeeks: number;
    selectedGoal: string;
    runningLevel: RunningLevelOption;
    targetTime?: string;
    targetTimeSeconds?: number;
    historyContext?: string;
    runDaysPerWeek: string;
    longRunDay: string;
    distanceUnit: 'km' | 'miles';
    restingHrTrend: string;
    sleepTrend: string;
    hrvTrend: string;
    vo2Trend: string;
    distanceTrend: string;
    stepTrend: string;
    workoutNarrative: string[];
    adaptationContext?: string;
  };

  const toCompactInput = (input: PlanInput): PlanInput => ({
    ...input,
    workoutNarrative: input.workoutNarrative.slice(0, 3),
    vo2Trend: `VO2: ${input.vo2Trend}`,
    distanceTrend: `Distance: ${input.distanceTrend}`,
    stepTrend: `Steps: ${input.stepTrend}`,
  });

  const buildWeeklyPlan = async (input: PlanInput) => {
    type PromptWeekKey = (typeof WEEK_PARTS)[number];
    const parts = Array.from({ length: input.planLengthWeeks }, (_, idx) => {
      const week = idx + 1;
      const key = `week${week}` as PromptWeekKey;
      if (!WEEK_PARTS.includes(key)) {
        throw new Error(`Unsupported week prompt key: ${key}`);
      }
      return { key, label: String(week), title: `## Week ${week}` };
    });
    const compactInput = toCompactInput(input);
    const runDayCap = parseRunDayCap(input.runDaysPerWeek);
    const partResponses: string[] = [];
    const accumulatedTables: PlanTable[] = [];
    const historySummaries: string[] = [];
    const nextDebugPrompts: WeeklyDebugPrompt[] = [];

    for (const part of parts) {
      const expectedWeekNumber = Number.parseInt(part.label, 10);
      const fullPromptInput: PlanInput = {
        ...input,
        historyContext: historySummaries.join('\n\n'),
      };
      const compactPromptInput: PlanInput = {
        ...compactInput,
        historyContext: historySummaries.join('\n\n'),
      };
      try {
        const fullPrompt = buildAdaptiveRunningCoachPrompt(fullPromptInput, part.key);
        nextDebugPrompts.push({ week: expectedWeekNumber, mode: 'full', prompt: fullPrompt });
        let text = await queryModel(fullPrompt);
        let structuredWeek = parseWeekJsonFromText(text, expectedWeekNumber);
        let normalizedTables = structuredWeek
          ? [structuredWeekToTable(structuredWeek)]
          : enforceExpectedWeek(parseMarkdownTables(text), expectedWeekNumber);
        if (countPlannedRunDays(normalizedTables) > runDayCap) {
          const correctionPrompt = withRunDayCorrection(fullPrompt, expectedWeekNumber, runDayCap);
          nextDebugPrompts.push({ week: expectedWeekNumber, mode: 'full-corrective', prompt: correctionPrompt });
          text = await queryModel(correctionPrompt);
          structuredWeek = parseWeekJsonFromText(text, expectedWeekNumber);
          normalizedTables = structuredWeek
            ? [structuredWeekToTable(structuredWeek)]
            : enforceExpectedWeek(parseMarkdownTables(text), expectedWeekNumber);
        }
        normalizedTables = clampWeekToRunDayCap(normalizedTables, runDayCap, input.longRunDay);
        partResponses.push(text);
        accumulatedTables.push(...normalizedTables);
        historySummaries.push(summarizeWeekForHistory(normalizedTables, expectedWeekNumber));
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'Unknown planning error.';
        if (!looksLikeContextWindowError(message)) {
          throw caught;
        }

        const compactPrompt = buildAdaptiveRunningCoachPrompt(compactPromptInput, part.key);
        nextDebugPrompts.push({ week: expectedWeekNumber, mode: 'compact', prompt: compactPrompt });
        let text = await queryModel(compactPrompt);
        let structuredWeek = parseWeekJsonFromText(text, expectedWeekNumber);
        let normalizedTables = structuredWeek
          ? [structuredWeekToTable(structuredWeek)]
          : enforceExpectedWeek(parseMarkdownTables(text), expectedWeekNumber);
        if (countPlannedRunDays(normalizedTables) > runDayCap) {
          const correctionPrompt = withRunDayCorrection(compactPrompt, expectedWeekNumber, runDayCap);
          nextDebugPrompts.push({ week: expectedWeekNumber, mode: 'compact-corrective', prompt: correctionPrompt });
          text = await queryModel(correctionPrompt);
          structuredWeek = parseWeekJsonFromText(text, expectedWeekNumber);
          normalizedTables = structuredWeek
            ? [structuredWeekToTable(structuredWeek)]
            : enforceExpectedWeek(parseMarkdownTables(text), expectedWeekNumber);
        }
        normalizedTables = clampWeekToRunDayCap(normalizedTables, runDayCap, input.longRunDay);
        partResponses.push(text);
        accumulatedTables.push(...normalizedTables);
        historySummaries.push(summarizeWeekForHistory(normalizedTables, expectedWeekNumber));
      }

      const partialCombined = parts
        .slice(0, partResponses.length)
        .map((currentPart, index) => [currentPart.title, partResponses[index] ?? ''].join('\n'))
        .join('\n\n');
      setResponse(partialCombined);
      setPlanTables([...accumulatedTables]);
      setDebugPrompts([...nextDebugPrompts]);
    }
    setDebugPrompts(nextDebugPrompts);

    const combined = parts
      .map((part, index) => [part.title, partResponses[index] ?? ''].join('\n'))
      .join('\n\n');
    const tables = [...accumulatedTables];
    return { combined, tables };
  };

  const generateHealthInsights = async () => {
    setHealthLoading(true);
    setError('');
    setResponse('');
    setPlanTables([]);
    setDebugPrompts([]);

    try {
      const authorized = await ExpoAppleIntelligence.requestHealthAuthorizationAsync();
      if (!authorized) {
      setError('Health permission was not granted.');
      return;
      }

      const rawSummary = await ExpoAppleIntelligence.getHealthSummaryAsync(lookbackDays);
      const summary = normalizeSummary(rawSummary);
      setHealthSummary(summary);
      setSyncedEventIds([]);
      setVisibleSegment('weeks1to4');
      setFollowUpAnswer('');
      setPlanQuestion('');
      setShowPlanAssistant(false);

      const stepTrend = trendLine(
        'Daily steps',
        summary.steps.filter((row) => row.steps > 0).map((row) => row.steps),
        'steps'
      );
      const restingHrTrend = trendLine(
        'Resting HR',
        summary.restingHeartRate.filter((row) => row.restingBpm > 0).map((row) => row.restingBpm),
        'bpm'
      );
      const sleepTrend = trendLine(
        'Sleep duration',
        summary.sleep.filter((row) => row.hoursAsleep > 0).map((row) => row.hoursAsleep),
        'hours'
      );
      const hrvTrend = trendLine(
        'HRV',
        summary.hrv.filter((row) => row.hrvMs > 0).map((row) => row.hrvMs),
        'ms'
      );
      const vo2Trend = trendLine(
        'VO2 max',
        summary.vo2Max.filter((row) => row.vo2Max > 0).map((row) => row.vo2Max),
        'ml/kg/min'
      );
      const activeEnergyTrend = trendLine(
        'Active energy',
        summary.activeEnergy.filter((row) => row.activeKilocalories > 0).map((row) => row.activeKilocalories),
        'kcal'
      );
      const distanceTrend = trendLine(
        'Walking/running distance',
        summary.distanceWalkingRunning
          .filter((row) => row.distanceKm > 0)
          .map((row) => (distanceUnit === 'miles' ? row.distanceKm * 0.621371 : row.distanceKm)),
        distanceUnit
      );
      const workoutNarrative = summarizeWorkouts(summary, lookbackDays);
      const hours = targetHours.trim();
      const minutesRaw = targetMinutes.trim();
      const secondsRaw = targetSeconds.trim();
      const minutesPadded = minutesRaw === '' ? '00' : minutesRaw.padStart(2, '0');
      const secondsPadded = secondsRaw === '' ? '00' : secondsRaw.padStart(2, '0');
      const targetTime = hours || minutesRaw || secondsRaw ? `${hours || '0'}:${minutesPadded}:${secondsPadded}` : undefined;
      const parsedTargetTimeSeconds = parseDurationSecondsFromInputs(hours, minutesRaw, secondsRaw);
      const targetTimeSeconds = parsedTargetTimeSeconds ?? undefined;
      const adaptationContext = buildAdaptationContext(activePlanId, completions);
      const fullInput = {
        lookbackDays,
        planLengthWeeks,
        selectedGoal,
        runningLevel,
        targetTime,
        targetTimeSeconds,
        runDaysPerWeek,
        longRunDay,
        distanceUnit,
        restingHrTrend,
        sleepTrend,
        hrvTrend,
        vo2Trend,
        distanceTrend,
        stepTrend,
        workoutNarrative,
        adaptationContext,
      };

      const fullPlan = await buildWeeklyPlan(fullInput);
      setResponse(fullPlan.combined);
      setPlanTables(fullPlan.tables);
      const newPlanId = `plan-${Date.now()}`;
      const newPlanStartDate = nextMonday().toISOString();
      const savedPlan: SavedPlan = {
        id: newPlanId,
        createdAt: new Date().toISOString(),
        goal: selectedGoal,
        planLengthWeeks,
        runDaysPerWeek,
        longRunDay,
        distanceUnit,
        planStartDate: newPlanStartDate,
        response: fullPlan.combined,
        tables: fullPlan.tables,
      };
      setSavedPlans((current) => [savedPlan, ...current].slice(0, 12));
      setActivePlanId(newPlanId);
      setPlanStartDate(newPlanStartDate);
      setPlanView('today');
      setScreen('plan');
      fireTactile();
      showBanner('Plan ready', 'success');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unknown error while generating health insights.';
      setError(message);
      showBanner(message, 'error');
    } finally {
      setHealthLoading(false);
    }
  };

  const askAboutPlan = async () => {
    const trimmedQuestion = planQuestion.trim();
    if (!trimmedQuestion) {
      setError('Ask a specific question about your plan first.');
      return;
    }
    if (!displayTables.length) {
      setError('Generate a plan first, then ask follow-up questions.');
      return;
    }

    setFollowUpLoading(true);
    setError('');

    try {
      const tableContext = visibleTables
        .map((table) => {
          const rows = table.rows
            .slice(0, 7)
            .map((row) =>
              table.headers
                .map((header, index) => `${header}: ${row[index] ?? ''}`)
                .join(', ')
            )
            .join('\n');
          return `${table.title}\n${rows}`;
        })
        .join('\n\n');

      const prompt = [
        'You are Frunna, a running coach.',
        'Answer using only the current plan context.',
        'Keep it concise and actionable.',
        '',
        'Plan Context:',
        tableContext,
        '',
        `Question: ${trimmedQuestion}`,
      ].join('\n');

      const answer = await queryModel(prompt);
      setFollowUpAnswer(answer);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unknown error asking follow-up question.';
      setError(message);
    } finally {
      setFollowUpLoading(false);
    }
  };

  const syncPlanToCalendar = async () => {
    if (!displayTables.length) {
      setError('Generate a plan first before syncing to calendar.');
      return;
    }

    setCalendarLoading(true);
    setError('');

    try {
      const granted = await ExpoAppleIntelligence.requestCalendarAccessAsync();
      if (!granted) {
        setError('Calendar permission was not granted.');
        return;
      }

      const events = toCalendarEvents(displayTables, planStartDate);
      if (!events.length) {
        setError('No runnable workout rows found to sync.');
        return;
      }

      const eventIds = await ExpoAppleIntelligence.syncCalendarEventsAsync(events);
      setSyncedEventIds(eventIds);
      fireTactile();
      showBanner(`Synced ${eventIds.length} workouts to Calendar`, 'success');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to sync plan to calendar.';
      setError(message);
      showBanner(message, 'error');
    } finally {
      setCalendarLoading(false);
    }
  };

  const removeSyncedEvents = async () => {
    if (!syncedEventIds.length) {
      setError('No synced events to remove.');
      return;
    }

    setCalendarLoading(true);
    setError('');

    try {
      await ExpoAppleIntelligence.removeCalendarEventsAsync(syncedEventIds);
      setSyncedEventIds([]);
      fireTactile();
      showBanner('Removed synced calendar events', 'success');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to remove synced calendar events.';
      setError(message);
      showBanner(message, 'error');
    } finally {
      setCalendarLoading(false);
    }
  };

  const confirmSyncToCalendar = () => {
    Alert.alert('Sync Plan To Calendar', 'Add all planned workouts to your iOS Calendar?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sync', onPress: () => void syncPlanToCalendar() },
    ]);
  };

  const confirmRemoveSyncedEvents = () => {
    Alert.alert('Remove Synced Events', 'Delete all Frunna events synced in this session?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void removeSyncedEvents() },
    ]);
  };

  const openSavedPlan = (plan: SavedPlan) => {
    setActivePlanId(plan.id);
    setPlanStartDate(plan.planStartDate);
    setResponse(plan.response);
    setPlanTables(plan.tables);
    setPlanLengthWeeks(plan.planLengthWeeks as PlanLengthOption);
    setSelectedGoal(plan.goal);
    setRunDaysPerWeek(plan.runDaysPerWeek);
    setLongRunDay(plan.longRunDay);
    setDistanceUnit(plan.distanceUnit);
    setPlanView('overview');
    setScreen('plan');
    fireTactile();
    showBanner('Loaded saved plan', 'success');
  };

  const saveTodayCheckin = () => {
    if (!todayCompletionKey) {
      return;
    }

    const nextRpe = Math.min(10, Math.max(1, Number.parseInt(checkinRpe, 10) || 6));
    const nextSoreness = Math.min(10, Math.max(1, Number.parseInt(checkinSoreness, 10) || 4));
    const nextSleep = Math.min(5, Math.max(1, Number.parseInt(checkinSleep, 10) || 3));

    setCompletions((current) => ({
      ...current,
      [todayCompletionKey]: {
        completedAt: new Date().toISOString(),
        rpe: nextRpe,
        soreness: nextSoreness,
        sleepQuality: nextSleep,
        notes: checkinNotes.trim(),
      },
    }));
    setShowCheckinForm(false);
    setCheckinNotes('');
    fireTactile();
    showBanner('Workout check-in saved', 'success');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', default: undefined })} style={styles.flex}>
        <View style={styles.flex}>
          {!!bannerMessage && (
            <View
              style={[
                styles.banner,
                bannerType === 'success' && styles.bannerSuccess,
                bannerType === 'error' && styles.bannerError,
              ]}
            >
              <Text style={styles.bannerText}>{bannerMessage}</Text>
            </View>
          )}
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            bounces={false}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(event) => {
              const index = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
              setScreen(index <= 0 ? 'setup' : 'plan');
            }}
          >
            <View style={[styles.page, { width: pageWidth }]}>
              <ScrollView
                contentContainerStyle={styles.container}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
              >
                <View style={styles.brandPill}>
                  <Text style={styles.brandPillText}>FRUNNA PERFORMANCE</Text>
                </View>
                <Text style={styles.title}>Frunna</Text>
                <Text style={styles.subtitle}>Build a personalized race plan from your Health data.</Text>
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionTitle}>Unlock Your Potential</Text>
                  <Text style={styles.fieldLabel}>What is your running level?</Text>
                  <View style={styles.goalRow}>
                    {RUNNING_LEVEL_OPTIONS.map((level) => (
                      <Pressable
                        key={level}
                        onPress={() => setRunningLevel(level)}
                        style={({ pressed }) => [
                          styles.goalChip,
                          runningLevel === level && styles.goalChipActive,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Text style={[styles.goalChipText, runningLevel === level && styles.goalChipTextActive]}>{level}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.fieldLabel}>Goal Distance</Text>
                  <View style={styles.goalRow}>
                    {GOAL_OPTIONS.map((goal) => (
                      <Pressable
                        key={goal}
                        onPress={() => setSelectedGoal(goal)}
                        style={({ pressed }) => [
                          styles.goalChip,
                          selectedGoal === goal && styles.goalChipActive,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Text style={[styles.goalChipText, selectedGoal === goal && styles.goalChipTextActive]}>{goal}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.fieldLabel}>{`Your Most Recent ${selectedGoal} Time`}</Text>
                  <View style={styles.inlineFieldRow}>
                    <View style={styles.timeGroup}>
                      <TextInput
                        value={targetHours}
                        onChangeText={setTargetHours}
                        keyboardType="number-pad"
                        placeholder="00"
                        placeholderTextColor="#6f849f"
                        style={styles.timeInput}
                        maxLength={2}
                      />
                      <Text style={styles.timeUnit}>hours</Text>
                    </View>
                    <Text style={styles.timeSeparator}>:</Text>
                    <View style={styles.timeGroup}>
                      <TextInput
                        value={targetMinutes}
                        onChangeText={setTargetMinutes}
                        keyboardType="number-pad"
                        placeholder="00"
                        placeholderTextColor="#6f849f"
                        style={styles.timeInput}
                        maxLength={2}
                      />
                      <Text style={styles.timeUnit}>minutes</Text>
                    </View>
                    <Text style={styles.timeSeparator}>:</Text>
                    <View style={styles.timeGroup}>
                      <TextInput
                        value={targetSeconds}
                        onChangeText={setTargetSeconds}
                        keyboardType="number-pad"
                        placeholder="00"
                        placeholderTextColor="#6f849f"
                        style={styles.timeInput}
                        maxLength={2}
                      />
                      <Text style={styles.timeUnit}>seconds</Text>
                    </View>
                  </View>
                  <Text style={styles.helperText}>This drives predicted time and pace targets for the plan.</Text>

                  <Text style={styles.fieldLabel}>Days Per Week Can You Train?</Text>
                  <View style={styles.daySelectorRow}>
                    {TRAIN_DAYS_OPTIONS.map((dayCount) => {
                      const isActive = runDaysPerWeek === String(dayCount);
                      return (
                        <Pressable
                          key={dayCount}
                          onPress={() => setRunDaysPerWeek(String(dayCount))}
                          style={({ pressed }) => [
                            styles.dayDot,
                            isActive && styles.dayDotActive,
                            pressed && styles.buttonPressed,
                          ]}
                        >
                          <Text style={[styles.dayDotText, isActive && styles.dayDotTextActive]}>{dayCount}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={styles.fieldLabel}>How Long Do You Want To Train?</Text>
                  <View style={styles.goalRow}>
                    {PLAN_LENGTH_OPTIONS.map((weeks) => (
                      <Pressable
                        key={weeks}
                        onPress={() => setPlanLengthWeeks(weeks)}
                        style={({ pressed }) => [
                          styles.goalChip,
                          planLengthWeeks === weeks && styles.goalChipActive,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Text style={[styles.goalChipText, planLengthWeeks === weeks && styles.goalChipTextActive]}>
                          {weeks} weeks
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <Pressable
                    onPress={() => setShowAdvanced((current) => !current)}
                    style={({ pressed }) => [styles.advancedToggle, pressed && styles.buttonPressed]}
                  >
                    <Text style={styles.advancedToggleText}>
                      {showAdvanced ? 'Hide Advanced Options' : 'Show Advanced Options'}
                    </Text>
                  </Pressable>

                  {showAdvanced && (
                    <View style={styles.advancedSection}>
                      <Text style={styles.fieldLabel}>Long Run Day</Text>
                      <View style={styles.goalRow}>
                        {LONG_RUN_OPTIONS.map((day) => (
                          <Pressable
                            key={day}
                            onPress={() => setLongRunDay(day)}
                            style={({ pressed }) => [
                              styles.goalChip,
                              longRunDay === day && styles.goalChipActive,
                              pressed && styles.buttonPressed,
                            ]}
                          >
                            <Text style={[styles.goalChipText, longRunDay === day && styles.goalChipTextActive]}>{day}</Text>
                          </Pressable>
                        ))}
                      </View>

                      <Text style={styles.fieldLabel}>Distance Unit</Text>
                      <View style={styles.goalRow}>
                        {DISTANCE_UNIT_OPTIONS.map((unit) => (
                          <Pressable
                            key={unit}
                            onPress={() => setDistanceUnit(unit)}
                            style={({ pressed }) => [
                              styles.goalChip,
                              distanceUnit === unit && styles.goalChipActive,
                              pressed && styles.buttonPressed,
                            ]}
                          >
                            <Text style={[styles.goalChipText, distanceUnit === unit && styles.goalChipTextActive]}>{unit}</Text>
                          </Pressable>
                        ))}
                      </View>

                      <Text style={styles.fieldLabel}>Health Lookback</Text>
                      <View style={styles.goalRow}>
                        {LOOKBACK_DAY_OPTIONS.map((days) => (
                          <Pressable
                            key={days}
                            onPress={() => setLookbackDays(days)}
                            style={({ pressed }) => [
                              styles.goalChip,
                              lookbackDays === days && styles.goalChipActive,
                              pressed && styles.buttonPressed,
                            ]}
                          >
                            <Text style={[styles.goalChipText, lookbackDays === days && styles.goalChipTextActive]}>
                              Last {days} days
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  )}

                  <View style={styles.predictionCard}>
                    <Text style={styles.predictionTitle}>{`Estimated ${selectedGoal} time in ${planLengthWeeks} weeks`}</Text>
                    <Text style={styles.predictionRange}>{predictionRange}</Text>
                    <Text style={styles.predictionCaption}>Based on your level, target time, and training availability.</Text>
                  </View>

                  <Pressable
                    disabled={healthLoading}
                    onPress={generateHealthInsights}
                    style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
                  >
                  {healthLoading ? (
                    <Text style={styles.secondaryButtonText}>{`Building plan${loadingDots}`}</Text>
                  ) : (
                    <Text style={styles.secondaryButtonText}>Build My Plan</Text>
                  )}
                </Pressable>

                {!!savedPlans.length && (
                  <View style={styles.savedPlansSection}>
                    <Text style={styles.fieldLabel}>Saved Plans</Text>
                    {savedPlans.slice(0, 3).map((plan) => (
                      <View key={plan.id} style={styles.savedPlanRow}>
                        <View style={styles.savedPlanMeta}>
                          <Text style={styles.savedPlanTitle}>{`${plan.goal} • ${plan.planLengthWeeks} weeks`}</Text>
                          <Text style={styles.savedPlanSubtitle}>
                            {new Date(plan.createdAt).toLocaleDateString()}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => openSavedPlan(plan)}
                          style={({ pressed }) => [styles.savedPlanOpenButton, pressed && styles.buttonPressed]}
                        >
                          <Text style={styles.savedPlanOpenText}>Open</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
              </View>
                {!!error && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}
              </ScrollView>
            </View>

            <View style={[styles.page, { width: pageWidth }]}>
              <ScrollView
                contentContainerStyle={styles.container}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
              >
                <View style={styles.screenHeaderRow}>
                  <Pressable
                    onPress={() => setScreen('setup')}
                    style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]}
                  >
                    <Text style={styles.backButtonText}>Back To Setup</Text>
                  </Pressable>
                  <Pressable
                    disabled={healthLoading}
                    onPress={generateHealthInsights}
                    style={({ pressed }) => [styles.refreshButton, pressed && styles.buttonPressed]}
                  >
                    <Text style={styles.refreshButtonText}>{healthLoading ? 'Refreshing...' : 'Regenerate'}</Text>
                  </Pressable>
                </View>
                {!displayTables.length && (
                  <View style={styles.responseBox}>
                    <Text style={styles.responseLabel}>Plan</Text>
                    <Text style={styles.responseText}>
                      {healthLoading
                        ? `Building plan${loadingDots}`
                        : 'No plan generated yet. Swipe right to Setup and tap Build My Plan.'}
                    </Text>
                  </View>
                )}
                {!!error && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}
                {!!response && !displayTables.length && (
                  <View style={styles.responseBox}>
                    <Text style={styles.responseLabel}>Response</Text>
                    <Text style={styles.responseText}>{response}</Text>
                  </View>
                )}
                {!!displayTables.length && (
                  <View style={styles.responseBox}>
                    <Text style={styles.responseLabel}>Your Plan</Text>
                    <View style={styles.goalRow}>
                      <Pressable
                        onPress={() => setPlanView('overview')}
                        style={({ pressed }) => [
                          styles.goalChip,
                          planView === 'overview' && styles.goalChipActive,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Text style={[styles.goalChipText, planView === 'overview' && styles.goalChipTextActive]}>Overview</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setPlanView('today')}
                        style={({ pressed }) => [
                          styles.goalChip,
                          planView === 'today' && styles.goalChipActive,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Text style={[styles.goalChipText, planView === 'today' && styles.goalChipTextActive]}>Today</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setPlanView('progress')}
                        style={({ pressed }) => [
                          styles.goalChip,
                          planView === 'progress' && styles.goalChipActive,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Text style={[styles.goalChipText, planView === 'progress' && styles.goalChipTextActive]}>Progress</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setPlanView('calendar')}
                        style={({ pressed }) => [
                          styles.goalChip,
                          planView === 'calendar' && styles.goalChipActive,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Text style={[styles.goalChipText, planView === 'calendar' && styles.goalChipTextActive]}>Calendar</Text>
                      </Pressable>
                    </View>

                    {planView === 'today' && (
                      <View style={styles.todayCard}>
                        <Text style={styles.tableTitle}>{`Week ${todayWeekNumber} • ${todayDayName}`}</Text>
                        {todayWorkout ? (
                          <>
                            <Text style={styles.todayWorkoutType}>{todayWorkout.workoutType}</Text>
                            {!!todayWorkout.details && <Text style={styles.responseText}>{todayWorkout.details}</Text>}
                            {!!todayWorkout.rationale && <Text style={styles.helperText}>{todayWorkout.rationale}</Text>}
                            {todayCompletion ? (
                              <View style={styles.checkinSummaryBox}>
                                <Text style={styles.checkinSummaryText}>
                                  {`Completed • RPE ${todayCompletion.rpe}/10 • Soreness ${todayCompletion.soreness}/10 • Sleep ${todayCompletion.sleepQuality}/5`}
                                </Text>
                              </View>
                            ) : (
                              <Pressable
                                onPress={() => setShowCheckinForm((current) => !current)}
                                style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                              >
                                <Text style={styles.buttonText}>{showCheckinForm ? 'Hide Check-In' : 'Mark Complete + Check-In'}</Text>
                              </Pressable>
                            )}

                            {showCheckinForm && !todayCompletion && (
                              <View style={styles.checkinForm}>
                                <Text style={styles.fieldLabel}>RPE (1-10)</Text>
                                <TextInput value={checkinRpe} onChangeText={setCheckinRpe} keyboardType="number-pad" style={styles.checkinInput} />
                                <Text style={styles.fieldLabel}>Soreness (1-10)</Text>
                                <TextInput value={checkinSoreness} onChangeText={setCheckinSoreness} keyboardType="number-pad" style={styles.checkinInput} />
                                <Text style={styles.fieldLabel}>Sleep Quality (1-5)</Text>
                                <TextInput value={checkinSleep} onChangeText={setCheckinSleep} keyboardType="number-pad" style={styles.checkinInput} />
                                <Text style={styles.fieldLabel}>Notes</Text>
                                <TextInput
                                  value={checkinNotes}
                                  onChangeText={setCheckinNotes}
                                  placeholder="Optional notes about this session"
                                  placeholderTextColor="#6f849f"
                                  style={styles.questionInput}
                                />
                                <Pressable onPress={saveTodayCheckin} style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}>
                                  <Text style={styles.secondaryButtonText}>Save Check-In</Text>
                                </Pressable>
                              </View>
                            )}
                          </>
                        ) : (
                          <Text style={styles.responseText}>No workout found for today yet.</Text>
                        )}
                      </View>
                    )}

                    {planView === 'progress' && (
                      <View style={styles.todayCard}>
                        <Text style={styles.tableTitle}>Progress Dashboard</Text>
                        <Text style={styles.responseText}>{`Planned workouts: ${plannedWorkoutCount}`}</Text>
                        <Text style={styles.responseText}>{`Completed workouts: ${completedWorkoutCount}`}</Text>
                        <Text style={styles.responseText}>{`Adherence: ${adherencePercent}%`}</Text>
                        <Text style={styles.helperText}>{`Avg RPE ${avgRpe}/10 • Avg soreness ${avgSoreness}/10 • Avg sleep ${avgSleepQuality}/5`}</Text>
                      </View>
                    )}

                    {(planView === 'overview' || planView === 'calendar') && (
                      <>
                        <View style={styles.goalRow}>
                          <Pressable
                            onPress={() => setVisibleSegment('weeks1to4')}
                            style={({ pressed }) => [
                              styles.goalChip,
                              visibleSegment === 'weeks1to4' && styles.goalChipActive,
                              pressed && styles.buttonPressed,
                            ]}
                          >
                            <Text style={[styles.goalChipText, visibleSegment === 'weeks1to4' && styles.goalChipTextActive]}>
                              Weeks 1-4
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={() => setVisibleSegment('weeks5to8')}
                            style={({ pressed }) => [
                              styles.goalChip,
                              visibleSegment === 'weeks5to8' && styles.goalChipActive,
                              pressed && styles.buttonPressed,
                            ]}
                          >
                            <Text style={[styles.goalChipText, visibleSegment === 'weeks5to8' && styles.goalChipTextActive]}>
                              {`Weeks 5-${planLengthWeeks}`}
                            </Text>
                          </Pressable>
                        </View>
                        {planView === 'overview' ? (
                          <>
                            <Pressable
                              onPress={() => setShowPlanAssistant((current) => !current)}
                              style={({ pressed }) => [styles.advancedToggle, pressed && styles.buttonPressed]}
                            >
                              <Text style={styles.advancedToggleText}>
                                {showPlanAssistant ? 'Hide Plan Q&A' : 'Ask a Question About This Plan'}
                              </Text>
                            </Pressable>
                            {showPlanAssistant && (
                              <>
                                <TextInput
                                  multiline
                                  value={planQuestion}
                                  onChangeText={setPlanQuestion}
                                  placeholder="e.g. Should I swap Thursday and Friday?"
                                  style={styles.questionInput}
                                />
                                <View style={styles.inputActionsRow}>
                                  <Pressable
                                    onPress={() => setPlanQuestion('')}
                                    style={({ pressed }) => [styles.clearButton, pressed && styles.buttonPressed]}
                                  >
                                    <Text style={styles.clearButtonText}>Clear Question</Text>
                                  </Pressable>
                                  <Pressable
                                    onPress={Keyboard.dismiss}
                                    style={({ pressed }) => [styles.hideKeyboardButton, pressed && styles.buttonPressed]}
                                  >
                                    <Text style={styles.hideKeyboardButtonText}>Hide Keyboard</Text>
                                  </Pressable>
                                </View>
                                <Pressable
                                  disabled={followUpLoading}
                                  onPress={askAboutPlan}
                                  style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                                >
                                  {followUpLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Ask About Plan</Text>}
                                </Pressable>
                                {!!followUpAnswer && (
                                  <View style={styles.followUpBox}>
                                    <Text style={styles.responseLabel}>Plan Answer</Text>
                                    <Text style={styles.responseText}>{followUpAnswer}</Text>
                                  </View>
                                )}
                              </>
                            )}
                            <View style={styles.calendarActionsRow}>
                              <Pressable
                                disabled={calendarLoading}
                                onPress={confirmSyncToCalendar}
                                style={({ pressed }) => [styles.calendarButton, pressed && styles.buttonPressed]}
                              >
                                <Text style={styles.calendarButtonText}>
                                  {calendarLoading ? 'Syncing...' : 'Sync Plan To Calendar'}
                                </Text>
                              </Pressable>
                              {!!syncedEventIds.length && (
                                <Pressable
                                  disabled={calendarLoading}
                                  onPress={confirmRemoveSyncedEvents}
                                  style={({ pressed }) => [styles.removeCalendarButton, pressed && styles.buttonPressed]}
                                >
                                  <Text style={styles.removeCalendarButtonText}>Remove Synced Events</Text>
                                </Pressable>
                              )}
                            </View>
                            <Pressable
                              onPress={() => setShowDebugPrompts((current) => !current)}
                              style={({ pressed }) => [styles.advancedToggle, pressed && styles.buttonPressed]}
                            >
                              <Text style={styles.advancedToggleText}>
                                {showDebugPrompts ? 'Hide Debug Prompts' : 'Show Debug Prompts'}
                              </Text>
                            </Pressable>
                            {showDebugPrompts && (
                              <View style={styles.debugBox}>
                                {debugPrompts.length ? (
                                  debugPrompts.map((entry, index) => (
                                    <View key={`debug-${entry.week}-${entry.mode}-${index}`} style={styles.debugEntry}>
                                      <Text style={styles.debugTitle}>{`Week ${entry.week} (${entry.mode})`}</Text>
                                      <Text style={styles.debugPromptText}>{entry.prompt}</Text>
                                    </View>
                                  ))
                                ) : (
                                  <Text style={styles.debugPromptText}>No prompt data yet. Generate a plan first.</Text>
                                )}
                              </View>
                            )}
                            {visibleTables.map((table, tableIndex) => (
                              <View key={`table-${tableIndex}`} style={styles.tableBlock}>
                                <Text style={styles.tableTitle}>{table.title}</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                  <View>
                                    <View style={[styles.tableRow, styles.tableHeaderRow]}>
                                      {table.headers.map((header, headerIndex) => (
                                        <Text
                                          key={`${tableIndex}-${header}`}
                                          style={[styles.tableCell, styles.tableHeaderCell, { width: TABLE_COLUMN_WIDTHS[headerIndex] ?? 160 }]}
                                        >
                                          {header}
                                        </Text>
                                      ))}
                                    </View>
                                    {table.rows.map((row, rowIndex) => (
                                      <View key={`${tableIndex}-${rowIndex}-${row[0] ?? 'row'}`} style={styles.tableRow}>
                                        {row.map((cell, cellIndex) => (
                                          <Text
                                            key={`${tableIndex}-${rowIndex}-${cellIndex}`}
                                            style={[styles.tableCell, { width: TABLE_COLUMN_WIDTHS[cellIndex] ?? 160 }]}
                                          >
                                            {cell}
                                          </Text>
                                        ))}
                                      </View>
                                    ))}
                                  </View>
                                </ScrollView>
                              </View>
                            ))}
                          </>
                        ) : (
                          <View style={styles.calendarModeBlock}>
                            <View style={styles.calendarHeaderRow}>
                              {WEEKDAY_NAMES.map((day) => (
                                <Text key={`header-${day}`} style={styles.calendarHeaderCell}>
                                  {day.slice(0, 3)}
                                </Text>
                              ))}
                            </View>
                            {calendarWeekRows.map((weekRow, index) => (
                              <View key={`calendar-week-${weekRow.title}-${index}`} style={styles.calendarWeekBlock}>
                                <Text style={styles.calendarWeekTitle}>{weekRow.title}</Text>
                                <View style={styles.calendarWeekGrid}>
                                  {weekRow.cells.map((cell) => (
                                    <Pressable
                                      key={`${weekRow.title}-${cell.dayName}`}
                                      onPress={() =>
                                        setSelectedCalendarCell({
                                          weekTitle: weekRow.title,
                                          dayName: cell.dayName,
                                          workoutType: cell.workoutType,
                                          details: cell.details,
                                        })
                                      }
                                      style={[styles.calendarCell, cell.isRest ? styles.calendarCellRest : styles.calendarCellWorkoutBg]}
                                    >
                                      <Text style={styles.calendarCellDay}>{cell.dayName.slice(0, 3)}</Text>
                                      <Text style={styles.calendarCellWorkoutText} numberOfLines={2}>
                                        {cell.workoutType}
                                      </Text>
                                      {!!cell.details && (
                                        <Text style={styles.calendarCellDetail} numberOfLines={2}>
                                          {cell.details}
                                        </Text>
                                      )}
                                    </Pressable>
                                  ))}
                                </View>
                              </View>
                            ))}
                          </View>
                        )}
                      </>
                    )}
                  </View>
                )}
              </ScrollView>
            </View>
          </ScrollView>
          <View style={styles.bottomTabBar}>
            <Pressable
              onPress={() => setScreen('setup')}
              style={({ pressed }) => [
                styles.bottomTab,
                screen === 'setup' && styles.bottomTabActive,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={[styles.bottomTabText, screen === 'setup' && styles.bottomTabTextActive]}>Setup</Text>
            </Pressable>
            <Pressable
              onPress={() => setScreen('plan')}
              style={({ pressed }) => [
                styles.bottomTab,
                screen === 'plan' && styles.bottomTabActive,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={[styles.bottomTabText, screen === 'plan' && styles.bottomTabTextActive]}>Plan</Text>
            </Pressable>
          </View>
          <Modal
            transparent
            visible={!!selectedCalendarCell}
            animationType="fade"
            onRequestClose={() => setSelectedCalendarCell(null)}
          >
            <View style={styles.modalBackdrop}>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>{selectedCalendarCell?.weekTitle}</Text>
                <Text style={styles.modalSubtitle}>{selectedCalendarCell?.dayName}</Text>
                <Text style={styles.modalWorkout}>{selectedCalendarCell?.workoutType}</Text>
                {!!selectedCalendarCell?.details && (
                  <Text style={styles.modalDetail}>{selectedCalendarCell.details}</Text>
                )}
                <Pressable
                  onPress={() => setSelectedCalendarCell(null)}
                  style={({ pressed }) => [styles.modalCloseButton, pressed && styles.buttonPressed]}
                >
                  <Text style={styles.modalCloseText}>Close</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  safe: {
    backgroundColor: '#070b12',
    flex: 1,
  },
  container: {
    flexGrow: 1,
    gap: 12,
    padding: 16,
    paddingBottom: 28,
  },
  page: {
    flex: 1,
  },
  banner: {
    backgroundColor: '#19324a',
    borderBottomColor: '#2b4d6d',
    borderBottomWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bannerSuccess: {
    backgroundColor: '#11374a',
    borderBottomColor: '#27e4dc',
  },
  bannerError: {
    backgroundColor: '#3a1a20',
    borderBottomColor: '#a4344a',
  },
  bannerText: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  brandPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#0a1828',
    borderColor: '#1f3b57',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  brandPillText: {
    color: '#27e4dc',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  title: {
    color: '#f8fafc',
    fontSize: 32,
    fontWeight: '700',
  },
  subtitle: {
    color: '#93a4bd',
    fontSize: 13,
    lineHeight: 18,
  },
  sectionCard: {
    backgroundColor: '#0f1928',
    borderColor: '#1d2b40',
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  sectionTitle: {
    color: '#e2e8f0',
    fontSize: 17,
    fontWeight: '700',
  },
  fieldLabel: {
    color: '#8ca1be',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  advancedToggle: {
    alignItems: 'center',
    backgroundColor: '#122035',
    borderColor: '#1e3553',
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 10,
  },
  advancedToggleText: {
    color: '#8ca1be',
    fontSize: 13,
    fontWeight: '600',
  },
  advancedSection: {
    gap: 10,
    marginTop: 2,
  },
  debugBox: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    gap: 10,
    padding: 10,
  },
  debugEntry: {
    borderBottomColor: '#334155',
    borderBottomWidth: 1,
    gap: 6,
    paddingBottom: 8,
  },
  debugTitle: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
  },
  debugPromptText: {
    color: '#cbd5e1',
    fontSize: 11,
    lineHeight: 16,
  },
  goalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  goalChip: {
    backgroundColor: '#152033',
    borderColor: '#1f324d',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  goalChipActive: {
    backgroundColor: '#11374a',
    borderColor: '#27e4dc',
  },
  goalChipText: {
    color: '#b9c7db',
    fontSize: 12,
    fontWeight: '600',
  },
  goalChipTextActive: {
    color: '#dbfffd',
  },
  inlineFieldRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  timeGroup: {
    flex: 1,
    gap: 4,
  },
  daySelectorRow: {
    alignItems: 'center',
    backgroundColor: '#0a1321',
    borderColor: '#1f324d',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  dayDot: {
    alignItems: 'center',
    borderColor: '#35516f',
    borderRadius: 12,
    borderWidth: 1,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  dayDotActive: {
    backgroundColor: '#27e4dc',
    borderColor: '#27e4dc',
  },
  dayDotText: {
    color: '#9eb0ca',
    fontSize: 12,
    fontWeight: '600',
  },
  dayDotTextActive: {
    color: '#071018',
  },
  timeInput: {
    backgroundColor: '#0a1321',
    borderColor: '#1f324d',
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#e2e8f0',
  },
  timeUnit: {
    color: '#7891b4',
    fontSize: 11,
    fontWeight: '600',
    paddingLeft: 4,
  },
  timeSeparator: {
    color: '#8ca1be',
    fontSize: 22,
    fontWeight: '700',
    marginTop: -12,
  },
  helperText: {
    color: '#7891b4',
    fontSize: 11,
    lineHeight: 15,
  },
  input: {
    backgroundColor: '#0a1321',
    borderColor: '#1f324d',
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 120,
    padding: 12,
    textAlignVertical: 'top',
    color: '#e2e8f0',
  },
  questionInput: {
    backgroundColor: '#0a1321',
    borderColor: '#1f324d',
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 92,
    padding: 12,
    textAlignVertical: 'top',
    color: '#e2e8f0',
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#1f5eff',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 46,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 46,
    marginTop: 4,
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '700',
  },
  predictionCard: {
    backgroundColor: '#101c2d',
    borderColor: '#28405d',
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
    marginTop: 4,
    padding: 12,
  },
  predictionTitle: {
    color: '#c6d4ea',
    fontSize: 12,
    fontWeight: '600',
  },
  predictionRange: {
    color: '#f8fafc',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  predictionCaption: {
    color: '#8ca1be',
    fontSize: 11,
    lineHeight: 16,
  },
  savedPlansSection: {
    backgroundColor: '#0c1522',
    borderColor: '#1f324d',
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    marginTop: 6,
    padding: 10,
  },
  savedPlanRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  savedPlanMeta: {
    flex: 1,
    gap: 2,
    paddingRight: 8,
  },
  savedPlanTitle: {
    color: '#dbe6f7',
    fontSize: 13,
    fontWeight: '700',
  },
  savedPlanSubtitle: {
    color: '#8ca1be',
    fontSize: 11,
  },
  savedPlanOpenButton: {
    backgroundColor: '#1f5eff',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  savedPlanOpenText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  screenHeaderRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  backButton: {
    backgroundColor: '#122035',
    borderColor: '#1e3553',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backButtonText: {
    color: '#c8d5e8',
    fontSize: 13,
    fontWeight: '600',
  },
  refreshButton: {
    backgroundColor: '#1f5eff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  refreshButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  bottomTabBar: {
    backgroundColor: '#0e1623',
    borderTopColor: '#1d2b40',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bottomTab: {
    alignItems: 'center',
    backgroundColor: '#122035',
    borderColor: '#1f324d',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
  },
  bottomTabActive: {
    backgroundColor: '#11374a',
    borderColor: '#27e4dc',
  },
  bottomTabText: {
    color: '#9eb0ca',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  bottomTabTextActive: {
    color: '#dbfffd',
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(2, 6, 23, 0.75)',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#0e1623',
    borderColor: '#1f324d',
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    padding: 16,
    width: '100%',
  },
  modalTitle: {
    color: '#c6d4ea',
    fontSize: 12,
    fontWeight: '700',
  },
  modalSubtitle: {
    color: '#8ca1be',
    fontSize: 12,
    fontWeight: '600',
  },
  modalWorkout: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  modalDetail: {
    color: '#d3deee',
    fontSize: 14,
    lineHeight: 20,
  },
  modalCloseButton: {
    alignItems: 'center',
    backgroundColor: '#1f5eff',
    borderRadius: 10,
    marginTop: 4,
    paddingVertical: 10,
  },
  modalCloseText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  inputActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  clearButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#122035',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  clearButtonText: {
    color: '#c8d5e8',
    fontSize: 13,
    fontWeight: '600',
  },
  hideKeyboardButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#1b2a3f',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  hideKeyboardButtonText: {
    color: '#d5dfef',
    fontSize: 13,
    fontWeight: '600',
  },
  buttonPressed: {
    opacity: 0.9,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  responseBox: {
    backgroundColor: '#0e1623',
    borderColor: '#1d2b40',
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  responseLabel: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '600',
  },
  responseText: {
    color: '#d3deee',
    fontSize: 15,
    lineHeight: 22,
  },
  followUpBox: {
    backgroundColor: '#0a1321',
    borderColor: '#1f324d',
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    padding: 10,
  },
  todayCard: {
    backgroundColor: '#0c1522',
    borderColor: '#1f324d',
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  todayWorkoutType: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 26,
  },
  checkinSummaryBox: {
    backgroundColor: '#11374a',
    borderColor: '#27e4dc',
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
  },
  checkinSummaryText: {
    color: '#dbfffd',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  checkinForm: {
    gap: 8,
    marginTop: 4,
  },
  checkinInput: {
    backgroundColor: '#0a1321',
    borderColor: '#1f324d',
    borderRadius: 10,
    borderWidth: 1,
    color: '#e2e8f0',
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  calendarModeBlock: {
    gap: 10,
    marginTop: 2,
  },
  calendarHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  calendarHeaderCell: {
    color: '#8ca1be',
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  calendarWeekBlock: {
    backgroundColor: '#0c1522',
    borderColor: '#1f324d',
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 10,
  },
  calendarWeekTitle: {
    color: '#dbe6f7',
    fontSize: 13,
    fontWeight: '700',
  },
  calendarWeekGrid: {
    flexDirection: 'row',
    gap: 6,
  },
  calendarCell: {
    borderRadius: 8,
    flex: 1,
    minHeight: 92,
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  calendarCellRest: {
    backgroundColor: '#121b2a',
    borderColor: '#22334b',
    borderWidth: 1,
  },
  calendarCellWorkoutBg: {
    backgroundColor: '#11374a',
    borderColor: '#27e4dc',
    borderWidth: 1,
  },
  calendarCellDay: {
    color: '#9eb0ca',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  calendarCellWorkoutText: {
    color: '#e7f2ff',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  calendarCellDetail: {
    color: '#c3d4ea',
    fontSize: 10,
    lineHeight: 12,
    marginTop: 3,
  },
  tableHeaderRow: {
    backgroundColor: '#122035',
  },
  tableRow: {
    borderBottomColor: '#1d2b40',
    borderBottomWidth: 1,
    flexDirection: 'row',
  },
  tableCell: {
    borderRightColor: '#1d2b40',
    borderRightWidth: 1,
    color: '#d3deee',
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  tableHeaderCell: {
    fontWeight: '700',
  },
  tableBlock: {
    gap: 8,
    marginTop: 8,
  },
  tableTitle: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700',
  },
  calendarActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  calendarButton: {
    backgroundColor: '#1f5eff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  calendarButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  removeCalendarButton: {
    backgroundColor: '#2a1217',
    borderColor: '#a4344a',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  removeCalendarButtonText: {
    color: '#f7b7c6',
    fontSize: 13,
    fontWeight: '600',
  },
  errorBox: {
    backgroundColor: '#2a1217',
    borderColor: '#a4344a',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  errorText: {
    color: '#f7b7c6',
    fontSize: 14,
    lineHeight: 20,
  },
});
