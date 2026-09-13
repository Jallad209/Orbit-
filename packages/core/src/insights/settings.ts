import { InsightSettingsSchema, type AppSettings, type InsightSettings } from '../schema';
import type { InsightPlanning } from './types';

/** The thresholds a fresh install starts from. */
export const DEFAULT_INSIGHT_SETTINGS: InsightSettings = InsightSettingsSchema.parse({});

/** Detector priority inside one severity: overload, weekly deficit, stale project, estimate bias, people. */
export const DETECTOR_ORDER = [
  'overloaded-day',
  'weekly-target-deficit',
  'stale-project',
  'estimate-bias',
  'person-commitments',
] as const;

/** Pull the two groups the engine reads out of the settings document. */
export function insightInputsFor(settings: AppSettings): {
  settings: InsightSettings;
  planning: InsightPlanning;
} {
  return {
    settings: settings.insights,
    planning: {
      workingWindow: settings.workingWindow,
      restBoundaries: settings.restBoundaries,
      defaultEstimateMin: settings.defaultEstimateMin,
    },
  };
}

export interface InsightSettingsField {
  key: keyof InsightSettings;
  label: string;
  help: string;
  min: number;
  max: number;
  /** Whole numbers only. */
  integer: boolean;
  unit: 'days' | 'count' | 'ratio';
}

/** One description per threshold, for the Settings form and the docs. Order matters. */
export const INSIGHT_SETTINGS_FIELDS: readonly InsightSettingsField[] = [
  {
    key: 'staleProjectDays',
    label: 'Stale project after',
    help: 'Complete days without any change to the project, its tasks, milestones, or sessions.',
    min: 1,
    max: 90,
    integer: true,
    unit: 'days',
  },
  {
    key: 'estimateWindowDays',
    label: 'Estimate observation window',
    help: 'Completed tasks from the last this many days are compared.',
    min: 7,
    max: 180,
    integer: true,
    unit: 'days',
  },
  {
    key: 'estimateMinSamples',
    label: 'Estimate minimum samples',
    help: 'Completed tasks with an estimate and a recorded actual before an area is compared.',
    min: 5,
    max: 100,
    integer: true,
    unit: 'count',
  },
  {
    key: 'estimateRatioThreshold',
    label: 'Estimate ratio threshold',
    help: 'Recorded ÷ estimated time above which the area is reported.',
    min: 1.05,
    max: 3,
    integer: false,
    unit: 'ratio',
  },
  {
    key: 'dayOverloadRatio',
    label: 'Day overload ratio',
    help: 'Committed work ÷ the whole day’s available work time above which the day is reported.',
    min: 1,
    max: 2,
    integer: false,
    unit: 'ratio',
  },
  {
    key: 'personCommitmentCount',
    label: 'Open commitments per person',
    help: 'From this many open commitments with one person, they are listed.',
    min: 1,
    max: 20,
    integer: true,
    unit: 'count',
  },
];

/**
 * Validate a candidate thresholds object the way the storage boundary does.
 * Returns the parsed group, or the field paths that are out of bounds.
 */
export function validateInsightSettings(
  candidate: unknown,
): { ok: true; settings: InsightSettings } | { ok: false; errors: Record<string, string> } {
  const parsed = InsightSettingsSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, settings: parsed.data };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? '');
    const field = INSIGHT_SETTINGS_FIELDS.find((f) => f.key === key);
    errors[key] = field
      ? `Use ${field.integer ? 'a whole number' : 'a number'} between ${field.min} and ${field.max}.`
      : issue.message;
  }
  return { ok: false, errors };
}
