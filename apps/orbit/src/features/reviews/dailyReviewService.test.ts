import { describe, expect, it } from 'vitest';
import { ReminderSchema, createRecord, fixedClock } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import {
  clearDailyReviewDraft,
  loadDailyReflectionDraft,
  loadDailyReviewDraft,
  saveDailyReflection,
  saveDailyReviewDraft,
} from './dailyReviewService';

const clock = fixedClock('2026-09-17T08:00:00.000Z');

describe('daily review persistence', () => {
  it('restores the exact morning state and clears its direct reminders only after completion', async () => {
    const repo = createMemoryRepository({ clock });
    const draft = await saveDailyReviewDraft(
      repo,
      '2026-09-17',
      'morning',
      {
        step: 'bill',
        formState: { title: 'Electricity' },
        createdRefs: [],
        deferredQuestions: ['bill'],
        reminderTime: 900,
      },
      clock,
    );
    await repo.reminders.upsert(
      createRecord(ReminderSchema, clock, {
        key: 'review-step:2026-09-17:bill',
        ruleId: null,
        source: 'review-step',
        entityType: 'dailyReviewDraft',
        entityId: draft.id,
        destination: '/review/morning?date=2026-09-17&step=bill',
        fireAt: '2026-09-17T12:00:00.000Z',
        title: 'Continue',
        status: 'pending',
      }),
    );
    expect(await loadDailyReviewDraft(repo, '2026-09-17', 'morning')).toMatchObject({
      step: 'bill',
      formState: { title: 'Electricity' },
    });
    await clearDailyReviewDraft(repo, '2026-09-17', 'morning');
    expect(await loadDailyReviewDraft(repo, '2026-09-17', 'morning')).toBeNull();
    expect(await repo.reminders.list()).toHaveLength(0);
  });

  it('creates one reflection per date and updates its journal note without parsing prose', async () => {
    const repo = createMemoryRepository({ clock });
    const first = await saveDailyReflection(
      repo,
      '2026-09-17',
      {
        body: 'A private entry',
        promptId: 'win',
        mood: 4,
        stress: 2,
        sleepQuality: 5,
        tags: ['family'],
      },
      clock,
    );
    const second = await saveDailyReflection(
      repo,
      '2026-09-17',
      {
        body: 'Updated private entry',
        promptId: 'free-write',
        mood: 3,
        stress: null,
        sleepQuality: 4,
        tags: ['rest'],
      },
      clock,
    );
    expect(second.id).toBe(first.id);
    expect(second.journalNoteId).toBe(first.journalNoteId);
    expect(await repo.dailyReflections.count()).toBe(1);
    expect(await repo.notes.count()).toBe(1);
    expect(await loadDailyReflectionDraft(repo, '2026-09-17')).toEqual({
      body: 'Updated private entry',
      promptId: 'free-write',
      mood: 3,
      stress: null,
      sleepQuality: 4,
      tags: ['rest'],
    });
  });
});
