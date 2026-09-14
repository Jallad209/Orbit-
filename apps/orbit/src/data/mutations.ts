import type { BaseRecord, Id } from '@orbit/core';
import type { EntityStore, Repository } from '@orbit/storage';
import { bumpData } from './useQuery';

/**
 * The shared mutation boundary (week 12). Every helper here follows one
 * shape: take the owned transaction, re-read the current record through
 * it, compare it with what the user acted upon, apply only the intended
 * change, and let the caller commit. Nothing is bumped or announced
 * before the transaction has committed, and the root repository is never
 * touched from inside the callback.
 */

export type ConflictCode = 'missing' | 'deleted' | 'changed';

export class ConflictError extends Error {
  constructor(
    public readonly code: ConflictCode,
    message: string,
    /** The fields that changed underneath the edit, when known. */
    public readonly fields: string[] = [],
  ) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** What the user saw: the id and, when the caller checks freshness, the change stamp. */
export interface Base {
  id: Id;
  updatedAt?: string;
}

export interface CurrentOptions {
  /** Return a soft-deleted row instead of refusing it (restore paths). */
  allowDeleted?: boolean;
  /** Human noun for messages: "note", "bill". */
  noun?: string;
}

/**
 * The current row for `base`, read through the transaction. Missing and
 * deleted rows are conflicts, not blanks: an edit must never resurrect a
 * record by writing over its tombstone. When `base.updatedAt` is given,
 * a newer stamp is a conflict too — callers that merge field by field use
 * `mergePatch` instead and pass no stamp.
 */
export async function currentRecord<T extends BaseRecord>(
  store: EntityStore<T>,
  base: Base,
  options: CurrentOptions = {},
): Promise<T> {
  const noun = options.noun ?? 'record';
  const current = await store.get(base.id);
  if (!current) throw new ConflictError('missing', `This ${noun} no longer exists.`);
  if (current.deletedAt !== null && !options.allowDeleted)
    throw new ConflictError('deleted', `This ${noun} was deleted.`);
  if (base.updatedAt !== undefined && current.updatedAt !== base.updatedAt)
    throw new ConflictError('changed', `This ${noun} changed since you opened it.`);
  return current;
}

/**
 * Apply `patch` to the current row against the `base` the user edited from.
 * Fields outside the patch keep their current values (independent edits
 * merge); a patched field that someone else changed in the meantime is a
 * conflict unless the user set it to the same value. Same-millisecond
 * writes cannot slip through: the comparison is on values, not stamps.
 */
export function mergePatch<T extends BaseRecord>(current: T, base: T, patch: Partial<T>): T {
  const conflicts: string[] = [];
  const next: T = { ...current };
  for (const key of Object.keys(patch) as Array<keyof T>) {
    const wanted = patch[key];
    if (wanted === undefined) continue;
    const before = JSON.stringify(base[key]);
    const now = JSON.stringify(current[key]);
    const after = JSON.stringify(wanted);
    if (before !== now && now !== after) {
      conflicts.push(String(key));
      continue;
    }
    next[key] = wanted as T[keyof T];
  }
  if (conflicts.length) {
    throw new ConflictError(
      'changed',
      `${conflicts.length === 1 ? 'A field' : 'Some fields'} changed since you opened this: ${conflicts.join(', ')}.`,
      conflicts,
    );
  }
  return next;
}

/**
 * Run `fn` in one owned transaction and announce the change only after it
 * committed. A throw rolls everything back, including op-log entries, and
 * nothing is announced.
 */
export async function mutate<T>(
  repo: Repository,
  fn: (tx: Repository) => Promise<T>,
  options: { bump?: boolean } = {},
): Promise<T> {
  const result = await repo.transaction(fn);
  if (options.bump ?? true) bumpData();
  return result;
}

export function isConflict(error: unknown): error is ConflictError {
  return error instanceof ConflictError;
}
