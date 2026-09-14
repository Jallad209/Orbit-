import { fixedClock, type FixedClock } from '../../src/clock';
import { toLocalDate } from '../../src/dates';
import {
  DEFAULT_INSIGHT_SETTINGS,
  computeInsights,
  type Insight,
  type InsightInput,
  type InsightPlanning,
  type InsightReport,
  type InsightSnapshot,
} from '../../src/insights';
import type { InsightSettings } from '../../src/schema';

/** Monday 14 September 2026, 10:00 local: the week runs 14–20, the next full week 21–27. */
export const NOW = new Date(2026, 8, 14, 10, 0, 0);

export function clockAt(at: Date | string = NOW): FixedClock {
  return fixedClock(at);
}

export const TODAY = toLocalDate(NOW);

/** 09:00–18:00 with a 45-minute lunch: 495 minutes of capacity, the plan's worked example. */
export const PLANNING: InsightPlanning = {
  workingWindow: { startMin: 540, endMin: 1080 },
  restBoundaries: [{ startMin: 750, endMin: 795 }],
  defaultEstimateMin: 30,
};

export function emptySnapshot(): InsightSnapshot {
  return {
    areas: [],
    goals: [],
    projects: [],
    milestones: [],
    tasks: [],
    sessions: [],
    events: [],
    routines: [],
    routineInstances: [],
    blocks: [],
    dayCommitments: [],
    people: [],
    commitments: [],
    rules: [],
  };
}

export function snapshotWith(parts: Partial<InsightSnapshot>): InsightSnapshot {
  return { ...emptySnapshot(), ...parts };
}

export function run(
  parts: Partial<InsightSnapshot>,
  overrides: Omit<Partial<InsightInput>, 'settings'> & { settings?: Partial<InsightSettings> } = {},
): InsightReport {
  return computeInsights({
    snapshot: snapshotWith(parts),
    settings: { ...DEFAULT_INSIGHT_SETTINGS, ...overrides.settings },
    planning: overrides.planning ?? PLANNING,
    clock: overrides.clock ?? clockAt(),
    ...(overrides.today ? { today: overrides.today } : {}),
  });
}

export function ofKind(report: InsightReport, kind: Insight['kind']): Insight[] {
  return report.insights.filter((i) => i.kind === kind);
}

/** ISO instant `days` days before NOW (fractional days allowed). */
export function daysAgo(days: number, from: Date = NOW): string {
  return new Date(from.getTime() - days * 86_400_000).toISOString();
}

/** Deep-shuffle every array in a snapshot with a fixed permutation, to prove order independence. */
export function reversed(snapshot: InsightSnapshot): InsightSnapshot {
  const out = {} as Record<string, unknown[]>;
  for (const [k, v] of Object.entries(snapshot)) out[k] = [...(v as unknown[])].reverse();
  return out as unknown as InsightSnapshot;
}
