import { beforeEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  APP_SETTINGS_ID,
  AreaSchema,
  BlockSchema,
  CommitmentSchema,
  PersonSchema,
  ProjectSchema,
  TaskSchema,
  addDays,
  createRecord,
  defaultAppSettings,
  fixedClock,
  toLocalDate,
} from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import type { Repository } from '@orbit/storage';
import { useToastStore } from '@/components/ui/toastStore';
import { renderWithProviders } from '@/test/render';
import { InsightsPage } from './InsightsPage';

// Monday 14 Sep 2026, 10:00 local.
const NOW = new Date(2026, 8, 14, 10, 0, 0);
const TODAY = toLocalDate(NOW);
const WED = addDays(TODAY, 2);
const clock = fixedClock(NOW);
const DAY_MS = 86_400_000;

async function seed(options: { stale?: boolean; overload?: boolean; people?: boolean } = {}) {
  const repo = createMemoryRepository({ clock });
  const area = createRecord(AreaSchema, clock, { name: 'Study' });
  await repo.areas.upsert(area);
  let project = null;
  if (options.stale ?? true) {
    const old = fixedClock(new Date(NOW.getTime() - 12 * DAY_MS));
    project = createRecord(ProjectSchema, old, { title: 'Thesis', areaId: area.id });
    await repo.projects.upsert(project, { preserveUpdatedAt: true });
  }
  let block = null;
  if (options.overload ?? true) {
    const task = createRecord(TaskSchema, clock, {
      title: 'Big task',
      status: 'open',
      estimateMin: 60,
    });
    await repo.tasks.upsert(task);
    for (let i = 0; i < 5; i += 1) {
      const b = createRecord(BlockSchema, clock, {
        date: WED,
        startMin: 540,
        endMin: 660,
        taskId: task.id,
        source: 'manual',
      });
      await repo.blocks.upsert(b);
      block ??= b;
    }
  }
  if (options.people ?? true) {
    const sara = createRecord(PersonSchema, clock, { name: 'Sara' });
    await repo.people.upsert(sara);
    for (const text of ['Slides', 'Room', 'Reply']) {
      await repo.commitments.upsert(
        createRecord(CommitmentSchema, clock, { personId: sara.id, text }),
      );
    }
  }
  return { repo, project, block };
}

function render(repo: Repository, route = '/insights') {
  return renderWithProviders(<InsightsPage clock={clock} />, { repository: repo, route, clock });
}

