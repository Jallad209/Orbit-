import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AreaSchema, RoutineSchema, RuleSchema, createRecord, fixedClock } from '@orbit/core';
import type { Rule } from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { useToastStore } from '@/components/ui/toastStore';
import { renderWithProviders } from '@/test/render';
import { RulesSection } from './RulesSection';

const clock = fixedClock(new Date(2026, 8, 14, 9, 0, 0));

async function seed() {
  const repo = createMemoryRepository({ clock });
  const family = createRecord(AreaSchema, clock, { name: 'Family' });
  const run = createRecord(RoutineSchema, clock, {
    title: 'Run',
    recurrence: { freq: 'weekly', byDay: ['MO'] },
  });
  await repo.areas.upsert(family);
  await repo.routines.upsert(run);
  return { repo, family, run };
}

function render(repo: Awaited<ReturnType<typeof seed>>['repo']) {
  return renderWithProviders(<RulesSection clock={clock} />, {
    repository: repo,
    route: '/settings',
  });
}

async function storedRules(repo: Awaited<ReturnType<typeof seed>>['repo']): Promise<Rule[]> {
  return repo.rules.list();
}

describe('RulesSection', () => {
  beforeEach(() => useToastStore.getState().clear());

  it('adds a "no demanding work after 19:00" constraint through the shared schema', async () => {
    const user = userEvent.setup();
    const { repo } = await seed();
    render(repo);
    expect(await screen.findByTestId('rules-empty')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Time constraint' }));
    const form = screen.getByTestId('constraint-form');
    expect(within(form).getByLabelText('Kind')).toHaveValue('noHighEnergyAfter');
    const after = within(form).getByLabelText(/After/);
    await user.clear(after);
    await user.type(after, '7pm');
    await user.click(within(form).getByRole('button', { name: 'Add rule' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Expected number');
    expect(await storedRules(repo)).toEqual([]);

    await user.clear(after);
    await user.type(after, '19:00');
    await user.type(within(form).getByLabelText(/Name/), 'Wind down');
    await user.click(within(form).getByRole('button', { name: 'Add rule' }));
    await waitFor(async () => expect(await storedRules(repo)).toHaveLength(1));
    const [rule] = await storedRules(repo);
    expect(rule).toMatchObject({
      type: 'constraint',
      name: 'Wind down',
      enabled: true,
      config: { kind: 'noHighEnergyAfter', afterMin: 19 * 60 },
    });
    expect(RuleSchema.safeParse(rule).success).toBe(true);
    expect(screen.getByRole('list', { name: 'Rules' })).toHaveTextContent(
      'No demanding work after 19:00',
    );
    expect(screen.queryByTestId('rule-editor')).not.toBeInTheDocument();
  });

  it('adds a reservation for an area and rejects a window that ends before it starts', async () => {
    const user = userEvent.setup();
    const { repo, family } = await seed();
    render(repo);
    await screen.findByTestId('rules-empty');
    await user.click(screen.getByRole('button', { name: 'Time constraint' }));
    const form = screen.getByTestId('constraint-form');
    await user.selectOptions(within(form).getByLabelText('Kind'), 'reserve');
    await user.selectOptions(within(form).getByLabelText('Weekday'), 'FR');
    await user.selectOptions(within(form).getByLabelText(/For/), family.id);
    const from = within(form).getByLabelText(/From/);
    const to = within(form).getByLabelText(/To/);
    await user.clear(from);
    await user.type(from, '18:00');
    await user.clear(to);
    await user.type(to, '17:00');
    await user.click(within(form).getByRole('button', { name: 'Add rule' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('must end after start');
    expect(await storedRules(repo)).toEqual([]);

    await user.clear(to);
    await user.type(to, '22:00');
    await user.type(within(form).getByLabelText(/Label/), 'Family');
    await user.click(within(form).getByRole('button', { name: 'Add rule' }));
    await waitFor(async () => expect(await storedRules(repo)).toHaveLength(1));
    expect((await storedRules(repo))[0]).toMatchObject({
      type: 'constraint',
      config: {
        kind: 'reserve',
        dayOfWeek: 'FR',
        startMin: 18 * 60,
        endMin: 22 * 60,
        areaId: family.id,
        label: 'Family',
      },
    });
  });

  it('submits recurring, rollover, and reminder rules in the right shapes', async () => {
    const user = userEvent.setup();
    const { repo, run } = await seed();
    render(repo);
    await screen.findByTestId('rules-empty');

    await user.click(screen.getByRole('button', { name: 'Recurring schedule' }));
    let form = screen.getByTestId('recurring-form');
    await user.selectOptions(within(form).getByLabelText('Routine'), run.id);
    const times = within(form).getByLabelText(/Times per week/);
    await user.clear(times);
    await user.type(times, '9');
    await user.click(within(form).getByRole('button', { name: 'Add rule' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('less than or equal to 7');
    await user.clear(times);
    await user.type(times, '3');
    await user.click(within(form).getByRole('button', { name: 'Add rule' }));
    await waitFor(async () => expect(await storedRules(repo)).toHaveLength(1));
    expect((await storedRules(repo))[0]).toMatchObject({
      type: 'recurring',
      config: { routineId: run.id, timesPerWeek: 3 },
    });

    await user.click(screen.getByRole('button', { name: 'Rollover policy' }));
    form = screen.getByTestId('rollover-form');
    await user.selectOptions(within(form).getByLabelText('Priority 3'), 'inbox');
    await user.click(within(form).getByRole('button', { name: 'Add rule' }));
    await waitFor(async () => expect(await storedRules(repo)).toHaveLength(2));
    expect((await storedRules(repo))[1]).toMatchObject({
      type: 'rollover',
      config: { p1: 'tomorrow', p2: 'tomorrow', p3: 'inbox' },
    });

    await user.click(screen.getByRole('button', { name: 'Reminder' }));
    form = screen.getByTestId('reminder-form');
    await user.selectOptions(within(form).getByLabelText('Remind me'), 'followUpAfter');
    const days = within(form).getByLabelText(/Days/);
    await user.clear(days);
    await user.type(days, '7');
    await user.click(within(form).getByRole('button', { name: 'Add rule' }));
    await waitFor(async () => expect(await storedRules(repo)).toHaveLength(3));
    expect((await storedRules(repo))[2]).toMatchObject({
      type: 'reminder',
      config: { kind: 'followUpAfter', days: 7 },
    });
    expect(useToastStore.getState().toasts.filter((t) => t.title === 'Rule added')).toHaveLength(3);
  });

  it('badges both rules in a conflict with the engine message, and toggles or deletes a rule', async () => {
    const user = userEvent.setup();
    const { repo } = await seed();
    const family = createRecord(RuleSchema, clock, {
      type: 'constraint',
      name: 'Family evening',
      config: {
        kind: 'reserve',
        dayOfWeek: 'FR',
        startMin: 18 * 60,
        endMin: 22 * 60,
        areaId: null,
        label: '',
      },
    });
    const band = createRecord(RuleSchema, clock, {
      type: 'constraint',
      name: 'Band practice',
      config: {
        kind: 'reserve',
        dayOfWeek: 'FR',
        startMin: 20 * 60,
        endMin: 23 * 60,
        areaId: null,
        label: '',
      },
    });
    const bills = createRecord(RuleSchema, clock, {
      type: 'reminder',
      name: 'Bills',
      config: { kind: 'billDueWithin', days: 3 },
    });
    for (const r of [family, band, bills]) await repo.rules.upsert(r);
    render(repo);
    const familyRow = await screen.findByTestId(`rule-${family.id}`);
    const bandRow = screen.getByTestId(`rule-${band.id}`);
    expect(within(familyRow).getByTestId('conflict-badge')).toBeInTheDocument();
    expect(within(bandRow).getByTestId('conflict-badge')).toBeInTheDocument();
    expect(within(familyRow).getByRole('list', { name: 'Conflicts' })).toHaveTextContent(
      '“Family evening” and “Band practice” both reserve Friday 20:00–22:00; the earlier rule wins.',
    );
    expect(
      within(screen.getByTestId(`rule-${bills.id}`)).queryByTestId('conflict-badge'),
    ).toBeNull();

    // Disabling one side clears the conflict.
    await user.click(screen.getByRole('switch', { name: 'Disable Band practice' }));
    await waitFor(() =>
      expect(
        within(screen.getByTestId(`rule-${family.id}`)).queryByTestId('conflict-badge'),
      ).toBeNull(),
    );
    expect((await repo.rules.get(band.id))?.enabled).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Delete Bills' }));
    await waitFor(async () => expect(await repo.rules.count()).toBe(2));
    expect(screen.queryByTestId(`rule-${bills.id}`)).not.toBeInTheDocument();
  });

  it('edits an existing rule in place, keeping its id', async () => {
    const user = userEvent.setup();
    const { repo } = await seed();
    const bills = createRecord(RuleSchema, clock, {
      type: 'reminder',
      name: 'Bills',
      config: { kind: 'billDueWithin', days: 3 },
    });
    await repo.rules.upsert(bills);
    render(repo);
    await screen.findByTestId(`rule-${bills.id}`);
    await user.click(screen.getByRole('button', { name: 'Edit Bills' }));
    const form = screen.getByTestId('reminder-form');
    const days = within(form).getByLabelText(/Days/);
    expect(days).toHaveValue(3);
    await user.clear(days);
    await user.type(days, '5');
    await user.click(within(form).getByRole('button', { name: 'Save rule' }));
    await waitFor(async () =>
      expect((await repo.rules.get(bills.id))?.config).toEqual({ kind: 'billDueWithin', days: 5 }),
    );
    expect(await repo.rules.count()).toBe(1);
    expect(screen.getByTestId(`rule-${bills.id}`)).toHaveTextContent('Bills due within 5 days');
  });
});
