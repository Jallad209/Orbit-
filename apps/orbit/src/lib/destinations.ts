import { UUID_RE } from '@orbit/core';
import type { Id, LocalDate } from '@orbit/core';
import type { Repository } from '@orbit/storage';

/**
 * The one map from a typed reference to the screen that shows it (week
 * 12). Search results, linked panels, insight evidence, Markdown links,
 * reminders, commands, and notification activations all go through here,
 * so a record has exactly one canonical address and a missing record is
 * never silently redirected to a different one.
 *
 * A destination only navigates. Nothing here marks paid, completes,
 * records contact, imports, or accepts a plan.
 */

export type Destination =
  | { type: 'person'; id: Id }
  | { type: 'commitment'; id: Id }
  | { type: 'bill'; id: Id }
  | { type: 'note'; id: Id }
  | { type: 'task'; id: Id }
  | { type: 'project'; id: Id }
  | { type: 'goal'; id: Id }
  | { type: 'review'; id: Id }
  | { type: 'reminder'; id: Id }
  | { type: 'timelineBlock'; id: Id; date: LocalDate }
  | { type: 'area'; id: Id }
  | { type: 'capture'; id: Id };

export type DestinationType = Destination['type'];

/** The kinds a URI or link may name directly. Reminders resolve to their source. */
export const LINKABLE_TYPES: readonly DestinationType[] = [
  'person',
  'commitment',
  'bill',
  'note',
  'task',
  'project',
  'goal',
  'review',
  'reminder',
];

export function isDestinationType(value: string): value is DestinationType {
  return (
    (LINKABLE_TYPES as readonly string[]).includes(value) ||
    value === 'timelineBlock' ||
    value === 'area' ||
    value === 'capture'
  );
}

/**
 * The route for a destination whose identity is fully known. A commitment
 * needs its person, a reminder its source, and a block its date, so those
 * go through `resolveDestination` first; here they return null.
 */
export function routeFor(destination: Destination, context: { personId?: Id } = {}): string | null {
  switch (destination.type) {
    case 'person':
      return `/people/${destination.id}`;
    case 'commitment':
      return context.personId ? `/people/${context.personId}?commitment=${destination.id}` : null;
    case 'bill':
      return `/bills/${destination.id}`;
    case 'note':
      return `/notes/${destination.id}`;
    case 'task':
      return `/tasks/${destination.id}`;
    case 'project':
      return `/projects/${destination.id}`;
    case 'goal':
      return `/goals/${destination.id}`;
    case 'area':
      return '/areas';
    case 'capture':
      return '/inbox';
    case 'review':
      return `/review/weekly?review=${destination.id}`;
    case 'timelineBlock':
      return `/timeline?date=${destination.date}&block=${destination.id}`;
    case 'reminder':
      return null;
  }
}

export type Resolved =
  | { kind: 'route'; path: string; destination: Destination }
  /** The record is gone or never existed: land somewhere safe and say so. */
  | { kind: 'missing'; path: string; destination: Destination };

/** Where a missing record sends the user: a page that explains, never another record. */
export function missingRoute(destination: Destination): string {
  return `/missing?type=${destination.type}&id=${encodeURIComponent(destination.id)}`;
}

/**
 * Resolve a destination against current data: a commitment finds its
 * person, a reminder its current source (a paid bill or completed
 * commitment opens in its historical state), a block its date. Deleted
 * people, bills, notes, and tasks are reported missing rather than
 * opened; a deleted commitment or block still lands on its parent.
 */
export async function resolveDestination(
  repo: Repository,
  destination: Destination,
): Promise<Resolved> {
  const missing = (): Resolved => ({
    kind: 'missing',
    path: missingRoute(destination),
    destination,
  });
  const route = (path: string | null): Resolved =>
    path ? { kind: 'route', path, destination } : missing();
  switch (destination.type) {
    case 'reminder': {
      const reminder = await repo.reminders.get(destination.id);
      if (!reminder) return missing();
      const source: Destination =
        reminder.entityType === 'bill'
          ? { type: 'bill', id: reminder.entityId }
          : { type: 'commitment', id: reminder.entityId };
      const inner = await resolveDestination(repo, source);
      return inner.kind === 'route' ? { ...inner, destination } : { ...inner, destination };
    }
    case 'commitment': {
      const commitment = await repo.commitments.get(destination.id);
      if (!commitment) return missing();
      const person = await repo.people.get(commitment.personId);
      if (!person || person.deletedAt !== null) return missing();
      return route(routeFor(destination, { personId: person.id }));
    }
    case 'person':
      return live(await repo.people.get(destination.id)) ? route(routeFor(destination)) : missing();
    case 'bill':
      return live(await repo.bills.get(destination.id)) ? route(routeFor(destination)) : missing();
    case 'note':
      return live(await repo.notes.get(destination.id)) ? route(routeFor(destination)) : missing();
    case 'task':
      return live(await repo.tasks.get(destination.id)) ? route(routeFor(destination)) : missing();
    case 'project':
      return live(await repo.projects.get(destination.id))
        ? route(routeFor(destination))
        : missing();
    case 'goal':
      return live(await repo.goals.get(destination.id)) ? route(routeFor(destination)) : missing();
    case 'review':
      return live(await repo.weeklyReviews.get(destination.id))
        ? route(routeFor(destination))
        : missing();
    case 'timelineBlock': {
      const block = await repo.blocks.get(destination.id);
      if (!block) return route(`/timeline?date=${destination.date}`);
      return route(routeFor({ ...destination, date: block.date }));
    }
    case 'area':
    case 'capture':
      return route(routeFor(destination));
  }
}

function live(record: { deletedAt: string | null } | undefined): boolean {
  return !!record && record.deletedAt === null;
}

/**
 * `orbit://<kind>/<uuid>` (week 12). Strict on purpose: one scheme, the
 * listed kinds, one UUID segment, no credentials, port, query, fragment,
 * encoded separators, or trailing material. A payload beyond a modest
 * length is refused before parsing. Nothing in the URI is ever logged or
 * shown beyond the kind and id.
 */
export const ORBIT_SCHEME = 'orbit';
export const MAX_URI_LENGTH = 128;

const URI_RE = /^orbit:\/\/([a-z]+)\/([0-9a-fA-F-]{36})\/?$/;

export function parseOrbitUri(input: string): Destination | null {
  if (typeof input !== 'string' || input.length > MAX_URI_LENGTH) return null;
  if (/[\s%?#@:]/.test(input.slice('orbit://'.length))) return null;
  const m = URI_RE.exec(input);
  if (!m) return null;
  const [, kind, id] = m as unknown as [string, string, string];
  if (!(LINKABLE_TYPES as readonly string[]).includes(kind) || !UUID_RE.test(id)) return null;
  return {
    type: kind as Exclude<DestinationType, 'timelineBlock' | 'area' | 'capture'>,
    id: id.toLowerCase(),
  };
}

/** The URI for a destination, for links Orbit writes itself. */
export function formatOrbitUri(destination: Destination): string {
  return `${ORBIT_SCHEME}://${destination.type}/${destination.id}`;
}
