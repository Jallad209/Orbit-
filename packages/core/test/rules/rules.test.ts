import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/clock';
import { toLocalDate } from '../../src/dates';
import { createRecord } from '../../src/records';
import { buildCapacity, planDay } from '../../src/planner';
import { DEFAULT_PLAN_SETTINGS } from '../../src/planner/types';
import {
  applyConstraints,
  applyRecurringRules,
  computeReminders,
  conflictsByRule,
  detectConflicts,
  dueReminders,
  evaluateRules,
  reconcileReminders,
  reminderKey,
  toReminderRecords,
  weekdayOf,
} from '../../src/rules';
import { APP_SETTINGS_ID, AppSettingsSchema, RuleSchema } from '../../src/schema';
import type { Rule } from '../../src/schema';
import { defaultAppSettings } from '../../src/settings';
import {
  aBill,
  aCommitment,
  aPerson,
  aRoutine,
  aTask,
  aWorld,
  anArea,
  testClock,
} from '../builders';

// Friday 18 Sep 2026, 08:00 local.
const FRIDAY = '2026-09-18';
const clock = fixedClock(new Date(2026, 8, 18, 8, 0, 0));
let ruleSequence = 0;

function rule<T extends Rule['type']>(
  type: T,
  config: Extract<Rule, { type: T }>['config'],
  extra: Partial<Pick<Rule, 'name' | 'enabled'>> = {},
): Rule {
  return createRecord(RuleSchema, testClock(), {
    type,
    config,
    name: extra.name ?? '',
    enabled: extra.enabled ?? true,
    createdAt: new Date(testClock().now().getTime() + ruleSequence++).toISOString(),
  } as never) as Rule;
}

describe('constraint rules', () => {
  it('no high-energy task is placed after 19:00 when the rule is enabled', () => {
    const w = aWorld(clock);
    const deep = aTask(
      { title: 'Deep proof', areaId: w.ids.study.id, energy: 'high', estimateMin: 60, priority: 1 },
      clock,
    );
    const light = aTask(
      { title: 'Tidy notes', areaId: w.ids.study.id, energy: 'low', estimateMin: 60 },
      clock,
    );
    const cut = rule('constraint', { kind: 'noHighEnergyAfter', afterMin: 19 * 60 });
    // An evening-only window: 19:00–22:00. Without the rule the deep task lands there.
    const settings = {
      workingWindow: { startMin: 19 * 60, endMin: 22 * 60 },
      energy: 'high' as const,
    };
    const snapshot = { ...w, tasks: [deep, light] };

    const without = planDay(snapshot, FRIDAY, settings, clock);
    expect(without.blocks.some((b) => b.taskId === deep.id)).toBe(true);

    const withRule = planDay({ ...snapshot, rules: [cut] }, FRIDAY, settings, clock);
    expect(withRule.blocks.some((b) => b.taskId === deep.id)).toBe(false);
    expect(withRule.blocks.some((b) => b.taskId === light.id)).toBe(true);
    // No interval may take it: a capacity miss, not the day's energy filter.
    expect(withRule.leftOut.find((l) => l.id === deep.id)?.reason).toBe('capacity');
    // The cut only touches time after it: a morning window keeps its flag.
    const cap = buildCapacity(
      { ...snapshot, rules: [cut] },
      FRIDAY,
      { ...DEFAULT_PLAN_SETTINGS, workingWindow: { startMin: 540, endMin: 22 * 60 } },
      new Date(2026, 8, 17, 8, 0),
    );
    expect(cap.free.filter((f) => f.startMin < 19 * 60).every((f) => f.highEnergyAllowed)).toBe(
      true,
    );
    expect(cap.free.filter((f) => f.startMin >= 19 * 60).every((f) => !f.highEnergyAllowed)).toBe(
      true,
    );
  });

  it('Friday 18:00–22:00 reserved for family leaves zero non-family blocks there', () => {
    const w = aWorld(clock);
    const family = anArea({ name: 'Family' }, clock);
    const dinner = aTask({ title: 'Cook dinner', areaId: family.id, estimateMin: 60 }, clock);
    const study = aTask({ title: 'Read paper', areaId: w.ids.study.id, estimateMin: 60 }, clock);
    const reserve = rule(
      'constraint',
      {
        kind: 'reserve',
        dayOfWeek: 'FR',
        startMin: 18 * 60,
        endMin: 22 * 60,
        areaId: family.id,
        label: 'Family',
      },
      { name: 'Family evening' },
    );
    const settings = { workingWindow: { startMin: 18 * 60, endMin: 22 * 60 } };
    const p = planDay(
      { ...w, areas: [...w.areas, family], tasks: [dinner, study], rules: [reserve] },
      FRIDAY,
      settings,
      clock,
    );
    const evening = p.blocks.filter((b) => b.startMin >= 18 * 60 && b.taskId);
    expect(evening.length).toBeGreaterThan(0);
    expect(evening.every((b) => b.taskId === dinner.id)).toBe(true);
    expect(p.leftOut.find((l) => l.id === study.id)?.reason).toBe('capacity');
    // Thursday is untouched by a Friday rule.
    const thursday = planDay(
      { ...w, areas: [...w.areas, family], tasks: [dinner, study], rules: [reserve] },
      '2026-09-17',
      settings,
      clock,
    );
    expect(thursday.blocks.some((b) => b.taskId === study.id)).toBe(true);
  });

  it('applyConstraints reserves a whole window as busy when no area is named', () => {
    const free = [{ startMin: 540, endMin: 1080, areaId: null, highEnergyAllowed: true }];
    const whole = rule('constraint', {
      kind: 'reserve',
      dayOfWeek: 'FR',
      startMin: 600,
      endMin: 660,
      areaId: null,
      label: 'Standup',
    });
    const r = applyConstraints(free, [whole, { ...whole, enabled: false }], FRIDAY);
    expect(r.busy).toEqual([
      { startMin: 600, endMin: 660, kind: 'reserve', refId: whole.id, label: 'Standup' },
    ]);
    expect(r.free).toEqual(free);
    expect(weekdayOf(FRIDAY)).toBe('FR');
    expect(applyConstraints(free, [whole], '2026-09-19').busy).toEqual([]);
  });
});

