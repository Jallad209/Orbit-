import { describe, expect, it } from 'vitest';
import { fixedClock, parseCapture } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { convertCapture, saveCapture, undoCaptureConversion } from './inboxService';

const clock = fixedClock(new Date(2026, 8, 12, 9, 0, 0));

describe('inbox conversion', () => {
  it('is idempotent when the same capture is accepted concurrently', async () => {
    const repo = createMemoryRepository({ clock });
    const capture = await saveCapture(
      repo,
      parseCapture('Submit quarterly report', { now: clock.now() }),
      clock,
    );

    const results = await Promise.all(
      Array.from({ length: 6 }, () => convertCapture(repo, capture, {}, clock)),
    );

    expect(await repo.tasks.count()).toBe(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
  });

  it('undo restores the capture and removes records created by conversion', async () => {
    const repo = createMemoryRepository({ clock });
    const capture = await saveCapture(
      repo,
      parseCapture('c: Call @Sarah tomorrow', { now: clock.now() }),
      clock,
    );
    const conversion = await convertCapture(repo, capture, {}, clock);

    expect(await repo.commitments.count()).toBe(1);
    expect(await repo.people.count()).toBe(1);
    await undoCaptureConversion(repo, capture.id, conversion);

    expect((await repo.captures.get(capture.id))?.status).toBe('inbox');
    expect(await repo.commitments.count()).toBe(0);
    expect(await repo.people.count()).toBe(0);
  });
});
