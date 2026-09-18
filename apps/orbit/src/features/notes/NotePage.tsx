import { systemClock } from '@orbit/core';
import type { Clock, Note } from '@orbit/core';
import { Trash2 } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { LinkedPanel } from '@/components/LinkedPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/Dialog';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { useDraftRegistration } from '@/features/drafts/DraftGuard';
import type { DraftStatus } from '@/features/drafts/draftStore';
import { useRepository } from '@/platform';
import { cn } from '@/lib/cn';
import { routeFor } from '@/lib/destinations';
import {
  createNote,
  deleteNote,
  loadNote,
  restoreNote,
  saveNote,
  type NoteDetail,
  type NotePatch,
} from './notesService';

const NotePreview = lazy(() => import('./NotePreview'));

type View = 'edit' | 'preview' | 'both';

const STATUS_LABEL: Record<DraftStatus, string> = {
  editing: 'Editing',
  saving: 'Saving…',
  saved: 'Saved',
  failed: 'Save failed',
  conflict: 'Changed elsewhere',
  invalid: 'Needs a title',
};

function report(title: string, e: unknown): void {
  toast({ title, description: e instanceof Error ? e.message : String(e), variant: 'danger' });
}

/**
 * The note editor. A textarea plus a lazy, sandboxed Markdown preview.
 * Saving is a patch against the record the editor loaded: dirty fields
 * save on blur, on Ctrl+S, and on the Save button; writes are serialized
 * per note; a late response never replaces text typed after it began; a
 * background refresh never overwrites a dirty draft; "Saved" appears only
 * after the commit. A conflict keeps both texts and offers reload, copy,
 * or a new note; a note deleted elsewhere can be copied into a new one.
 */
export function NotePage({ clock = systemClock }: { clock?: Clock }) {
  const { id } = useParams();
  const repo = useRepository();
  const { data, loading, error } = useRepoQuery(
    (r) => (id ? loadNote(r, id) : Promise.resolve(null)),
    [id],
  );
  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        This note could not be loaded: {error.message}
      </p>
    );
  }
  if (!data) {
    if (loading) return <p className="text-sm text-ink-muted">Loading…</p>;
    return (
      <EmptyState
        title="That note no longer exists"
        description="The link may be old, or the note was removed. Nothing new was created."
        action={
          <Link to="/notes" className="text-sm underline">
            Back to notes
          </Link>
        }
      />
    );
  }
  if (data.note.deletedAt !== null) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Link to="/notes" className="text-[13px] text-ink-muted hover:underline">
          ← Notes
        </Link>
        <EmptyState
          title={`“${data.note.title}” was deleted`}
          description="Its links are kept for recovery."
          action={
            <Button
              variant="secondary"
              onClick={() =>
                void restoreNote(repo, data.note.id).catch((e) => report('Could not restore', e))
              }
            >
              Restore note
            </Button>
          }
        />
      </div>
    );
  }
  return <Editor key={data.note.id} detail={data} clock={clock} />;
}