describe('reminder rules', () => {
  const bills = rule('reminder', { kind: 'billDueWithin', days: 3 }, { name: 'Bills' });

  it('every unpaid bill gets one row, future ones prepared ahead with a date-stable title', () => {
    const rent = aBill(
      { title: 'Rent', amount: 900, currency: 'EUR', dueAt: '2026-09-20', dueTime: 14 * 60 },
      clock,
    );
    const later = aBill({ title: 'Gym', dueAt: '2026-09-30' }, clock);
    const paid = aBill({ title: 'Paid', dueAt: '2026-09-19', paid: true }, clock);
    const undated = aBill({ title: 'Someday', dueAt: null }, clock);
    const all = computeReminders(
      { rules: [bills], bills: [rent, later, paid, undated] },
      clock.now(),
    );
    expect(all).toHaveLength(2);
    const first = all.filter((d) => d.entityId === rent.id);
    expect(first[0]).toMatchObject({
      key: reminderKey(bills.id, rent.id, '2026-09-20'),
      entityType: 'bill',
      entityId: rent.id,
      title: 'Rent due 2026-09-20',
      body: '900 EUR',
    });
    // Honors the optional due time on the day it enters the window (due − 3 days = the 17th).
    expect(new Date(first[0]!.fireAt).getHours()).toBe(14);
    expect(toLocalDate(new Date(first[0]!.fireAt))).toBe('2026-09-17');
    // The gym bill is known now, so its row waits in the queue with its real future fire time.
    const gym = all.find((d) => d.entityId === later.id)!;
    expect(toLocalDate(new Date(gym.fireAt))).toBe('2026-09-27');
    expect(gym).toMatchObject({ title: 'Gym due 2026-09-30', body: '10' });
    expect(dueReminders(toReminderRecords([gym], clock), clock.now())).toEqual([]);

    const created = toReminderRecords(reconcileReminders([], first), clock);
    expect(created[0]!.status).toBe('pending');
    // Every later run, an hour or a day on, finds nothing new.
    clock.advance(60 * 60_000);
    expect(
      reconcileReminders(created, computeReminders({ rules: [bills], bills: [rent] }, clock.now())),
    ).toEqual([]);
    clock.advance(24 * 60 * 60_000);
    expect(
      reconcileReminders(created, computeReminders({ rules: [bills], bills: [rent] }, clock.now())),
    ).toEqual([]);
    // Nor after it fired or was dismissed.
    expect(reconcileReminders([{ ...created[0]!, status: 'dismissed' }], first)).toEqual([]);
    // Duplicates inside one computation collapse too.
    expect(reconcileReminders([], [...first, ...first])).toHaveLength(1);
    clock.set(new Date(2026, 8, 18, 8, 0, 0));
  });

  it('a commitment owed to me with no reply for 8 days becomes a follow-up', () => {
    const followUp = rule('reminder', { kind: 'followUpAfter', days: 7 }, { name: 'Chase' });
    // The promises predate the contacts, so the contact date is the baseline.
    const earlier = fixedClock(new Date(2026, 8, 1, 9, 0));
    const omar = aPerson({ name: 'Omar', lastContactAt: '2026-09-10T10:00:00.000Z' }, clock);
    const quiet = aCommitment(
      { personId: omar.id, text: 'Interview feedback', direction: 'owed-to-me' },
      earlier,
    );
    const recent = aPerson({ name: 'Lina', lastContactAt: '2026-09-16T10:00:00.000Z' }, clock);
    const fresh = aCommitment(
      { personId: recent.id, text: 'Slides', direction: 'owed-to-me' },
      earlier,
    );
    const mine = aCommitment(
      { personId: omar.id, text: 'Send CV', direction: 'owed-by-me' },
      earlier,
    );
    const done = aCommitment(
      { personId: omar.id, text: 'Old', direction: 'owed-to-me', status: 'done' },
      earlier,
    );
    const out = computeReminders(
      { rules: [followUp], commitments: [quiet, fresh, mine, done], people: [omar, recent] },
      clock.now(),
    );
    // Both open owed-to-me commitments get a row; only Omar's is due, Lina's waits until the 23rd.
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      entityType: 'commitment',
      entityId: quiet.id,
      title: 'Follow up with Omar',
      body: 'No reply on “Interview feedback” since 2026-09-10',
      key: reminderKey(followUp.id, quiet.id, '2026-09-17'),
    });
    expect(toLocalDate(new Date(out[0]!.fireAt))).toBe('2026-09-17');
    expect(out[1]).toMatchObject({
      entityId: fresh.id,
      key: reminderKey(followUp.id, fresh.id, '2026-09-23'),
    });
    expect(toLocalDate(new Date(out[1]!.fireAt))).toBe('2026-09-23');
    // With no contact on record, the commitment's own age counts.
    const nobody = aCommitment(
      { personId: aPerson({}, clock).id, text: 'Ping', direction: 'owed-to-me' },
      fixedClock(new Date(2026, 8, 1, 9, 0)),
    );
    expect(
      computeReminders({ rules: [followUp], commitments: [nobody] }, clock.now())[0]?.title,
    ).toBe('Follow up');
  });

  it('a new commitment counts from its own creation, not an older contact date (week 12)', () => {
    const followUp = rule('reminder', { kind: 'followUpAfter', days: 7 }, { name: 'Chase' });
    // Last contact was long ago; the promise was made today.
    const omar = aPerson({ name: 'Omar', lastContactAt: '2026-08-01T10:00:00.000Z' }, clock);
    const made = aCommitment(
      { personId: omar.id, text: 'Reference letter', direction: 'owed-to-me' },
      clock,
    );
    const [draft] = computeReminders(
      { rules: [followUp], commitments: [made], people: [omar] },
      clock.now(),
    );
    expect(draft).toMatchObject({
      key: reminderKey(followUp.id, made.id, '2026-09-25'),
      body: 'No reply on “Reference letter” since 2026-09-18',
    });
    // A reply after the promise restarts the wait from the reply.
    const replied = { ...omar, lastContactAt: '2026-09-20T10:00:00.000Z' };
    const [later] = computeReminders(
      { rules: [followUp], commitments: [made], people: [replied] },
      clock.now(),
    );
    expect(later?.key).toBe(reminderKey(followUp.id, made.id, '2026-09-27'));
    // A deleted person has no follow-ups; a done or dropped commitment neither.
    expect(
      computeReminders({ rules: [followUp], commitments: [made], people: [] }, clock.now()),
    ).toHaveLength(0);
    expect(
      computeReminders(
        { rules: [followUp], commitments: [{ ...made, status: 'dropped' }], people: [omar] },
        clock.now(),
      ),
    ).toHaveLength(0);
  });

  it('lists the pending reminders whose time has come, oldest first', () => {
    const rent = aBill({ title: 'Rent', dueAt: '2026-09-19' }, clock);
    const drafts = computeReminders({ rules: [bills], bills: [rent] }, clock.now());
    const [pending] = toReminderRecords(drafts, clock);
    const later = {
      ...pending!,
      id: aBill({}, clock).id,
      key: 'x',
      fireAt: '2026-09-18T12:00:00.000Z',
    };
    const fired = { ...pending!, id: aBill({}, clock).id, key: 'y', status: 'fired' as const };
    expect(dueReminders([later, fired, pending!], clock.now()).map((r) => r.key)).toEqual([
      pending!.key,
    ]);
    expect(dueReminders([later, pending!], new Date(2026, 8, 18, 23, 0)).map((r) => r.key)).toEqual(
      [pending!.key, 'x'],
    );
  });
});

