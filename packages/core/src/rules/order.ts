import type { Rule } from '../schema';

/** One precedence order for the engine and UI, independent of adapter row order. */
export function rulesInOrder(rules: readonly Rule[]): Rule[] {
  return [...rules].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}
