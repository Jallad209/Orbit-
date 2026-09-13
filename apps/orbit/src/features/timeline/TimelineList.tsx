import type { Block } from '@orbit/core';
import { formatDuration, formatMinute } from '@orbit/core';
import { ArrowDown, ArrowUp, Lock, LockOpen, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import type { DayData } from './timelineService';
import { blockTitle } from './timelineService';

interface Props {
  day: DayData;
  nowMin: number | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onNudge: (block: Block, deltaMin: number) => void;
  onToggleLock: (block: Block) => void;
  onRemove: (block: Block) => void;
}

/** Under 900 px the day is a list: same actions as the canvas, as buttons. */
export function TimelineList({
  day,
  nowMin,
  selectedId,
  onSelect,
  onNudge,
  onToggleLock,
  onRemove,
}: Props) {
  const rows = [
    ...day.eventRanges.map((e) => ({
      key: `event-${e.event.id}`,
      startMin: e.startMin,
      endMin: e.endMin,
      title: e.event.title,
      block: null as Block | null,
    })),
    ...day.blocks.map((b) => ({
      key: b.id,
      startMin: b.startMin,
      endMin: b.endMin,
      title: blockTitle(day, b),
      block: b,
    })),
  ].sort((a, b) => a.startMin - b.startMin);

  return (
    <ol className="flex flex-col gap-1" aria-label="Day timeline" data-testid="timeline-list">
      {rows.length === 0 ? (
        <li className="text-[13px] text-ink-muted">Nothing scheduled.</li>
      ) : null}
      {rows.map((r) => {
        const b = r.block;
        const past = nowMin !== null && r.endMin <= nowMin;
        return (
          <li
            key={r.key}
            data-testid={b ? `block-${b.id}` : undefined}
            data-start={r.startMin}
            data-end={r.endMin}
            data-locked={b?.locked || undefined}
            onClick={() => b && onSelect(b.id)}
            className={cn(
              'flex items-center gap-2 rounded-md border-l-4 px-2.5 py-1.5 text-sm',
              b
                ? b.routineInstanceId
                  ? 'border-[#7fbf98] bg-[#dcefe3]'
                  : 'border-lime-2 bg-lime/30'
                : 'border-[#7fa3c8] bg-[#dbe7f3]',
              past && 'opacity-55',
              b && selectedId === b.id && 'ring-2 ring-lime-ink/60',
            )}
          >
            <span className="w-24 shrink-0 text-[12px] text-ink-muted tnum">
              {formatMinute(r.startMin)}–{formatMinute(r.endMin)}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {b?.locked ? <Lock className="mr-1 inline size-3" aria-hidden="true" /> : null}
              {r.title}
            </span>
            <span className="text-[11px] text-ink-faint tnum">
              {formatDuration(r.endMin - r.startMin)}
            </span>
            {b && !past ? (
              <span className="flex items-center">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Earlier ${r.title}`}
                  onClick={() => onNudge(b, -15)}
                  disabled={b.locked}
                >
                  <ArrowUp className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Later ${r.title}`}
                  onClick={() => onNudge(b, 15)}
                  disabled={b.locked}
                >
                  <ArrowDown className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`${b.locked ? 'Unlock' : 'Lock'} ${r.title}`}
                  onClick={() => onToggleLock(b)}
                >
                  {b.locked ? (
                    <LockOpen className="size-4" aria-hidden="true" />
                  ) : (
                    <Lock className="size-4" aria-hidden="true" />
                  )}
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${r.title}`}
                  onClick={() => onRemove(b)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
