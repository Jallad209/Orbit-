import type { Clock } from '../clock';
import { nowIso } from '../clock';
import { newId } from '../ids';
import type { Id } from '../schema';
import { storeFor, type CommandRepository, type UndoChange } from './types';

/**
 * Session undo for command-registry mutations. The op log records what
 * changed but not what it replaced, so each command hands the stack the
 * records as they were and as they became; undo restores the "before" in
 * one transaction, refusing if anything moved since. The stack lives in
 * memory: it does not survive a restart, and the UI says so.
 */

export const UNDO_LIMIT = 20;

export interface UndoEntry {
  id: Id;
  commandId: string;
  /** What the user did, for "Undo: Add task". */
  title: string;
  at: string;
  changes: UndoChange[];
}

export type UndoResult =
  | { ok: true; entry: UndoEntry }
  | { ok: false; reason: 'empty' | 'conflict' | 'failed'; message: string; entry?: UndoEntry };

export class UndoConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UndoConflictError';
  }
}

export interface UndoStack {
  push(entry: Omit<UndoEntry, 'id' | 'at'>, clock: Clock): UndoEntry;
  peek(): UndoEntry | null;
  readonly size: number;
  /** Reverse the newest entry. It leaves the stack whether or not it could be applied. */
  undoLast(repo: CommandRepository): Promise<UndoResult>;
  clear(): void;
  /** Notified after every push, undo, or clear (for a UI badge). */
  subscribe(listener: () => void): () => void;
}

export function createUndoStack(limit = UNDO_LIMIT): UndoStack {
  const entries: UndoEntry[] = [];
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };

  return {
    push(entry, clock) {
      const full: UndoEntry = { ...entry, id: newId(), at: nowIso(clock) };
      entries.push(full);
      if (entries.length > limit) entries.splice(0, entries.length - limit);
      emit();
      return full;
    },

    peek() {
      return entries[entries.length - 1] ?? null;
    },

    get size() {
      return entries.length;
    },

    async undoLast(repo) {
      const entry = entries.pop();
      emit();
      if (!entry) return { ok: false, reason: 'empty', message: 'Nothing to undo.' };
      try {
        await applyUndo(repo, entry);
        return { ok: true, entry };
      } catch (e) {
        if (e instanceof UndoConflictError) {
          return { ok: false, reason: 'conflict', message: e.message, entry };
        }
        return {
          ok: false,
          reason: 'failed',
          message: e instanceof Error ? e.message : String(e),
          entry,
        };
      }
    },

    clear() {
      entries.length = 0;
      emit();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Restore every record of an entry, newest change first, in one
 * transaction. Each record must still be exactly what the command left
 * (`updatedAt` unchanged); otherwise nothing is written and the caller is
 * told what moved. Created records are soft-deleted, replaced ones get
 * their previous fields back. Every write carries `undoOf` in its op-log
 * patch, so the compensating operations are recognisable in the log.
 */
export async function applyUndo(repo: CommandRepository, entry: UndoEntry): Promise<void> {
  await repo.transaction(async (tx) => {
    for (const change of [...entry.changes].reverse()) {
      const store = storeFor(tx, change.entity);
      const current = await store.get(change.entityId);
      if (!current || current.updatedAt !== change.after.updatedAt) {
        throw new UndoConflictError(
          `“${entry.title}” was not undone: the ${change.entity} changed since (maybe in another window).`,
        );
      }
      const opMeta = { undoOf: entry.id };
      if (change.before === null) {
        await store.softDelete(change.entityId, { opMeta });
      } else {
        await store.upsert(change.before, { opMeta });
      }
    }
  });
}
