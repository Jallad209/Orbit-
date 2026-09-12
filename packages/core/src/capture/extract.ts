import { addDays, daysInMonth, formatMinute, minuteOfDay, toLocalDate } from '../dates';
import type { LocalDate, Recurrence, Weekday } from '../schema';
import type { CaptureToken, TokenKind } from './types';

/**
 * Span-based extractors. Each scans the original text and claims spans;
 * later extractors skip anything that overlaps an earlier claim. Order in
 * `extractAll` therefore encodes precedence (e.g. recurrence before date so
 * "every friday" is a routine, not a deadline).
 */

export interface Extracted {
  tokens: CaptureToken[];
  prefix?: string;
  dueDate?: LocalDate;
  /** True when the date phrase was explicitly a deadline ("by", "due"). */
  deadline?: boolean;
  time?: number;
  timeRange?: { startMin: number; endMin: number };
  recurrence?: Recurrence;
  timesPerWeek?: number;
  preferredStart?: number;
  money?: { amount: number; currency: string };
  estimateMin?: number;
  priority?: 1 | 2 | 3;
  mentionsPeople: string[];
  mentionsProjects: string[];
  /** Person named after a directed verb ("ask Omar", "call Sara"). */
  directedPerson?: string;
  direction?: 'owed-by-me' | 'owed-to-me';
}

const WEEKDAYS: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const WEEKDAY_RE =
  'mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?';
const MONTH_RE =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const NUM_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function weekdayIndex(word: string): number {
  const w = word.slice(0, 3).toLowerCase();
  return ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(w);
}

function monthIndex(word: string): number {
  const w = word.slice(0, 3).toLowerCase();
  return [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ].indexOf(w);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function makeDate(y: number, m0: number, d: number): LocalDate {
  return `${y}-${pad2(m0 + 1)}-${pad2(d)}`;
}

/** Monday-based index 0..6 of a local date. */
function mondayIndex(date: LocalDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const js = new Date(y, m - 1, d).getDay(); // 0 = Sunday
  return (js + 6) % 7;
}

/** First occurrence of `dow` (0 = Mon) strictly after `from`. */
function nextWeekday(from: LocalDate, dow: number): LocalDate {
  const cur = mondayIndex(from);
  let delta = (dow - cur + 7) % 7;
  if (delta === 0) delta = 7;
  return addDays(from, delta);
}

/** Same weekday in the following Monday–Sunday week. */
function weekdayNextWeek(from: LocalDate, dow: number): LocalDate {
  const cur = mondayIndex(from);
  const monday = addDays(from, 7 - cur); // next week's Monday
  return addDays(monday, dow);
}

export function formatDateLabel(date: LocalDate, today: LocalDate): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const js = new Date(y, m - 1, d);
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][js.getDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    m - 1
  ];
  const yearPart = y === Number(today.slice(0, 4)) ? '' : ` ${y}`;
  return `${dow} ${d} ${mon}${yearPart}`;
}

