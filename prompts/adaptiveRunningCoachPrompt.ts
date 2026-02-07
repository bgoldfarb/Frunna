export const WEEK_PARTS = [
  'week1',
  'week2',
  'week3',
  'week4',
  'week5',
  'week6',
  'week7',
  'week8',
  'week9',
  'week10',
  'week11',
  'week12',
] as const;
type PromptPart = (typeof WEEK_PARTS)[number];

export type AdaptiveRunningCoachPromptInput = {
  lookbackDays: number;
  selectedGoal: string;
  runningLevel: 'Beginner' | 'Intermediate' | 'Advanced' | 'Elite';
  targetTime?: string;
  targetTimeSeconds?: number;
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
  historyContext?: string;
  adaptationContext?: string;
};

const GOAL_DISTANCE_KM: Record<string, number> = {
  '5K': 5,
  '10K': 10,
  'Half Marathon': 21.0975,
  Marathon: 42.195,
};

const PART_WEEK_MAP: Record<PromptPart, number> = {
  week1: 1,
  week2: 2,
  week3: 3,
  week4: 4,
  week5: 5,
  week6: 6,
  week7: 7,
  week8: 8,
  week9: 9,
  week10: 10,
  week11: 11,
  week12: 12,
};

const parseDurationToSeconds = (value?: string): number | null => {
  if (!value) {
    return null;
  }
  const cleaned = value.trim();
  if (!cleaned) {
    return null;
  }

  if (/^\d+$/.test(cleaned)) {
    const minutes = Number.parseInt(cleaned, 10);
    return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : null;
  }

  const parts = cleaned.split(':').map((part) => part.trim());
  if (parts.length === 2) {
    const first = Number.parseInt(parts[0], 10);
    const second = Number.parseInt(parts[1], 10);
    if (!Number.isFinite(first) || !Number.isFinite(second) || first < 0 || second < 0) {
      return null;
    }
    if (second >= 60) {
      return first * 60 + second;
    }
    return first * 3600 + second * 60;
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts.map((part) => Number.parseInt(part, 10));
    if (![hours, minutes, seconds].every((valuePart) => Number.isFinite(valuePart) && valuePart >= 0)) {
      return null;
    }
    return hours * 3600 + minutes * 60 + seconds;
  }

  return null;
};

