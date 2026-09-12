import type { EntityRef, EntityType } from '@orbit/core';
import { Link2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { TypeBadge, type EntityKind } from '@/components/ui/Badge';
import { useRepoQuery } from '@/data/useQuery';
import { loadLinkCandidates } from '@/features/structure/structureService';
import { cn } from '@/lib/cn';

const KINDS: Array<{ type: EntityType | 'all'; label: string }> = [
  { type: 'all', label: 'All' },
  { type: 'note', label: 'Notes' },
  { type: 'person', label: 'People' },
  { type: 'event', label: 'Events' },
  { type: 'bill', label: 'Bills' },
  { type: 'task', label: 'Tasks' },
  { type: 'project', label: 'Projects' },
];

export interface LinkPickerProps {
  /** The entity being linked from; excluded from the candidates. */
  from: EntityRef;
  /** Already-linked ids, hidden from the list. */
  exclude?: readonly EntityRef[];
  onLink: (to: EntityRef) => void | Promise<void>;
  triggerLabel?: string;
}

/**
 * Universal "link to…" picker: filter by type, search by name, Enter picks the
 * first match. Used from projects, tasks, notes, and people.
 */
export function LinkPicker({
  from,
  exclude = [],
  onLink,
  triggerLabel = 'Link…',
}: LinkPickerProps) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<EntityType | 'all'>('all');
  const [query, setQuery] = useState('');
  const { data: candidates } = useRepoQuery(
    (repo) => loadLinkCandidates(repo, from),
    [from.type, from.id],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (candidates ?? [])
      .filter((c) => kind === 'all' || c.type === kind)
      .filter((c) => !exclude.some((e) => e.type === c.type && e.id === c.id))
      .filter((c) => !q || c.label.toLowerCase().includes(q))
      .slice(0, 50);
  }, [candidates, kind, query, exclude]);

  const pick = async (c: EntityRef) => {
    await onLink({ type: c.type, id: c.id });
    setOpen(false);
    setQuery('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Link2 className="size-3.5" aria-hidden="true" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent size="md" aria-describedby="link-picker-desc">
        <DialogTitle>Link to</DialogTitle>
        <DialogDescription id="link-picker-desc">
          Connect this to a note, person, event, bill, task, or project.
        </DialogDescription>
        <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Type">
          {KINDS.map((k) => (
            <button
              key={k.type}
              type="button"
              role="tab"
              aria-selected={kind === k.type}
              onClick={() => setKind(k.type)}
              className={cn(
                'h-7 rounded-full px-2.5 text-[12px] font-medium focus-visible:outline-2 focus-visible:outline-lime-2',
                kind === k.type
                  ? 'bg-nav text-nav-fg'
                  : 'bg-surface-2 text-ink-muted hover:bg-surface-3',
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
        <Input
          autoFocus
          aria-label="Search"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && filtered[0]) {
              e.preventDefault();
              void pick(filtered[0]);
            }
          }}
          className="mt-3"
        />
        <ul className="mt-2 flex max-h-72 flex-col gap-0.5 overflow-y-auto" aria-label="Candidates">
          {filtered.map((c) => (
            <li key={`${c.type}-${c.id}`}>
              <button
                type="button"
                onClick={() => void pick(c)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-lime-2"
              >
                <TypeBadge kind={c.type as EntityKind} />
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.hint ? <span className="text-[12px] text-ink-faint">{c.hint}</span> : null}
              </button>
            </li>
          ))}
          {candidates && filtered.length === 0 ? (
            <li className="px-2 py-3 text-[13px] text-ink-faint">Nothing matches.</li>
          ) : null}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
