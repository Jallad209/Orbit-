import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AreaSchema,
  BlockSchema,
  ProjectSchema,
  TaskSchema,
  createRecord,
  fixedClock,
} from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { useToastStore } from '@/components/ui/toastStore';
import { renderWithProviders } from '@/test/render';
import { usePlanPrefs } from '@/features/today/planSettings';
import { TimelinePage } from './TimelinePage';
import { dropTask, loadDay } from './timelineService';

// Monday 14 Sep 2026 at 11:00: the morning has passed.
const clock = fixedClock(new Date(2026, 8, 14, 11, 0, 0));
const DATE = '2026-09-14';

async function seed() {
  const repo = createMemoryRepository({ clock });
  const area = createRecord(AreaSchema, clock, { name: 'Study' });
  const project = createRecord(ProjectSchema, clock, { title: 'Thesis', areaId: area.id });
  const mk = (title: string, estimateMin = 30) =>
    createRecord(TaskSchema, clock, {
      title,
      projectId: project.id,
      areaId: area.id,
      status: 'open',
      estimateMin,
    });
  const intro = mk('Write intro');
  const lit = mk('Literature review', 60);
  const cards = mk('Make flash cards');
  const email = mk('Email the supervisor', 20);
  const past = createRecord(BlockSchema, clock, {
    date: DATE,
    startMin: 540,
    endMin: 600,
    taskId: intro.id,
    source: 'planner',
  });
  const locked = createRecord(BlockSchema, clock, {
    date: DATE,
    startMin: 780,
    endMin: 840,
    taskId: lit.id,
    locked: true,
    source: 'planner',
  });
  const manual = createRecord(BlockSchema, clock, {
    date: DATE,
    startMin: 900,
    endMin: 930,
    taskId: cards.id,
    source: 'manual',
  });
  await repo.transaction(async (tx) => {
    await tx.areas.upsert(area);
    await tx.projects.upsert(project);
    for (const t of [intro, lit, cards, email]) await tx.tasks.upsert(t);
    for (const b of [past, locked, manual]) await tx.blocks.upsert(b);
  });
  return { repo, intro, lit, cards, email, past, locked, manual };
}

function render(repo: Awaited<ReturnType<typeof seed>>['repo']) {
  return renderWithProviders(<TimelinePage clock={clock} date={DATE} />, {
    repository: repo,
    route: '/timeline',
  });
}

