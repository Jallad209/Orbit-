import { addDays } from '../dates';
import { startOfWeek } from '../recurrence/expand';
import type { LocalDate } from '../schema';
import { fullDayCapacity } from './capacity';
import { fingerprint } from './fingerprint';
import type { InsightIndex } from './snapshot';
import type {
  AreaTargetEvidence,
  CapacityEvidence,
  DetectorCoverage,
  Insight,
  InsightPlanning,
  InsightSnapshot,
} from './types';
import { INSIGHT_ALGORITHM_VERSION } from './types';

/**
 * Weekly area-target deficit: the next full Monday–Sunday week, with the
 * sum of the live areas' weekly hour targets against the sum of the seven
 * full-day capacities. Each area counts once whatever its goals; a target
 * without active goals is still the user's commitment. Aggregate capacity
 * only: it says nothing about whether the hours can be placed.
 */

export const WEEKEND_NOTE =
  'Every date uses the working window; there is no weekday preference, so weekends count unless a reservation or event blocks them.';
export const AGGREGATE_NOTE =
  'Aggregate capacity only: this is not a proof that area, energy, or buffer rules would let every hour be placed.';

export interface GoalDeficitResult {
  insights: Insight[];
  coverage: DetectorCoverage;
}

/** Monday of the first full week strictly after the week holding `today`. */
export function nextFullWeekStart(today: LocalDate): LocalDate {
  return addDays(startOfWeek(today), 7);
}

export function weeklyTargetDeficit(
  snapshot: InsightSnapshot,
  index: InsightIndex,
  planning: InsightPlanning,
  today: LocalDate,
  computedAt: string,
): GoalDeficitResult {
  const weekStart = nextFullWeekStart(today);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const targets: AreaTargetEvidence[] = [...index.areaById.values()]
    .filter((a) => a.weeklyHoursTarget > 0)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((a) => ({
      kind: 'area-target',
      ref: { type: 'area', id: a.id },
      name: a.name,
      weeklyHoursTarget: a.weeklyHoursTarget,
      minutes: Math.round(a.weeklyHoursTarget * 60),
    }));
  const coverage: DetectorCoverage = {
    kind: 'weekly-target-deficit',
    subjects: targets.length ? 1 : 0,
    eligible: targets.length ? 1 : 0,
    emitted: 0,
    requiredSamples: null,
    largestSample: null,
    available: targets.length > 0,
    unavailableReason: targets.length > 0 ? null : 'no-targets',
  };
  if (!targets.length) return { insights: [], coverage };

  const capacities: CapacityEvidence[] = dates.map((d) =>
    fullDayCapacity(d, planning, snapshot.rules, snapshot.events),
  );
  const requiredMin = targets.reduce((sum, t) => sum + t.minutes, 0);
  const availableMin = capacities.reduce((sum, c) => sum + c.availableMin, 0);
  const deficitMin = requiredMin - availableMin;
  if (!(deficitMin > 0)) return { insights: [], coverage };

  const weekEnd = dates[6]!;
  coverage.emitted = 1;
  return {
    coverage,
    insights: [
      {
        key: `weekly-target-deficit:${weekStart}`,
        kind: 'weekly-target-deficit',
        severity: 'risk',
        title: 'Weekly area targets exceed available time.',
        detail: `${weekStart} to ${weekEnd}: ${targets.length} area target${targets.length === 1 ? '' : 's'} add up to ${requiredMin} minutes; the seven days offer ${availableMin}. That is ${deficitMin} minutes short.`,
        subject: { type: 'week', weekStart },
        evidence: [...targets, ...capacities],
        threshold: {
          metric: 'required−available',
          actual: deficitMin,
          operator: '>',
          limit: 0,
          unit: 'minutes',
          sampleSize: null,
          minSamples: null,
        },
        metrics: { requiredMin, availableMin, deficitMin, areas: targets.length },
        range: { from: weekStart, to: weekEnd },
        notes: [WEEKEND_NOTE, AGGREGATE_NOTE],
        computedAt,
        fingerprint: fingerprint({
          v: INSIGHT_ALGORITHM_VERSION,
          weekStart,
          targets: targets.map((t) => [t.ref.id, t.minutes]),
          capacities: capacities.map((c) => [
            c.date,
            c.workingWindow,
            c.exclusions.map((e) => [e.kind, e.refId, e.startMin, e.endMin]),
          ]),
        }),
        algorithmVersion: INSIGHT_ALGORITHM_VERSION,
      },
    ],
  };
}
