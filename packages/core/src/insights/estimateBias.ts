import { toLocalDate } from '../dates';
import type { Id, InsightSettings, Instant, Task } from '../schema';
import { byId, fingerprint } from './fingerprint';
import type { InsightIndex } from './snapshot';
import type { DetectorCoverage, Insight, InsightSnapshot, TaskActualEvidence } from './types';
import { INSIGHT_ALGORITHM_VERSION } from './types';

/**
 * Estimate bias: per effective area, the sum of recorded minutes over the
 * sum of estimated minutes across tasks completed in the window. Sums first,
 * then one division: five tasks at 10 minutes and one at 300 do not average
 * into a ratio. An explicit `actualMin` (even zero) wins; otherwise the
 * task's closed sessions; a task with neither is not a sample. Tasks whose
 * area does not resolve to a live area form an "Unassigned" group rather
 * than landing in someone else's.
 */

const DAY_MS = 86_400_000;

interface Group {
  areaId: Id | null;
  samples: TaskActualEvidence[];
  estimateMin: number;
  actualMin: number;
}

function sampleFor(task: Task, index: InsightIndex): TaskActualEvidence | null {
  if (task.actualMin !== null) {
    return {
      kind: 'task-actual',
      ref: { type: 'task', id: task.id },
      title: task.title,
      estimateMin: task.estimateMin,
      actualMin: task.actualMin,
      actualSource: 'actualMin',
      completedAt: task.completedAt!,
    };
  }
  const sessions = index.closedSessionMin.get(task.id);
  if (sessions === undefined) return null;
  return {
    kind: 'task-actual',
    ref: { type: 'task', id: task.id },
    title: task.title,
    estimateMin: task.estimateMin,
    actualMin: Math.round(sessions),
    actualSource: 'sessions',
    completedAt: task.completedAt!,
  };
}

/** A live completed task's completion instant when it is valid and not in the future. */
function completedAt(task: Task, now: Date): number | null {
  if (task.deletedAt !== null || task.status !== 'done' || !task.completedAt) return null;
  const at = new Date(task.completedAt).getTime();
  if (!Number.isFinite(at) || at > now.getTime()) return null;
  return at;
}

export interface EstimateBiasResult {
  insights: Insight[];
  coverage: DetectorCoverage;
  /** The earliest instant a counted sample leaves the window: the next time-only change. */
  nextSampleExpiryAt: Instant | null;
}

export function estimateBias(
  snapshot: InsightSnapshot,
  index: InsightIndex,
  settings: InsightSettings,
  computedAt: string,
): EstimateBiasResult {
  const now = index.now;
  const since = now.getTime() - settings.estimateWindowDays * DAY_MS;
  const groups = new Map<Id | null, Group>();
  // The fingerprint covers every completed task of the area with an estimate and an
  // actual, whatever its date: a sample ageing out of the window is not a source edit.
  const sources = new Map<Id | null, Array<[Id, number, number, string]>>();
  let oldestCounted: number | null = null;

  for (const task of snapshot.tasks) {
    const at = completedAt(task, now);
    if (at === null || task.estimateMin <= 0) continue;
    const sample = sampleFor(task, index);
    if (!sample) continue;
    const areaId = index.areaOf(task);
    const list = sources.get(areaId) ?? [];
    list.push([task.id, task.estimateMin, sample.actualMin, sample.actualSource]);
    sources.set(areaId, list);
    if (at < since) continue;
    if (oldestCounted === null || at < oldestCounted) oldestCounted = at;
    const group = groups.get(areaId) ?? { areaId, samples: [], estimateMin: 0, actualMin: 0 };
    group.samples.push(sample);
    group.estimateMin += task.estimateMin;
    group.actualMin += sample.actualMin;
    groups.set(areaId, group);
  }

  const insights: Insight[] = [];
  let eligible = 0;
  let largest = 0;
  for (const group of groups.values()) {
    largest = Math.max(largest, group.samples.length);
    if (group.samples.length < settings.estimateMinSamples) continue;
    eligible += 1;
    const ratio = group.actualMin / group.estimateMin;
    if (!(ratio > settings.estimateRatioThreshold)) continue;
    const area = group.areaId ? index.areaById.get(group.areaId) : undefined;
    const name = area ? area.name : 'Unassigned';
    const n = group.samples.length;
    const from = toLocalDate(new Date(since));
    const to = toLocalDate(now);
    const samples = [...group.samples].sort((a, b) => byId(a.ref, b.ref));
    insights.push({
      key: group.areaId ? `estimate-bias:area:${group.areaId}` : 'estimate-bias:unassigned',
      kind: 'estimate-bias',
      severity: 'attention',
      title: `Work recorded in ${name} took ${ratio.toFixed(2)}× the estimated time across ${n} completed task${n === 1 ? '' : 's'}.`,
      detail: `${group.actualMin} minutes recorded against ${group.estimateMin} estimated, ${from} to ${to}. This describes recorded time, not how well the work went.`,
      subject: group.areaId ? { type: 'area', id: group.areaId } : { type: 'unassigned' },
      evidence: samples,
      threshold: {
        metric: 'actual/estimate',
        actual: ratio,
        operator: '>',
        limit: settings.estimateRatioThreshold,
        unit: 'ratio',
        sampleSize: n,
        minSamples: settings.estimateMinSamples,
      },
      metrics: {
        ratio,
        samples: n,
        estimateMin: group.estimateMin,
        actualMin: group.actualMin,
        windowDays: settings.estimateWindowDays,
      },
      range: { from, to },
      notes: [],
      computedAt,
      fingerprint: fingerprint({
        v: INSIGHT_ALGORITHM_VERSION,
        area: group.areaId,
        sources: (sources.get(group.areaId) ?? []).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
        settings: [
          settings.estimateWindowDays,
          settings.estimateMinSamples,
          settings.estimateRatioThreshold,
        ],
      }),
      algorithmVersion: INSIGHT_ALGORITHM_VERSION,
    });
  }

  return {
    insights,
    coverage: {
      kind: 'estimate-bias',
      subjects: groups.size,
      eligible,
      emitted: insights.length,
      requiredSamples: settings.estimateMinSamples,
      largestSample: groups.size ? largest : null,
      available: eligible > 0,
      unavailableReason: eligible > 0 ? null : groups.size ? 'insufficient-samples' : 'no-subjects',
    },
    // The window is inclusive at `now − windowDays`, so a sample expires the instant after.
    nextSampleExpiryAt:
      oldestCounted === null
        ? null
        : new Date(oldestCounted + settings.estimateWindowDays * DAY_MS + 1).toISOString(),
  };
}
