import type { z } from 'zod';
import type { Clock } from './clock';
import { nowIso } from './clock';
import { newId } from './ids';
import type { BaseRecord } from './schema/common';

type BaseKeys = keyof BaseRecord;

/**
 * Build a fully-stamped record from entity fields. Applies schema defaults, so
 * callers pass only what they know: `createRecord(TaskSchema, clock, { title })`.
 */
export function createRecord<S extends z.ZodTypeAny>(
  schema: S,
  clock: Clock,
  fields: Omit<z.input<S>, BaseKeys> & Partial<Pick<BaseRecord, 'id'>>,
): z.output<S> {
  const at = nowIso(clock);
  const draft = {
    ...fields,
    id: fields.id ?? newId(),
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
  return schema.parse(draft) as z.output<S>;
}

/** Shallow diff: keys of `next` whose value differs from `prev`. */
export function shallowPatch<T extends object>(prev: T, next: T): Partial<T> {
  const patch: Partial<T> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (
      !Object.is(prev[key], next[key]) &&
      JSON.stringify(prev[key]) !== JSON.stringify(next[key])
    ) {
      patch[key] = next[key];
    }
  }
  return patch;
}