describe('conflicts', () => {
  it('uses one recurring count and one reservation owner regardless of input order', () => {
    const routine = aRoutine({}, clock);
    const first = rule('recurring', { routineId: routine.id, timesPerWeek: 2 });
    const later = rule('recurring', { routineId: routine.id, timesPerWeek: 3 });
    const instances = applyRecurringRules([later, first], [routine], [], '2026-09-14', clock);
    expect(instances).toHaveLength(2);
    expect(new Set(instances.map((i) => i.date)).size).toBe(2);
    expect(detectConflicts([later, first])[0]!.ruleIds).toEqual([first.id, later.id]);
    const area = anArea({}, clock);
    const reserve = rule('constraint', {
      kind: 'reserve',
      dayOfWeek: 'FR',
      startMin: 540,
      endMin: 660,
      areaId: area.id,
      label: '',
    });
    const busy = rule('constraint', {
      kind: 'reserve',
      dayOfWeek: 'FR',
      startMin: 600,
      endMin: 720,
      areaId: null,
      label: '',
    });
    const capacity = applyConstraints(
      [{ startMin: 540, endMin: 780, areaId: null, highEnergyAllowed: true }],
      [busy, reserve],
      FRIDAY,
    );
    expect(capacity.busy).toEqual([expect.objectContaining({ startMin: 660, endMin: 720 })]);
    expect(capacity.free.find((i) => i.startMin === 540)).toEqual(
      expect.objectContaining({ endMin: 660, areaId: area.id }),
    );
  });

  it('reports two overlapping reservations on the same weekday, and badges both', () => {
    const a = rule(
      'constraint',
      {
        kind: 'reserve',
        dayOfWeek: 'FR',
        startMin: 18 * 60,
        endMin: 22 * 60,
        areaId: null,
        label: '',
      },
      { name: 'Family evening' },
    );
    const b = rule(
      'constraint',
      {
        kind: 'reserve',
        dayOfWeek: 'FR',
        startMin: 20 * 60,
        endMin: 23 * 60,
        areaId: null,
        label: '',
      },
      { name: 'Band practice' },
    );
    const otherDay = rule('constraint', {
      kind: 'reserve',
      dayOfWeek: 'SA',
      startMin: 18 * 60,
      endMin: 22 * 60,
      areaId: null,
      label: '',
    });
    const conflicts = detectConflicts([a, b, otherDay, { ...b, id: aTask().id, enabled: false }]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.ruleIds).toEqual([a.id, b.id]);
    expect(conflicts[0]!.message).toBe(
      '“Family evening” and “Band practice” both reserve Friday 20:00–22:00; the earlier rule wins.',
    );
    const byRule = conflictsByRule(conflicts);
    expect(byRule.get(a.id)).toHaveLength(1);
    expect(byRule.get(b.id)).toHaveLength(1);
    expect(byRule.has(otherDay.id)).toBe(false);
  });

  it('reports a reserved area window after the high-energy cut, duplicate policies, and duplicate routines', () => {
    const area = anArea({}, clock);
    const cut = rule(
      'constraint',
      { kind: 'noHighEnergyAfter', afterMin: 19 * 60 },
      { name: 'Wind down' },
    );
    const late = rule(
      'constraint',
      {
        kind: 'reserve',
        dayOfWeek: 'MO',
        startMin: 20 * 60,
        endMin: 21 * 60,
        areaId: area.id,
        label: '',
      },
      { name: 'Late study' },
    );
    const early = rule('constraint', {
      kind: 'reserve',
      dayOfWeek: 'MO',
      startMin: 9 * 60,
      endMin: 10 * 60,
      areaId: area.id,
      label: '',
    });
    const r1 = rule(
      'rollover',
      { p1: 'tomorrow', p2: 'tomorrow', p3: 'nextWeek' },
      { name: 'Default' },
    );
    const r2 = rule('rollover', { p1: 'inbox', p2: 'inbox', p3: 'inbox' }, { name: 'Strict' });
    const routine = aRoutine({}, clock);
    const t1 = rule('recurring', { routineId: routine.id, timesPerWeek: 3 }, { name: 'Thrice' });
    const t2 = rule('recurring', { routineId: routine.id, timesPerWeek: 5 }, { name: 'Daily-ish' });
    const conflicts = detectConflicts([cut, late, early, r1, r2, t1, t2]);
    expect(conflicts.map((c) => c.ruleIds)).toEqual([
      [late.id, cut.id],
      [r1.id, r2.id],
      [t1.id, t2.id],
    ]);
    expect(conflicts[0]!.message).toMatch(/after 19:00/);
    expect(conflicts[1]!.message).toBe(
      'Two rollover policies are enabled; only “Default” applies.',
    );
    expect(conflicts[2]!.message).toMatch(/same routine/);
    expect(detectConflicts([cut, early, r1, t1])).toEqual([]);
  });
});

