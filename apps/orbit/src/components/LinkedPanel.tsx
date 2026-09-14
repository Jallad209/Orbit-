import type { Clock, EntityRef } from '@orbit/core';
import { systemClock } from '@orbit/core';
import { Unlink } from 'lucide-react';
import { Link } from 'react-router';
import { LinkPicker } from '@/components/LinkPicker';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { addLink, loadLinked, removeLink } from '@/features/structure/structureService';
import { routeFor, type Destination } from '@/lib/destinations';
import { useRepository } from '@/platform';

interface Item {
  id: string;
  label: string;
  hint?: string;
  linkId?: string;
  to: string | null;
}

/**
 * The "Linked" section every detail screen shares (week 12): the other
 * ends of a record's links grouped by type, each a real link to its
 * canonical screen, with Unlink (which soft-deletes the relationship, not
 * the record) and the picker to add more. Deleted endpoints are filtered
 * by the loader; a record's own notes show as "in project".
 */
export function LinkedPanel({ entity, clock = systemClock }: { entity: EntityRef; clock?: Clock }) {
  const repo = useRepository();
  const { data: linked } = useRepoQuery((r) => loadLinked(r, entity), [entity.type, entity.id]);
  if (!linked) return null;
  const groups: Array<{ title: string; items: Item[] }> = [
    {
      title: 'Notes',
      items: linked.notes.map((n) => ({
        id: n.id,
        label: n.title,
        linkId: n.linkId,
        to: routeFor({ type: 'note', id: n.id }),
      })),
    },
    {
      title: 'People',
      items: linked.people.map((p) => ({
        id: p.id,
        label: p.name,
        linkId: p.linkId,
        to: routeFor({ type: 'person', id: p.id }),
      })),
    },
    {
      title: 'Projects',
      items: linked.projects.map((p) => ({
        id: p.id,
        label: p.title,
        linkId: p.linkId,
        to: routeFor({ type: 'project', id: p.id }),
      })),
    },
    {
      title: 'Events',
      items: linked.events.map((e) => ({
        id: e.id,
        label: e.title,
        hint: e.startAt.slice(0, 10),
        linkId: e.linkId,
        to: null,
      })),
    },
    {
      title: 'Bills',
      items: linked.bills.map((b) => ({
        id: b.id,
        label: b.title,
        hint: `${b.amount} ${b.currency}`.trim(),
        linkId: b.linkId,
        to: routeFor({ type: 'bill', id: b.id }),
      })),
    },
    {
      title: 'Tasks',
      items: linked.tasks.map((t) => ({
        id: t.id,
        label: t.title,
        linkId: t.linkId,
        to: routeFor({ type: 'task', id: t.id } satisfies Destination),
      })),
    },
  ].filter((g) => g.items.length > 0);
  const alreadyLinked: EntityRef[] = [
    ...linked.notes.map((n) => ({ type: 'note' as const, id: n.id })),
    ...linked.people.map((p) => ({ type: 'person' as const, id: p.id })),
    ...linked.projects.map((p) => ({ type: 'project' as const, id: p.id })),
    ...linked.events.map((e) => ({ type: 'event' as const, id: e.id })),
    ...linked.bills.map((b) => ({ type: 'bill' as const, id: b.id })),
    ...linked.tasks.map((t) => ({ type: 'task' as const, id: t.id })),
  ];
  return (
    <section aria-label="Linked" data-testid="linked-panel">
      <SectionHeader
        title="Linked"
        actions={
          <LinkPicker
            from={entity}
            exclude={alreadyLinked}
            onLink={async (to) => {
              try {
                await addLink(repo, entity, to, 'related', clock);
              } catch (e) {
                toast({
                  title: 'Could not link',
                  description: e instanceof Error ? e.message : String(e),
                  variant: 'danger',
                });
              }
            }}
          />
        }
      />
      {groups.length === 0 ? (
        <p className="text-[13px] text-ink-faint">
          Nothing linked yet. Notes, people, projects, events, bills, and tasks can all attach here.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {groups.map((g) => (
            <Card key={g.title} className="p-3">
              <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
                {g.title}
              </p>
              <ul className="flex flex-col gap-1" aria-label={`Linked ${g.title.toLowerCase()}`}>
                {g.items.map((it) => (
                  <li key={it.id} className="flex items-center gap-2 text-sm">
                    {it.to ? (
                      <Link to={it.to} className="min-w-0 flex-1 truncate hover:underline">
                        {it.label}
                      </Link>
                    ) : (
                      <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    )}
                    {it.hint ? <span className="text-[12px] text-ink-faint">{it.hint}</span> : null}
                    {it.linkId ? (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Unlink ${it.label}`}
                        onClick={() => void removeLink(repo, it.linkId!)}
                      >
                        <Unlink className="size-3.5" aria-hidden="true" />
                      </Button>
                    ) : (
                      <Badge tone="outline">in project</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
