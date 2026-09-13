import { describe, expect, it } from 'vitest';
import {
  formatSearchQuery,
  mergeFilters,
  parseSearchQuery,
  queryTerms,
  tokenizeText,
} from '../../src/search/query';
import {
  editDistance,
  highlightSegments,
  makeSnippet,
  matchedFieldsFor,
  maxEditDistance,
  termMatcher,
} from '../../src/search/terms';
import { rankHits } from '../../src/search/types';

const areas = [
  { id: '019372a0-0000-7000-8000-000000000001', name: 'University' },
  { id: '019372a0-0000-7000-8000-000000000002', name: 'Deep Work' },
];

describe('parseSearchQuery', () => {
  it('keeps plain text as text', () => {
    expect(parseSearchQuery('  find   notes ')).toEqual({
      text: 'find notes',
      filters: {},
      errors: [],
      tokens: [],
    });
  });

  it('pulls type: and area: out of the text, case-insensitively', () => {
    const parsed = parseSearchQuery('Type:Note university AREA:university reading', { areas });
    expect(parsed.text).toBe('university reading');
    expect(parsed.filters).toEqual({ types: ['note'], areaId: areas[0]!.id });
    expect(parsed.tokens.map((t) => t.key)).toEqual(['type', 'area']);
    expect(parsed.errors).toEqual([]);
  });

  it('accepts a quoted area name and an area id', () => {
    expect(parseSearchQuery('area:"Deep Work" focus', { areas }).filters.areaId).toBe(areas[1]!.id);
    expect(parseSearchQuery(`area:${areas[1]!.id} focus`, { areas }).filters.areaId).toBe(
      areas[1]!.id,
    );
    expect(parseSearchQuery(`area:${areas[1]!.id}`).filters.areaId).toBe(areas[1]!.id);
  });

  it('unions several type filters', () => {
    expect(parseSearchQuery('type:task type:person x').filters.types).toEqual(['task', 'person']);
  });

  it('reports malformed filters and keeps searching the rest', () => {
    const parsed = parseSearchQuery('type: type:banana area:nowhere area:University area:Home x', {
      areas,
    });
    expect(parsed.text).toBe('x');
    expect(parsed.filters).toEqual({ areaId: areas[0]!.id });
    expect(parsed.errors).toEqual([
      'Add a value after "type:" — task, note, project, person.',
      'Unknown type "banana". Use task, note, project, person.',
      'No area named "nowhere".',
      'No area named "Home".',
    ]);
  });

  it('refuses a second, different area', () => {
    const parsed = parseSearchQuery('area:University area:"Deep Work" x', { areas });
    expect(parsed.filters.areaId).toBe(areas[0]!.id);
    expect(parsed.errors).toEqual(['Only one area filter applies at a time.']);
  });

  it('leaves unknown filters as searchable text', () => {
    const parsed = parseSearchQuery('due:tomorrow foo:bar rent');
    expect(parsed.text).toBe('due:tomorrow foo:bar rent');
    expect(parsed.errors).toEqual([]);
  });

  it('formats back to a string a UI control can edit, and merges explicit filters', () => {
    const q = formatSearchQuery('reading', { types: ['note'], areaId: areas[1]!.id }, { areas });
    expect(q).toBe('type:note area:"Deep Work" reading');
    expect(parseSearchQuery(q, { areas }).filters).toEqual({
      types: ['note'],
      areaId: areas[1]!.id,
    });
    expect(mergeFilters({ types: ['note'] }, { areaId: 'x' })).toEqual({
      types: ['note'],
      areaId: 'x',
    });
    expect(mergeFilters({ types: ['note'] }, { types: ['task'] })).toEqual({ types: ['task'] });
  });

  it('tokenizes to lowercase words without diacritics', () => {
    expect(tokenizeText('Café — Über-Wörter, 2026!')).toEqual(['cafe', 'uber', 'worter', '2026']);
  });

  it('drops stop words from a query unless nothing else is left', () => {
    expect(queryTerms('find notes about the university')).toEqual(['notes', 'university']);
    expect(queryTerms('Review the contract')).toEqual(['review', 'contract']);
    expect(queryTerms('the')).toEqual(['the']);
    expect(queryTerms('')).toEqual([]);
  });
});

describe('term matching', () => {
  it('bounds typo tolerance the way MiniSearch does', () => {
    expect(maxEditDistance('uni')).toBe(0);
    expect(maxEditDistance('univ')).toBe(1);
    expect(maxEditDistance('university')).toBe(2);
    expect(maxEditDistance('extraordinarily')).toBe(2);
    expect(editDistance('university', 'univrsity')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('kitten', 'sitting', 1)).toBe(2);
  });

  it('reports which fields matched, by prefix or by a fuzzy expansion', () => {
    const doc = { title: 'University fees', body: 'Thesis · University' };
    expect(matchedFieldsFor(doc, termMatcher('univ'))).toEqual(['title', 'body']);
    expect(matchedFieldsFor(doc, termMatcher('thes'))).toEqual(['body']);
    expect(matchedFieldsFor(doc, termMatcher('univrsity'))).toEqual([]);
    expect(matchedFieldsFor(doc, termMatcher('univrsity', ['university']))).toEqual([
      'title',
      'body',
    ]);
    expect(matchedFieldsFor(doc, termMatcher(''))).toEqual([]);
  });

  it('highlights the matched prefix only, and whole words for expansions', () => {
    expect(highlightSegments('University fees', termMatcher('univ'))).toEqual([
      { text: 'Univ', match: true },
      { text: 'ersity fees', match: false },
    ]);
    expect(highlightSegments('the university', termMatcher('univrsity', ['university']))).toEqual([
      { text: 'the ', match: false },
      { text: 'university', match: true },
    ]);
  });

  it('snippets around the first match, or from the start', () => {
    const body = `${'word '.repeat(60)}neural networks ${'tail '.repeat(40)}`;
    const snip = makeSnippet(body, termMatcher('neural'), 60);
    expect(snip.startsWith('…')).toBe(true);
    expect(snip).toContain('neural');
    expect(snip.length).toBeLessThanOrEqual(64);
    expect(makeSnippet('short body', termMatcher('zzz'))).toBe('short body');
    expect(makeSnippet('a\n\nb   c', termMatcher('zzz'))).toBe('a b c');
    expect(makeSnippet('', termMatcher('a'))).toBe('');
  });
});

describe('rankHits', () => {
  it('orders title matches first, then score, then recency, then id', () => {
    const base = { type: 'task' as const, title: '', snippet: '', areaId: null };
    const hits = [
      { ...base, id: 'b', score: 1, matchedFields: ['body'], updatedAt: '2026-01-02' },
      { ...base, id: 'a', score: 1, matchedFields: ['body'], updatedAt: '2026-01-02' },
      { ...base, id: 'c', score: 5, matchedFields: ['body'], updatedAt: '2026-01-01' },
      { ...base, id: 'd', score: 0.5, matchedFields: ['title'], updatedAt: '2026-01-01' },
      { ...base, id: 'e', score: 1, matchedFields: ['body'], updatedAt: '2026-01-03' },
    ];
    expect(rankHits(hits).map((h) => h.id)).toEqual(['d', 'c', 'e', 'a', 'b']);
  });
});
