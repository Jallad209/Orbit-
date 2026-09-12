import { v7 as uuidv7 } from 'uuid';
import type { Id } from './schema/common';

/** Time-ordered UUID v7: sorts by creation time, safe to merge across devices later. */
export function newId(): Id {
  return uuidv7();
}
