import { queryTerms, tokenizeText } from './query';

/**
 * Term matching shared by both backends, so "which field matched", the
 * snippet, and the highlight all agree with each other regardless of the
 * engine that found the record.
 */

/** Typo tolerance: the same rule MiniSearch applies with `fuzzy: 0.2`. */
export const FUZZY_MIN_LENGTH = 4;
export const FUZZY_RATE = 0.2;
export const FUZZY_MAX = 2;

export function maxEditDistance(term: string): number {
  if (term.length < FUZZY_MIN_LENGTH) return 0;
  return Math.min(FUZZY_MAX, Math.round(term.length * FUZZY_RATE));
}

/** Levenshtein distance, bounded: returns `limit + 1` as soon as it is exceeded. */
export function editDistance(a: string, b: string, limit = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** Does a document token satisfy a query term: by prefix, or as one of the expansions. */
function tokenMatches(token: string, term: string, expansions: ReadonlySet<string>): boolean {
  return token.startsWith(term) || expansions.has(token);
}

export interface TermMatcher {
  /** Query terms, tokenized. */
  terms: readonly string[];
  /** Whole document terms the engine matched fuzzily (e.g. "university" for "univrsity"). */
  expansions: ReadonlySet<string>;
}

export function termMatcher(query: string, expansions: Iterable<string> = []): TermMatcher {
  return { terms: queryTerms(query), expansions: new Set(expansions) };
}

export function textMatches(text: string, m: TermMatcher): boolean {
  if (!m.terms.length) return false;
  const tokens = tokenizeText(text);
  return tokens.some((tok) => m.terms.some((t) => tokenMatches(tok, t, m.expansions)));
}

/** `title`, `body`, or both; empty when the engine matched on something the text does not show. */
export function matchedFieldsFor(doc: { title: string; body: string }, m: TermMatcher): string[] {
  const out: string[] = [];
  if (textMatches(doc.title, m)) out.push('title');
  if (textMatches(doc.body, m)) out.push('body');
  return out;
}

export interface MatchRange {
  start: number;
  end: number;
}

/** Character ranges in `text` covered by matching words, ascending, non-overlapping. */
export function matchRanges(text: string, m: TermMatcher): MatchRange[] {
  const out: MatchRange[] = [];
  if (!m.terms.length) return out;
  const re = /[\p{L}\p{N}]+/gu;
  for (const w of text.matchAll(re)) {
    const token = tokenizeText(w[0])[0] ?? '';
    if (!token) continue;
    for (const t of m.terms) {
      if (tokenMatches(token, t, m.expansions)) {
        // Highlight the matched prefix only, so "univ" lights "univ" in "university".
        const len = token.startsWith(t) && !m.expansions.has(token) ? t.length : w[0].length;
        out.push({ start: w.index, end: w.index + Math.min(len, w[0].length) });
        break;
      }
    }
  }
  return out;
}

/** Plain-text pieces with a flag, for a UI to render `<mark>` around matches. */
export function highlightSegments(
  text: string,
  m: TermMatcher,
): Array<{ text: string; match: boolean }> {
  const segments: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  for (const r of matchRanges(text, m)) {
    if (r.start > cursor) segments.push({ text: text.slice(cursor, r.start), match: false });
    segments.push({ text: text.slice(r.start, r.end), match: true });
    cursor = r.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

const ELLIPSIS = '…';

/**
 * A window of `width` characters around the first match in `body`, or the
 * start of the body when nothing in it matched. Whitespace is collapsed so
 * a multi-line note reads as one line.
 */
export function makeSnippet(body: string, m: TermMatcher, width = 140): string {
  const flat = body.replace(/\s+/gu, ' ').trim();
  if (!flat) return '';
  const first = matchRanges(flat, m)[0];
  if (!first) return flat.length > width ? `${flat.slice(0, width).trimEnd()}${ELLIPSIS}` : flat;
  let start = Math.max(0, first.start - Math.floor(width / 3));
  if (start > 0) {
    // Snap to a word boundary so the snippet does not open mid-word.
    const boundary = flat.lastIndexOf(' ', start);
    start = boundary > 0 ? boundary + 1 : start;
  }
  const end = Math.min(flat.length, start + width);
  return `${start > 0 ? ELLIPSIS : ''}${flat.slice(start, end).trim()}${end < flat.length ? ELLIPSIS : ''}`;
}
