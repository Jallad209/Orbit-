import { systemClock } from '@orbit/core';
import type { CaptureType, Clock } from '@orbit/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, TypeBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { useRepoQuery } from '@/data/useQuery';
import { routeFor } from '@/lib/destinations';
import type { StepSession } from '../useReviewSession';
import {
  archiveCaptureWithin,
  convertCaptureWithin,
  loadInboxStep,
  triageTaskWithin,
} from '../weeklyService';
import { DeferButton, StepFrame } from './StepFrame';

const TYPES: CaptureType[] = ['task', 'note', 'event', 'goal', 'routine', 'bill', 'commitment'];

/**
 * Step 1: the capture inbox and the untriaged task inbox, as two groups.
 * A capture is converted (with the parent it needs), archived, or
 * deferred; an inbox task is triaged into a project or area, or deferred.
 * Conversion, the processed reference, and the receipt commit together.
 */
export function InboxStep({
  session,
  clock = systemClock,
}: {
  session: StepSession;
  clock?: Clock;
}) {
  const { data } = useRepoQuery(loadInboxStep, [session.review.revision]);
  const [types, setTypes] = useState<Record<string, CaptureType>>({});
  const [parents, setParents] = useState<Record<string, string>>({});
  if (!data) return <p className="text-sm text-ink-muted">Loading…</p>;
  const items = [
    ...data.captures.map((c) => ({ type: 'capture' as const, id: c.id })),
    ...data.inboxTasks.map((t) => ({ type: 'task' as const, id: t.id })),
  ];
  const parentOf = (key: string) => {
    const value = parents[key] ?? '';
    if (value.startsWith('project:')) return { projectId: value.slice(8), areaId: null };
    if (value.startsWith('area:')) return { projectId: null, areaId: value.slice(5) };
    return { projectId: null, areaId: null };
  };
  const ParentSelect = ({ id }: { id: string }) => (
    <Select
      aria-label={`Parent for ${id}`}
      value={parents[id] ?? ''}
      onChange={(e) => setParents((p) => ({ ...p, [id]: e.target.value }))}
      className="h-8 w-44"
    >
      <option value="">No project or area</option>
      {data.projects.map((p) => (
        <option key={p.id} value={`project:${p.id}`}>
          Project: {p.title}
        </option>
      ))}
      {data.areas.map((a) => (
        <option key={a.id} value={`area:${a.id}`}>
          Area: {a.name}
        </option>
      ))}
    </Select>
  );
  return (
    <StepFrame
      session={session}
      items={items}
      fingerprint={data.fingerprint}
      intro="Two inboxes: captures waiting to become records, and tasks captured without a home. Convert, archive, triage, or defer each one; an empty inbox can simply be acknowledged."
      gate="Convert, archive, triage, or defer them first."
    >
      <section aria-label="Captures">
        <h3 className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
          Captures ({data.captures.length})
        </h3>
        {data.captures.length === 0 ? (
          <p className="text-[13px] text-ink-faint">No captures waiting.</p>
        ) : null}
        <ul className="mt-1 flex flex-col gap-1">
          {data.captures.map((c) => {
            const decided = session.decided.has(`capture:${c.id}`);
            const type = types[c.id] ?? c.type;
            const parent = parentOf(c.id);
            return (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2 text-sm"
                data-testid="inbox-capture"
              >
                <TypeBadge kind={type} />
                <span className="min-w-0 flex-1 truncate">{c.text}</span>
                <Select
                  aria-label={`Type for ${c.text}`}
                  value={type}
                  onChange={(e) =>
                    setTypes((t) => ({ ...t, [c.id]: e.target.value as CaptureType }))
                  }
                  className="h-8 w-32"
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
                <ParentSelect id={c.id} />
                <Button
                  size="sm"
                  variant="primary"
                  disabled={decided || session.busy || session.stale}
                  onClick={() =>
                    void session.submit(
                      'convert-capture',
                      [{ type: 'capture', id: c.id }],
                      data.fingerprint,
                      { type, ...parent },
                      (tx) => convertCaptureWithin(tx, c.id, { type, ...parent }, clock),
                    )
                  }
                >
                  Convert
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={decided || session.busy || session.stale}
                  onClick={() =>
                    void session.submit(
                      'archive-capture',
                      [{ type: 'capture', id: c.id }],
                      data.fingerprint,
                      {},
                      (tx) => archiveCaptureWithin(tx, c.id),
                    )
                  }
                >
                  Archive
                </Button>
                <DeferButton
                  session={session}
                  target={{ type: 'capture', id: c.id }}
                  fingerprint={data.fingerprint}
                />
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-label="Inbox tasks">
        <h3 className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
          Inbox tasks ({data.inboxTasks.length})
        </h3>
        {data.inboxTasks.length === 0 ? (
          <p className="text-[13px] text-ink-faint">Every task has been triaged.</p>
        ) : null}
        <ul className="mt-1 flex flex-col gap-1">
          {data.inboxTasks.map((t) => {
            const decided = session.decided.has(`task:${t.id}`);
            return (
              <li
                key={t.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2 text-sm"
                data-testid="inbox-task"
              >
                <Badge tone="task">task</Badge>
                <Link
                  to={routeFor({ type: 'task', id: t.id })!}
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {t.title}
                </Link>
                <ParentSelect id={t.id} />
                <Button
                  size="sm"
                  variant="primary"
                  disabled={decided || session.busy || session.stale}
                  onClick={() =>
                    void session.submit(
                      'triage-task',
                      [{ type: 'task', id: t.id }],
                      data.fingerprint,
                      parentOf(t.id),
                      (tx) => triageTaskWithin(tx, t.id, parentOf(t.id)),
                    )
                  }
                >
                  Triage
                </Button>
                <DeferButton
                  session={session}
                  target={{ type: 'task', id: t.id }}
                  fingerprint={data.fingerprint}
                />
              </li>
            );
          })}
        </ul>
      </section>
    </StepFrame>
  );
}
