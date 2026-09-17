import {
  CAPTURE_TYPES,
  MaterializeError,
  formatDateLabel,
  formatRecurrenceLabel,
  systemClock,
  toLocalDate,
} from '@orbit/core';
import type { Capture, CaptureType, Clock, LocalDate } from '@orbit/core';
import { Inbox as InboxIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge, ENTITY_LABELS, TypeBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Card';
import { Kbd } from '@/components/ui/Kbd';
import { List, ListRow } from '@/components/ui/List';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { useHotkey } from '@/lib/hotkeys';
import { useRepository } from '@/platform';
import { createArea } from '@/features/structure/structureService';
import { CaptureBar } from './CaptureBar';
import { TriageActions } from './TriageActions';
import {
  archiveCapture,
  captureFields,
  convertCapture,
  listInbox,
  loadCaptureNames,
  restoreArchivedCapture,
  setCaptureDate,
  setCaptureType,
  undoCaptureConversion,
} from './inboxService';

const GROUP_LABELS: Record<CaptureType, string> = {
  task: 'Tasks',
  event: 'Events',
  note: 'Notes',
  goal: 'Goals',
  routine: 'Routines',
  bill: 'Bills',
  commitment: 'Commitments',
};

function CaptureMeta({ capture, today }: { capture: Capture; today: LocalDate }) {
  const f = captureFields(capture);
  const chips: string[] = [];
  const date = capture.type === 'event' ? f.date : f.dueDate;
  if (date) chips.push(formatDateLabel(date, today));
  if (f.recurrence) chips.push(formatRecurrenceLabel(f.recurrence, f.timesPerWeek));
  if (f.amount !== undefined) chips.push(`${f.amount} ${f.currency ?? ''}`.trim());
  if (f.person) chips.push(f.person);
  if (f.estimateMin) chips.push(`${f.estimateMin}m`);
  return (
    <>
      {chips.map((c) => (
        <Badge key={c} tone="outline">
          {c}
        </Badge>
      ))}
      <TypeBadge kind={capture.type} />
    </>
  );
}

export interface InboxPageProps {
  clock?: Clock;
}

/**
 * Universal inbox: capture at the top, untriaged items grouped by type below.
 * j/k move, Enter accepts, t/d/p/e act on the selected item.
 */
export function InboxPage({ clock = systemClock }: InboxPageProps) {
  const repo = useRepository();
  const navigate = useNavigate();
  const today = toLocalDate(clock.now());
  const { data: items, loading } = useRepoQuery(listInbox, []);
  const { data: names } = useRepoQuery(loadCaptureNames, []);
  const { data: projects } = useRepoQuery(
    async (r) => r.projects.query((p) => p.status === 'active'),
    [],
  );
  const { data: areas } = useRepoQuery(async (r) => r.areas.list(), []);
  const [chosenId, setSelectedId] = useState<string | null>(null);
  const [popover, setPopover] = useState<'date' | 'project' | 'area' | null>(null);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());

  const visibleItems = useMemo(
    () => (items ?? []).filter((item) => !pendingIds.has(item.id)),
    [items, pendingIds],
  );

  const grouped = useMemo(() => {
    const map = new Map<CaptureType, Capture[]>();
    for (const t of CAPTURE_TYPES) map.set(t, []);
    for (const c of visibleItems) map.get(c.type)!.push(c);
    return CAPTURE_TYPES.map((t) => [t, map.get(t)!] as const).filter(([, rows]) => rows.length);
  }, [visibleItems]);

  const displayOrder = useMemo(() => grouped.flatMap(([, rows]) => rows), [grouped]);
  // Fall back to the first item in visual (grouped) order when the chosen row leaves.
  const selectedId =
    chosenId && visibleItems.some((c) => c.id === chosenId)
      ? chosenId
      : (displayOrder[0]?.id ?? null);

  const selected = visibleItems.find((c) => c.id === selectedId) ?? null;

  const setPending = (id: string, pending: boolean) => {
    setPendingIds((previous) => {
      const next = new Set(previous);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const beginPending = (capture: Capture): boolean => {
    if (pendingIds.has(capture.id)) return false;
    const index = displayOrder.findIndex((item) => item.id === capture.id);
    const neighbour = displayOrder[index + 1] ?? displayOrder[index - 1] ?? null;
    setSelectedId(neighbour?.id ?? null);
    setPending(capture.id, true);
    return true;
  };

  const withSelected = (fn: (c: Capture) => Promise<void> | void) => () => {
    if (selected) void fn(selected);
  };

  const accept = withSelected(async (c) => {
    if (!beginPending(c)) return;
    try {
      const conversion = await convertCapture(repo, c, {}, clock);
      if (!conversion.replayed) {
        toast({
          title: `Added ${ENTITY_LABELS[c.type].toLowerCase()}`,
          description: captureFields(c).title,
          variant: 'success',
          durationMs: 8000,
          action: {
            label: 'Undo',
            onClick: () => {
              void undoCaptureConversion(repo, c.id, conversion)
                .then(() => {
                  setPending(c.id, false);
                  setSelectedId(c.id);
                })
                .catch((error: unknown) =>
                  toast.warning(
                    'Could not undo',
                    error instanceof Error ? error.message : String(error),
                  ),
                );
            },
          },
        });
      }
    } catch (e) {
      setPending(c.id, false);
      setSelectedId(c.id);
      if (e instanceof MaterializeError) {
        toast.warning('Needs one more thing', e.message);
        if (e.code === 'needs-area') setPopover('area');
      } else throw e;
    }
  });

  const archive = withSelected(async (c) => {
    if (!beginPending(c)) return;
    try {
      await archiveCapture(repo, c);
      toast({
        title: 'Archived',
        description: captureFields(c).title,
        durationMs: 8000,
        action: {
          label: 'Undo',
          onClick: () => {
            void restoreArchivedCapture(repo, c.id).then(() => {
              setPending(c.id, false);
              setSelectedId(c.id);
            });
          },
        },
      });
    } catch (error) {
      setPending(c.id, false);
      setSelectedId(c.id);
      throw error;
    }
  });

  const cycleType = withSelected(async (c) => {
    const i = CAPTURE_TYPES.indexOf(c.type);
    const next = CAPTURE_TYPES[(i + 1) % CAPTURE_TYPES.length]!;
    await setCaptureType(repo, c, next, names, clock);
  });

  const assignProject = async (projectId: string) => {
    if (!selected) return;
    const capture = selected;
    if (!beginPending(capture)) return;
    setPopover(null);
    const type: CaptureType = capture.type === 'note' ? 'note' : 'task';
    try {
      const conversion = await convertCapture(repo, capture, { projectId, type }, clock);
      const project = projects?.find((p) => p.id === projectId);
      toast({
        title: `Added to ${project?.title ?? 'project'}`,
        description: captureFields(capture).title,
        variant: 'success',
        durationMs: 8000,
        action: {
          label: 'Undo',
          onClick: () => {
            void undoCaptureConversion(repo, capture.id, conversion).then(() => {
              setPending(capture.id, false);
              setSelectedId(capture.id);
            });
          },
        },
      });
    } catch (e) {
      setPending(capture.id, false);
      setSelectedId(capture.id);
      if (e instanceof MaterializeError) toast.warning('Needs one more thing', e.message);
      else throw e;
    }
  };

  const assignArea = async (areaId: string) => {
    if (!selected) return;
    const capture = selected;
    if (!beginPending(capture)) return;
    setPopover(null);
    try {
      const conversion = await convertCapture(repo, capture, { areaId }, clock);
      const area = areas?.find((a) => a.id === areaId);
      toast({
        title: `Added goal to ${area?.name ?? 'area'}`,
        description: captureFields(capture).title,
        variant: 'success',
        durationMs: 8000,
        action: {
          label: 'Undo',
          onClick: () => {
            void undoCaptureConversion(repo, capture.id, conversion).then(() => {
              setPending(capture.id, false);
              setSelectedId(capture.id);
            });
          },
        },
      });
    } catch (error) {
      setPending(capture.id, false);
      setSelectedId(capture.id);
      throw error;
    }
  };

  useHotkey('enter', accept, { description: 'Accept selected capture', group: 'Inbox' });
  useHotkey('e', archive, { description: 'Archive selected capture', group: 'Inbox' });
  useHotkey('t', cycleType, { description: 'Change type of selected capture', group: 'Inbox' });
  useHotkey('d', () => selected && setPopover('date'), { description: 'Set date', group: 'Inbox' });
  useHotkey('p', () => selected && setPopover('project'), {
    description: 'Assign project',
    group: 'Inbox',
  });
  useHotkey('o', () => navigate('/today'), { description: 'Open today', group: 'Inbox' });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-display font-semibold tracking-tight text-ink">Inbox</h1>
        <p className="mt-1 text-ink-muted">
          Capture anything. Orbit guesses what it is; you correct it in one keystroke.
        </p>
      </div>

      <CaptureBar clock={clock} />

      {selected && projects && areas ? (
        <TriageActions
          capture={selected}
          projects={projects}
          areas={areas}
          onSetType={(t) => void setCaptureType(repo, selected, t, names, clock)}
          onSetDate={(d) => {
            setPopover(null);
            void setCaptureDate(repo, selected, d);
          }}
          onAssignProject={(id) => void assignProject(id)}
          onAssignArea={(id) => void assignArea(id)}
          onCreateArea={async (name) => {
            const area = await createArea(repo, { name }, clock);
            await assignArea(area.id);
          }}
          onAccept={accept}
          onArchive={archive}
          openPopover={popover}
          onOpenPopover={setPopover}
          pending={pendingIds.has(selected.id)}
          clock={clock}
        />
      ) : null}

      {!loading && items && items.length === 0 ? (
        <EmptyState
          icon={<InboxIcon />}
          title="Inbox zero"
          description="Everything captured has a home. Press c anywhere to capture something new."
        />
      ) : null}

      {grouped.length ? (
        <List
          aria-label="Inbox items"
          selectedId={selectedId}
          onSelectedChange={setSelectedId}
          onActivate={() => accept()}
          className="rounded-lg border border-line bg-surface-2/40 p-1.5"
        >
          {grouped.map(([type, rows]) => (
            <li key={type} role="presentation" className="contents">
              <ul role="group" aria-label={GROUP_LABELS[type]} className="contents">
                <li
                  role="presentation"
                  className="px-2.5 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-ink-faint uppercase first:pt-1"
                >
                  {GROUP_LABELS[type]} <span className="tnum">{rows.length}</span>
                </li>
                {rows.map((c) => (
                  <ListRow
                    key={c.id}
                    id={c.id}
                    trailing={<CaptureMeta capture={c} today={today} />}
                  >
                    {captureFields(c).title}
                  </ListRow>
                ))}
              </ul>
            </li>
          ))}
        </List>
      ) : null}

      {items && items.length ? (
        <p className="text-[12px] text-ink-faint">
          <Kbd>j</Kbd> <Kbd>k</Kbd> move · <Kbd>Enter</Kbd> accept · <Kbd>t</Kbd> type ·{' '}
          <Kbd>d</Kbd> date · <Kbd>p</Kbd> project · <Kbd>e</Kbd> archive
        </p>
      ) : null}
    </div>
  );
}
