import { useDraggable } from '@dnd-kit/core';
import type { Task } from '@orbit/core';
import { formatDuration } from '@orbit/core';
import { CalendarPlus, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';

interface Props {
  tasks: Task[];
  onSchedule: (task: Task) => void;
}

function Row({ task, onSchedule }: { task: Task; onSchedule: (task: Task) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `task:${task.id}`,
    data: { type: 'task', task },
  });
  return (
    <li
      ref={setNodeRef}
      data-testid={`unscheduled-${task.id}`}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
      }}
      className={
        'flex items-center gap-2 rounded-md border border-line bg-surface px-2 py-1.5 text-[13px] ' +
        (isDragging ? 'z-30 shadow-lg' : '')
      }
    >
      <button
        type="button"
        aria-label={`Drag ${task.title}`}
        className="cursor-grab text-ink-faint hover:text-ink"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
      <span className="min-w-0 flex-1 truncate">{task.title}</span>
      <span className="text-[11px] text-ink-faint tnum">{formatDuration(task.estimateMin)}</span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Schedule ${task.title}`}
        onClick={() => onSchedule(task)}
      >
        <CalendarPlus className="size-4" aria-hidden="true" />
      </Button>
    </li>
  );
}

/** Open tasks without a block today. Drag one onto the canvas, or Schedule it into the first free slot. */
export function UnscheduledPanel({ tasks, onSchedule }: Props) {
  return (
    <Card data-testid="unscheduled">
      <SectionHeader title="Unscheduled" meta={String(tasks.length)} />
      {tasks.length === 0 ? (
        <p className="text-[13px] text-ink-muted">Every open task has a block today.</p>
      ) : null}
      <ul className="flex flex-col gap-1" aria-label="Unscheduled tasks">
        {tasks.map((t) => (
          <Row key={t.id} task={t} onSchedule={onSchedule} />
        ))}
      </ul>
    </Card>
  );
}
