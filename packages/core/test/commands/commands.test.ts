import { describe, expect, it, vi } from 'vitest';
import { fixedClock } from '../../src/clock';
import {
  addTask,
  coreCommands,
  createCommandRegistry,
  openProject,
  rescheduleUnfinished,
} from '../../src/commands';
import type { CommandContext, CommandNotice } from '../../src/commands';
import { createRecord } from '../../src/records';
import { DayCommitmentSchema, ProjectSchema, RuleSchema, TaskSchema } from '../../src/schema';
import { anArea, testClock } from '../builders';
import { fakeRepository } from './fakeRepository';

// Monday 14 Sep 2026, 18:00 local: the end of a working day.
const NOW = new Date(2026, 8, 14, 18, 0, 0);

function context(overrides: Partial<CommandContext> = {}) {
  const clock = fixedClock(NOW);
  const repo = fakeRepository(clock);
  const navigate = vi.fn<(path: string) => void>();
  const notices: CommandNotice[] = [];
  const ctx: CommandContext = {
    repo,
    clock,
    navigate,
    notify: (n) => notices.push(n),
    capabilities: { insights: false, weeklyReview: false },
    settings: { defaultEstimateMin: 45 },
    names: { people: ['Omar'], projects: ['Thesis'] },
    ...overrides,
  };
  return {
    ctx,
    repo,
    clock,
    navigate,
    notices,
    registry: createCommandRegistry({ commands: coreCommands() }),
  };
}

describe('command registry', () => {
  it('lists every core command, hiding undo until something can be undone', () => {
    const { ctx, registry } = context();
    const ids = registry.list().map((c) => c.id);
    expect(ids).toEqual([
      'add-task',
      'add-note',
      'add-event',
      'plan-my-day',
      'regenerate-plan',
      'reschedule-unfinished',
      'show-neglected-goals',
      'open-insights',
      'review-this-week',
      'open-project',
      'undo',
    ]);
    expect(registry.list(ctx).map((c) => c.id)).not.toContain('undo');
  });

  it('rejects bad arguments with a message and writes nothing', async () => {
    const { ctx, repo, registry } = context();
    const result = await registry.run('add-task', ctx, { text: '   ' });
    expect(result).toEqual({
      ok: false,
      kind: 'invalid',
      errors: { text: 'Type something first.' },
      message: 'Type something first.',
    });
    expect(await repo.tasks.list()).toEqual([]);
    expect(repo.ops()).toEqual([]);

    const badId = await registry.run('open-project', ctx, { projectId: 'not-a-uuid' });
    expect(badId).toMatchObject({
      ok: false,
      kind: 'invalid',
      errors: { projectId: 'must be a UUID' },
    });
    expect(registry.validate(openProject, {})).toMatchObject({
      ok: false,
      errors: { projectId: 'Required' },
    });
    expect(registry.validate(addTask, { text: 'x'.repeat(501) })).toMatchObject({
      ok: false,
      message: 'Keep it under 500 characters.',
    });
  });

  it('reports unknown and unavailable commands as failures, not crashes', async () => {
    const { ctx, registry } = context();
    expect(await registry.run('nope', ctx)).toEqual({
      ok: false,
      kind: 'failed',
      message: 'Unknown command "nope".',
    });
    expect(await registry.run('undo', ctx)).toMatchObject({ ok: false, kind: 'failed' });
  });

  it('turns a thrown error into a failed result', async () => {
    const { ctx, registry } = context();
    registry.register({
      id: 'explode',
      title: 'Explode',
      keywords: [],
      group: 'Orbit',
      run: async () => {
        throw new Error('boom');
      },
    });
    expect(await registry.run('explode', ctx)).toEqual({
      ok: false,
      kind: 'failed',
      message: 'boom',
    });
  });
});

describe('add task / note / event', () => {
  it('adds a task through the capture parser, with the saved default estimate, and records undo', async () => {
    const { ctx, repo, registry } = context();
    const result = await registry.run('add-task', ctx, {
      text: 'Submit report next Friday #thesis',
    });
    expect(result).toMatchObject({ ok: true, outcome: { message: 'Added task' } });
    const [task] = await repo.tasks.list();
    expect(task).toMatchObject({ status: 'open', estimateMin: 45 });
    expect(task!.title).toMatch(/^Submit report/u);
    expect(task!.dueAt).not.toBeNull();
    expect(registry.undo.size).toBe(1);
    expect(registry.undo.peek()).toMatchObject({
      commandId: 'add-task',
      title: 'Add task',
      changes: [{ entity: 'task', entityId: task!.id, before: null }],
    });
  });

  it('forces the type even when the text reads like something else', async () => {
    const { ctx, repo, registry } = context();
    await registry.run('add-note', ctx, { text: 'Pay rent $900 every month' });
    expect((await repo.notes.list()).map((n) => n.title)[0]).toMatch(/^Pay rent/u);
    expect(await repo.bills.list()).toEqual([]);

    await registry.run('add-event', ctx, { text: 'Dentist tomorrow at 3pm' });
    const [event] = await repo.events.list();
    expect(event?.title).toBe('Dentist');
    expect(event?.startAt).toBe(new Date(2026, 8, 15, 15, 0).toISOString());
  });
});

