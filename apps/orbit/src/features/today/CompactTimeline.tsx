import type { ProposedBlock, TimeWindow } from '@orbit/core';
import { formatMinute } from '@orbit/core';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, SectionHeader } from '@/components/ui/Card';

interface Props {
  blocks: ProposedBlock[];
  workingWindow: TimeWindow;
  /** Minute of day when the timeline is for today; null otherwise. */
  nowMin: number | null;
}

const KIND_CLASS: Record<ProposedBlock['kind'], string> = {
  task: 'border-lime-2/70 bg-lime/30',
  routine: 'border-[#9fd0b0] bg-[#dcefe3]',
  event: 'border-[#9fb8d6] bg-[#dbe7f3]',
  fixed: 'border-line bg-surface-3',
};

/**
 * The day as a compact list in time order with a "now" marker. The full
 * drag-and-drop timeline arrives in week 6; this answers "what is next".
 */
export function CompactTimeline({ blocks, workingWindow, nowMin }: Props) {
  const rows: Array<{ type: 'block'; block: ProposedBlock } | { type: 'now' }> = blocks.map(
    (block) => ({ type: 'block', block }),
  );
  if (nowMin !== null) {
    const i = blocks.findIndex((b) => b.startMin > nowMin);
    rows.splice(i === -1 ? rows.length : i, 0, { type: 'now' });
  }

  return (
    <Card data-testid="compact-timeline">
      <SectionHeader
        title="Timeline"
        meta={`${formatMinute(workingWindow.startMin)}–${formatMinute(workingWindow.endMin)}`}
      />
      {blocks.length === 0 ? (
        <p className="text-[13px] text-ink-muted">Nothing scheduled yet.</p>
      ) : null}
      <ol className="flex flex-col gap-1" aria-label="Day timeline">
        {rows.map((r, i) =>
          r.type === 'now' ? (
            <li key={`now-${i}`} className="flex items-center gap-2 py-0.5" aria-label="Now">
              <span className="text-[11px] font-semibold text-lime-ink">
                {formatMinute(nowMin!)}
              </span>
              <span className="h-px flex-1 bg-lime-2" aria-hidden="true" />
            </li>
          ) : (
            <li
              key={r.block.key}
              className={cn(
                'flex items-center gap-3 rounded-md border-l-4 px-2.5 py-1.5 text-sm',
                KIND_CLASS[r.block.kind],
                nowMin !== null && r.block.endMin <= nowMin ? 'opacity-60' : '',
              )}
            >
              <span className="w-24 shrink-0 text-[12px] text-ink-muted tnum">
                {formatMinute(r.block.startMin)}–{formatMinute(r.block.endMin)}
              </span>
              <span className="min-w-0 flex-1 truncate">{r.block.title}</span>
              {r.block.locked && r.block.kind !== 'event' ? (
                <Lock className="size-3.5 text-ink-faint" aria-label="Locked" />
              ) : null}
            </li>
          ),
        )}
      </ol>
    </Card>
  );
}