describe('TimelinePage', () => {
  beforeEach(() => {
    usePlanPrefs.setState({ energyByDate: {} });
    useToastStore.getState().clear();
  });
  afterEach(() => {
    // @ts-expect-error -- test-only reset
    delete window.matchMedia;
  });

  it('dropping a task onto free time creates a manual block at the snapped time', async () => {
    const { repo, email } = await seed();
    const day = await loadDay(repo, DATE, clock);
    const { block } = await dropTask(repo, day, email, 968, {}, clock);
    expect(block).toMatchObject({
      startMin: 975,
      endMin: 1005,
      source: 'manual',
      taskId: email.id,
    });
    expect(await repo.blocks.count()).toBe(4);
  });

  it('Schedule puts an unscheduled task into the first free slot after now', async () => {
    const user = userEvent.setup();
    const { repo, email } = await seed();
    render(repo);
    await screen.findByTestId('timeline-canvas');
    await user.click(screen.getByRole('button', { name: 'Schedule Email the supervisor' }));
    await waitFor(async () => expect(await repo.blocks.count()).toBe(4));
    const created = (await repo.blocks.list()).find((b) => b.taskId === email.id)!;
    expect(created).toMatchObject({ startMin: 660, endMin: 690, source: 'manual' });
    expect(screen.queryByTestId(`unscheduled-${email.id}`)).not.toBeInTheDocument();
  });

  it('arrow keys move the selected block by 15 minutes, and Shift resizes', async () => {
    const user = userEvent.setup();
    const { repo, manual } = await seed();
    render(repo);
    const block = await screen.findByTestId(`block-${manual.id}`);
    await user.click(block);
    await user.keyboard('{ArrowDown}');
    await waitFor(async () => expect((await repo.blocks.get(manual.id))?.startMin).toBe(915));
    expect((await repo.blocks.get(manual.id))?.endMin).toBe(945);

    await user.click(screen.getByTestId(`block-${manual.id}`));
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await waitFor(async () => expect((await repo.blocks.get(manual.id))?.endMin).toBe(960));
    expect((await repo.blocks.get(manual.id))?.startMin).toBe(915);
  });

  it('resizing below 15 minutes is prevented with a reason', async () => {
    const user = userEvent.setup();
    const { repo, manual } = await seed();
    render(repo);
    await user.click(await screen.findByTestId(`block-${manual.id}`));
    await user.keyboard('{Shift>}{ArrowUp}{/Shift}');
    await waitFor(async () => expect((await repo.blocks.get(manual.id))?.endMin).toBe(915));
    await user.click(await screen.findByTestId(`block-${manual.id}`));
    await user.keyboard('{Shift>}{ArrowUp}{/Shift}');
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.description)).toContain(
        'Blocks are at least 15 minutes.',
      ),
    );
    expect(await repo.blocks.get(manual.id)).toMatchObject({ startMin: 900, endMin: 915 });
  });

  it('a locked block ignores move attempts and says why', async () => {
    const user = userEvent.setup();
    const { repo, locked } = await seed();
    render(repo);
    await user.click(await screen.findByTestId(`block-${locked.id}`));
    await user.keyboard('{ArrowDown}');
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.description)).toContain(
        'Unlock the block to move it.',
      ),
    );
    expect(await repo.blocks.get(locked.id)).toMatchObject({ startMin: 780, endMin: 840 });

    // `l` unlocks it, then it moves.
    await user.keyboard('l');
    await waitFor(async () => expect((await repo.blocks.get(locked.id))?.locked).toBe(false));
    await user.keyboard('{ArrowDown}');
    await waitFor(async () => expect((await repo.blocks.get(locked.id))?.startMin).toBe(795));
  });

  it('a move onto a locked block is rejected, and recalculation never changes locked or past blocks', async () => {
    const user = userEvent.setup();
    const { repo, past, locked, manual, email } = await seed();
    render(repo);
    await screen.findByTestId('timeline-canvas');
    // Put a planner block for "email" after the manual one, then move the manual block onto the locked block.
    const planner = createRecord(BlockSchema, clock, {
      date: DATE,
      startMin: 945,
      endMin: 975,
      taskId: email.id,
      source: 'planner',
    });
    await repo.blocks.upsert(planner);

    const day = await loadDay(repo, DATE, clock);
    const { moveBlockTo } = await import('./timelineService');
    await expect(moveBlockTo(repo, day, manual, 800, {}, clock)).rejects.toThrow(/overlap/);

    // A legal move re-plans the planner block but leaves past and locked untouched.
    await user.click(await screen.findByTestId(`block-${manual.id}`));
    await user.keyboard('{ArrowDown}{ArrowDown}');
    await waitFor(async () => expect((await repo.blocks.get(manual.id))?.startMin).toBe(930));
    expect(await repo.blocks.get(past.id)).toMatchObject({
      startMin: 540,
      endMin: 600,
      deletedAt: null,
    });
    expect(await repo.blocks.get(locked.id)).toMatchObject({
      startMin: 780,
      endMin: 840,
      locked: true,
      deletedAt: null,
    });
    const replanned = (await repo.blocks.list()).find((b) => b.taskId === email.id)!;
    expect(replanned.source).toBe('planner');
    expect(replanned.startMin).toBeGreaterThanOrEqual(660);
    expect(useToastStore.getState().toasts.some((t) => t.title === 'Day re-planned')).toBe(true);
  });

  it('Delete removes the selected block', async () => {
    const user = userEvent.setup();
    const { repo, manual } = await seed();
    render(repo);
    await user.click(await screen.findByTestId(`block-${manual.id}`));
    await user.keyboard('{Delete}');
    await waitFor(async () => expect((await repo.blocks.get(manual.id))?.deletedAt).not.toBeNull());
  });

  it('renders the list variant under the breakpoint with the same actions', async () => {
    const user = userEvent.setup();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    const { repo, manual } = await seed();
    render(repo);
    const list = await screen.findByTestId('timeline-list');
    expect(screen.queryByTestId('timeline-canvas')).not.toBeInTheDocument();
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    await user.click(within(list).getByRole('button', { name: 'Later Make flash cards' }));
    await waitFor(async () => expect((await repo.blocks.get(manual.id))?.startMin).toBe(915));
  });
});

