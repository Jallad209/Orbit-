import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { APP_SETTINGS_ID, DEFAULT_INSIGHT_SETTINGS, fixedClock } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { useToastStore } from '@/components/ui/toastStore';
import { usePlanPrefs } from '@/features/today/planSettings';
import { renderWithProviders } from '@/test/render';
import { InsightSettings } from './InsightSettings';
import { loadSettings, readSettings, saveSettings } from './settingsService';

const clock = fixedClock(new Date(2026, 8, 14, 9, 0, 0));

describe('insight settings', () => {
  beforeEach(() => {
    usePlanPrefs.setState({ insights: DEFAULT_INSIGHT_SETTINGS, hydrated: false });
    useToastStore.getState().clear();
    localStorage.clear();
  });

  it('rejects an out-of-bounds threshold visibly and saves a valid one without touching planning', async () => {
    const user = userEvent.setup();
    const repo = createMemoryRepository({ clock });
    await saveSettings(repo, { workingWindow: { startMin: 480, endMin: 960 } }, clock);
    renderWithProviders(<InsightSettings clock={clock} />, { repository: repo, insights: false });
    const stale = screen.getByLabelText(/Stale project after/);
    await user.clear(stale);
    await user.type(stale, '0');
    await user.click(screen.getByRole('button', { name: 'Save insight settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Use a whole number between 1 and 90.',
    );
    expect((await readSettings(repo)).insights.staleProjectDays).toBe(10);

    await user.clear(stale);
    await user.type(stale, '14');
    const ratio = screen.getByLabelText(/Estimate ratio threshold/);
    await user.clear(ratio);
    await user.type(ratio, '1.5');
    await user.click(screen.getByRole('button', { name: 'Save insight settings' }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.at(-1)?.title).toBe('Insight settings saved'),
    );
    const saved = await readSettings(repo);
    expect(saved.insights).toEqual({
      ...DEFAULT_INSIGHT_SETTINGS,
      staleProjectDays: 14,
      estimateRatioThreshold: 1.5,
    });
    expect(saved.workingWindow).toEqual({ startMin: 480, endMin: 960 });
    expect(usePlanPrefs.getState().insights.staleProjectDays).toBe(14);

    // Restore defaults touches only the insight group.
    await user.click(screen.getByRole('button', { name: 'Restore defaults' }));
    await waitFor(async () =>
      expect((await readSettings(repo)).insights).toEqual(DEFAULT_INSIGHT_SETTINGS),
    );
    expect((await readSettings(repo)).workingWindow).toEqual({ startMin: 480, endMin: 960 });
    expect(screen.getByRole('button', { name: 'Restore defaults' })).toBeDisabled();
  });

  it('merges a patch into a fresh copy, so a stale form cannot overwrite another window’s change', async () => {
    const repo = createMemoryRepository({ clock });
    await loadSettings(repo, clock);
    // Window B changes the working window and a threshold…
    await saveSettings(
      repo,
      { workingWindow: { startMin: 420, endMin: 900 }, insights: { personCommitmentCount: 5 } },
      clock,
    );
    // …while window A, holding an older draft, saves one other threshold.
    const stored = await saveSettings(repo, { insights: { staleProjectDays: 20 } }, clock);
    expect(stored.workingWindow).toEqual({ startMin: 420, endMin: 900 });
    expect(stored.insights).toEqual({
      ...DEFAULT_INSIGHT_SETTINGS,
      personCommitmentCount: 5,
      staleProjectDays: 20,
    });
    expect((await repo.appSettings.get(APP_SETTINGS_ID))?.insights.personCommitmentCount).toBe(5);
    await expect(
      saveSettings(repo, { insights: { dayOverloadRatio: 9 } }, clock),
    ).rejects.toThrow();
    expect((await readSettings(repo)).insights.dayOverloadRatio).toBe(1.1);
  });

  it('re-keys the form after an import replaces the document', async () => {
    const repo = createMemoryRepository({ clock });
    await loadSettings(repo, clock);
    renderWithProviders(<InsightSettings clock={clock} />, { repository: repo, insights: false });
    expect(screen.getByLabelText(/Stale project after/)).toHaveValue(10);
    await saveSettings(repo, { insights: { staleProjectDays: 30 } }, clock);
    await waitFor(() => expect(screen.getByLabelText(/Stale project after/)).toHaveValue(30));
    const form = screen.getByRole('form', { name: 'Insight settings' });
    expect(within(form).getByText(/Default 10, between 1 and 90/)).toBeInTheDocument();
  });
});
