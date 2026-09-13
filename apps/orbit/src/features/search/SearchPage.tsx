import { BlockError, systemClock } from '@orbit/core';
import type { Clock, EntityRef, Task } from '@orbit/core';
import { SEARCHABLE_TYPES, formatSearchQuery } from '@orbit/storage';
import type { SearchHit, SearchableType } from '@orbit/storage';
import { Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { LinkPicker } from '@/components/LinkPicker';
import { Checkbox } from '@/components/ui/Checkbox';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/Dialog';
import { Input, Label, Select } from '@/components/ui/Input';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { useRepository } from '@/platform';
import { addLink, completeTask } from '@/features/structure/structureService';
import { usePlanPrefs } from '@/features/today/planSettings';
import { formatPreviewRef, parsePreviewRef, scheduleTaskToday } from './searchActions';
import { SearchPreview } from './SearchPreview';
import { SearchResults, type HitAction } from './SearchResults';
import { useSearch } from './searchService';

interface Props {
  clock?: Clock;
}

const PAGE_LIMIT = 50;

const TYPE_PLURAL: Record<SearchableType, string> = {
  task: 'Tasks',
  note: 'Notes',
  project: 'Projects',
  person: 'People',
};

/**
 * `/search?q=…`: the full result list with a filter sidebar. The URL is
 * the state — the query string carries the free text and the `type:` /
 * `area:` filters, so back and forward move through searches, and
 * `open=type:id` names the record shown in the preview drawer.
 */
export function SearchPage({ clock = systemClock }: Props) {
  const repo = useRepository();
  const navigate = useNavigate();
  const prefs = usePlanPrefs();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const preview = parsePreviewRef(params.get('open'));
  const { data: areas } = useRepoQuery(async (r) => r.areas.list(), []);
  const areaOptions = (areas ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const { hits, loading, error, parsed } = useSearch(q, { limit: PAGE_LIMIT });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [linking, setLinking] = useState<{ ref: EntityRef; title: string } | null>(null);

  const update = (next: Partial<{ q: string; open: string | null }>, replace = true) => {
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next.q !== undefined) {
          if (next.q) out.set('q', next.q);
          else out.delete('q');
        }
        if (next.open !== undefined) {
          if (next.open) out.set('open', next.open);
          else out.delete('open');
        }
        return out;
      },
      { replace },
    );
  };

  // A filter change is a step worth going back to; keystrokes only replace the entry.
  const setFilters = (types: SearchableType[], areaId: string | undefined) =>
    update({ q: formatSearchQuery(parsed.text, { types, areaId }, { areas: areaOptions }) }, false);

  const toggleType = (type: SearchableType) => {
    const current = new Set(parsed.filters.types ?? []);
    if (current.has(type)) current.delete(type);
    else current.add(type);
    setFilters([...current], parsed.filters.areaId);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Enter commits this search to history; typing only replaces the current entry.
    update({ q }, false);
  };

  const fail = (e: unknown) =>
    toast({
      title: e instanceof BlockError ? 'Not possible' : 'Something went wrong',
      description: e instanceof Error ? e.message : String(e),
      variant: 'danger',
    });

  const withTask = async (hit: SearchHit, fn: (task: Task) => Promise<void>) => {
    setBusyId(hit.id);
    try {
      const task = await repo.tasks.get(hit.id);
      if (!task || task.deletedAt !== null) throw new Error('That task no longer exists.');
      await fn(task);
    } catch (e) {
      fail(e);
    } finally {
      setBusyId(null);
    }
  };

  const complete = async (task: Task) => {
    await completeTask(repo, task, null, clock);
    toast({ title: 'Task completed', description: task.title, variant: 'success' });
  };

  const schedule = async (task: Task) => {
    const { summary } = await scheduleTaskToday(repo, task, prefs, clock);
    toast({
      title: 'Scheduled today',
      description: `${task.title} · ${summary}`,
      variant: 'success',
    });
  };

  const onAction = (hit: SearchHit, action: HitAction) => {
    switch (action) {
      case 'open':
        void navigate(`/projects/${hit.id}`);
        return;
      case 'preview':
        update({ open: formatPreviewRef({ type: hit.type, id: hit.id }) });
        return;
      case 'complete':
        void withTask(hit, complete);
        return;
      case 'schedule':
        void withTask(hit, schedule);
        return;
      case 'link':
        setLinking({ ref: { type: hit.type, id: hit.id }, title: hit.title });
        return;
    }
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <h1 className="text-display font-semibold tracking-tight text-ink">Search</h1>
        <p className="mt-1 text-ink-muted">Everything you have written down, in one place.</p>
      </div>

      <form onSubmit={submit} role="search" className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint"
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label="Search"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          className="h-11 pl-9 text-base"
          placeholder="Search tasks, notes, projects, people… (type:note area:name)"
          value={q}
          onChange={(e) => update({ q: e.target.value })}
        />
      </form>
      {parsed.errors.length ? (
        <ul role="alert" className="text-[13px] text-danger" data-testid="search-query-errors">
          {parsed.errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-5 md:grid-cols-[12rem_minmax(0,1fr)]">
        <aside
          aria-label="Filters"
          className="flex flex-col gap-4 md:sticky md:top-2 md:self-start"
        >
          <fieldset>
            <legend className="mb-2 text-[12px] font-semibold tracking-wide text-ink-faint uppercase">
              Types
            </legend>
            <div className="flex flex-col gap-1.5">
              {SEARCHABLE_TYPES.map((type) => (
                <Checkbox
                  key={type}
                  label={TYPE_PLURAL[type]}
                  checked={parsed.filters.types?.includes(type) ?? false}
                  onCheckedChange={() => toggleType(type)}
                />
              ))}
            </div>
            <p className="mt-1.5 text-[12px] text-ink-faint">None ticked means every type.</p>
          </fieldset>
          <div>
            <Label htmlFor="search-area">Area</Label>
            <Select
              id="search-area"
              className="mt-1"
              value={parsed.filters.areaId ?? ''}
              onChange={(e) =>
                setFilters([...(parsed.filters.types ?? [])], e.target.value || undefined)
              }
            >
              <option value="">Any area</option>
              {areaOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
        </aside>

        <section aria-label="Results" className="min-w-0">
          <div className="mb-2 flex items-baseline justify-between text-[12px] text-ink-faint">
            <span role="status" aria-live="polite">
              {parsed.text
                ? loading
                  ? 'Searching…'
                  : `${hits.length}${hits.length === PAGE_LIMIT ? '+' : ''} result${hits.length === 1 ? '' : 's'}`
                : ''}
            </span>
            <span>↑ ↓ to move · Enter to open</span>
          </div>
          <SearchResults
            hits={hits}
            query={parsed.text}
            loading={loading}
            error={error}
            hasQuery={parsed.text.length > 0}
            busyId={busyId}
            onAction={onAction}
          />
        </section>
      </div>

      <SearchPreview
        target={preview}
        onClose={() => update({ open: null })}
        clock={clock}
        onComplete={(task) => void complete(task).catch(fail)}
        onSchedule={(task) => void schedule(task).catch(fail)}
      />

      <Dialog
        open={linking !== null}
        onOpenChange={(open) => (!open ? setLinking(null) : undefined)}
      >
        <DialogContent size="sm" aria-describedby={undefined}>
          <DialogTitle className="text-h2">Link “{linking?.title}”</DialogTitle>
          {linking ? (
            <div className="mt-3">
              <LinkPicker
                from={linking.ref}
                triggerLabel="Choose what to link…"
                onLink={async (to) => {
                  await addLink(repo, linking.ref, to, 'related', clock);
                  toast({ title: 'Linked', variant: 'success' });
                  setLinking(null);
                }}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
