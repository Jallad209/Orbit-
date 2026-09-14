import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { Block, Clock, LocalDate, Task } from '@orbit/core';
import { BlockError, minuteOfDay, systemClock, toLocalDate } from '@orbit/core';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';
import type { Repository } from '@orbit/storage';
import { Kbd } from '@/components/ui/Kbd';
import { Skeleton } from '@/components/ui/Card';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { useMediaQuery, NARROW_QUERY } from '@/lib/useMediaQuery';
import { useRepository } from '@/platform';
import { settingsFor, usePlanPrefs } from '@/features/today/planSettings';
import { DayNav } from './DayNav';
import { canvasLayout, pxToMinute } from './layout';
import { OverloadWarning } from './OverloadWarning';
import { parseTimelineParams } from './timelineParams';
import { TimelineCanvas } from './TimelineCanvas';
import { TimelineList } from './TimelineList';
import { UnscheduledPanel } from './UnscheduledPanel';
import {
  dropTask,
  firstFreeSlot,
  loadDay,
  moveBlockTo,
  removeBlock,
  resizeBlockTo,
  toggleLock,
  type DayData,
} from './timelineService';

interface Props {
  clock?: Clock;
  date?: LocalDate;
}

/**
 * The day as time blocks. Drag tasks in, move and resize blocks, lock the
 * ones that must not move; every change re-plans the rest of the day.
 * Keyboard: arrows nudge 15 min, Shift+arrows resize, `l` locks, Delete removes.
 * The date lives in the URL (`?date=YYYY-MM-DD`), so evidence links can open
 * any day; `&block=<id>` selects and scrolls to one block once the day loads.
 */
