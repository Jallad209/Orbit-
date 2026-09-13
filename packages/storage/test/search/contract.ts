import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NoteSchema, TaskSchema, createRecord, fixedClock } from '@orbit/core';
import type { FixedClock } from '@orbit/core';
import type { Repository } from '../../src/repository';
import { parseSearchQuery } from '../../src/search/query';
import type { SearchHit, SearchService } from '../../src/search/types';
import { seedSearchWorld, type SearchWorld } from './fixture';

export interface SearchContractFactory {
  /** A fresh repository and the service under test, not yet built. */
  open(clock: FixedClock): Promise<{ repo: Repository; service: SearchService }>;
}

const ids = (hits: readonly SearchHit[]) => hits.map((h) => h.id).sort();

/**
 * The behaviour every search backend must show. MiniSearch and FTS5 run
 * this same suite: the entity set, the ordering rules, the filters, the
 * lifecycle, and the safety rules are one contract, the engine is a detail.
 */
export function searchContract(name: string, factory: SearchContractFactory): void {
  describe(`Search contract: ${name}`, () => {
    let clock: FixedClock;
    let repo: Repository;
    let service: SearchService;
    let world: SearchWorld;

    beforeEach(async () => {
      clock = fixedClock('2026-09-12T09:00:00.000Z');
      ({ repo, service } = await factory.open(clock));
      world = await seedSearchWorld(repo, clock);
      await service.ready();
    });

    afterEach(async () => {
      await service.close?.();
      await repo.close();
    });

    it('prefix "univ" finds the university note, task, and project, never the deleted task', async () => {
      const hits = await service.search('univ');
      expect(ids(hits)).toEqual([world.readingList.id, world.fees.id, world.thesis.id].sort());
      expect(hits.map((h) => h.id)).not.toContain(world.parking.id);
    });

    it('ranks title matches before body matches, then by recency and id', async () => {
      const hits = await service.search('university');
      expect(
        hits
          .map((h) => h.id)
          .slice(0, 2)
          .sort(),
      ).toEqual([world.readingList.id, world.fees.id].sort());
      expect(hits[2]).toMatchObject({ id: world.thesis.id, matchedFields: ['body'] });
      expect(hits[0]!.matchedFields).toContain('title');
      expect(hits[1]!.matchedFields).toContain('title');
    });

    it('type:note excludes tasks and projects', async () => {
      const hits = await service.search('type:note university');
      expect(ids(hits)).toEqual([world.readingList.id]);
      expect(hits.every((h) => h.type === 'note')).toBe(true);
    });

    it('several type filters union, and explicit filters win over parsed ones', async () => {
      const both = await service.search('type:note type:person omar');
      expect(ids(both)).toEqual([world.readingList.id, world.omar.id].sort());
      const explicit = await service.search('type:note omar', { types: ['person'] });
      expect(ids(explicit)).toEqual([world.omar.id]);
    });

    it('area:<name> keeps only records filed under that area', async () => {
      const hits = await service.search('area:university thesis');
      expect(ids(hits)).toEqual([world.thesis.id, world.readingList.id, world.fees.id].sort());
      const byId = await service.search('thesis', { areaId: world.home.id });
      expect(byId).toEqual([]);
    });

    it('returns nothing for a blank query, with or without filters', async () => {
      expect(await service.search('')).toEqual([]);
      expect(await service.search('   ')).toEqual([]);
      expect(await service.search('type:note')).toEqual([]);
      expect(await service.search('', { types: ['task'] })).toEqual([]);
    });

    it('tolerates a typo ("univrsity") and finds the same records as the prefix', async () => {
      const typo = await service.search('univrsity');
      expect(ids(typo)).toEqual(ids(await service.search('univ')));
    });

    it('finds accented titles from plain letters', async () => {
      expect(ids(await service.search('cafe'))).toEqual([world.cafeNotes.id]);
    });

    it('matches any word of a longer phrase and puts the strongest match first', async () => {
      const hits = await service.search('find notes about university');
      expect(hits.map((h) => h.id)).toContain(world.readingList.id);
      expect(hits[0]!.matchedFields).toContain('title');
    });

    it('snippets show the matching part of the body, as plain text on one line', async () => {
      const [hit] = await service.search('type:note lab');
      expect(hit?.id).toBe(world.readingList.id);
      expect(hit?.snippet).toContain('lab');
      expect(hit?.snippet).not.toContain('\n');
      expect(hit?.snippet).not.toMatch(/[<>]/u);
    });

    it('respects the limit and orders identically across calls', async () => {
      const all = await service.search('university');
      const two = await service.search('university', undefined, 2);
      expect(two).toHaveLength(2);
      expect(two.map((h) => h.id)).toEqual(all.slice(0, 2).map((h) => h.id));
      expect(await service.search('university')).toEqual(all);
    });

    it('reflects an update after refresh, without a full page reload', async () => {
      clock.advance(1000);
      await repo.tasks.upsert({ ...world.groceries, title: 'Buy university supplies' });
      await service.refresh();
      expect(ids(await service.search('type:task university'))).toEqual(
        [world.fees.id, world.groceries.id].sort(),
      );
    });

    it('drops a soft-deleted record after refresh', async () => {
      await repo.notes.softDelete(world.readingList.id);
      await service.refresh();
      expect(ids(await service.search('type:note university'))).toEqual([]);
    });

    it('indexes a record created after the first build', async () => {
      const late = createRecord(NoteSchema, clock, { title: 'Late university memo' });
      await repo.notes.upsert(late);
      await service.refresh();
      expect(ids(await service.search('memo'))).toEqual([late.id]);
    });

    it('follows a renamed area and project into the documents that name them', async () => {
      clock.advance(1000);
      await repo.areas.upsert({ ...world.university, name: 'Campus' });
      await repo.projects.upsert({ ...world.thesis, title: 'Dissertation' });
      await service.refresh();
      expect(ids(await service.search('type:task campus'))).toEqual([world.fees.id]);
      expect(ids(await service.search('type:task dissertation'))).toEqual([world.fees.id]);
      expect(await service.search('type:task thesis')).toEqual([]);
    });

    it('a malformed filter is reported and never changes data', async () => {
      const before = await repo.opLog.latestSeq();
      const parsed = parseSearchQuery('type:banana university');
      expect(parsed.errors).toEqual(['Unknown type "banana". Use task, note, project, person.']);
      const hits = await service.search('type:banana university');
      expect(hits.length).toBeGreaterThan(0);
      expect(await repo.opLog.latestSeq()).toBe(before);
    });

    it('rebuilds from live records after invalidate', async () => {
      const task = createRecord(TaskSchema, clock, { title: 'Invalidated entry', status: 'open' });
      await repo.tasks.upsert(task);
      service.invalidate();
      await service.refresh();
      expect(ids(await service.search('invalidated'))).toEqual([task.id]);
    });
  });
}
