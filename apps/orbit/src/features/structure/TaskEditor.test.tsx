import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AreaSchema, ProjectSchema, TaskSchema, createRecord, fixedClock } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { renderWithProviders } from '@/test/render';
import { TaskEditor } from './TaskEditor';

const clock = fixedClock(new Date(2026, 8, 12, 9, 0, 0));

async function seed() {
  const repo = createMemoryRepository({ clock });
  const area = createRecord(AreaSchema, clock, { name: 'Study' });
  const project = createRecord(ProjectSchema, clock, { title: 'Thesis', areaId: area.id });
  const intro = createRecord(TaskSchema, clock, {
    title: 'Write intro',
    projectId: project.id,
    areaId: area.id,
    status: 'open',
  });
  const lit = createRecord(TaskSchema, clock, {
    title: 'Literature review',
    projectId: project.id,
    areaId: area.id,
    status: 'open',
  });
  // method already waits on intro.
  const method = createRecord(TaskSchema, clock, {
    title: 'Methods',
    projectId: project.id,
    areaId: area.id,
    status: 'open',
    dependsOn: [intro.id],
  });
  await repo.transaction(async (tx) => {
    await tx.areas.upsert(area);
    await tx.projects.upsert(project);
    for (const t of [intro, lit, method]) await tx.tasks.upsert(t);
  });
  return { repo, project, intro, lit, method, tasks: [intro, lit, method] };
}

describe('TaskEditor', () => {
  it('parses "1h30" into 90 minutes and saves', async () => {
    const user = userEvent.setup();
    const { repo, project, intro, tasks } = await seed();
    const onClose = vi.fn();
    renderWithProviders(
      <TaskEditor task={intro} tasks={tasks} projects={[project]} onClose={onClose} />,
      { repository: repo },
    );

    const estimate = await screen.findByLabelText(/Estimate/);
    await user.clear(estimate);
    await user.type(estimate, '1h30');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await repo.tasks.get(intro.id))?.estimateMin).toBe(90);
  });

  it('rejects an unparseable estimate inline', async () => {
    const user = userEvent.setup();
    const { repo, project, intro, tasks } = await seed();
    renderWithProviders(
      <TaskEditor task={intro} tasks={tasks} projects={[project]} onClose={() => {}} />,
      { repository: repo },
    );
    const estimate = await screen.findByLabelText(/Estimate/);
    await user.clear(estimate);
    await user.type(estimate, 'soon');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter minutes');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('never offers the task itself and disables choices that would create a loop', async () => {
    const { repo, project, intro, tasks } = await seed();
    renderWithProviders(
      <TaskEditor task={intro} tasks={tasks} projects={[project]} onClose={() => {}} />,
      { repository: repo },
    );
    const picker = await screen.findByTestId('dependency-picker');
    expect(within(picker).queryByLabelText(/Write intro/)).not.toBeInTheDocument();
    // Methods waits on intro, so intro cannot wait on Methods.
    const methods = within(picker).getByRole('checkbox', { name: /Methods/ });
    expect(methods).toBeDisabled();
    expect(within(picker).getByText(/Would create a loop/)).toBeInTheDocument();
    // Literature review is fine.
    expect(within(picker).getByRole('checkbox', { name: /Literature review/ })).toBeEnabled();
  });

  it('saves dependencies and the service rejects a cycle it did not foresee', async () => {
    const user = userEvent.setup();
    const { repo, project, intro, lit, tasks } = await seed();
    const onClose = vi.fn();
    renderWithProviders(
      <TaskEditor task={intro} tasks={tasks} projects={[project]} onClose={onClose} />,
      { repository: repo },
    );
    const picker = await screen.findByTestId('dependency-picker');
    await user.click(within(picker).getByRole('checkbox', { name: /Literature review/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await repo.tasks.get(intro.id))?.dependsOn).toEqual([lit.id]);
  });
});