describe('navigation commands', () => {
  it('opens a project that exists, and says so when it does not', async () => {
    const { ctx, repo, navigate, registry } = context();
    const area = anArea({}, testClock());
    const project = createRecord(ProjectSchema, testClock(), { title: 'Thesis', areaId: area.id });
    await repo.areas.upsert(area);
    await repo.projects.upsert(project);
    const choices =
      (await openProject.prompt!.kind) === 'choice'
        ? await (
            openProject.prompt as { choices: (c: CommandContext) => Promise<unknown[]> }
          ).choices(ctx)
        : [];
    expect(choices).toEqual([{ value: project.id, label: 'Thesis', hint: 'active' }]);

    await registry.run('open-project', ctx, { projectId: project.id });
    expect(navigate).toHaveBeenCalledWith(`/projects/${project.id}`);
    const gone = await registry.run('open-project', ctx, {
      projectId: '00000000-0000-7000-8000-000000000000',
    });
    expect(gone).toMatchObject({
      ok: true,
      outcome: { message: 'That project no longer exists.' },
    });
  });

  it('routes plan, regenerate, goals, and the weekly review honestly by capability', async () => {
    const { ctx, navigate, notices, registry } = context();
    await registry.run('plan-my-day', ctx);
    await registry.run('regenerate-plan', ctx);
    await registry.run('show-neglected-goals', ctx);
    await registry.run('review-this-week', ctx);
    // Without the capability the command explains and stays put (week 12: it only navigates
    // where the screen exists).
    expect(navigate.mock.calls.map((c) => c[0])).toEqual([
      '/today',
      '/today?regenerate=1',
      '/goals?filter=neglected',
    ]);
    expect(notices).toEqual([
      expect.objectContaining({ title: 'The weekly review is not available here' }),
    ]);

    // "Open insights" exists only once the capability is on; neglected goals stay on /goals.
    expect(registry.list(ctx).map((c) => c.id)).not.toContain('open-insights');
    const later = context({ capabilities: { insights: true, weeklyReview: true } });
    await later.registry.run('show-neglected-goals', later.ctx);
    await later.registry.run('open-insights', later.ctx);
    await later.registry.run('review-this-week', later.ctx);
    expect(later.navigate.mock.calls.map((c) => c[0])).toEqual([
      '/goals?filter=neglected',
      '/insights',
      '/review/weekly',
    ]);
    expect(later.notices).toEqual([]);
  });
});

describe('reschedule unfinished work', () => {
  async function committedDay(ctx: CommandContext) {
    const clock = testClock(NOW);
    const p1 = createRecord(TaskSchema, clock, { title: 'Urgent', status: 'open', priority: 1 });
    const p3 = createRecord(TaskSchema, clock, { title: 'Later', status: 'open', priority: 3 });
    const done = createRecord(TaskSchema, clock, { title: 'Done', status: 'done' });
    for (const t of [p1, p3, done]) await ctx.repo.tasks.upsert(t);
    await ctx.repo.dayCommitments.upsert(
      createRecord(DayCommitmentSchema, clock, {
        date: '2026-09-14',
        acceptedTaskIds: [p1.id, p3.id, done.id],
        acceptedAt: clock.now().toISOString(),
      }),
    );
    return { p1, p3, done };
  }

  it('previews the move, applies the rollover rule per priority, and records undo', async () => {
    const { ctx, repo, registry } = context();
    const { p1, p3 } = await committedDay(ctx);
    expect(await rescheduleUnfinished.preview!(ctx, { target: 'rule' })).toBe(
      '2 tasks move: 1 to tomorrow (2026-09-15), 1 to next Monday (2026-09-21).',
    );
    const result = await registry.run('reschedule-unfinished', ctx, {});
    expect(result).toMatchObject({ ok: true, outcome: { message: 'Moved 2 tasks' } });
    expect((await repo.tasks.get(p1.id))!.dueAt!.slice(0, 10)).toBe('2026-09-15');
    expect((await repo.tasks.get(p3.id))!.dueAt!.slice(0, 10)).toBe('2026-09-21');
    expect(
      registry.undo
        .peek()!
        .changes.map((c) => c.entityId)
        .sort(),
    ).toEqual([p1.id, p3.id].sort());
  });

  it('honours an explicit target and a custom rollover rule', async () => {
    const { ctx, repo, registry } = context();
    const { p1, p3 } = await committedDay(ctx);
    await repo.rules.upsert(
      createRecord(RuleSchema, testClock(), {
        type: 'rollover',
        config: { p1: 'inbox', p2: 'tomorrow', p3: 'inbox' },
      }),
    );
    expect(await rescheduleUnfinished.preview!(ctx, { target: 'rule' })).toBe(
      '2 tasks move: 2 to the inbox.',
    );
    await registry.run('reschedule-unfinished', ctx, { target: 'nextWeek' });
    for (const id of [p1.id, p3.id]) {
      expect((await repo.tasks.get(id))!.dueAt!.slice(0, 10)).toBe('2026-09-21');
    }
    await registry
      .run('reschedule-unfinished', ctx, { target: 'bogus' })
      .then((r) => expect(r).toMatchObject({ ok: false, kind: 'invalid' }));
  });

  it('does nothing when the day is done', async () => {
    const { ctx, registry } = context();
    expect(await rescheduleUnfinished.preview!(ctx, { target: 'rule' })).toBe(
      'Nothing is unfinished on today’s commitment.',
    );
    const result = await registry.run('reschedule-unfinished', ctx, {});
    expect(result).toMatchObject({ ok: true, outcome: { message: 'Nothing to reschedule' } });
    expect(registry.undo.size).toBe(0);
  });
});