describe('TimelinePage evidence links', () => {
  beforeEach(() => {
    usePlanPrefs.setState({ energyByDate: {} });
    useToastStore.getState().clear();
  });

  function renderAt(repo: Awaited<ReturnType<typeof seed>>['repo'], route: string) {
    return renderWithProviders(<TimelinePage clock={clock} />, { repository: repo, route, clock });
  }

  it('selects the date and block named in the URL, scrolling to the block once it loads', async () => {
    const { repo, manual } = await seed();
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function () {
      scrolled.push((this as HTMLElement).dataset.testid ?? '');
    };
    renderAt(repo, `/timeline?date=${DATE}&block=${manual.id}`);
    const block = await screen.findByTestId(`block-${manual.id}`);
    await waitFor(() => expect(block).toHaveFocus());
    expect(scrolled).toEqual([`block-${manual.id}`]);
    expect(screen.getByRole('button', { name: DATE })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the linked date and explains a block that is gone; malformed parameters fall back to today', async () => {
    const { repo } = await seed();
    renderAt(repo, `/timeline?date=2026-09-18&block=019372a0-0000-7000-8000-00000000dead`);
    expect(await screen.findByTestId('block-missing')).toHaveTextContent('no longer on this day');
    expect(screen.getByRole('button', { name: '2026-09-18' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText(/2026-09-18\. Drag, resize, lock/)).toBeInTheDocument();

    renderAt(repo, '/timeline?date=2026-13-45&block=not-a-uuid');
    await screen.findAllByTestId('timeline-canvas');
    expect(screen.getAllByRole('button', { name: DATE }).at(-1)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByTestId('block-missing')).toBeInTheDocument(); // only the first render's notice
  });

  it('shows the overload warning from the shared day-load result, linking to the evidence', async () => {
    const user = userEvent.setup();
    const { repo, intro } = await seed();
    // Five two-hour blocks on Wednesday: 600 minutes against 495 available.
    for (let i = 0; i < 5; i += 1) {
      await repo.blocks.upsert(
        createRecord(BlockSchema, clock, {
          date: '2026-09-16',
          startMin: 540,
          endMin: 660,
          taskId: intro.id,
          source: 'manual',
        }),
      );
    }
    renderAt(repo, '/timeline?date=2026-09-16');
    const warning = await screen.findByTestId('overload-warning');
    expect(warning).toHaveTextContent(
      'Overloaded: 600 min of committed work against 495 min of available work time.',
    );
    expect(within(warning).getByRole('link', { name: 'See the evidence' })).toHaveAttribute(
      'href',
      '/insights?open=overloaded-day:2026-09-16',
    );
    // Today (14th) holds 150 minutes of blocks: no warning; the nav keeps the URL in charge.
    await user.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => expect(screen.queryByTestId('overload-warning')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: DATE })).toHaveAttribute('aria-pressed', 'true');
  });

  it('uses the same calculation for a date outside the seven-day horizon', async () => {
    const { repo, intro } = await seed();
    for (let i = 0; i < 5; i += 1) {
      await repo.blocks.upsert(
        createRecord(BlockSchema, clock, {
          date: '2026-10-07',
          startMin: 540,
          endMin: 660,
          taskId: intro.id,
          source: 'manual',
        }),
      );
    }
    renderAt(repo, '/timeline?date=2026-10-07');
    const warning = await screen.findByTestId('overload-warning');
    expect(warning).toHaveTextContent('600 min of committed work against 495 min');
    expect(warning).toHaveTextContent('Outside the insights horizon; same calculation.');
    expect(within(warning).queryByRole('link')).not.toBeInTheDocument();
  });
});
