import { describe, expect, it } from 'vitest';
import { MaterializeError, materializeCapture, parseCapture } from '../../src/capture';
import { fixedClock, newId } from '../../src';
import { PersonSchema, createRecord } from '../../src';

const clock = fixedClock(new Date(2026, 8, 12, 9, 0, 0));
const ctx = { now: clock.now() };

describe('materializeCapture', () => {
  it('task: due at end of day when only a date was given, open status', () => {
    const r = parseCapture('Submit my report next Friday', ctx);
    const m = materializeCapture('task', r.fields, clock, { projectId: null });
    expect(m.primary.type).toBe('task');
    const rec = m.records[0]!;
    expect(rec.store).toBe('tasks');
    if (rec.store === 'tasks') {
      expect(rec.record.status).toBe('open');
      expect(rec.record.title).toBe('Submit my report');
      expect(new Date(rec.record.dueAt!).getHours()).toBe(23);
      expect(new Date(rec.record.dueAt!).getDate()).toBe(18);
    }
  });

  it('event: fills a default hour and 60-minute length', () => {
    const r = parseCapture('e: Coffee with Ali', ctx);
    const m = materializeCapture('event', r.fields, clock);
    const rec = m.records[0]!;
    if (rec.store === 'events') {
      const start = new Date(rec.record.startAt);
      const end = new Date(rec.record.endAt);
      expect(start.getHours()).toBe(9);
      expect((end.getTime() - start.getTime()) / 60000).toBe(60);
    }
  });

  it('goal: requires an area', () => {
    const r = parseCapture('Goal: run a half marathon by June', ctx);
    expect(() => materializeCapture('goal', r.fields, clock)).toThrow(MaterializeError);
    const areaId = newId();
    const m = materializeCapture('goal', r.fields, clock, { areaId });
    const rec = m.records[0]!;
    if (rec.store === 'goals') {
      expect(rec.record.areaId).toBe(areaId);
      expect(rec.record.targetDate).toBe('2027-06-30');
    }
  });

  it('routine: preferred window from start and duration', () => {
    const r = parseCapture('Meditate every morning for 10 minutes', ctx);
    const m = materializeCapture('routine', r.fields, clock);
    const rec = m.records[0]!;
    if (rec.store === 'routines') {
      expect(rec.record.durationMin).toBe(10);
      expect(rec.record.preferredWindow).toEqual({ startMin: 480, endMin: 490 });
      expect(rec.record.recurrence.freq).toBe('daily');
    }
  });

  it('bill: defaults due date a week out when none was given', () => {
    const r = parseCapture('Pay the plumber 85', ctx);
    const m = materializeCapture('bill', r.fields, clock);
    const rec = m.records[0]!;
    if (rec.store === 'bills') {
      expect(rec.record.amount).toBe(85);
      expect(rec.record.dueAt).toBe('2026-09-19');
    }
  });

  it('commitment: links an existing person or creates one', () => {
    const omar = createRecord(PersonSchema, clock, { name: 'Omar' });
    const r = parseCapture('Remind me to ask Omar about his interview', ctx);

    const linked = materializeCapture('commitment', r.fields, clock, { people: [omar] });
    expect(linked.records).toHaveLength(1);
    const c = linked.records[0]!;
    if (c.store === 'commitments') {
      expect(c.record.personId).toBe(omar.id);
      expect(c.record.text).toBe('Ask Omar about his interview');
    }

    const created = materializeCapture('commitment', r.fields, clock, { people: [] });
    expect(created.records.map((x) => x.store)).toEqual(['people', 'commitments']);
  });

  it('commitment: needs a person', () => {
    const r = parseCapture('c: follow up later', ctx);
    expect(() => materializeCapture('commitment', r.fields, clock)).toThrow(/Who is this about/);
  });

  it('note: keeps the body', () => {
    const r = parseCapture('Idea: an app that plans your day around energy', ctx);
    const m = materializeCapture('note', r.fields, clock);
    const rec = m.records[0]!;
    if (rec.store === 'notes') {
      expect(rec.record.body).toBe('an app that plans your day around energy');
    }
  });
});