export function formatRecurrenceLabel(r: Recurrence, timesPerWeek?: number): string {
  if (timesPerWeek) return `${timesPerWeek}× a week`;
  const every = r.interval > 1 ? `every ${r.interval} ` : 'every ';
  if (r.freq === 'daily') return r.interval > 1 ? `${every}days` : 'every day';
  if (r.freq === 'weekly') {
    if (r.byDay.length === 5 && !r.byDay.includes('SA') && !r.byDay.includes('SU'))
      return 'weekdays';
    if (r.byDay.length)
      return `${every}${r.byDay.map((d) => d[0] + d.slice(1).toLowerCase()).join('/')}`;
    return r.interval > 1 ? `${every}weeks` : 'every week';
  }
  if (r.interval === 12) return 'every year';
  const day = r.byMonthDay ? ` on the ${ordinal(r.byMonthDay)}` : '';
  return r.interval > 1 ? `${every}months${day}` : `every month${day}`;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

class Claims {
  private spans: Array<[number, number]> = [];
  readonly tokens: CaptureToken[] = [];

  overlaps(start: number, end: number): boolean {
    return this.spans.some(([s, e]) => start < e && end > s);
  }

  claim(kind: TokenKind, text: string, start: number, end: number, label: string): boolean {
    if (this.overlaps(start, end)) return false;
    this.spans.push([start, end]);
    this.tokens.push({ kind, text, start, end, label });
    return true;
  }
}

function hourTo24(h: number, ampm: string | undefined, bare: boolean, evening = false): number {
  const p = ampm?.replace(/\./g, '').toLowerCase();
  if (p === 'pm') return h === 12 ? 12 : h + 12;
  if (p === 'am') return h === 12 ? 0 : h;
  // No meridiem: small bare hours are almost always afternoon ("at 5"), and
  // 7–11 lean evening when the text says so ("dinner at 8").
  if (bare && h >= 1 && h <= 6) return h + 12;
  if (bare && evening && h >= 7 && h <= 11) return h + 12;
  return h;
}

const EVENING_HINT = /\b(dinner|evening|night|tonight|party|drinks|bedtime)\b/i;

export function extractAll(text: string, now: Date): Extracted {
  const claims = new Claims();
  const today = toLocalDate(now);
  const evening = EVENING_HINT.test(text);
  const out: Extracted = { tokens: claims.tokens, mentionsPeople: [], mentionsProjects: [] };

  // 1. Explicit prefix ---------------------------------------------------
  const prefix =
    /^\s*(t|n|e|g|r|b|c|task|note|event|goal|routine|bill|commitment|idea|remind):\s*/i.exec(text);
  if (prefix) {
    const p = prefix[1]!.toLowerCase();
    out.prefix =
      {
        t: 'task',
        n: 'note',
        e: 'event',
        g: 'goal',
        r: 'routine',
        b: 'bill',
        c: 'commitment',
        idea: 'note',
        remind: 'commitment',
      }[p] ?? p;
    claims.claim('prefix', prefix[0], 0, prefix[0].length, out.prefix);
  } else if (/^\s*\$\s*\d/.test(text)) {
    out.prefix = 'bill';
  }

  // 2. Mentions ----------------------------------------------------------
  for (const m of text.matchAll(/(^|[\s(])@([\p{L}][\p{L}\d_'-]*)/gu)) {
    const start = m.index! + m[1]!.length;
    const name = m[2]!;
    if (claims.claim('person', `@${name}`, start, start + name.length + 1, name)) {
      out.mentionsPeople.push(name);
    }
  }
  for (const m of text.matchAll(/(^|[\s(])#([\p{L}\d][\p{L}\d_-]*)/gu)) {
    const start = m.index! + m[1]!.length;
    const name = m[2]!;
    if (claims.claim('project', `#${name}`, start, start + name.length + 1, name)) {
      out.mentionsProjects.push(name);
    }
  }

  // 3. Time ranges (before single times and dates) -----------------------
  {
    const re =
      /\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:-|–|—|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/gi;
    for (const m of text.matchAll(re)) {
      const [whole, h1, m1, p1, h2, m2, p2] = m;
      if (!p1 && !p2 && !m1 && !m2) continue; // "2-3 days", "1-2 people"
      const endH = hourTo24(Number(h2), p2, false);
      let startH = hourTo24(Number(h1), p1 ?? p2, false);
      if (!p1 && p2 && startH > endH) startH -= 12; // "11-1pm" → 11:00–13:00
      const startMin = startH * 60 + Number(m1 ?? 0);
      const endMin = endH * 60 + Number(m2 ?? 0);
      if (startMin >= endMin || endMin > 1440) continue;
      if (
        claims.claim(
          'time',
          whole,
          m.index!,
          m.index! + whole.length,
          `${formatMinute(startMin)}–${formatMinute(endMin)}`,
        )
      ) {
        out.timeRange = { startMin, endMin };
        break;
      }
    }
  }

  // 4. Recurrence (before dates: "every friday" is not a deadline) --------
  {
    const weekdayList = `(?:${WEEKDAY_RE})(?:\\s*(?:,|/|and|&)\\s*(?:${WEEKDAY_RE}))*`;
    const re = new RegExp(
      `\\b(?:(every|each)\\s+(?:(other|second|\\d+)\\s+)?(day|weekday|week|month|year|morning|evening|night|${weekdayList})s?|(daily|weekly|monthly|yearly|annually|nightly)|(?:on\\s+)?(weekdays))\\b(?:\\s+on\\s+the\\s+(\\d{1,2})(?:st|nd|rd|th)\\b)?`,
      'gi',
    );
    const m = re.exec(text);
    if (m) {
      const [whole, , intervalWord, unit, adverb, weekdaysWord, monthDay] = m;
      const interval =
        intervalWord === 'other' || intervalWord === 'second'
          ? 2
          : intervalWord
            ? Number(intervalWord)
            : 1;
      let rec: Recurrence | undefined;
      const u = (unit ?? adverb ?? weekdaysWord ?? '').toLowerCase();
      if (u === 'day' || u === 'daily')
        rec = { freq: 'daily', interval, byDay: [], byMonthDay: null, count: null, until: null };
      else if (u === 'morning' || u === 'evening' || u === 'night' || u === 'nightly') {
        rec = { freq: 'daily', interval, byDay: [], byMonthDay: null, count: null, until: null };
        out.preferredStart = u === 'morning' ? 8 * 60 : u === 'evening' ? 18 * 60 : 21 * 60;
      } else if (u === 'weekday' || u === 'weekdays') {
        rec = {
          freq: 'weekly',
          interval,
          byDay: ['MO', 'TU', 'WE', 'TH', 'FR'],
          byMonthDay: null,
          count: null,
          until: null,
        };
      } else if (u === 'week' || u === 'weekly') {
        rec = { freq: 'weekly', interval, byDay: [], byMonthDay: null, count: null, until: null };
      } else if (u === 'month' || u === 'monthly') {
        rec = {
          freq: 'monthly',
          interval,
          byDay: [],
          byMonthDay: monthDay ? Number(monthDay) : null,
          count: null,
          until: null,
        };
      } else if (u === 'year' || u === 'yearly' || u === 'annually') {
        rec = {
          freq: 'monthly',
          interval: 12 * interval,
          byDay: [],
          byMonthDay: null,
          count: null,
          until: null,
        };
      } else {
        // weekday list
        const days = Array.from(u.matchAll(new RegExp(WEEKDAY_RE, 'gi')))
          .map((x) => weekdayIndex(x[0]))
          .filter((i) => i >= 0)
          .map((i) => WEEKDAYS[i]!);
        rec = {
          freq: 'weekly',
          interval,
          byDay: [...new Set(days)],
          byMonthDay: null,
          count: null,
          until: null,
        };
      }
      if (
        rec &&
        claims.claim(
          'recurrence',
          whole,
          m.index!,
          m.index! + whole.length,
          formatRecurrenceLabel(rec),
        )
      ) {
        out.recurrence = rec;
      }
    }
    const times =
      /\b(once|twice|thrice|three times|four times|five times|(\d+)\s*(?:times|x))\s+(?:a|per|every)\s+week\b/i.exec(
        text,
      );
    if (times) {
      const w = times[1]!.toLowerCase();
      const n =
        w === 'once'
          ? 1
          : w === 'twice'
            ? 2
            : w === 'thrice' || w === 'three times'
              ? 3
              : w === 'four times'
                ? 4
                : w === 'five times'
                  ? 5
                  : Number(times[2]);
      const rec: Recurrence = {
        freq: 'weekly',
        interval: 1,
        byDay: [],
        byMonthDay: null,
        count: null,
        until: null,
      };
      if (
        claims.claim(
          'recurrence',
          times[0],
          times.index!,
          times.index! + times[0].length,
          `${n}× a week`,
        )
      ) {
        out.recurrence = rec;
        out.timesPerWeek = n;
      }
    }
  }

  // 5. Money ---------------------------------------------------------------
  {
    const sym: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP' };
    const word: Record<string, string> = {
      usd: 'USD',
      dollars: 'USD',
      dollar: 'USD',
      bucks: 'USD',
      eur: 'EUR',
      euros: 'EUR',
      euro: 'EUR',
      gbp: 'GBP',
      pounds: 'GBP',
      pound: 'GBP',
      quid: 'GBP',
      jod: 'JOD',
      jd: 'JOD',
      dinars: 'JOD',
      dinar: 'JOD',
      egp: 'EGP',
      le: 'EGP',
      sar: 'SAR',
      riyals: 'SAR',
      riyal: 'SAR',
      aed: 'AED',
      dirhams: 'AED',
      dirham: 'AED',
    };
    const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
    const re = new RegExp(
      `(?:(\\$|€|£)\\s?(${NUM})|\\b(${NUM})\\s?(\\$|€|£|usd|dollars?|bucks|eur|euros?|gbp|pounds?|quid|jod|jd|dinars?|egp|le|sar|riyals?|aed|dirhams?)(?![a-z\\d]))`,
      'i',
    );
    const parseAmount = (s: string) =>
      Number(/^\d{1,3}(,\d{3})+/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.'));
    const m = re.exec(text);
    if (m) {
      const amount = parseAmount(m[2] ?? m[3] ?? '0');
      const cur = m[1] ?? m[4] ?? '';
      const currency = sym[cur] ?? word[cur.toLowerCase()] ?? cur.toUpperCase();
      if (
        claims.claim(
          'money',
          m[0],
          m.index!,
          m.index! + m[0].length,
          `${amount} ${currency}`.trim(),
        )
      ) {
        out.money = { amount, currency };
      }
    } else {
      // "pay Omar 50", "pay the plumber 85": a bare amount after "pay".
      const pay =
        /\bpay(?:ing)?\s+(?:back\s+)?(?:(?:the|my|our)\s+)?(?:[\p{L}'’-]+\s+){0,2}?(\d{1,6}(?:[.,]\d{1,2})?)\b(?!\s*(?:am|pm|:|h\b|hours?|min|days?|weeks?|months?|st|nd|rd|th))/iu.exec(
          text,
        );
      if (pay) {
        const numStart = pay.index! + pay[0].lastIndexOf(pay[1]!);
        const amount = parseAmount(pay[1]!);
        if (claims.claim('money', pay[1]!, numStart, numStart + pay[1]!.length, String(amount))) {
          out.money = { amount, currency: '' };
        }
      }
    }
  }

  // 6. Relative durations ("in 3 days", "in 2 hours") ----------------------
  {
    const re =
      /\b(in|after|within)\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(minutes?|mins?|hours?|hrs?|days?|weeks?|months?)\b/gi;
    for (const m of text.matchAll(re)) {
      const n = NUM_WORDS[m[2]!.toLowerCase()] ?? Number(m[2]);
      const unit = m[3]!.toLowerCase();
      let date: LocalDate;
      let time: number | undefined;
      if (unit.startsWith('min')) {
        const at = new Date(now.getTime() + n * 60_000);
        date = toLocalDate(at);
        time = minuteOfDay(at);
      } else if (unit.startsWith('h')) {
        const at = new Date(now.getTime() + n * 3_600_000);
        date = toLocalDate(at);
        time = minuteOfDay(at);
      } else if (unit.startsWith('d')) date = addDays(today, n);
      else if (unit.startsWith('w')) date = addDays(today, 7 * n);
      else {
        const [y, mo, d] = today.split('-').map(Number) as [number, number, number];
        const target = new Date(y, mo - 1 + n, 1);
        const dim = daysInMonth(target.getFullYear(), target.getMonth() + 1);
        date = makeDate(target.getFullYear(), target.getMonth(), Math.min(d, dim));
      }
      const label =
        time !== undefined
          ? `${formatDateLabel(date, today)} ${formatMinute(time)}`
          : formatDateLabel(date, today);
      if (claims.claim('date', m[0], m.index!, m.index! + m[0].length, label)) {
        out.dueDate = date;
        if (time !== undefined) out.time = time;
        break;
      }
    }
  }

  // 7. Absolute and relative dates ----------------------------------------
  if (!out.dueDate) {
    const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
    type Cand = { start: number; end: number; date: LocalDate; deadline?: boolean; time?: number };
    const cands: Cand[] = [];
    const push = (m: RegExpMatchArray, date: LocalDate, extra: Partial<Cand> = {}) =>
      cands.push({ start: m.index!, end: m.index! + m[0].length, date, ...extra });

    // ISO
    for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(m, m[0]);
    // 12 Oct [2026] / 12th of October
    for (const m of text.matchAll(
      new RegExp(
        `\\b(?:(by|due|on|until|before)\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\b\\.?(?:,?\\s+(\\d{4}))?`,
        'gi',
      ),
    )) {
      const d = Number(m[2]);
      const mo = monthIndex(m[3]!);
      let y = m[4] ? Number(m[4]) : ty;
      if (!m[4] && makeDate(y, mo, d) < today) y += 1;
      push(m, makeDate(y, mo, Math.min(d, daysInMonth(y, mo + 1))), {
        deadline: /by|due|before|until/i.test(m[1] ?? ''),
      });
    }
    // Oct 12 [, 2026]
    for (const m of text.matchAll(
      new RegExp(
        `\\b(?:(by|due|on|until|before)\\s+)?(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`,
        'gi',
      ),
    )) {
      const d = Number(m[3]);
      const mo = monthIndex(m[2]!);
      let y = m[4] ? Number(m[4]) : ty;
      if (!m[4] && makeDate(y, mo, d) < today) y += 1;
      push(m, makeDate(y, mo, Math.min(d, daysInMonth(y, mo + 1))), {
        deadline: /by|due|before|until/i.test(m[1] ?? ''),
      });
    }
    // by June / in December (month only → last day of that month)
    for (const m of text.matchAll(
      new RegExp(`\\b(by|in|until|before|due|end of)\\s+(${MONTH_RE})\\b(?!\\s+\\d)`, 'gi'),
    )) {
      const mo = monthIndex(m[2]!);
      const y = mo < tm - 1 ? ty + 1 : ty;
      push(m, makeDate(y, mo, daysInMonth(y, mo + 1)), {
        deadline: /by|until|before|due|end of/i.test(m[1]!),
      });
    }
    // D/M[/Y]
    for (const m of text.matchAll(
      /\b(?:(by|due|on|until|before)\s+)?(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b(?!\s*(?:h\b|hours?|hrs?|min|m\b))/gi,
    )) {
      const d = Number(m[2]);
      const mo = Number(m[3]) - 1;
      if (mo < 0 || mo > 11 || d < 1 || d > 31) continue;
      let y = m[4] ? (m[4].length === 2 ? 2000 + Number(m[4]) : Number(m[4])) : ty;
      if (!m[4] && makeDate(y, mo, d) < today) y += 1;
      push(m, makeDate(y, mo, Math.min(d, daysInMonth(y, mo + 1))), {
        deadline: /by|due|before|until/i.test(m[1] ?? ''),
      });
    }
    // today / tomorrow / tonight
    for (const m of text.matchAll(
      /\b(?:(by|due|until|before)\s+)?(?:the\s+)?(day after tomorrow|tomorrow|today|tonight)\b/gi,
    )) {
      const w = m[2]!.toLowerCase();
      const date =
        w === 'today' || w === 'tonight'
          ? today
          : w === 'tomorrow'
            ? addDays(today, 1)
            : addDays(today, 2);
      push(m, date, { deadline: !!m[1], time: w === 'tonight' ? 20 * 60 : undefined });
    }
    // weekdays with optional next/this
    for (const m of text.matchAll(
      new RegExp(
        `\\b(?:(by|due|on|until|before|for)\\s+)?(?:(next|this|coming)\\s+)?(${WEEKDAY_RE})s?\\b`,
        'gi',
      ),
    )) {
      const dow = weekdayIndex(m[3]!);
      const date =
        m[2]?.toLowerCase() === 'next' ? weekdayNextWeek(today, dow) : nextWeekday(today, dow);
      push(m, date, { deadline: /by|due|before|until/i.test(m[1] ?? '') });
    }
    // next week / month / year / weekend; "this X" means the end of the current one
    for (const m of text.matchAll(
      /\b(?:(by|due|until|before)\s+)?(next|this)\s+(week|month|year|weekend)\b/gi,
    )) {
      const which = m[2]!.toLowerCase();
      const unit = m[3]!.toLowerCase();
      const wd = mondayIndex(today);
      let date: LocalDate;
      if (unit === 'week')
        date = which === 'next' ? addDays(today, 7 - wd) : addDays(today, 6 - wd);
      else if (unit === 'weekend') {
        if (which === 'next') date = weekdayNextWeek(today, 5);
        else date = wd >= 5 ? today : nextWeekday(today, 5);
      } else if (unit === 'month') {
        date =
          which === 'next'
            ? makeDate(tm === 12 ? ty + 1 : ty, tm % 12, 1)
            : makeDate(ty, tm - 1, daysInMonth(ty, tm));
      } else date = which === 'next' ? makeDate(ty + 1, 0, 1) : makeDate(ty, 11, 31);
      push(m, date, { deadline: !!m[1] || which === 'this' });
    }
    // end of day/week/month/year
    for (const m of text.matchAll(
      /\b(?:(by|at|until|before)\s+)?(?:the\s+)?end of (?:the\s+|this\s+)?(day|week|month|year)\b/gi,
    )) {
      const unit = m[2]!.toLowerCase();
      let date: LocalDate;
      let time: number | undefined;
      if (unit === 'day') {
        date = today;
        time = 17 * 60;
      } else if (unit === 'week') date = addDays(today, 6 - mondayIndex(today));
      else if (unit === 'month') date = makeDate(ty, tm - 1, daysInMonth(ty, tm));
      else date = makeDate(ty, 11, 31);
      push(m, date, { deadline: true, time });
    }
    // on the 5th (this month, or next if passed)
    for (const m of text.matchAll(
      /\b(?:(by|due|on|until|before)\s+)(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/gi,
    )) {
      const d = Number(m[2]);
      if (d < 1 || d > 31) continue;
      let y = ty;
      let mo = tm - 1;
      if (d < td) {
        mo += 1;
        if (mo > 11) {
          mo = 0;
          y += 1;
        }
      }
      push(m, makeDate(y, mo, Math.min(d, daysInMonth(y, mo + 1))), {
        deadline: /by|due|before|until/i.test(m[1] ?? ''),
      });
    }

    cands.sort((a, b) => a.start - b.start);
    for (const c of cands) {
      const label =
        c.time !== undefined
          ? `${formatDateLabel(c.date, today)} ${formatMinute(c.time)}`
          : formatDateLabel(c.date, today);
      if (claims.claim('date', text.slice(c.start, c.end), c.start, c.end, label)) {
        out.dueDate = c.date;
        out.deadline = c.deadline;
        if (c.time !== undefined && out.time === undefined) out.time = c.time;
        break;
      }
    }
  }

  // 8. Single times ---------------------------------------------------------
  if (out.time === undefined && !out.timeRange) {
    const re =
      /\b(?:(at|@)\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b|\b(noon|midday|midnight)\b|\b(?:in the\s+)?(morning|afternoon|evening|night)\b/gi;
    for (const m of text.matchAll(re)) {
      let min: number | undefined;
      if (m[5]) min = m[5].toLowerCase() === 'midnight' ? 0 : 12 * 60;
      else if (m[6])
        min = { morning: 9 * 60, afternoon: 14 * 60, evening: 18 * 60, night: 21 * 60 }[
          m[6].toLowerCase()
        ];
      else {
        const hasAt = !!m[1];
        const h = Number(m[2]);
        const mm = m[3] ? Number(m[3]) : 0;
        if (!hasAt && !m[4] && !m[3]) continue; // bare number without at/am/pm/colon is not a time
        if (h > 24 || mm > 59) continue;
        min = hourTo24(h, m[4], hasAt && !m[3], evening) * 60 + mm;
      }
      if (
        min !== undefined &&
        claims.claim('time', m[0], m.index!, m.index! + m[0].length, formatMinute(min))
      ) {
        out.time = min;
        break;
      }
    }
  }

  // 9. Estimates ("for 45 min", "2h", "1h30") --------------------------------
  {
    const re =
      /\b(?:(?:for|takes?|~|about|around)\s+)?(?:(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)(?:\s*(?:and\s+)?(\d+)\s*(?:minutes?|mins?|m))?|(\d+)h(\d{2})|(\d+)\s*(minutes?|mins?|m))\b/gi;
    for (const m of text.matchAll(re)) {
      let minutes: number;
      if (m[1]) minutes = Math.round(Number(m[1]) * 60) + Number(m[3] ?? 0);
      else if (m[4]) minutes = Number(m[4]) * 60 + Number(m[5]);
      else minutes = Number(m[6]);
      if (minutes <= 0 || minutes > 24 * 60) continue;
      const label =
        minutes >= 60
          ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`
          : `${minutes}m`;
      if (claims.claim('estimate', m[0], m.index!, m.index! + m[0].length, label)) {
        out.estimateMin = minutes;
        break;
      }
    }
  }

  // 10. Priority -------------------------------------------------------------
  {
    const re =
      /\b(urgent|asap|critical|high priority|important|top priority)\b|(!{2,})|\b(low priority|someday|maybe|whenever|no rush)\b|\bp([123])\b/gi;
    for (const m of text.matchAll(re)) {
      const p: 1 | 2 | 3 = m[1] || m[2] ? 1 : m[3] ? 3 : (Number(m[4]) as 1 | 2 | 3);
      if (claims.claim('priority', m[0], m.index!, m.index! + m[0].length, `P${p}`)) {
        out.priority = p;
        break;
      }
    }
  }

  // 11. Directed person ("ask Omar", "call Sara Ahmed") ----------------------
  {
    const re =
      /\b(ask|call|phone|email|e-mail|text|message|msg|ping|dm|follow up with|follow-up with|check in with|check with|meeting with|meet with|meet|lunch with|dinner with|coffee with|call with|reply to|thank|tell|talk to|catch up with|write to|get back to|chase|visit|pay back|pay|owe)\s+(@?)([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*)?)/iu;
    const m = re.exec(text);
    if (m) {
      const isCap = (w: string) => w[0] !== undefined && w[0] !== w[0].toLowerCase();
      // Keep only the leading capitalised words: "ask Omar about" → "Omar".
      const words: string[] = [];
      for (const w of m[3]!.split(/\s+/)) {
        if (!isCap(w)) break;
        words.push(w.replace(/['’]s$/i, ''));
      }
      const name = words.join(' ');
      const lower = name.toLowerCase();
      const stop = [
        'i',
        'me',
        'my',
        'the',
        'a',
        'an',
        'him',
        'her',
        'them',
        'mom',
        'dad',
        'hr',
        'it',
        'back',
        'the',
      ];
      if (name && !stop.includes(lower)) {
        out.directedPerson = name;
        out.direction = 'owed-by-me';
      }
    }
    const owes = /\b([A-Z][\p{L}'’-]+)\s+owes\s+me\b/u.exec(text);
    if (owes) {
      out.directedPerson = owes[1]!;
      out.direction = 'owed-to-me';
    }
    const iowe = /\bI\s+owe\s+([A-Z][\p{L}'’-]+)\b/u.exec(text);
    if (iowe) {
      out.directedPerson = iowe[1]!;
      out.direction = 'owed-by-me';
    }
  }

  return out;
}

/** Remove claimed spans and tidy the remainder into a title. */
export function stripTokens(text: string, tokens: CaptureToken[], keep: TokenKind[] = []): string {
  const remove = tokens.filter((t) => !keep.includes(t.kind)).sort((a, b) => b.start - a.start);
  let s = text;
  for (const t of remove) {
    // Mentions keep their name, minus the sigil.
    const replacement = t.kind === 'person' || t.kind === 'project' ? ` ${t.label} ` : ' ';
    s = s.slice(0, t.start) + replacement + s.slice(t.end);
  }
  return tidy(s);
}

export function tidy(s: string): string {
  let t = s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, '')
    .replace(/\s*\(\s*\)/g, '')
    .trim();
  // Dangling connectors left behind by removed tokens.
  const dangling =
    /\s+(on|at|by|due|for|every|each|in|until|till|from|to|the|and|@|before|after|around|about|is|are|was)$/i;
  let prev = '';
  while (prev !== t) {
    prev = t;
    t = t
      .replace(dangling, '')
      .replace(
        /\s+(on|at|by|due|for|until|till|from|and|the)\s+(on|at|by|due|for|until|till|from|and)\s+/gi,
        ' ',
      )
      .trim();
  }
  t = t.replace(
    /^(remind me to|reminder to|remember to|i need to|i have to|i should|need to|have to|todo:?|to do:?)\s+/i,
    '',
  );
  t = t.replace(/^(on|at|by|the)\s+/i, '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}
