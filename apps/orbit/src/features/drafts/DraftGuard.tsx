import { useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router';
import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/Dialog';
import { dirtyDrafts, flushDrafts, hasDirtyDrafts, useDraftStore } from './draftStore';

/**
 * One Save / Discard / Stay guard for every way of leaving unsaved input:
 * in-app navigation (Back and Forward, the nav rail, the palette, links,
 * incoming native navigation) through the data router's blocker, and
 * imperative requests (the PWA reload, the desktop quit) through
 * `confirmLeave`. The browser's own unload warning covers document
 * reloads and cross-origin exits; it cannot await a database write, so
 * only acknowledged saves survive it.
 */
export function DraftGuard() {
  const pending = useDraftStore((s) => s.pending);
  const answer = useDraftStore((s) => s.answer);
  const drafts = useDraftStore((s) => s.drafts);
  const dirty = Object.values(drafts).filter((d) => d.dirty);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasDirtyDrafts() && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    // A draft that is no longer dirty releases a blocked navigation on its own.
    if (blocker.state === 'blocked' && !hasDirtyDrafts()) blocker.proceed();
  }, [blocker, drafts]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!hasDirtyDrafts()) return;
      event.preventDefault();
      // Older browsers read the return value; the text itself is not shown by modern ones.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const open = blocker.state === 'blocked' || pending !== null;
  const action = pending?.action ?? 'leave this page';
  const label = describe(dirty.map((d) => d.label));

  const stay = () => {
    setSaveError(null);
    if (blocker.state === 'blocked') blocker.reset();
    else answer('stay');
  };
  const discard = () => {
    setSaveError(null);
    if (blocker.state === 'blocked') {
      for (const d of dirtyDrafts()) d.discard();
      blocker.proceed();
    } else answer('discard');
  };
  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      if (blocker.state === 'blocked') {
        const result = await flushDrafts();
        if (result.ok) blocker.proceed();
        else setSaveError(result.reason);
      } else {
        // `confirmLeave` flushes after the answer; its caller sees the outcome.
        answer('save');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? stay() : undefined)}>
      <DialogContent size="sm" data-testid="draft-guard" hideClose>
        <DialogTitle>Unsaved changes</DialogTitle>
        <DialogDescription>
          {label} {dirty.length === 1 ? 'has' : 'have'} unsaved changes. Save before you {action},
          discard them, or stay here.
        </DialogDescription>
        {saveError ? (
          <p role="alert" className="mt-3 text-[13px] text-danger">
            {saveError}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={stay} disabled={saving}>
            Stay
          </Button>
          <Button variant="secondary" onClick={discard} disabled={saving}>
            Discard
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} autoFocus>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function describe(labels: string[]): string {
  if (labels.length === 0) return 'An editor';
  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels[0]}, ${labels[1]}, and ${labels.length - 2} more`;
}

/**
 * Register an editor's unsaved state with the coordinator for as long as
 * it is mounted. `flush` and `discard` are read fresh on every call, so an
 * editor can pass closures over its current state.
 */
export interface DraftRegistration {
  key: string;
  label: string;
  dirty: boolean;
  status: import('./draftStore').DraftStatus;
  error?: string | null;
  generation?: number;
  flush: () => Promise<import('./draftStore').FlushResult>;
  discard: () => void;
}

export function useDraftRegistration(registration: DraftRegistration): void {
  const latest = useRef(registration);
  useEffect(() => {
    latest.current = registration;
  });
  const register = useDraftStore((s) => s.register);
  const update = useDraftStore((s) => s.update);
  const unregister = useDraftStore((s) => s.unregister);
  const { key, label, dirty, status, error = null, generation = 0 } = registration;

  useEffect(() => {
    register({
      key,
      label,
      dirty,
      status,
      error,
      generation,
      flush: () => latest.current.flush(),
      discard: () => latest.current.discard(),
    });
    return () => unregister(key);
    // The entry is created once per key; field changes go through `update` below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, register, unregister]);

  useEffect(() => {
    update(key, { label, dirty, status, error, generation });
  }, [key, label, dirty, status, error, generation, update]);
}