export function TimelinePage({ clock = systemClock, date: dateProp }: Props) {
  const repo = useRepository();
  const prefs = usePlanPrefs();
  const today = toLocalDate(clock.now());
  const [params, setParams] = useSearchParams();
  const linked = parseTimelineParams(params);
  const date = dateProp ?? linked.date ?? today;
  const narrow = useMediaQuery(NARROW_QUERY);
  // A linked block starts selected; a block that is gone leaves the date selected and says so.
  const [selectedId, setSelectedId] = useState<string | null>(linked.blockId);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const focusedLink = useRef<string | null>(null);

  const query = useCallback((r: Repository) => loadDay(r, date, clock), [date, clock]);
  const { data: day, loading } = useRepoQuery(query, [query]);
  const linkedBlockLoaded = !!linked.blockId && !!day && day.date === date;
  const linkedBlockFound = linkedBlockLoaded && day.blocks.some((b) => b.id === linked.blockId);
  const missingBlock = linkedBlockLoaded && !linkedBlockFound ? linked.blockId : null;

  // Scroll to and focus the linked block once, when its day has loaded.
  useEffect(() => {
    const id = linked.blockId;
    if (!id || !linkedBlockFound || focusedLink.current === id) return;
    focusedLink.current = id;
    const frame = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-testid="block-${id}"]`);
      el?.scrollIntoView?.({ block: 'center' });
      el?.focus?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [linked.blockId, linkedBlockFound]);

  const changeDate = (d: LocalDate) => {
    setSelectedId(null);
    focusedLink.current = null;
    setParams(d === today ? {} : { date: d });
  };
  const settings = useMemo(() => settingsFor(prefs, date, []), [prefs, date]);
  const layout = useMemo(() => canvasLayout(prefs.workingWindow), [prefs.workingWindow]);
  const nowMin = day?.isToday ? minuteOfDay(day.now) : null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const report = (summary: string, title = 'Day re-planned') =>
    toast({ title, description: summary, variant: 'neutral' });
  const fail = (e: unknown) =>
    toast({
      title: e instanceof BlockError ? 'Not possible' : 'Something went wrong',
      description: e instanceof Error ? e.message : String(e),
      variant: 'danger',
    });

  const run = async (fn: (d: DayData) => Promise<string | void>) => {
    if (!day) return;
    try {
      const summary = await fn(day);
      if (summary) report(summary);
    } catch (e) {
      fail(e);
    }
  };

  const move = (block: Block, startMin: number) =>
    run(async (d) => (await moveBlockTo(repo, d, block, startMin, settings, clock)).summary);
  const resize = (block: Block, endMin: number) =>
    run(async (d) => (await resizeBlockTo(repo, d, block, 'end', endMin, settings, clock)).summary);
  const schedule = (task: Task) =>
    run(async (d) => {
      const slot = firstFreeSlot(d, task.estimateMin, prefs.workingWindow, nowMin);
      if (slot === null)
        throw new BlockError('overlap', 'No free slot left in the working window.');
      const { block, summary } = await dropTask(repo, d, task, slot, settings, clock);
      setSelectedId(block.id);
      return summary;
    });

  const onDragEnd = (e: DragEndEvent) => {
    if (!day || e.over?.id !== 'canvas') return;
    const canvasTop = canvasRef.current?.getBoundingClientRect().top ?? 0;
    const top = e.active.rect.current.translated?.top;
    if (top === undefined) return;
    const minute = pxToMinute(top - canvasTop, layout);
    const data = e.active.data.current as
      { type: 'task'; task: Task } | { type: 'block'; block: Block };
    if (data.type === 'task') {
      void run(async (d) => {
        const { block, summary } = await dropTask(repo, d, data.task, minute, settings, clock);
        setSelectedId(block.id);
        return summary;
      });
    } else {
      void move(data.block, minute);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!day || !selectedId) return;
    const block = day.blocks.find((b) => b.id === selectedId);
    if (!block) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    const step = 15;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault();
        const delta = e.key === 'ArrowUp' ? -step : step;
        if (e.shiftKey) void resize(block, block.endMin + delta);
        else void move(block, block.startMin + delta);
        break;
      }
      case 'l':
      case 'L':
        e.preventDefault();
        void run(async () => {
          const next = await toggleLock(repo, block);
          return next.locked ? 'Locked; the planner will work around it' : 'Unlocked';
        });
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        void run(async (d) => removeBlock(repo, d, block, settings, clock));
        setSelectedId(null);
        break;
      case 'Escape':
        setSelectedId(null);
        break;
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" onKeyDown={onKeyDown}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-display font-semibold tracking-tight text-ink">Timeline</h1>
          <p className="mt-1 text-ink-muted">
            {date === today ? 'Today' : date}. Drag, resize, lock; the rest of the day re-plans
            around you.
          </p>
        </div>
        {!dateProp ? <DayNav date={date} today={today} onChange={changeDate} /> : null}
      </div>

      <OverloadWarning date={date} clock={clock} />
      {missingBlock ? (
        <p role="status" data-testid="block-missing" className="text-[13px] text-ink-muted">
          The block this link pointed at is no longer on this day; the day is still selected.
        </p>
      ) : null}

      {loading && !day ? <Skeleton className="h-64" /> : null}

      {day ? (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div
            className={
              narrow ? 'flex flex-col gap-4' : 'grid grid-cols-[minmax(0,1fr)_18rem] gap-4'
            }
          >
            {narrow ? (
              <TimelineList
                day={day}
                nowMin={nowMin}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onNudge={(b, delta) => void move(b, b.startMin + delta)}
                onToggleLock={(b) =>
                  void run(async () => {
                    await toggleLock(repo, b);
                  })
                }
                onRemove={(b) => void run(async (d) => removeBlock(repo, d, b, settings, clock))}
              />
            ) : (
              <TimelineCanvas
                day={day}
                layout={layout}
                workingWindow={prefs.workingWindow}
                nowMin={nowMin}
                selectedId={selectedId}
                canvasRef={canvasRef}
                onSelect={setSelectedId}
                onResizeEnd={(b, end) => void resize(b, end)}
              />
            )}
            <div className="flex flex-col gap-3">
              <UnscheduledPanel tasks={day.unscheduled} onSchedule={schedule} />
              <p className="text-[11px] text-ink-faint">
                <Kbd>↑</Kbd> <Kbd>↓</Kbd> move 15 min · <Kbd>Shift</Kbd>+<Kbd>↓</Kbd> resize ·{' '}
                <Kbd>l</Kbd> lock · <Kbd>Del</Kbd> remove
              </p>
            </div>
          </div>
        </DndContext>
      ) : null}
    </div>
  );
}
