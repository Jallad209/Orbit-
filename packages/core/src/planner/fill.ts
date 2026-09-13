import { formatDuration } from '../durations';
import { roundUpTo } from './capacity';
import type { Scored } from './score';
import type { FreeInterval, LeftOut, PlanSettings, ProposedBlock } from './types';

export interface Placement {
  scored: Scored;
  parts: Array<{ startMin: number; endMin: number }>;
}

export interface FillResult {
  placed: Placement[];
  leftOut: LeftOut[];
  /** What remains after filling. */
  free: FreeInterval[];
}

function fits(i: FreeInterval, c: Scored['candidate']): boolean {
  if (i.areaId !== null && i.areaId !== c.areaId) return false;
  if (!i.highEnergyAllowed && c.energy === 'high') return false;
  return true;
}

function length(i: FreeInterval): number {
  return i.endMin - i.startMin;
}

/** Carve `[start, start+need)` out of `interval`, leaving the buffer after it. */
function consume(
  free: FreeInterval[],
  interval: FreeInterval,
  start: number,
  need: number,
  settings: PlanSettings,
): FreeInterval[] {
  const out: FreeInterval[] = [];
  for (const i of free) {
    if (i !== interval) {
      out.push(i);
      continue;
    }
    if (start > i.startMin) out.push({ ...i, endMin: start });
    const after = start + need + settings.bufferMin;
    if (i.endMin - after >= settings.minBlockMin) out.push({ ...i, startMin: after });
  }
  return out.sort((a, b) => a.startMin - b.startMin);
}

/** Intervals ordered by preference: preferred window / before due time first, then earliest. */
function ordered(free: FreeInterval[], c: Scored['candidate'], need: number): FreeInterval[] {
  const usable = free.filter((i) => fits(i, c));
  const preferred = (i: FreeInterval) => {
    if (c.preferredWindow) {
      return i.startMin < c.preferredWindow.endMin && i.endMin > c.preferredWindow.startMin;
    }
    if (c.dueMin !== null) return i.startMin + need <= c.dueMin;
    return false;
  };
  const first = usable.filter(preferred);
  const rest = usable.filter((i) => !first.includes(i));
  return [...first, ...rest];
}

/**
 * Greedy fill: candidates in score order, each into the earliest usable
 * interval that holds it. Long tasks may be split into a few parts when no
 * single interval fits. Everything else is left out with `capacity`.
 */
export function greedyFill(
  ranked: readonly Scored[],
  initialFree: readonly FreeInterval[],
  settings: PlanSettings,
): FillResult {
  let free = [...initialFree];
  const placed: Placement[] = [];
  const leftOut: LeftOut[] = [];

  for (const s of ranked) {
    const c = s.candidate;
    if (s.score < settings.minScore) {
      leftOut.push(out(s, 'lowScore', `Score ${s.score} is below today’s bar`));
      continue;
    }
    const need = roundUpTo(Math.max(c.durationMin, settings.minBlockMin), settings.gridMin);
    const options = ordered(free, c, need);

    const whole = options.find((i) => length(i) >= need);
    if (whole) {
      let start = whole.startMin;
      if (c.preferredWindow && whole.startMin < c.preferredWindow.startMin) {
        const inWindow = roundUpTo(c.preferredWindow.startMin, settings.gridMin);
        if (inWindow + need <= whole.endMin) start = inWindow;
      }
      placed.push({ scored: s, parts: [{ startMin: start, endMin: start + need }] });
      free = consume(free, whole, start, need, settings);
      continue;
    }

    const split = trySplit(options, need, settings);
    if (split) {
      placed.push({ scored: s, parts: split.parts });
      for (const p of split.used) free = consume(free, p.interval, p.startMin, p.need, settings);
      continue;
    }

    const usable = free.filter((i) => fits(i, c)).reduce((sum, i) => sum + length(i), 0);
    leftOut.push(
      out(
        s,
        'capacity',
        usable === 0
          ? 'No free time left today'
          : `Needs ${formatDuration(need)}, only ${formatDuration(usable)} free in one stretch`,
      ),
    );
  }

  placed.sort((a, b) => a.parts[0]!.startMin - b.parts[0]!.startMin);
  return { placed, leftOut, free };
}

function trySplit(
  options: FreeInterval[],
  need: number,
  settings: PlanSettings,
): {
  parts: Array<{ startMin: number; endMin: number }>;
  used: Array<{ interval: FreeInterval; startMin: number; need: number }>;
} | null {
  if (need <= settings.splitThresholdMin || settings.maxSplitParts < 2) return null;
  const byTime = [...options].sort((a, b) => a.startMin - b.startMin);
  const parts: Array<{ startMin: number; endMin: number }> = [];
  const used: Array<{ interval: FreeInterval; startMin: number; need: number }> = [];
  let remaining = need;
  for (const i of byTime) {
    if (remaining === 0 || parts.length === settings.maxSplitParts) break;
    let chunk = Math.min(remaining, Math.floor(length(i) / settings.gridMin) * settings.gridMin);
    if (chunk < settings.minSplitPartMin) continue;
    // Never leave a tail shorter than a valid part.
    const tail = remaining - chunk;
    if (tail > 0 && tail < settings.minSplitPartMin) {
      chunk = remaining - settings.minSplitPartMin;
      if (chunk < settings.minSplitPartMin) continue;
    }
    if (parts.length === settings.maxSplitParts - 1 && chunk < remaining) continue;
    parts.push({ startMin: i.startMin, endMin: i.startMin + chunk });
    used.push({ interval: i, startMin: i.startMin, need: chunk });
    remaining -= chunk;
  }
  return remaining === 0 && parts.length > 1 ? { parts, used } : null;
}

function out(s: Scored, reason: LeftOut['reason'], detail: string): LeftOut {
  return {
    kind: s.candidate.kind,
    id: s.candidate.id,
    title: s.candidate.title,
    reason,
    detail,
    score: s.score,
  };
}

export function toBlocks(p: Placement): ProposedBlock[] {
  const c = p.scored.candidate;
  const of = p.parts.length;
  return p.parts.map((part, index) => ({
    key: `${c.id}#${index}`,
    kind: c.kind,
    startMin: part.startMin,
    endMin: part.endMin,
    title: c.title,
    taskId: c.kind === 'task' ? c.id : null,
    routineInstanceId: c.kind === 'routine' ? c.id : null,
    eventId: null,
    locked: false,
    part: of > 1 ? { index, of } : null,
    existingBlockId: null,
  }));
}
