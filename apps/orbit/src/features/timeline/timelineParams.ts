import { UUID_RE, isValidLocalDate } from '@orbit/core';
import type { LocalDate } from '@orbit/core';

/**
 * `/timeline?date=YYYY-MM-DD&block=<uuid>`: the canonical route evidence
 * links use. A malformed date or id is ignored rather than rewritten, so a
 * bad link cannot start a navigation loop; the page simply shows today.
 */
export function parseTimelineParams(params: URLSearchParams): {
  date: LocalDate | null;
  blockId: string | null;
} {
  const date = params.get('date');
  const block = params.get('block');
  return {
    date: date && isValidLocalDate(date) ? date : null,
    blockId: block && UUID_RE.test(block) ? block : null,
  };
}
