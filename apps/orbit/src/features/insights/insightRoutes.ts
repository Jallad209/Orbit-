import type { EvidenceRef, Insight, InsightEvidence, InsightSubject, LocalDate } from '@orbit/core';
import type { PreviewRef } from '@/features/search/searchActions';
import { routeFor } from '@/lib/destinations';

/**
 * Where evidence goes. Core emits typed references; only the app knows
 * which screens exist, so the mapping lives here. Everything resolves to a
 * route that works today or to the read-only preview drawer; nothing links
 * to a placeholder page.
 */

export type Destination =
  | { kind: 'route'; to: string; label: string }
  | { kind: 'preview'; ref: PreviewRef; label: string };

export function timelineRoute(date: LocalDate, blockId?: string): string {
  return blockId ? `/timeline?date=${date}&block=${blockId}` : `/timeline?date=${date}`;
}

export function subjectDestination(subject: InsightSubject): Destination {
  switch (subject.type) {
    case 'project':
      return { kind: 'route', to: `/projects/${subject.id}`, label: 'Open project' };
    case 'area':
    case 'unassigned':
      return { kind: 'route', to: '/areas', label: 'Open areas' };
    case 'date':
      return { kind: 'route', to: timelineRoute(subject.date), label: 'Open that day' };
    case 'week':
      return { kind: 'route', to: timelineRoute(subject.weekStart), label: 'Open that week' };
    case 'person':
      return {
        kind: 'route',
        to: routeFor({ type: 'person', id: subject.id })!,
        label: 'Open person',
      };
  }
}

function refDestination(ref: EvidenceRef, insight: Insight): Destination | null {
  switch (ref.type) {
    case 'task':
      return { kind: 'route', to: routeFor({ type: 'task', id: ref.id })!, label: 'Open task' };
    case 'project':
      return { kind: 'route', to: `/projects/${ref.id}`, label: 'Open project' };
    case 'person':
      return { kind: 'route', to: routeFor({ type: 'person', id: ref.id })!, label: 'Open person' };
    case 'area':
      return { kind: 'route', to: '/areas', label: 'Open areas' };
    case 'milestone':
    case 'session':
      // Both belong to the insight's project; the project page shows them.
      return insight.subject.type === 'project'
        ? { kind: 'route', to: `/projects/${insight.subject.id}`, label: 'Open project' }
        : null;
    case 'commitment':
      // The exact commitment, highlighted on its person's page.
      return insight.subject.type === 'person'
        ? {
            kind: 'route',
            to: routeFor({ type: 'commitment', id: ref.id }, { personId: insight.subject.id })!,
            label: 'Open commitment',
          }
        : null;
    case 'routine':
    case 'routineInstance':
      return { kind: 'route', to: '/settings#rules', label: 'Open routines' };
    case 'event':
    case 'rule':
      return null;
  }
}

/** The destination for one evidence row, or null when it has no record to open. */
export function evidenceDestination(row: InsightEvidence, insight: Insight): Destination | null {
  switch (row.kind) {
    case 'task-actual':
    case 'activity':
    case 'area-target':
    case 'commitment':
      return refDestination(row.ref, insight);
    case 'unscheduled-task':
      return refDestination(row.ref, insight);
    case 'block':
      return { kind: 'route', to: timelineRoute(row.date, row.blockId), label: 'Open block' };
    case 'capacity':
      return { kind: 'route', to: timelineRoute(row.date), label: 'Open that day' };
  }
}

/** Where a capacity exclusion is explained: the settings section that owns it, or the day itself. */
export function exclusionDestination(
  kind: 'rest' | 'event' | 'reserve',
  date: LocalDate,
): Destination {
  switch (kind) {
    case 'rest':
      return { kind: 'route', to: '/settings#planning', label: 'Open planning settings' };
    case 'reserve':
      return { kind: 'route', to: '/settings#rules', label: 'Open rules' };
    case 'event':
      return { kind: 'route', to: timelineRoute(date), label: 'Open that day' };
  }
}