const formatPace = (secondsPerUnit: number): string => {
  const minutes = Math.floor(secondsPerUnit / 60);
  const seconds = Math.round(secondsPerUnit % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const buildPaceGuardrails = (input: AdaptiveRunningCoachPromptInput): string[] => {
  const distanceKm = GOAL_DISTANCE_KM[input.selectedGoal];
  const totalSeconds = input.targetTimeSeconds ?? parseDurationToSeconds(input.targetTime);
  if (!distanceKm || !totalSeconds || totalSeconds <= 0) {
    return ['Target Pace Context: unavailable (no valid target time provided).'];
  }

  const goalPacePerKm = totalSeconds / distanceKm;
  const goalPacePerMile = totalSeconds / (distanceKm * 0.621371);
  const easyLowPerKm = goalPacePerKm + 45;
  const easyHighPerKm = goalPacePerKm + 90;
  const easyLowPerMile = goalPacePerMile + 75;
  const easyHighPerMile = goalPacePerMile + 150;
  const thresholdLowPerKm = goalPacePerKm + 8;
  const thresholdHighPerKm = goalPacePerKm + 25;
  const thresholdLowPerMile = goalPacePerMile + 13;
  const thresholdHighPerMile = goalPacePerMile + 40;
  const intervalLowPerKm = goalPacePerKm - 10;
  const intervalHighPerKm = goalPacePerKm + 12;
  const intervalLowPerMile = goalPacePerMile - 16;
  const intervalHighPerMile = goalPacePerMile + 19;
  const continuousMaxFastPerKm = goalPacePerKm + 8;
  const continuousMaxFastPerMile = goalPacePerMile + 13;

  return [
    `Target Pace Context: goal pace is about ${formatPace(goalPacePerKm)}/km (${formatPace(goalPacePerMile)}/mile).`,
    `Easy pace guardrail: roughly ${formatPace(easyLowPerKm)}-${formatPace(easyHighPerKm)}/km (${formatPace(easyLowPerMile)}-${formatPace(easyHighPerMile)}/mile).`,
    `Threshold/tempo guardrail: ${formatPace(thresholdLowPerKm)}-${formatPace(thresholdHighPerKm)}/km (${formatPace(thresholdLowPerMile)}-${formatPace(thresholdHighPerMile)}/mile).`,
    `Interval guardrail (short repeats only): ${formatPace(intervalLowPerKm)}-${formatPace(intervalHighPerKm)}/km (${formatPace(intervalLowPerMile)}-${formatPace(intervalHighPerMile)}/mile).`,
    `Hard guardrail: continuous efforts longer than 1 mile must not be faster than ${formatPace(continuousMaxFastPerKm)}/km (${formatPace(continuousMaxFastPerMile)}/mile).`,
    'Validation rule: if any prescribed pace breaks these bounds, rewrite the session before returning the final table.',
    'Safety guardrail: keep pace prescriptions realistic for current goal and injury prevention.',
  ];
};

const buildBasePrompt = (input: AdaptiveRunningCoachPromptInput): string => {
  const paceGuardrails = buildPaceGuardrails(input);
  const historyBlock = input.historyContext?.trim()
    ? ['Prior Plan Context (already generated):', input.historyContext.trim(), ''].join('\n')
    : '';
  const adaptationBlock = input.adaptationContext?.trim()
    ? ['Execution Feedback (completed workouts + check-ins):', input.adaptationContext.trim(), ''].join('\n')
    : '';

  return [
    `Role: You are an elite running coach specializing in ${input.selectedGoal} performance and injury prevention.`,
    '',
    'My Context:',
    `Goal: Improve ${input.selectedGoal} speed while staying injury-free.`,
    `Running Level: ${input.runningLevel}`,
    input.targetTime ? `Target Time: ${input.targetTime}` : 'Target Time: not specified',
    'Current Phase: Base Building.',
    `Schedule Constraints: I can run ${input.runDaysPerWeek} days per week. Long runs are on ${input.longRunDay}.`,
    `Distance Unit Preference: ${input.distanceUnit}.`,
    '',
    `The Data (Last ${input.lookbackDays} Days):`,
    '',
    'Recovery Trends:',
    `Resting HR: ${input.restingHrTrend}`,
    `Sleep: ${input.sleepTrend}`,
    `HRV: ${input.hrvTrend}`,
    '',
    'Workload:',
    `VO2 Max: ${input.vo2Trend}`,
    `Distance: ${input.distanceTrend}`,
    `Steps: ${input.stepTrend}`,
    '',
    'Recent Workouts:',
    ...input.workoutNarrative.map((line) => `- ${line}`),
    '',
    historyBlock,
    adaptationBlock,
    'Your Task: Based on my Recovery Trends (HRV/RHR), prior plan context, and schedule constraints, determine progression and write the next week schedule.',
    '',
    'Global Constraints:',
    'Constraint: Ensure easy runs are actually easy (Zone 2).',
    'Constraint: If Push week, include one speed session (Intervals or Tempo).',
    'Constraint: If Deload week, remove all speed work and focus on Zone 1/2.',
    'Constraint: Keep Details and Rationale concise (max 12 words each).',
    `Constraint: Use ${input.distanceUnit} for all distance prescriptions.`,
    'Constraint: Do not prescribe more run days than schedule allows.',
    'Constraint: Weekly load progression should be conservative (roughly <=10% increase vs prior week when context exists).',
    ...paceGuardrails.map((line) => `Constraint: ${line}`),
    '',
  ].join('\n');
};

export const buildAdaptiveRunningCoachPrompt = (input: AdaptiveRunningCoachPromptInput, part: PromptPart): string => {
  const basePrompt = buildBasePrompt(input);
  const week = PART_WEEK_MAP[part];
  const assumption = week === 1 ? 'No prior weeks planned yet.' : `Assume Weeks 1-${week - 1} are already planned. Continue progression appropriately.`;

  return [
    basePrompt,
    `Output Required (Part ${week}):`,
    assumption,
    'The Verdict: state Push, Maintenance, or Deload.',
    'The Reasoning: one sentence.',
    'Pace Check: verify every pace obeys the guardrails before finalizing.',
    `The Plan (Week ${week} only): Return ONLY valid JSON (no markdown, no prose) with this exact shape:`,
    '{',
    `  "week": ${week},`,
    '  "verdict": "Push|Maintenance|Deload",',
    '  "reasoning": "one sentence",',
    '  "days": [',
    '    { "day": "Monday", "workoutType": "...", "details": "...", "rationale": "..." }',
    '  ]',
    '}',
    'JSON Rules: include exactly 7 day objects; keep non-running days as Rest Day; use only day names Monday..Sunday.',
  ].join('\n');
};
