import { describe, expect, it } from 'vitest';
import { parseCapture, reclassify } from '../../src/capture';
import type { CaptureContext, CaptureType } from '../../src/capture';
import corpus from './corpus.json';

interface CorpusEntry {
  text: string;
  type: CaptureType;
  explicit?: boolean;
  fields?: Record<string, unknown>;
  alternativesInclude?: CaptureType[];
}

// Saturday 12 September 2026, 09:00 local.
const NOW = new Date(2026, 8, 12, 9, 0, 0);
const ctx: CaptureContext = {
  now: NOW,
  people: ['Omar', 'Sara', 'Layla', 'Ahmed', 'Ali', 'Nour'],
  projects: ['Thesis'],
};

/** Deep partial match: every expected key must equal the actual value. */
function matches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    return expected.every((e) => actual.some((a) => matches(a, e)));
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return false;
    return Object.entries(expected).every(([k, v]) =>
      matches((actual as Record<string, unknown>)[k], v),
    );
  }
  return actual === expected;
}

describe('capture corpus', () => {
  const entries = corpus as CorpusEntry[];

  it('has at least 120 phrases', () => {
    expect(entries.length).toBeGreaterThanOrEqual(120);
  });

  const failures: string[] = [];
  for (const entry of entries) {
    const result = parseCapture(entry.text, ctx);
    const typeOk = result.type === entry.type;
    const explicitOk = entry.explicit === undefined || result.explicit === entry.explicit;
    const fieldsOk = entry.fields === undefined || matches(result.fields, entry.fields);
    const altOk =
      entry.alternativesInclude === undefined ||
      entry.alternativesInclude.every((t) =>
        result.alternatives.slice(0, 3).some((a) => a.type === t),
      );
    if (!(typeOk && explicitOk && fieldsOk && altOk)) {
      failures.push(
        `${entry.text}\n    expected ${entry.type} ${JSON.stringify(entry.fields ?? {})}\n    got      ${result.type} ${JSON.stringify(result.fields)} alts=${result.alternatives.map((a) => `${a.type}:${a.score}`).join(',')}`,
      );
    }
  }

  it('classifies at least 95% of the corpus exactly', () => {
    const accuracy = 1 - failures.length / entries.length;
    expect(
      accuracy,
      `corpus accuracy ${(accuracy * 100).toFixed(1)}%\n${failures.length} failures:\n  ${failures.join('\n  ')}`,
    ).toBeGreaterThanOrEqual(0.95);
  });

  it('currently classifies the whole corpus (guards against silent regressions)', () => {
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('classifies the four spec examples correctly', () => {
    expect(parseCapture('Submit my report next Friday', ctx).type).toBe('task');
    expect(parseCapture('Remind me to ask Omar about his interview', ctx).type).toBe('commitment');
    expect(parseCapture('Save this idea for my business', ctx).type).toBe('note');
    expect(parseCapture('Pay electricity bill every month', ctx).type).toBe('bill');
  });
});

describe('dates relative to the clock', () => {
  it('resolves weekdays, next/this, and month boundaries', () => {
    const p = (t: string) => parseCapture(t, ctx).fields.dueDate;
    expect(p('Do it on Friday')).toBe('2026-09-18');
    expect(p('Do it next Friday')).toBe('2026-09-18');
    expect(p('Do it next Saturday')).toBe('2026-09-19');
    expect(p('Do it on Saturday')).toBe('2026-09-19'); // today is Saturday → next one
    expect(p('Do it tomorrow')).toBe('2026-09-13');
    expect(p('Do it in 30 days')).toBe('2026-10-12');
    expect(p('Do it by end of week')).toBe('2026-09-13');
    expect(p('Do it by end of year')).toBe('2026-12-31');
    expect(p('Do it on 5 Jan')).toBe('2027-01-05'); // already passed this year → next
    expect(p('Do it on 31 Nov')).toBe('2026-11-30'); // clamped
    expect(p('Do it on 3/10')).toBe('2026-10-03'); // day/month
  });

  it('handles relative hours across midnight', () => {
    const late = parseCapture('Check the oven in 16 hours', { now: new Date(2026, 8, 12, 20, 0) });
    expect(late.fields.dueDate).toBe('2026-09-13');
    expect(late.fields.dueTime).toBe(12 * 60);
  });

  it('rolls a year boundary', () => {
    const dec = parseCapture('Renew by 15 Jan', { now: new Date(2026, 11, 20, 9, 0) });
    expect(dec.fields.dueDate).toBe('2027-01-15');
  });
});

describe('recurrence phrases', () => {
  const rec = (t: string) => parseCapture(t, ctx).fields.recurrence;
  it('maps every phrase form', () => {
    expect(rec('Gym every day')).toMatchObject({ freq: 'daily', interval: 1 });
    expect(rec('Gym daily')).toMatchObject({ freq: 'daily', interval: 1 });
    expect(rec('Gym every 2 days')).toMatchObject({ freq: 'daily', interval: 2 });
    expect(rec('Gym every other week')).toMatchObject({ freq: 'weekly', interval: 2 });
    expect(rec('Gym weekly')).toMatchObject({ freq: 'weekly', interval: 1 });
    expect(rec('Gym every tuesday and thursday')).toMatchObject({
      freq: 'weekly',
      byDay: ['TU', 'TH'],
    });
    expect(rec('Gym every mon, wed, fri')).toMatchObject({
      freq: 'weekly',
      byDay: ['MO', 'WE', 'FR'],
    });
    expect(rec('Gym on weekdays')).toMatchObject({
      freq: 'weekly',
      byDay: ['MO', 'TU', 'WE', 'TH', 'FR'],
    });
    expect(rec('Gym every month')).toMatchObject({ freq: 'monthly', interval: 1 });
    expect(rec('Gym monthly on the 3rd')).toMatchObject({ freq: 'monthly', byMonthDay: 3 });
    expect(rec('Gym every 3 months')).toMatchObject({ freq: 'monthly', interval: 3 });
    expect(rec('Gym yearly')).toMatchObject({ freq: 'monthly', interval: 12 });
  });
});

describe('ambiguity and alternatives', () => {
  it('"Pay Omar 50 on Friday" is a bill linked to Omar, with task and commitment as alternatives', () => {
    const r = parseCapture('Pay Omar 50 on Friday', ctx);
    expect(r.type).toBe('bill');
    expect(r.fields.amount).toBe(50);
    expect(r.fields.people).toContain('Omar');
    const top3 = r.alternatives.slice(0, 3).map((a) => a.type);
    expect(top3).toContain('task');
    expect(top3).toContain('commitment');
  });

  it('every result ranks all seven types', () => {
    const r = parseCapture('hello', ctx);
    expect(r.alternatives.map((a) => a.type).sort()).toEqual([
      'bill',
      'commitment',
      'event',
      'goal',
      'note',
      'routine',
      'task',
    ]);
    expect(r.type).toBe('task');
    expect(r.confidence).toBeLessThan(0.5);
  });

  it('never throws on odd input', () => {
    expect(parseCapture('', ctx).fields.title).toBe('Untitled');
    expect(parseCapture('   ', ctx).type).toBe('task');
    expect(parseCapture('@ # $ !!', ctx).type).toBeDefined();
    expect(parseCapture('12/99', ctx).fields.dueDate).toBeUndefined();
  });
});

describe('prefixes', () => {
  it('override every cue', () => {
    const r = parseCapture('n: Pay electricity bill every month', ctx);
    expect(r.type).toBe('note');
    expect(r.explicit).toBe(true);
    expect(r.confidence).toBe(1);
    expect(parseCapture('t: Dentist tomorrow at 3pm', ctx).type).toBe('task');
    expect(parseCapture('e: Submit my report', ctx).type).toBe('event');
    expect(parseCapture('$40 for the tickets', ctx).type).toBe('bill');
  });

  it('reclassify re-derives fields for the chosen type', () => {
    const r = parseCapture('Dentist tomorrow at 3pm', ctx);
    expect(r.type).toBe('event');
    const asTask = reclassify(r, 'task', ctx);
    expect(asTask.type).toBe('task');
    expect(asTask.explicit).toBe(true);
    expect(asTask.fields.dueDate).toBe('2026-09-13');
    expect(asTask.fields.dueTime).toBe(900);
    expect(asTask.fields.date).toBeUndefined();
  });
});

describe('tokens for chips', () => {
  it('reports labelled spans in source order', () => {
    const r = parseCapture('Pay #thesis printing 12 JOD by Friday for 30 min @Omar', ctx);
    const kinds = r.tokens.sort((a, b) => a.start - b.start).map((t) => `${t.kind}:${t.label}`);
    expect(kinds).toEqual([
      'project:thesis',
      'money:12 JOD',
      'date:Fri 18 Sep',
      'estimate:30m',
      'person:Omar',
    ]);
  });
});
