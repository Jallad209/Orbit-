import { describe, expect, it, vi } from 'vitest';
import { createRecord, fixedClock, RoutineSchema } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { loadToday } from '@/features/today/todayService';
import { loadDay } from '@/features/timeline/timelineService';
import { ensureRoutineInstances } from './routineInstances';

const clock = fixedClock(new Date(2026, 8, 14, 8));
const date = '2026-09-14';

async function seed() {
  const repo = createMemoryRepository({ clock });
  await repo.routines.upsert(
    createRecord(RoutineSchema, clock, {
      title: 'Morning walk',
      recurrence: { freq: 'daily' },
      durationMin: 30,
      preferredWindow: { startMin: 540, endMin: 600 },
    }),
  );
  return repo;
}

describe('routine instances before planning', () => {
  it('includes a new routine in Today without first visiting Timeline', async () => {
    const repo = await seed();
    expect(await repo.routineInstances.count()).toBe(0);
    const today = await loadToday(repo, { date, settings: {}, clock });
    const instance = (await repo.routineInstances.query((i) => i.date === date))[0]!;
    expect(instance).toBeDefined();
    expect(today.proposal.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Morning walk', routineInstanceId: instance.id }),
      ]),
    );
  });

  it('keeps one instance per occurrence across concurrent screen loads and later visits', async () => {
    const repo = await seed();
    await Promise.all([loadToday(repo, { date, settings: {}, clock }), loadDay(repo, date, clock)]);
    const instances = await repo.routineInstances.list();
    expect(instances).toHaveLength(28);
    expect(new Set(instances.map((i) => `${i.routineId}:${i.date}`)).size).toBe(28);
    const today = instances.find((i) => i.date === date)!;
    await repo.routineInstances.upsert({ ...today, status: 'skipped' });
    await repo.routineInstances.softDelete(instances[1]!.id);
    const seq = await repo.opLog.latestSeq();
    await loadToday(repo, { date, settings: {}, clock });
    expect(await repo.routineInstances.list({ includeDeleted: true })).toHaveLength(28);
    expect((await repo.routineInstances.get(today.id))?.status).toBe('skipped');
    expect(await repo.opLog.latestSeq()).toBe(seq);
  });

  it('allows a retry after materialization fails', async () => {
    const repo = await seed();
    vi.spyOn(repo.routines, 'list').mockRejectedValueOnce(new Error('read failed'));
    const failed = ensureRoutineInstances(repo, clock);
    const retry = ensureRoutineInstances(repo, clock);
    await expect(failed).rejects.toThrow('read failed');
    expect(await retry).toBe(28);
    expect(await repo.routineInstances.count()).toBe(28);
  });
});
