import { dayOfWeek, toLocalDate } from '../dates';
import type { Recurrence, Weekday } from '../schema';
import { extractAll, stripTokens, tidy, type Extracted } from './extract';
import {
  CAPTURE_TYPES,
  type CaptureAlternative,
  type CaptureContext,
  type CaptureFields,
  type CaptureResult,
  type CaptureType,
  type Classifier,
} from './types';

const CUES = {
  bill: /\b(bill|invoice|rent|subscription|fee|fees|payment|tuition|insurance|utilities|electricity|water bill|internet bill|phone bill|installment)\b/i,
  pay: /\b(pay|paid|renew)\b/i,
  routine:
    /\b(routine|habit|workout|exercise|gym|meditate|meditation|stretch|journal|practice|review my)\b/i,
  event:
    /\b(meeting|meet|call with|appointment|dentist|doctor|lunch with|dinner with|coffee with|interview|class|lecture|standup|stand-up|flight|party|wedding|birthday|visit|session|webinar|workshop|conference|exam|presentation|demo|1:1|one-on-one)\b/i,
  note: /\b(idea|note|thought|remember that|save this|insight|quote|learned|learning|reflection|observation|fyi|link:)\b|^["“]/i,
  goal: /\b(goal|aim to|i want to|become|by the end of the year|this year|long term|long-term|dream|ambition|resolution|get better at|master)\b/i,
  commitmentVerb:
    /\b(ask|call|phone|email|e-mail|text|message|msg|ping|dm|follow up with|follow-up with|check with|check in with|reply to|thank|tell|talk to|catch up with|write to|get back to|chase|owes me|i owe)\b/i,
  task: /\b(remind me to|todo|to do|task|submit|finish|write|send|buy|fix|clean|book|schedule|prepare|draft|review|update|read|study|apply|order|print|renew|cancel|organize|plan|research|pack|install|deploy|test|check)\b/i,
};

function scoreTypes(text: string, x: Extracted): Record<CaptureType, number> {
  const s: Record<CaptureType, number> = {
    task: 1,
    event: 0,
    note: 0,
    goal: 0,
    routine: 0,
    bill: 0,
    commitment: 0,
  };
  const words = text.trim().split(/\s+/).length;

  if (x.money) s.bill += 3;
  if (CUES.bill.test(text)) s.bill += 2.5;
  if (CUES.pay.test(text)) s.bill += 1.5;

  if (x.recurrence) {
    s.routine += 2.5;
    if (x.money || CUES.bill.test(text)) s.bill += 1.5; // recurring bill
  }
  if (CUES.routine.test(text)) s.routine += 1.5;
  if (x.preferredStart !== undefined) s.routine += 1;

  if (x.timeRange) s.event += 3;
  if (CUES.event.test(text)) s.event += 2;
  if (x.time !== undefined && !x.deadline && !x.recurrence) s.event += 1;
  if (x.time !== undefined && CUES.event.test(text)) s.event += 1;
  if (x.dueDate && !x.deadline && !x.time && CUES.event.test(text)) s.event += 0.5;

  if (CUES.note.test(text)) s.note += 3;
  if (
    /^\s*(idea|note|thought|insight|observation|fyi|quote|learned|remember that|save this)\b/i.test(
      text,
    )
  )
    s.note += 1;
  if (words > 18 && !x.dueDate && !x.money && !x.recurrence) s.note += 1.5;

  if (CUES.goal.test(text)) s.goal += 3;

  if (x.directedPerson) s.commitment += 2.5;
  if (CUES.commitmentVerb.test(text)) s.commitment += 1;
  if (x.directedPerson && x.money) s.bill -= 1; // "pay Omar 50" is still a bill, but closer
  if (x.direction === 'owed-to-me') s.commitment += 2;

  if (CUES.task.test(text)) s.task += 1;
  if (x.dueDate && !x.recurrence) s.task += 0.5; // "on Sundays" next to "weekly" names a day, not a deadline
  if (x.deadline) s.task += 1;
  if (x.estimateMin) s.task += 1;
  if (x.priority) s.task += 0.5;

  return s;
}

function baseRecurrence(): Recurrence {
  return { freq: 'weekly', interval: 1, byDay: [], byMonthDay: null, count: null, until: null };
}

function buildFields(
  type: CaptureType,
  text: string,
  x: Extracted,
  ctx: CaptureContext,
): CaptureFields {
  const people = [...x.mentionsPeople];
  const projects = [...x.mentionsProjects];

  // Bare mentions of known names/projects.
  for (const name of ctx.people ?? []) {
    if (
      !people.some((p) => p.toLowerCase() === name.toLowerCase()) &&
      new RegExp(`\\b${escapeRe(name)}\\b`, 'i').test(text)
    ) {
      people.push(name);
    }
  }
  for (const title of ctx.projects ?? []) {
    if (
      !projects.some((p) => p.toLowerCase() === title.toLowerCase()) &&
      new RegExp(`\\b${escapeRe(title)}\\b`, 'i').test(text)
    ) {
      projects.push(title);
    }
  }
  if (
    x.directedPerson &&
    !people.some((p) => p.toLowerCase() === x.directedPerson!.toLowerCase())
  ) {
    const known = (ctx.people ?? []).find(
      (p) => p.toLowerCase() === x.directedPerson!.toLowerCase(),
    );
    people.push(known ?? x.directedPerson);
  }

  // A leading adverb like "Weekly review" is part of the name, not just a schedule.
  const strippable = x.tokens.filter(
    (t) =>
      !(
        t.kind === 'recurrence' &&
        t.start === 0 &&
        /^(daily|weekly|monthly|yearly|nightly)$/i.test(t.text.trim())
      ),
  );
  const title = stripTokens(text, strippable);
  const fields: CaptureFields = { title: title || tidy(text) || 'Untitled', people, projects };
  const today = toLocalDate(ctx.now);

  switch (type) {
    case 'task':
      if (x.dueDate) fields.dueDate = x.dueDate;
      else if (x.time !== undefined) fields.dueDate = today; // "at 5" means today
      if (x.time !== undefined) fields.dueTime = x.time;
      if (x.estimateMin) fields.estimateMin = x.estimateMin;
      if (x.priority) fields.priority = x.priority;
      break;
    case 'event': {
      fields.date = x.dueDate;
      if (x.timeRange) {
        fields.startMin = x.timeRange.startMin;
        fields.endMin = x.timeRange.endMin;
      } else if (x.time !== undefined) {
        fields.startMin = x.time;
        fields.endMin = Math.min(1440, x.time + (x.estimateMin ?? 60));
      }
      // Keep the estimate token in the title only if it was a duration for the event.
      break;
    }
    case 'note': {
      const body = text.replace(/^\s*(n|note|idea):\s*/i, '').trim();
      const firstLine = body.split(/\n|(?<=[.!?])\s+/)[0] ?? body;
      fields.title =
        tidy(firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine) || 'Note';
      fields.body = body;
      break;
    }
    case 'goal':
      if (x.dueDate) fields.dueDate = x.dueDate;
      break;
    case 'routine': {
      let rec: Recurrence = x.recurrence ?? baseRecurrence();
      // "Weekly review on Sundays": the weekday phrase names the day, not a deadline.
      if (rec.freq === 'weekly' && rec.byDay.length === 0 && x.dueDate && !x.timesPerWeek) {
        const dow = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][dayOfWeek(x.dueDate)] as Weekday;
        rec = { ...rec, byDay: [dow] };
      }
      fields.recurrence = rec;
      if (x.timesPerWeek) fields.timesPerWeek = x.timesPerWeek;
      if (x.estimateMin) fields.durationMin = x.estimateMin;
      if (x.timeRange) {
        fields.startMin = x.timeRange.startMin;
        fields.durationMin = fields.durationMin ?? x.timeRange.endMin - x.timeRange.startMin;
      } else if (x.time !== undefined) fields.startMin = x.time;
      else if (x.preferredStart !== undefined) fields.startMin = x.preferredStart;
      break;
    }
    case 'bill':
      if (x.money) {
        fields.amount = x.money.amount;
        fields.currency = x.money.currency;
      }
      if (x.dueDate) fields.dueDate = x.dueDate;
      if (x.recurrence) fields.recurrence = x.recurrence;
      if (
        x.directedPerson &&
        !fields.title.toLowerCase().includes(x.directedPerson.toLowerCase())
      ) {
        fields.title = `${fields.title} ${x.directedPerson}`.trim();
      }
      break;
    case 'commitment':
      fields.person = x.directedPerson ?? people[0];
      fields.direction = x.direction ?? 'owed-by-me';
      if (x.dueDate) fields.dueDate = x.dueDate;
      if (x.time !== undefined) fields.dueTime = x.time;
      break;
  }
  return fields;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Deterministic, offline capture parser. Returns the best type, its fields,
 * a confidence in [0, 1], and every other type ranked for one-keystroke
 * correction. Never throws on user text; empty input yields an empty task.
 */
export function parseCapture(text: string, ctx: CaptureContext): CaptureResult {
  const clean = text ?? '';
  const x = extractAll(clean, ctx.now);

  let type: CaptureType;
  let explicit = false;
  let confidence: number;
  const scores = scoreTypes(clean, x);

  if (x.prefix && (CAPTURE_TYPES as readonly string[]).includes(x.prefix)) {
    type = x.prefix as CaptureType;
    explicit = true;
    confidence = 1;
    scores[type] += 100;
  } else {
    const ranked = [...CAPTURE_TYPES].sort(
      (a, b) => scores[b] - scores[a] || CAPTURE_TYPES.indexOf(a) - CAPTURE_TYPES.indexOf(b),
    );
    type = ranked[0]!;
    const top = scores[type];
    const second = scores[ranked[1]!] ?? 0;
    confidence =
      top <= 1 ? 0.35 : Math.max(0.35, Math.min(0.98, 0.5 + (top - second) / (top + second)));
  }

  const alternatives: CaptureAlternative[] = [...CAPTURE_TYPES]
    .map((t) => ({ type: t, score: scores[t] }))
    .sort(
      (a, b) => b.score - a.score || CAPTURE_TYPES.indexOf(a.type) - CAPTURE_TYPES.indexOf(b.type),
    );

  return {
    text: clean,
    type,
    confidence: Number(confidence.toFixed(2)),
    explicit,
    fields: buildFields(type, clean, x, ctx),
    alternatives,
    tokens: x.tokens,
  };
}

/** Re-derive fields for a different type without re-parsing the text differently. */
export function reclassify(
  result: CaptureResult,
  type: CaptureType,
  ctx: CaptureContext,
): CaptureResult {
  const x = extractAll(result.text, ctx.now);
  return {
    ...result,
    type,
    explicit: true,
    confidence: 1,
    fields: buildFields(type, result.text, x, ctx),
  };
}

export const ruleClassifier: Classifier = {
  classify: parseCapture,
};
