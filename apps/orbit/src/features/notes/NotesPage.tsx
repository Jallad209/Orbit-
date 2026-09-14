import { systemClock } from '@orbit/core';
import type { Clock } from '@orbit/core';
import { StickyNote } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, Skeleton } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { useRepository } from '@/platform';
import { routeFor } from '@/lib/destinations';
import { createNote, loadNotes, restoreNote } from './notesService';

/**
 * Every note, newest edit first, filtered by title, area, or project. A
 * new note needs a title and opens straight into its editor. Deleted
 * notes have an explicit view with Restore.
 */
export function NotesPage({ clock = systemClock }: { clock?: Clock }) {
  const repo = useRepository();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [areaId, setAreaId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const { data, loading, error } = useRepoQuery(
    (r) => loadNotes(r, { q, areaId: areaId || undefined, projectId: projectId || undefined }),
    [q, areaId, projectId],
  );

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      const note = await createNote(repo, { title }, clock);
      setTitle('');
      void navigate(routeFor({ type: 'note', id: note.id })!);
    } catch (err) {
      toast({
        title: 'Could not create the note',
        description: err instanceof Error ? err.message : String(err),
        variant: 'danger',
      });
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-display font-semibold tracking-tight text-ink">Notes</h1>
        <p className="mt-1 text-ink-muted">
          Plain text with Markdown preview, saved as you go. Notes can belong to a project or an
          area and link to anything.
        </p>
      </div>

      <form onSubmit={add} className="flex flex-wrap gap-2" aria-label="New note">
        <Input
          aria-label="New note title"
          placeholder="New note title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="min-w-56 flex-1"
        />
        <Button type="submit" variant="primary" disabled={!title.trim()}>
          Add note
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Filter notes"
          placeholder="Filter by title"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-8 max-w-xs"
        />
        <Select
          aria-label="Filter by area"
          value={areaId}
          onChange={(e) => setAreaId(e.target.value)}
          className="h-8 w-40"
        >
          <option value="">Any area</option>
          {data?.areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="h-8 w-44"
        >
          <option value="">Any project</option>
          {data?.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </Select>
        {data?.deleted.length ? (
          <Button size="sm" variant="ghost" onClick={() => setShowDeleted((v) => !v)}>
            {showDeleted ? 'Hide deleted' : `Deleted (${data.deleted.length})`}
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          Notes could not be loaded: {error.message}
        </p>
      ) : loading && !data ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : data && data.rows.length === 0 ? (
        <EmptyState
          icon={<StickyNote />}
          title={q || areaId || projectId ? 'No notes match' : 'No notes yet'}
          description={
            q || areaId || projectId
              ? 'Try a different filter.'
              : 'Give a note a title above and start writing.'
          }
        />
      ) : (
        <ul className="flex flex-col gap-1" aria-label="Notes">
          {data?.rows.map(({ note, projectTitle, areaName }) => (
            <li key={note.id}>
              <Link
                to={routeFor({ type: 'note', id: note.id })!}
                className="flex items-center gap-3 rounded-md border border-line bg-surface-2/40 px-3 py-2 hover:bg-surface-2"
                data-testid="note-row"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{note.title}</span>
                  <span className="block truncate text-[12px] text-ink-faint">
                    {note.body ? note.body.slice(0, 120).replace(/\s+/g, ' ') : 'Empty note'}
                  </span>
                </span>
                {projectTitle ? <Badge tone="project">{projectTitle}</Badge> : null}
                {areaName ? <Badge tone="outline">{areaName}</Badge> : null}
                {note.projectId && !projectTitle ? (
                  <Badge tone="gold">Unavailable project</Badge>
                ) : null}
                <span className="text-[12px] text-ink-faint tnum">
                  {note.updatedAt.slice(0, 10)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {showDeleted && data?.deleted.length ? (
        <section aria-label="Deleted notes" className="flex flex-col gap-2">
          <h2 className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
            Deleted
          </h2>
          <ul className="flex flex-col gap-1">
            {data.deleted.map((n) => (
              <li
                key={n.id}
                className="flex items-center gap-3 rounded-md border border-dashed border-line px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">{n.title}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void restoreNote(repo, n.id).catch((err: unknown) =>
                      toast({
                        title: 'Could not restore',
                        description: err instanceof Error ? err.message : String(err),
                        variant: 'danger',
                      }),
                    )
                  }
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
