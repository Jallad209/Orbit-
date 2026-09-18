import { screen, within } from '@testing-library/react';
import {
  DailyReflectionSchema,
  DayCommitmentSchema,
  NoteSchema,
  PersonSchema,
  createRecord,
  fixedClock,
  newWeeklyReview,
} from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { ReviewDashboard } from './ReviewDashboard';

const clock = fixedClock('2026-09-17T08:00:00.000Z');

describe('ReviewDashboard', () => {
  it('shows daily completion, follow-ups, journal links, and completed weekly history', async () => {
    const repo = createMemoryRepository({ clock });
    const note = createRecord(NoteSchema, clock, { title: 'Daily journal', body: 'Private' });
    const commitment = createRecord(DayCommitmentSchema, clock, {
      date: '2026-09-16',
      acceptedTaskIds: [],
      energy: 'medium',
      acceptedAt: '2026-09-16T06:00:00.000Z',
    });
    const reflection = createRecord(DailyReflectionSchema, clock, {
      date: '2026-09-16',
      journalNoteId: note.id,
      mood: 4,
      stress: 2,
      sleepQuality: 3,
      tags: ['focus'],
      completedAt: '2026-09-16T18:00:00.000Z',
    });
    const person = createRecord(PersonSchema, clock, {
      name: 'Omar',
      followUpDate: '2026-09-18',
      followUpTime: 9 * 60 + 30,
    });
    const openReview = newWeeklyReview(clock, '2026-09-17');
    const completedReview = {
      ...newWeeklyReview(clock, '2026-09-10'),
      status: 'completed' as const,
      completedAt: '2026-09-10T18:00:00.000Z',
      summary: {
        version: 1 as const,
        reviewWeekStart: '2026-09-07',
        targetWeekStart: '2026-09-14',
        computedAt: '2026-09-10T18:00:00.000Z',
        steps: [],
        actionCount: 2,
        items: [],
        capacity: null,
      },
    };
    await repo.transaction(async (tx) => {
      await tx.notes.upsert(note);
      await tx.dayCommitments.upsert(commitment);
      await tx.dailyReflections.upsert(reflection);
      await tx.people.upsert(person);
      await tx.weeklyReviews.upsert(openReview);
      await tx.weeklyReviews.upsert(completedReview);
    });

    renderWithProviders(<ReviewDashboard clock={clock} />, { repository: repo, route: '/review' });

    const dashboard = await screen.findByTestId('review-dashboard');
    const rhythm = within(dashboard).getByRole('list', { name: 'Daily review completion' });
    expect(rhythm).toHaveTextContent('2026-09-16');
    expect(rhythm).toHaveTextContent('Morning done');
    expect(rhythm).toHaveTextContent('Evening done');
    expect(within(dashboard).getByRole('link', { name: 'Omar' })).toHaveAttribute(
      'href',
      `/people/${person.id}`,
    );
    expect(within(dashboard).getByText('2026-09-18 · 09:30')).toBeInTheDocument();
    expect(within(dashboard).getByRole('link', { name: 'Open entry' })).toHaveAttribute(
      'href',
      `/notes/${note.id}`,
    );
    expect(within(dashboard).getByText('focus')).toBeInTheDocument();
    const history = within(dashboard).getByRole('link', { name: 'Week of 2026-09-07' });
    expect(history).toHaveAttribute('href', `/review/weekly?review=${completedReview.id}`);
    expect(within(dashboard).getByText('2 actions')).toBeInTheDocument();
    expect(within(dashboard).queryByText(`Week of ${openReview.reviewWeekStart}`)).toBeNull();
  });
});
