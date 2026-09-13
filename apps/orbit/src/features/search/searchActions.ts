import { BlockError, minuteOfDay, systemClock, toLocalDate } from '@orbit/core';
import type { Block, Clock, Id, Task, TimeWindow } from '@orbit/core';
import type { Repository, SearchHit, SearchableType } from '@orbit/storage';
import { settingsFor, type PlanPrefs } from '@/features/today/planSettings';
import { dropTask, firstFreeSlot, loadDay } from '@/features/timeline/timelineService';

/**
 * Quick actions a search result offers. Only behaviour that already exists
 * elsewhere in Orbit is wired here; the search page adds no new workflow.
 */

/** Put a task into today's first free slot, the way the timeline's "Schedule" does. */
export async function scheduleTaskToday(
  repo: Repository,
  task: Task,
  prefs: Pick<PlanPrefs, 'workingWindow' | 'restBoundaries' | 'energyByDate' | 'bufferMin'>,
  clock: Clock = systemClock,
): Promise<{ block: Block; summary: string }> {
  const today = toLocalDate(clock.now());
  const day = await loadDay(repo, today, clock);
  const window: TimeWindow = prefs.workingWindow;
  const slot = firstFreeSlot(day, task.estimateMin, window, minuteOfDay(day.now));
  if (slot === null) throw new BlockError('overlap', 'No free slot left in the working window.');
  return dropTask(repo, day, task, slot, settingsFor(prefs, today, []), clock);
}

/** Where "Open" goes for a hit: projects have a page; everything else previews in place. */
export function openTarget(hit: SearchHit): { kind: 'route'; to: string } | { kind: 'preview' } {
  if (hit.type === 'project') return { kind: 'route', to: `/projects/${hit.id}` };
  return { kind: 'preview' };
}

export interface PreviewRef {
  type: SearchableType;
  id: Id;
}

/** `open=task:<id>` in the search URL names the record the preview drawer shows. */
export function parsePreviewRef(value: string | null): PreviewRef | null {
  if (!value) return null;
  const [type, id] = value.split(':');
  if (!id || !['task', 'note', 'project', 'person'].includes(type ?? '')) return null;
  return { type: type as SearchableType, id };
}

export function formatPreviewRef(ref: PreviewRef): string {
  return `${ref.type}:${ref.id}`;
}
