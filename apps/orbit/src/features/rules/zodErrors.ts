import type { ZodIssue } from 'zod';

/**
 * Zod issues → one message per field, keyed by the dotted path
 * (`config.endMin`). The first issue for a path wins; forms show it under
 * the field and the root message, if any, above the buttons.
 */
export function fieldErrors(issues: readonly ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
