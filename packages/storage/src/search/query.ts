import { UUID_RE } from '@orbit/core';
import type { Id } from '@orbit/core';
import {
  SEARCHABLE_TYPES,
  isSearchableType,
  type SearchFilters,
  type SearchableType,
} from './types';

/**
 * The tiny query language every search surface shares: free text plus
 * `type:note` and `area:university`. Anything else stays text, so a query
 * can never do more than search. Malformed filters are reported, not
 * guessed at; the search still runs on the remaining text.
 */

export interface QueryToken {
  key: 'type' | 'area';
  value: string;
  raw: string;
}

export interface ParsedQuery {
  /** Free text with the filters removed and whitespace collapsed. */
  text: string;
  filters: SearchFilters;
  /** Human messages for filters that could not be applied. */
  errors: string[];
  /** The filters that were understood, in order, for chips. */
  tokens: QueryToken[];
}

export interface QueryContext {
  /** Areas to resolve `area:<name>` against; ids are always accepted. */
  areas?: ReadonlyArray<{ id: Id; name: string }>;
}

const FILTER_RE = /(^|\s)(type|area):("([^"]*)"|(\S*))/giu;

export function parseSearchQuery(input: string, ctx: QueryContext = {}): ParsedQuery {
  const errors: string[] = [];
  const tokens: QueryToken[] = [];
  const types = new Set<SearchableType>();
  let areaId: Id | undefined;

  const text = input
    .replace(FILTER_RE, (_m, lead: string, key: string, quoted: string, inner?: string) => {
      const k = key.toLowerCase() as QueryToken['key'];
      const value = (quoted.startsWith('"') ? (inner ?? '') : quoted).trim();
      const raw = `${key}:${quoted}`;
      if (!value) {
        errors.push(
          k === 'type'
            ? `Add a value after "type:" — ${SEARCHABLE_TYPES.join(', ')}.`
            : 'Add an area name after "area:".',
        );
        return lead;
      }
      if (k === 'type') {
        const t = value.toLowerCase();
        if (!isSearchableType(t)) {
          errors.push(`Unknown type "${value}". Use ${SEARCHABLE_TYPES.join(', ')}.`);
          return lead;
        }
        types.add(t);
        tokens.push({ key: 'type', value: t, raw });
        return lead;
      }
      const resolved = resolveArea(value, ctx);
      if (!resolved) {
        errors.push(`No area named "${value}".`);
        return lead;
      }
      if (areaId && areaId !== resolved) {
        errors.push('Only one area filter applies at a time.');
        return lead;
      }
      areaId = resolved;
      tokens.push({ key: 'area', value, raw });
      return lead;
    })
    .replace(/\s+/gu, ' ')
    .trim();

  const filters: SearchFilters = {};
  if (types.size) filters.types = [...types];
  if (areaId) filters.areaId = areaId;
  return { text, filters, errors, tokens };
}

function resolveArea(value: string, ctx: QueryContext): Id | undefined {
  const byName = ctx.areas?.find(
    (a) => a.name.localeCompare(value, undefined, { sensitivity: 'base' }) === 0,
  );
  if (byName) return byName.id;
  if (UUID_RE.test(value)) {
    if (!ctx.areas || ctx.areas.some((a) => a.id === value)) return value;
  }
  return undefined;
}

/** Explicit filters win over parsed ones, field by field. */
export function mergeFilters(parsed: SearchFilters, explicit?: SearchFilters): SearchFilters {
  const out: SearchFilters = { ...parsed };
  if (explicit?.types?.length) out.types = [...explicit.types];
  if (explicit?.areaId) out.areaId = explicit.areaId;
  return out;
}

/**
 * Rebuild a query string from text and filters, so a UI control (a type
 * checkbox, an area select) can edit the same string the user types into.
 */
export function formatSearchQuery(
  text: string,
  filters: SearchFilters,
  ctx: QueryContext = {},
): string {
  const parts: string[] = [];
  for (const t of filters.types ?? []) parts.push(`type:${t}`);
  if (filters.areaId) {
    const area = ctx.areas?.find((a) => a.id === filters.areaId);
    const name = area?.name ?? filters.areaId;
    parts.push(/\s/u.test(name) ? `area:"${name}"` : `area:${name}`);
  }
  const free = text.trim();
  if (free) parts.push(free);
  return parts.join(' ');
}

/** Lowercased, diacritic-free word tokens; the same split both backends index with. */
export function tokenizeText(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Words that say nothing about which record is meant. Dropped from queries
 * (never from the index): "review the contract" searches for "review" and
 * "contract", so a stop word cannot match half the file. A query made only
 * of stop words keeps them, so "the" still finds something.
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'at',
  'by',
  'from',
  'is',
  'it',
  'its',
  'this',
  'that',
  'my',
  'me',
  'about',
  'be',
  'as',
  'find',
  'show',
]);

/** The terms a query actually searches for: tokenized, stop words dropped. */
export function queryTerms(text: string): string[] {
  const all = tokenizeText(text);
  const kept = all.filter((t) => !STOP_WORDS.has(t));
  return kept.length ? kept : all;
}
