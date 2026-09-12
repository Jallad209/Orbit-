import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AreaSchema,
  MilestoneSchema,
  NoteSchema,
  ProjectSchema,
  TaskSchema,
  createRecord,
  fixedClock,
} from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { Route, Routes } from 'react-router';
import { renderWithProviders } from '@/test/render';
import { ProjectPage } from './ProjectPage';

const clock = fixedClock(new Date(2026, 8, 12, 9, 0, 0));

async function seed() {
  const repo = createMemoryRepository({ clock });
  const area = createRecord(AreaSchema, clock, { name: 'Study' });
  const project = createRecord(ProjectSchema, clock, { title: 'Thesis', areaId: area.id });
  const ms = ['Outline', 'Draft', 'Revise', 'Submit'].map((title, i) =>
    createRecord(MilestoneSchema, clock, { projectId: project.id, title, order: i, done: i < 2 }),
  );
  const t1 = createRecord(TaskSchema, clock, {
    title: 'Write intro',
    projectId: project.id,
    areaId: area.id,
    status: 'open',
  });
  const t2 = createRecord(TaskSchema, clock, {
    title: 'Literature review',
    projectId: project.id,
    areaId: area.id,
    status: 'open',
  });
  const note = createRecord(NoteSchema, clock, { title: 'Sources' });
  await repo.transaction(async (tx) => {
    await tx.areas.upsert(area);
    await tx.projects.upsert(project);
    for (const m of ms) await tx.milestones.upsert(m);
    await tx.tasks.upsert(t1);
    await tx.tasks.upsert(t2);
    await tx.notes.upsert(note);
  });
  return { repo, area, project, ms, t1, t2, note };
}

function render(repo: Awaited<ReturnType<typeof seed>>['repo'], id: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:id" element={<ProjectPage clock={clock} />} />
    </Routes>,
    { repository: repo, route: `/projects/${id}` },
  );
}

describe('ProjectPage', () => {
  it('shows progress from milestones (2/4 → 50%) and updates when one is toggled', async () => {
    const user = userEvent.setup();
    const { repo, project } = await seed();
    render(repo, project.id);
    expect(await screen.findByTestId('progress-label')).toHaveTextContent('50%');
    expect(screen.getByRole('progressbar', { name: 'Project progress' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );

    await user.click(screen.getByRole('checkbox', { name: 'Revise done' }));
    await waitFor(() => expect(screen.getByTestId('progress-label')).toHaveTextContent('75%'));
  });

  it('flags a project with no next action and clears the flag once one is chosen', async () => {
    const user = userEvent.setup();
    const { repo, project, t1 } = await seed();
    render(repo, project.id);
    const badges = await screen.findByTestId('health-badges');
    expect(within(badges).getByText('No next action')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Next action'), t1.id);
    await waitFor(() => expect(screen.queryByText('No next action')).not.toBeInTheDocument());
    expect((await repo.projects.get(project.id))?.nextActionTaskId).toBe(t1.id);
    expect(screen.getByText('Next')).toBeInTheDocument();
  });

  it('adds a milestone and a task from the inline forms', async () => {
    const user = userEvent.setup();
    const { repo, project } = await seed();
    render(repo, project.id);
    await screen.findByTestId('progress-label');
    await user.type(screen.getByRole('textbox', { name: 'Milestone title' }), 'Defend{Enter}');
    await waitFor(async () => expect(await repo.milestones.count()).toBe(5));
    await user.type(screen.getByRole('textbox', { name: 'Task title' }), 'Book the room{Enter}');
    await waitFor(async () => expect(await repo.tasks.count()).toBe(3));
    const list = screen.getByRole('listbox', { name: 'Project tasks' });
    expect(await within(list).findByRole('option', { name: /Book the room/ })).toBeInTheDocument();
  });

  it('links a note through the picker, filtered by type', async () => {
    const user = userEvent.setup();
    const { repo, project, note } = await seed();
    render(repo, project.id);
    await screen.findByTestId('progress-label');
    await user.click(screen.getByRole('button', { name: 'Link…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Link to' });
    await user.click(within(dialog).getByRole('tab', { name: 'Notes' }));
    const candidates = within(dialog).getByRole('list', { name: 'Candidates' });
    expect(within(candidates).getAllByRole('button')).toHaveLength(1);
    await user.click(within(candidates).getByRole('button', { name: /Sources/ }));

    await waitFor(async () => expect(await repo.links.count()).toBe(1));
    const linked = await screen.findByRole('list', { name: 'Linked notes' });
    expect(within(linked).getByText('Sources')).toBeInTheDocument();
    const link = (await repo.links.list())[0]!;
    expect([link.fromId, link.toId].sort()).toEqual([note.id, project.id].sort());
  });
});