function Editor({ detail, clock }: { detail: NoteDetail; clock: Clock }) {
  const repo = useRepository();
  const navigate = useNavigate();
  const [base, setBase] = useState<Note>(detail.note);
  const [title, setTitle] = useState(detail.note.title);
  const [body, setBody] = useState(detail.note.body);
  const [view, setView] = useState<View>('edit');
  const version = useRef(0);
  const [savedVersion, setSavedVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ current: Note; fields: string[] } | null>(null);
  const [gone, setGone] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const savedVersionRef = useRef(0);
  const [editedVersion, setEditedVersion] = useState(0);
  // A queued save reads the newest draft and base when it runs, not the ones at queue time.
  const latest = useRef({ title, body, base });
  useEffect(() => {
    latest.current = { title, body, base };
  }, [title, body, base]);

  const dirty = editedVersion > savedVersion;
  const invalid = dirty && !title.trim();

  // A background refresh (another write, another window) updates the base only while nothing
  // is dirty; a dirty draft is never overwritten by data that arrived underneath it. Derived
  // during render from the note's change stamp, the React way to adopt a changed prop.
  const [seenUpdatedAt, setSeenUpdatedAt] = useState(detail.note.updatedAt);
  if (detail.note.updatedAt !== seenUpdatedAt) {
    setSeenUpdatedAt(detail.note.updatedAt);
    if (!dirty && !conflict && detail.note.updatedAt !== base.updatedAt) {
      setBase(detail.note);
      setTitle(detail.note.title);
      setBody(detail.note.body);
    }
  }

  const edit = (patch: { title?: string; body?: string }) => {
    version.current += 1;
    setEditedVersion(version.current);
    if (patch.title !== undefined) setTitle(patch.title);
    if (patch.body !== undefined) setBody(patch.body);
    setFailure(null);
  };

  /** Save the dirty fields; serialized per note; returns whether the commit succeeded. */
  const save = useCallback(async (): Promise<boolean> => {
    const run = async (): Promise<boolean> => {
      if (version.current <= savedVersionRef.current) return true;
      const at = version.current;
      const { title, body, base } = latest.current;
      const patch: NotePatch = {};
      if (title !== base.title) patch.title = title;
      if (body !== base.body) patch.body = body;
      if (!Object.keys(patch).length) {
        setSavedVersion(at);
        savedVersionRef.current = at;
        return true;
      }
      if (patch.title !== undefined && !patch.title.trim()) {
        setFailure('A title is required.');
        return false;
      }
      setSaving(true);
      setFailure(null);
      try {
        const outcome = await saveNote(repo, base, patch);
        if (outcome.kind === 'saved') {
          setBase(outcome.note);
          latest.current = { ...latest.current, base: outcome.note };
          if (at > savedVersionRef.current) {
            savedVersionRef.current = at;
            setSavedVersion(at);
          }
          return true;
        }
        if (outcome.kind === 'conflict') {
          setConflict({ current: outcome.current, fields: outcome.fields });
          return false;
        }
        setGone(true);
        return false;
      } catch (e) {
        setFailure(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setSaving(false);
      }
    };
    const next = chain.current.then(run, run);
    chain.current = next.catch(() => undefined);
    return next;
  }, [repo]);

  const status: DraftStatus = gone
    ? 'failed'
    : conflict
      ? 'conflict'
      : invalid
        ? 'invalid'
        : saving
          ? 'saving'
          : failure
            ? 'failed'
            : dirty
              ? 'editing'
              : 'saved';

  useDraftRegistration({
    key: `note:${base.id}`,
    label: `Note “${base.title}”`,
    dirty: dirty || conflict !== null,
    status,
    error: invalid ? 'A title is required.' : gone ? 'This note was deleted elsewhere.' : failure,
    generation: 0,
    flush: async () =>
      (await save()) ? { ok: true } : { ok: false, reason: failure ?? STATUS_LABEL[status] },
    discard: () => {
      setTitle(base.title);
      setBody(base.body);
      savedVersionRef.current = version.current;
      setSavedVersion(version.current);
      setConflict(null);
      setFailure(null);
    },
  });

  const assign = async (patch: NotePatch) => {
    try {
      const outcome = await saveNote(repo, base, patch);
      if (outcome.kind === 'saved') setBase(outcome.note);
      else if (outcome.kind === 'conflict')
        setConflict({ current: outcome.current, fields: outcome.fields });
      else setGone(true);
    } catch (e) {
      report('Could not change the assignment', e);
    }
  };

  const copyDraft = async () => {
    try {
      await navigator.clipboard?.writeText(`${title}\n\n${body}`);
      toast({
        title: 'Copied',
        description: 'Your draft is on the clipboard.',
        variant: 'success',
      });
    } catch {
      toast({
        title: 'Could not copy',
        description: 'Select the text and copy it by hand.',
        variant: 'warning',
      });
    }
  };

  const saveAsNew = async () => {
    try {
      const note = await createNote(
        repo,
        {
          title: title.trim() || `${base.title} (copy)`,
          body,
          projectId: base.projectId,
          areaId: base.areaId,
        },
        clock,
      );
      savedVersionRef.current = version.current;
      setSavedVersion(version.current);
      setConflict(null);
      void navigate(routeFor({ type: 'note', id: note.id })!);
    } catch (e) {
      report('Could not save as a new note', e);
    }
  };

  const parent = detail.projects.find((p) => p.id === base.projectId);

  return (
    <div
      className="mx-auto flex max-w-6xl flex-col gap-5"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          void save();
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/notes" className="text-[13px] text-ink-muted hover:underline">
          ← Notes
        </Link>
        <span
          className={cn(
            'ml-auto text-[12px]',
            status === 'saved'
              ? 'text-ok'
              : status === 'failed' || status === 'conflict' || status === 'invalid'
                ? 'text-danger'
                : 'text-ink-muted',
          )}
          data-testid="note-save-state"
          aria-live="polite"
        >
          {STATUS_LABEL[status]}
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void save()}
          disabled={!dirty || saving || invalid}
          loading={saving}
        >
          Save
        </Button>
        <div role="group" aria-label="View" className="flex rounded-md border border-line">
          {(['edit', 'both', 'preview'] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                'h-8 px-2.5 text-[12px] font-medium',
                view === v ? 'bg-nav text-nav-fg' : 'text-ink-muted hover:bg-surface-2',
              )}
            >
              {v === 'edit' ? 'Edit' : v === 'both' ? 'Both' : 'Preview'}
            </button>
          ))}
        </div>
      </div>

      {gone ? (
        <Card className="flex flex-col gap-2 border-danger/40" data-testid="note-gone">
          <p className="text-sm text-ink">
            This note was deleted elsewhere. Your draft is kept here and cannot be saved to it.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => void copyDraft()}>
              Copy my draft
            </Button>
            <Button size="sm" variant="primary" onClick={() => void saveAsNew()}>
              Save as a new note
            </Button>
          </div>
        </Card>
      ) : null}
      {conflict ? (
        <Card className="flex flex-col gap-2 border-gold-2" data-testid="note-conflict">
          <p className="text-sm text-ink">
            This note changed elsewhere ({conflict.fields.join(', ')}). Your draft and the saved
            version are both kept; nothing was overwritten.
          </p>
          <details className="text-[13px]">
            <summary className="cursor-pointer text-ink-muted">Show the saved version</summary>
            <pre
              className="mt-1 max-h-48 overflow-auto rounded bg-surface-3 p-2 whitespace-pre-wrap"
              data-testid="note-conflict-current"
            >
              {conflict.current.title}
              {'\n\n'}
              {conflict.current.body}
            </pre>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setBase(conflict.current);
                setTitle(conflict.current.title);
                setBody(conflict.current.body);
                savedVersionRef.current = version.current;
                setSavedVersion(version.current);
                setConflict(null);
              }}
            >
              Reload the saved version
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void copyDraft()}>
              Copy my draft
            </Button>
            <Button size="sm" variant="primary" onClick={() => void saveAsNew()}>
              Save mine as a new note
            </Button>
          </div>
        </Card>
      ) : null}
      {failure ? (
        <p role="alert" className="text-[13px] text-danger" data-testid="note-failure">
          {failure} Your text is still here; try Save again or copy it.
        </p>
      ) : null}

      <div>
        <Label htmlFor="note-title">Title</Label>
        <Input
          id="note-title"
          value={title}
          onChange={(e) => edit({ title: e.target.value })}
          onBlur={() => void save()}
          invalid={invalid}
          className="mt-1 text-base font-semibold"
        />
      </div>

      <div className={cn('grid gap-4', view === 'both' && 'md:grid-cols-2')}>
        {view !== 'preview' ? (
          <div>
            <Label htmlFor="note-body">Body</Label>
            <Textarea
              id="note-body"
              value={body}
              onChange={(e) => edit({ body: e.target.value })}
              onBlur={() => void save()}
              rows={18}
              spellCheck
              className="mt-1 font-mono text-[13px] leading-6"
              placeholder="Write in Markdown. Links open only when you click them; images show their alt text."
            />
          </div>
        ) : null}
        {view !== 'edit' ? (
          <div>
            <p className="text-[13px] font-medium text-ink">Preview</p>
            <div className="mt-1 min-h-40 rounded-md border border-line bg-surface-2/40 p-3">
              <Suspense fallback={<p className="text-[13px] text-ink-faint">Loading preview…</p>}>
                <NotePreview body={body} />
              </Suspense>
            </div>
          </div>
        ) : null}
      </div>

      <Card className="grid gap-3 md:grid-cols-3">
        <div>
          <Label htmlFor="note-project">Project</Label>
          <Select
            id="note-project"
            value={base.projectId ?? ''}
            onChange={(e) => void assign({ projectId: e.target.value || null })}
            className="mt-1"
          >
            <option value="">No project</option>
            {detail.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
                {p.status === 'archived' ? ' (archived)' : ''}
              </option>
            ))}
          </Select>
          {detail.parentUnavailable ? (
            <Badge tone="gold" className="mt-1">
              Unavailable project
            </Badge>
          ) : null}
        </div>
        <div>
          <Label htmlFor="note-area" hint={base.projectId ? 'from the project' : undefined}>
            Area
          </Label>
          <Select
            id="note-area"
            value={base.areaId ?? ''}
            disabled={base.projectId !== null}
            onChange={(e) => void assign({ areaId: e.target.value || null })}
            className="mt-1"
          >
            <option value="">No area</option>
            {detail.areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-end justify-end">
          <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-4" aria-hidden="true" /> Delete note
          </Button>
        </div>
        {parent ? (
          <p className="text-[12px] text-ink-faint md:col-span-3">
            In{' '}
            <Link to={routeFor({ type: 'project', id: parent.id })!} className="underline">
              {parent.title}
            </Link>
            . Assigning a parent is separate from linking; use Link… below for relationships.
          </p>
        ) : null}
      </Card>

      <LinkedPanel entity={{ type: 'note', id: base.id }} clock={clock} />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent size="sm">
          <DialogTitle>Delete “{base.title}”?</DialogTitle>
          <DialogDescription>
            The note is hidden and kept for recovery with its links. Nothing else is deleted.
          </DialogDescription>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmDelete(false);
                savedVersionRef.current = version.current;
                setSavedVersion(version.current);
                void deleteNote(repo, base.id)
                  .then(() => navigate('/notes'))
                  .catch((e) => report('Could not delete', e));
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
