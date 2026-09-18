import { useDroppable } from '@dnd-kit/core';
import type { Block, TimeWindow } from '@orbit/core';
import { formatMinute } from '@orbit/core';
import { useEffect, useRef, type RefObject } from 'react';
import { cn } from '@/lib/cn';
import { minuteToPx, type CanvasLayout } from './layout';
import { TimelineBlock } from './TimelineBlock';
import type { DayData } from './timelineService';
import { blockTitle } from './timelineService';

interface Props {
  day: DayData;
  layout: CanvasLayout;
  workingWindow: TimeWindow;
  nowMin: number | null;
  selectedId: string | null;
  canvasRef: RefObject<HTMLDivElement | null>;
  onSelect: (id: string | null) => void;
  onResizeEnd: (block: Block, endMin: number) => void;
}

/** Hour gutter, working-window shading, events, blocks, and the now line. */
export function TimelineCanvas({
  day,
  layout,
  workingWindow,
  nowMin,
  selectedId,
  canvasRef,
  onSelect,
  onResizeEnd,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas' });
  const scroller = useRef<HTMLDivElement>(null);

  // Open on "now" (or the working window) rather than 06:00.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target = nowMin ?? workingWindow.startMin;
    el.scrollTop = Math.max(0, minuteToPx(target, layout) - 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open / day change
  }, [day.date]);

  return (
    <div
      ref={scroller}
      tabIndex={0}
      aria-label={`Timeline for ${day.date}`}
      className="relative max-h-[70vh] overflow-y-auto rounded-lg border border-line bg-surface-2/60"
      data-testid="timeline-canvas"
    >
      <div
        ref={(el) => {
          setNodeRef(el);
          canvasRef.current = el;
        }}
        className={cn('relative', isOver && 'bg-lime/10')}
        style={{ height: layout.heightPx }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelect(null);
        }}
      >
        {/* Working window */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bg-surface"
          style={{
            top: minuteToPx(workingWindow.startMin, layout),
            height: workingWindow.endMin - workingWindow.startMin,
          }}
        />
        {/* Hour lines and labels */}
        {layout.hours.map((m) => (
          <div
            key={m}
            aria-hidden="true"
            className="absolute inset-x-0 border-t border-line/70"
            style={{ top: minuteToPx(m, layout) }}
          >
            <span className="absolute -top-2.5 left-2 text-[11px] text-ink-faint tnum">
              {formatMinute(m)}
            </span>
          </div>
        ))}
        {/* Events */}
        {day.eventRanges.map(({ event, startMin, endMin }) => (
          <div
            key={event.id}
            data-testid={`event-${event.id}`}
            className="absolute right-2 left-14 overflow-hidden rounded-md border-l-4 border-[#7fa3c8] bg-[#dbe7f3] px-2 py-1 text-[13px] text-[#1f3a5a]"
            style={{ top: minuteToPx(startMin, layout), height: endMin - startMin }}
          >
            <span className="font-medium">{event.title}</span>
            <span className="ml-2 text-[11px] opacity-70 tnum">
              {formatMinute(startMin)}–{formatMinute(endMin)}
            </span>
          </div>
        ))}
        {/* Blocks */}
        {day.blocks.map((b) => (
          <TimelineBlock
            key={b.id}
            block={b}
            title={blockTitle(day, b)}
            kind={b.routineInstanceId ? 'routine' : 'task'}
            layout={layout}
            selected={selectedId === b.id}
            past={nowMin !== null && b.endMin <= nowMin}
            onSelect={onSelect}
            onResizeEnd={onResizeEnd}
          />
        ))}
        {/* Now */}
        {nowMin !== null && nowMin >= layout.startMin && nowMin <= layout.endMin ? (
          <div
            aria-label="Now"
            data-testid="now-line"
            className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-lime-2"
            style={{ top: minuteToPx(nowMin, layout) }}
          >
            <span className="absolute -top-2.5 right-2 rounded bg-lime px-1 text-[10px] font-semibold text-lime-ink tnum">
              {formatMinute(nowMin)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