describe('InsightsPage', () => {
  beforeEach(() => useToastStore.getState().clear());

  it('groups by severity in the engine order, shows thresholds, and opens evidence with working links', async () => {
    const user = userEvent.setup();
    const { repo, project, block } = await seed();
    render(repo);
    const cards = await screen.findAllByTestId('insight-card');
    expect(cards.map((c) => c.dataset.severity)).toEqual(['risk', 'attention', 'info']);
    expect(screen.getByRole('heading', { level: 2, name: /Risk \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Attention \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Info \(1\)/ })).toBeInTheDocument();

    const overload = cards[0]!;
    expect(overload).toHaveTextContent(
      'Wednesday has 600 minutes of committed work and 495 minutes of available work time.',
    );
    expect(within(overload).getByTestId('insight-threshold')).toHaveTextContent(
      `Threshold: 1.21× > 1.10× · ${WED}`,
    );
    await user.click(within(overload).getByRole('button', { name: /Evidence \(6\)/ }));
    const evidence = within(overload).getByRole('list', { name: 'Evidence, 6 rows' });
    expect(evidence).toHaveTextContent('Big task 09:00–11:00 · 120 min');
    expect(within(evidence).getAllByRole('link', { name: 'Open block' })[0]).toHaveAttribute(
      'href',
      `/timeline?date=${WED}&block=${block!.id}`,
    );
    expect(evidence).toHaveTextContent(
      'working window 09:00–18:00 (540 min), minus 45 min excluded = 495 min available',
    );
    expect(within(evidence).getByRole('link', { name: 'Open planning settings' })).toHaveAttribute(
      'href',
      '/settings#planning',
    );
    expect(overload).toHaveTextContent('Workload comparison only.');
    expect(within(overload).getAllByRole('link', { name: 'Open that day' })[0]).toHaveAttribute(
      'href',
      `/timeline?date=${WED}`,
    );

    const stale = cards[1]!;
    expect(stale).toHaveTextContent('Thesis has had no recorded activity for 12 days.');
    expect(within(stale).getByTestId('insight-threshold')).toHaveTextContent('12 days >= 10 days');
    expect(within(stale).getByRole('link', { name: 'Open project' })).toHaveAttribute(
      'href',
      `/projects/${project!.id}`,
    );

    const people = cards[2]!;
    await user.click(within(people).getByRole('button', { name: 'Preview person' }));
    const preview = await screen.findByTestId('search-preview');
    expect(preview).toHaveTextContent('Sara');
    expect(preview).toHaveTextContent('Open commitments');
  });

  it('snoozes a card away, lists it in history, restores it, and dismisses for good until restored', async () => {
    const user = userEvent.setup();
    const { repo } = await seed({ overload: false, people: false });
    render(repo);
    const card = await screen.findByTestId('insight-card');
    await user.click(within(card).getByRole('button', { name: /^Snooze:/ }));
    await user.click(await screen.findByRole('menuitem', { name: '1 week' }));
    await waitFor(() => expect(screen.queryByTestId('insight-card')).not.toBeInTheDocument());
    expect(screen.getByText('1 observation is snoozed or dismissed')).toBeInTheDocument();
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ title: 'Snoozed for a week' });
    const stored = await repo.insightStates.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      snoozeMode: 'time',
      snoozedUntil: new Date(NOW.getTime() + 7 * DAY_MS).toISOString(),
      lastSummary: {
        kind: 'stale-project',
        title: 'Thesis has had no recorded activity for 12 days.',
      },
    });

    const history = screen.getByTestId('insight-history');
    expect(history).toHaveTextContent('Snoozed until 2026-09-21 10:00');
    expect(history).toHaveTextContent('still applies today');
    await user.click(within(history).getByRole('button', { name: /^Restore:/ }));
    expect(await screen.findByTestId('insight-card')).toBeInTheDocument();
    expect(screen.getByText('No history')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Dismiss:/ }));
    await waitFor(() => expect(screen.queryByTestId('insight-card')).not.toBeInTheDocument());
    expect((await repo.insightStates.list())[0]).toMatchObject({
      dismissedAt: NOW.toISOString(),
      snoozeMode: null,
    });
    // Time and edits do not bring a dismissal back: a fresh mount hours later still hides it.
    clock.advance(30 * DAY_MS);
    render(repo);
    await screen.findAllByText('1 observation is snoozed or dismissed');
    clock.set(NOW);
  });

  it('a timed snooze lifts at the exact instant and the page recomputes on its own', async () => {
    const { repo } = await seed({ overload: false, people: false });
    render(repo);
    const user = userEvent.setup();
    const card = await screen.findByTestId('insight-card');
    await user.click(within(card).getByRole('button', { name: /^Snooze:/ }));
    await user.click(await screen.findByRole('menuitem', { name: '1 day' }));
    await waitFor(() => expect(screen.queryByTestId('insight-card')).not.toBeInTheDocument());
    // Just before expiry: still hidden after a refresh.
    clock.advance(DAY_MS - 1000);
    await user.click(screen.getByRole('button', { name: 'Refresh insights' }));
    await waitFor(() =>
      expect(screen.getByTestId('insights-status')).toHaveTextContent('Computed 2026-09-15 09:59'),
    );
    expect(screen.queryByTestId('insight-card')).not.toBeInTheDocument();
    // At expiry, a focus check (what a resumed machine looks like) brings it back without a write.
    clock.advance(1000);
    const seq = await repo.opLog.latestSeq();
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(await screen.findByTestId('insight-card')).toBeInTheDocument();
    expect(await repo.opLog.latestSeq()).toBe(seq);
    clock.set(NOW);
  });

  it('explains an empty result by coverage instead of claiming health, and names data that changed', async () => {
    const repo = createMemoryRepository({ clock });
    await repo.appSettings.upsert(defaultAppSettings(clock));
    expect((await repo.appSettings.get(APP_SETTINGS_ID))?.insights.staleProjectDays).toBe(10);
    render(repo);
    expect(await screen.findByText('No observations from the current data')).toBeInTheDocument();
    const coverage = screen.getByTestId('insights-coverage');
    expect(coverage).toHaveTextContent('Estimate bias needs 5 completed tasks');
    expect(coverage).toHaveTextContent('Weekly targets: no area has a weekly hours target yet.');
    expect(coverage).toHaveTextContent('Stale projects: there are no active projects.');
    expect(screen.queryByText(/healthy/i)).not.toBeInTheDocument();
  });

  it('focuses the card named in the URL and moves focus on after it is dismissed', async () => {
    const user = userEvent.setup();
    const { repo } = await seed();
    render(repo, `/insights?open=overloaded-day:${WED}`);
    const cards = await screen.findAllByTestId('insight-card');
    await waitFor(() => expect(cards[0]).toHaveFocus());
    // The named card starts with its evidence open.
    expect(within(cards[0]!).getByRole('button', { name: /Evidence/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await user.click(within(cards[0]!).getByRole('button', { name: /^Dismiss:/ }));
    await waitFor(() => expect(screen.getAllByTestId('insight-card')).toHaveLength(2));
    await waitFor(() => expect(screen.getAllByTestId('insight-card')[0]).toHaveFocus());
    expect(screen.getByRole('status', { name: '' })).toBeInTheDocument();
  });
});
