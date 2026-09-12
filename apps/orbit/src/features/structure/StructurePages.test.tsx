import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AreaSchema, GoalSchema, ProjectSchema, createRecord, fixedClock } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { useToastStore } from '@/components/ui/toastStore';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/render';

const clock = fixedClock(new Date(2026, 8, 12, 9, 0, 0));

describe('Areas → Goals → Projects', () => {
  it('creates an area, a goal in it, and a project under the goal', async () => {
    const user = userEvent.setup();
    const repo = createMemoryRepository({ clock });
    renderWithProviders(<AppRoutes />, { repository: repo, route: '/areas' });

    await user.type(await screen.findByRole('textbox', { name: 'Area name' }), 'Health{Enter}');
    expect(await screen.findByRole('button', { name: /Area name Health/ })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /^Goals/ }));
    await user.type(
      await screen.findByRole('textbox', { name: 'Goal title' }),
      'Run a half marathon{Enter}',
    );
    const goalLink = await screen.findByRole('link', { name: /Run a half marathon/ });
    expect(within(goalLink).getByText('Neglected')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /^Projects/ }));
    await user.type(await screen.findByRole('textbox', { name: 'Project title' }), 'Training plan');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Goal' }),
      (await repo.goals.list())[0]!.id,
    );
    await user.click(screen.getByRole('button', { name: 'Add project' }));

    const row = await screen.findByRole('link', { name: /Training plan/ });
    expect(row).toHaveTextContent('Health › Run a half marathon');
    expect(within(row).getByText('No next action')).toBeInTheDocument();
    expect(await repo.projects.count()).toBe(1);
  });

  it('refuses to delete an area that still has projects', async () => {
    const user = userEvent.setup();
    const repo = createMemoryRepository({ clock });
    const area = createRecord(AreaSchema, clock, { name: 'Study' });
    await repo.areas.upsert(area);
    await repo.projects.upsert(
      createRecord(ProjectSchema, clock, { title: 'Thesis', areaId: area.id }),
    );
    renderWithProviders(<AppRoutes />, { repository: repo, route: '/areas' });
    await user.click(await screen.findByRole('button', { name: 'Delete Study' }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.title)).toContain('Area is not empty'),
    );
    expect(await repo.areas.count()).toBe(1);
  });

  it('goal detail edits importance and lists its projects', async () => {
    const user = userEvent.setup();
    const repo = createMemoryRepository({ clock });
    const area = createRecord(AreaSchema, clock, { name: 'Study' });
    const goal = createRecord(GoalSchema, clock, {
      title: 'Graduate',
      areaId: area.id,
      importance: 3,
    });
    await repo.areas.upsert(area);
    await repo.goals.upsert(goal);
    await repo.projects.upsert(
      createRecord(ProjectSchema, clock, { title: 'Thesis', areaId: area.id, goalId: goal.id }),
    );
    renderWithProviders(<AppRoutes />, { repository: repo, route: `/goals/${goal.id}` });
    await user.selectOptions(await screen.findByLabelText('Importance'), '5');
    await waitFor(async () => expect((await repo.goals.get(goal.id))?.importance).toBe(5));
    expect(screen.getByRole('link', { name: /Thesis/ })).toBeInTheDocument();
  });
});
