import { useDraggable } from '@dnd-kit/core';
import type { Block } from '@orbit/core';
import { formatDuration, formatMinute } from '@orbit/core';
import { Lock } from 'lucide-react';
import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@/lib/cn';
import { minuteToPx, PX_PER_MIN, type CanvasLayout } from './layout';

export interface TimelineBlockProps {
  block: Block;
  title: string;
  kind: 'task' | 'routine';
  layout: CanvasLayout;
  selected: boolean;
  past: boolean;
  onSelect: (id: string) => void;
  onResizeEnd: (block: Block, endMin: number) => void;
}

const KIND_CLASS = {
  task: 'border-lime-2 bg-lime/40 text-lime-ink',
  routine: 'border-[#7fbf98] bg-[#dcefe3] text-[#1f4a31]',
};

/** One block on the canvas: draggable unless locked or past, resizable from its bottom edge. */
export function TimelineBlock({
  block,
  title,
  kind,
  layout,
  selected,
  past,
  onSelect,
  onResizeEnd,
}: TimelineBlockProps) {
  const disabled = block.locked || past;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `block:${block.id}`,
    disabled,
    data: { type: 'block', block },
  });
  const [previewEnd, setPreviewEnd] = useState<number | null>(null);

  const top = minuteToPx(block.startMin, layout);
  const endMin = previewEnd ?? block.endMin;
  const height = Math.max(14, (endMin - block.startMin) * PX_PER_MIN);

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    const originY = e.clientY;
    const originEnd = block.endMin;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      setPreviewEnd(originEnd + Math.round((ev.clientY - originY) / PX_PER_MIN));
    };
    const up = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      const finalEnd = originEnd + Math.round((ev.clientY - originY) / PX_PER_MIN);
      setPreviewEnd(null);
      if (finalEnd !== originEnd) onResizeEnd(block, finalEnd);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={`${title} ${formatMinute(block.startMin)}–${formatMinute(block.endMin)}${block.locked ? ', locked' : ''}`}
      aria-pressed={selected}
      data-testid={`block-${block.id}`}
      data-start={block.startMin}
      data-end={block.endMin}
      data-locked={block.locked || undefined}
      onClick={() => onSelect(block.id)}
      onFocus={() => onSelect(block.id)}
      style={{
        top,
        height,
        transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
      }}
      className={cn(
        'absolute right-2 left-14 flex cursor-grab flex-col overflow-hidden rounded-md border-l-4 px-2 py-1 text-[13px] leading-tight select-none',
        'transition-[top,height] duration-(--duration-base) ease-(--ease-out-quick)',
        KIND_CLASS[kind],
        past && 'cursor-default opacity-55',
        block.locked && 'cursor-default border-l-nav',
        selected && 'ring-2 ring-lime-ink/60 ring-offset-1',
        isDragging && 'z-30 shadow-lg transition-none',
      )}
    >
      <span className="flex items-center gap-1 truncate font-medium">
        {block.locked ? <Lock className="size-3 shrink-0" aria-hidden="true" /> : null}
        {title}
      </span>
      <span className="text-[11px] opacity-70 tnum">
        {formatMinute(block.startMin)}–{formatMinute(endMin)} ·{' '}
        {formatDuration(endMin - block.startMin)}
      </span>
      {!disabled ? (
        <div
          role="separator"
          aria-label={`Resize ${title}`}
          onPointerDown={startResize}
          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize hover:bg-lime-ink/20"
        />
      ) : null}
    </div>
  );
}
