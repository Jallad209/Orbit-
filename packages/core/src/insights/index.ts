import { addDays, fromLocalDate, toLocalDate } from '../dates';
import type { InsightKind, InsightSeverity } from '../schema';
import { computeDayLoad, overloadDates, overloadInsight } from './dayLoad';
import { estimateBias } from './estimateBias';
import { weeklyTargetDeficit } from './goalDeficit';
import { personCommitments } from './personCommitments';
import { DETECTOR_ORDER } from './settings';
import { buildInsightIndex } from './snapshot';
import { staleProjects } from './staleProjects';
import type { DetectorCoverage, Insight, InsightInput, InsightReport } from './types';
import { INSIGHT_ALGORITHM_VERSION } from './types';

export * from './types';
export * from './settings';
export * from './state';
export { fingerprint, canonical } from './fingerprint';
export { buildInsightIndex, type InsightIndex } from './snapshot';
export { fullDayCapacity, unionMinutes } from './capacity';
export {
  computeDayLoad,
  overloadDates,
  overloadInsight,
  weekdayName,
  OVERLOAD_HORIZON_DAYS,
  WORKLOAD_NOTE,
  type DayLoad,
} from './dayLoad';
export { nextFullWeekStart, WEEKEND_NOTE, AGGREGATE_NOTE } from './goalDeficit';

const SEVERITY_RANK: Record<InsightSeverity, number> = { risk: 0, attention: 1, info: 2 };
const KIND_RANK: Record<InsightKind, number> = Object.fromEntries(
  DETECTOR_ORDER.map((k, i) => [k, i]),
) as Record<InsightKind, number>;

/** Severity, then detector priority, then date or subject, then key: a total order. */
export function compareInsights(a: Insight, b: Insight): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    subjectOrder(a).localeCompare(subjectOrder(b)) ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}

function subjectOrder(i: Insight): string {
  switch (i.subject.type) {
    case 'date':
      return i.subject.date;
    case 'week':
      return i.subject.weekStart;
    default:
      return '';
  }
}

/**
 * The one entry point. Builds the indexes once, runs the five detectors,
 * sorts deterministically, and reports what each detector could and could
 * not judge, so an empty list is never mistaken for a clean bill of health.
 * Identical input and clock give identical output; input order is irrelevant.
 */
export function computeInsights(input: InsightInput): InsightReport {
  const now = input.clock.now();
  const computedAt = now.toISOString();
  const today = input.today ?? toLocalDate(now);
  const { snapshot, settings, planning } = input;
  const index = buildInsightIndex(snapshot, now);

  const insights: Insight[] = [];
  const coverage: DetectorCoverage[] = [];

  const dates = overloadDates(today);
  let overloaded = 0;
  for (const date of dates) {
    const load = computeDayLoad(date, snapshot, index, planning, settings);
    if (!load.overloaded) continue;
    overloaded += 1;
    insights.push(overloadInsight(load, computedAt, settings));
  }
  coverage.push({
    kind: 'overloaded-day',
    subjects: dates.length,
    eligible: dates.length,
    emitted: overloaded,
    requiredSamples: null,
    largestSample: null,
    available: true,
    unavailableReason: null,
  });

  const deficit = weeklyTargetDeficit(snapshot, index, planning, today, computedAt);
  insights.push(...deficit.insights);
  coverage.push(deficit.coverage);

  const stale = staleProjects(index, settings, computedAt);
  insights.push(...stale.insights);
  coverage.push(stale.coverage);

  const bias = estimateBias(snapshot, index, settings, computedAt);
  insights.push(...bias.insights);
  coverage.push(bias.coverage);

  const people = personCommitments(index, settings, computedAt);
  insights.push(...people.insights);
  coverage.push(people.coverage);

  insights.sort(compareInsights);
  return {
    insights,
    coverage,
    computedAt,
    today,
    algorithmVersion: INSIGHT_ALGORITHM_VERSION,
    boundaries: {
      nextStaleAt: stale.nextStaleAt,
      nextSampleExpiryAt: bias.nextSampleExpiryAt,
      nextMidnightAt: fromLocalDate(addDays(today, 1)).toISOString(),
    },
  };
}
