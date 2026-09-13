import type { InsightSettings, Instant } from '../schema';
import { elapsedDays, staleAt } from '../services/activity';
import { fingerprint } from './fingerprint';
import type { InsightIndex } from './snapshot';
import type { ActivityEvidence, DetectorCoverage, Insight } from './types';
import { INSIGHT_ALGORITHM_VERSION } from './types';

/**
 * Stale projects: live, active projects whose last activity (the shared
 * definition in `services/activity.ts`) is at least `staleProjectDays`
 * complete 24-hour periods ago. The evidence is the record that moved last,
 * so the user can see what "activity" meant. Snoozing the insight is not
 * activity: the clock keeps running underneath a snooze.
 */

export interface StaleProjectsResult {
  insights: Insight[];
  coverage: DetectorCoverage;
  /** When the next not-yet-stale active project crosses the threshold. */
  nextStaleAt: Instant | null;
}

export function staleProjects(
  index: InsightIndex,
  settings: InsightSettings,
  computedAt: string,
): StaleProjectsResult {
  const insights: Insight[] = [];
  let subjects = 0;
  let nextStale: string | null = null;
  const projects = [...index.projectById.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const project of projects) {
    if (project.status !== 'active') continue;
    subjects += 1;
    const activity = index.activity.get(project.id);
    if (!activity) continue;
    const days = elapsedDays(activity.at, index.now);
    if (days < settings.staleProjectDays) {
      const at = staleAt(activity, settings.staleProjectDays);
      if (nextStale === null || at < nextStale) nextStale = at;
      continue;
    }
    const evidence: ActivityEvidence = {
      kind: 'activity',
      ref: { type: activity.source.type, id: activity.source.id },
      title: activity.source.title,
      at: activity.at,
      deleted: activity.source.deleted,
      elapsedDays: days,
    };
    insights.push({
      key: `stale-project:${project.id}`,
      kind: 'stale-project',
      severity: 'attention',
      title: `${project.title} has had no recorded activity for ${days} day${days === 1 ? '' : 's'}.`,
      detail: `The last change was ${describe(evidence)} on ${activity.at.slice(0, 10)}; the threshold is ${settings.staleProjectDays} days.`,
      subject: { type: 'project', id: project.id },
      evidence: [evidence],
      threshold: {
        metric: 'staleDays',
        actual: days,
        operator: '>=',
        limit: settings.staleProjectDays,
        unit: 'days',
        sampleSize: null,
        minSamples: null,
      },
      metrics: { staleDays: days, thresholdDays: settings.staleProjectDays },
      range: null,
      notes: [],
      computedAt,
      fingerprint: fingerprint({
        v: INSIGHT_ALGORITHM_VERSION,
        project: project.id,
        lastActivityAt: activity.at,
        source: [activity.source.type, activity.source.id],
        staleProjectDays: settings.staleProjectDays,
      }),
      algorithmVersion: INSIGHT_ALGORITHM_VERSION,
    });
  }
  return {
    insights,
    coverage: {
      kind: 'stale-project',
      subjects,
      eligible: subjects,
      emitted: insights.length,
      requiredSamples: null,
      largestSample: null,
      available: subjects > 0,
      unavailableReason: subjects > 0 ? null : 'no-subjects',
    },
    nextStaleAt: nextStale,
  };
}

function describe(e: ActivityEvidence): string {
  const what =
    e.ref.type === 'project'
      ? 'the project itself'
      : e.ref.type === 'session'
        ? `a session on “${e.title ?? 'a task'}”`
        : `the ${e.ref.type} “${e.title ?? ''}”`;
  return e.deleted ? `${what} (deleted)` : what;
}
