import { describe, expect, it } from 'vitest';
import { TaskSchema, createRecord, fixedClock } from '@orbit/core';
import { createMemoryRepository } from '../../src/memory';
import type { Repository } from '../../src/repository';
import { createMiniSearchService } from '../../src/search/minisearch';
import { seedSearchWorld } from './fixture';

/** A repository whose op-log reads can be held, to observe overlapping refreshes. */
function gated(inner: Repository) {
  let gate: Promise<void> = Promise.resolve();
  let sinceCalls = 0;
  const repo: Repository = {
    ...inner,
    opLog: {
      latestSeq: () => inner.opLog.latestSeq(),
      since: async (after, limit) => {
        sinceCalls += 1;
        await gate;
        return inner.opLog.since(after, limit);
      },
    },
  };
  return {
    repo,
    hold() {
      let release!: () => void;
      gate = new Promise<void>((r) => {
        release = r;
      });
      return release;
    },
    get sinceCalls() {
      return sinceCalls;
    },
  };
}

describe('search refresh concurrency', () => {
  it('coalesces concurrent refresh calls into one pass and never runs two at once', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const g = gated(createMemoryRepository({ clock }));
    await seedSearchWorld(g.repo, clock);
    const service = createMiniSearchService({ repo: g.repo });
    await service.ready();
    const before = g.sinceCalls;

    const release = g.hold();
    const calls = Array.from({ length: 5 }, () => service.refresh());
    expect(g.sinceCalls).toBe(before + 1); // one pass started, the others joined it
    release();
    await Promise.all(calls);
    // The joined callers asked again once the pass ended: exactly one follow-up pass.
    expect(g.sinceCalls).toBe(before + 2);
  });

  it('a change made during a pass is picked up by the follow-up pass', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const g = gated(createMemoryRepository({ clock }));
    await seedSearchWorld(g.repo, clock);
    const service = createMiniSearchService({ repo: g.repo });
    await service.ready();

    const release = g.hold();
    const first = service.refresh();
    const late = createRecord(TaskSchema, clock, { title: 'Written mid-pass', status: 'open' });
    await g.repo.tasks.upsert(late);
    const second = service.refresh(); // joins, and asks for another pass
    release();
    await Promise.all([first, second]);
    expect((await service.search('mid-pass')).map((h) => h.id)).toEqual([late.id]);
  });

  it('searching while a rebuild is in flight answers from the previous index', async () => {
    const clock = fixedClock('2026-09-12T09:00:00.000Z');
    const g = gated(createMemoryRepository({ clock }));
    const world = await seedSearchWorld(g.repo, clock);
    const service = createMiniSearchService({ repo: g.repo });
    await service.ready();

    await g.repo.tasks.upsert({ ...world.groceries, title: 'Buy candles' });
    const release = g.hold();
    const refreshing = service.refresh();
    expect((await service.search('groceries')).map((h) => h.id)).toEqual([world.groceries.id]);
    release();
    await refreshing;
    expect(await service.search('groceries')).toEqual([]);
    expect((await service.search('candles')).map((h) => h.id)).toEqual([world.groceries.id]);
  });
});
