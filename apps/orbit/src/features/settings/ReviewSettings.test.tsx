import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fixedClock } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { readSettings } from './settingsService';
import { ReviewSettings } from './ReviewSettings';

const clock = fixedClock('2026-09-17T08:00:00.000Z');

describe('ReviewSettings', () => {
  it('persists question order, enabled questions, and capture templates', async () => {
    const user = userEvent.setup();
    const repo = createMemoryRepository({ clock });
    renderWithProviders(<ReviewSettings clock={clock} />, { repository: repo });

    const settings = await screen.findByTestId('review-settings');
    expect(settings).toHaveTextContent('Stored locally');
    await user.click(within(settings).getByRole('button', { name: 'Move Bills up' }));
    await user.click(within(settings).getByRole('checkbox', { name: 'People' }));
    await user.click(within(settings).getByRole('button', { name: 'Save question order' }));

    await user.type(within(settings).getByLabelText('Template name'), 'Thesis sprint');
    await user.type(within(settings).getByLabelText('Prefilled name'), 'Finish chapter');
    await user.click(within(settings).getByRole('button', { name: 'Add' }));

    await waitFor(async () => {
      const stored = await readSettings(repo, clock);
      expect(stored.reviews.questionOrder).toEqual(['bill', 'project', 'person']);
      expect(stored.reviews.enabledQuestions).toEqual(['project', 'bill']);
      expect(stored.reviews.templates).toEqual([
        expect.objectContaining({
          kind: 'project',
          name: 'Thesis sprint',
          values: { title: 'Finish chapter' },
        }),
      ]);
    });
  });
});
