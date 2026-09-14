import { create } from 'zustand';

/**
 * The draft coordinator (week 12). Every editor that holds unsaved input
 * registers here under a stable identity (a record id, or the window for
 * quick capture) with an awaited flush and an explicit discard. One guard
 * then mediates navigation, the PWA reload, and the desktop quit: nobody
 * adds a second unsaved-changes prompt of their own.
 *
 * "Saved" means a durable commit succeeded. A failed save keeps its draft
 * and its Retry; a guard never proceeds past a failed flush on its own.
 */

export type DraftStatus =
  | 'editing'
  | 'saving'
  | 'saved'
  | 'failed'
  | 'conflict'
  /** The draft cannot be saved as it is (an empty title); only fixing or discarding resolves it. */
  | 'invalid';

export type FlushResult = { ok: true } | { ok: false; reason: string };

export interface DraftEntry {
  key: string;
  /** What the guard shows: "Note “Budget”", "Quick capture". */
  label: string;
  dirty: boolean;
  status: DraftStatus;
  error: string | null;
  /** The repository generation the draft belongs to; a restore invalidates older ones. */
  generation: number;
  /** Save now; resolves once the commit succeeded or with why it did not. */
  flush: () => Promise<FlushResult>;
  /** Throw the input away and reset the editor to its saved state. */
  discard: () => void;
}

export type LeaveChoice = 'save' | 'discard' | 'stay';

export interface LeaveRequest {
  /** Why the guard is asking: what proceeding would do. */
  action: string;
  resolve: (choice: LeaveChoice) => void;
}

interface DraftState {
  drafts: Record<string, DraftEntry>;
  /** The question the guard dialog is showing, if any. */
  pending: LeaveRequest | null;
  /** The generation drafts are valid for; older registrations are dropped. */
  generation: number;
  register: (entry: DraftEntry) => void;
  update: (key: string, patch: Partial<Omit<DraftEntry, 'key'>>) => void;
  unregister: (key: string) => void;
  /** A restore or relocation happened: every draft from before it is stale. */
  invalidate: (generation: number) => void;
  ask: (request: LeaveRequest) => void;
  answer: (choice: LeaveChoice) => void;
}

export const useDraftStore = create<DraftState>((set, get) => ({
  drafts: {},
  pending: null,
  generation: 0,
  register: (entry) =>
    set((s) => ({
      drafts: { ...s.drafts, [entry.key]: { ...entry, generation: entry.generation } },
    })),
  update: (key, patch) =>
    set((s) => {
      const current = s.drafts[key];
      if (!current) return s;
      return { drafts: { ...s.drafts, [key]: { ...current, ...patch } } };
    }),
  unregister: (key) =>
    set((s) => {
      if (!(key in s.drafts)) return s;
      const drafts = { ...s.drafts };
      delete drafts[key];
      return { drafts };
    }),
  invalidate: (generation) =>
    set((s) => {
      const drafts: Record<string, DraftEntry> = {};
      for (const [key, d] of Object.entries(s.drafts))
        if (d.generation >= generation) drafts[key] = d;
      return { drafts, generation };
    }),
  ask: (request) => {
    const previous = get().pending;
    // A second question while one is open loses: the user answers the visible one.
    if (previous) previous.resolve('stay');
    set({ pending: request });
  },
  answer: (choice) => {
    const pending = get().pending;
    set({ pending: null });
    pending?.resolve(choice);
  },
}));

/** The registered drafts that hold unsaved input. */
export function dirtyDrafts(): DraftEntry[] {
  return Object.values(useDraftStore.getState().drafts).filter((d) => d.dirty);
}

export function hasDirtyDrafts(): boolean {
  return dirtyDrafts().length > 0;
}

/**
 * Save every dirty draft. Stops at the first failure and reports it; the
 * others keep their input. Drafts that cannot be saved as they are
 * (invalid) fail without a write.
 */
export async function flushDrafts(): Promise<FlushResult> {
  for (const draft of dirtyDrafts()) {
    if (draft.status === 'invalid') {
      return {
        ok: false,
        reason: draft.error
          ? `${draft.label}: ${draft.error}`
          : `${draft.label} cannot be saved as it is.`,
      };
    }
    const result = await draft.flush();
    if (!result.ok) return { ok: false, reason: `${draft.label}: ${result.reason}` };
  }
  return { ok: true };
}

export function discardDrafts(): void {
  for (const draft of dirtyDrafts()) draft.discard();
}

/**
 * Ask whether to leave with unsaved input: resolves `true` when it is safe
 * to proceed (nothing dirty, everything saved, or discarded on request),
 * `false` when the user chose to stay or a save failed. The guard dialog
 * is the only UI; `action` tells it what proceeding would do.
 */
export async function confirmLeave(action: string): Promise<boolean> {
  if (!hasDirtyDrafts()) return true;
  const choice = await new Promise<LeaveChoice>((resolve) =>
    useDraftStore.getState().ask({ action, resolve }),
  );
  if (choice === 'stay') return false;
  if (choice === 'discard') {
    discardDrafts();
    return true;
  }
  const result = await flushDrafts();
  if (!result.ok) {
    // The editor shows the failure; the user decides again from there.
    return false;
  }
  return true;
}