describe('evaluateRules and settings', () => {
  it('runs recurring, reminder, and conflict evaluation in one pass', () => {
    const routine = aRoutine({ title: 'Run' }, clock);
    const thrice = rule('recurring', { routineId: routine.id, timesPerWeek: 3 });
    const bill = aBill({ title: 'Rent', dueAt: '2026-09-19' }, clock);
    const bills = rule('reminder', { kind: 'billDueWithin', days: 3 });
    const r = evaluateRules(
      { rules: [thrice, bills], routines: [routine], bills: [bill] },
      FRIDAY,
      clock,
    );
    // Friday to Sunday: three days left in the week, three instances.
    expect(r.routineInstances.map((i) => i.date)).toEqual([FRIDAY, '2026-09-19', '2026-09-20']);
    expect(r.reminders.map((d) => d.entityId)).toEqual([bill.id]);
    expect(r.conflicts).toEqual([]);
    // Already-queued reminders are not repeated.
    const again = evaluateRules(
      {
        rules: [thrice, bills],
        routines: [routine],
        routineInstances: r.routineInstances,
        bills: [bill],
        reminders: toReminderRecords(r.reminders, clock),
      },
      FRIDAY,
      clock,
    );
    expect(again.routineInstances).toEqual([]);
    expect(again.reminders).toEqual([]);
  });

  it('the default settings document has the fixed id and the planner defaults', () => {
    const s = defaultAppSettings(clock);
    expect(s.id).toBe(APP_SETTINGS_ID);
    expect(s).toMatchObject({
      workingWindow: { startMin: 540, endMin: 1080 },
      restBoundaries: [{ startMin: 750, endMin: 795 }],
      bufferMin: 10,
      defaultEstimateMin: 30,
      eveningStartMin: 17 * 60,
    });
    expect(
      AppSettingsSchema.safeParse({ ...s, workingWindow: { startMin: 600, endMin: 600 } }).success,
    ).toBe(false);
    expect(AppSettingsSchema.safeParse({ ...s, bufferMin: -1 }).success).toBe(false);
  });
});
