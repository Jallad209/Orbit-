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
import { CaptureBar } from './CaptureBar';
import { TriageActions } from './TriageActions';
import {
  archiveCapture,
  captureFields,
  convertCapture,
  listInbox,
  loadCaptureNames,
  setCaptureDate,
  setCaptureType,
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
  const [chosenId, setSelectedId] = useState<string | null>(null);
  const [popover, setPopover] = useState<'date' | 'project' | null>(null);
  // Fall back to the first item when the chosen one leaves the inbox.
  const selectedId =
    chosenId && items?.some((c) => c.id === chosenId) ? chosenId : (items?.[0]?.id ?? null);

  const grouped = useMemo(() => {
    const map = new Map<CaptureType, Capture[]>();
    for (const t of CAPTURE_TYPES) map.set(t, []);
    for (const c of items ?? []) map.get(c.type)!.push(c);
    return CAPTURE_TYPES.map((t) => [t, map.get(t)!] as const).filter(([, rows]) => rows.length);
  }, [items]);

  const selected = items?.find((c) => c.id === selectedId) ?? null;

  const withSelected = (fn: (c: Capture) => Promise<void> | void) => () => {
    if (selected) void fn(selected);
  };

  const accept = withSelected(async (c) => {
    try {
      const primary = await convertCapture(repo, c, {}, clock);
      toast.success(`Captured as ${ENTITY_LABELS[c.type].toLowerCase()}`, captureFields(c).title);
      void primary;
    } catch (e) {
      if (e instanceof MaterializeError) {
        toast.warning('Needs one more thing', e.message);
        if (e.code === 'needs-area') setPopover('project');
      } else throw e;
    }
  });

  const archive = withSelected(async (c) => {
    await archiveCapture(repo, c);
    toast({ title: 'Archived', description: captureFields(c).title });
  });

  const cycleType = withSelected(async (c) => {
    const i = CAPTURE_TYPES.indexOf(c.type);
    const next = CAPTURE_TYPES[(i + 1) % CAPTURE_TYPES.length]!;
    await setCaptureType(repo, c, next, names, clock);
  });

  const assignProject = async (projectId: string) => {
    if (!selected) return;
    setPopover(null);
    const type: CaptureType = selected.type === 'note' ? 'note' : 'task';
    try {
      await convertCapture(repo, selected, { projectId, type }, clock);
      const project = projects?.find((p) => p.id === projectId);
      toast.success(`Added to ${project?.title ?? 'project'}`, captureFields(selected).title);
    } catch (e) {
      if (e instanceof MaterializeError) toast.warning('Needs one more thing', e.message);
      else throw e;
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

      {selected && projects ? (
        <TriageActions
          capture={selected}
          projects={projects}
          onSetType={(t) => void setCaptureType(repo, selected, t, names, clock)}
          onSetDate={(d) => {
            setPopover(null);
            void setCaptureDate(repo, selected, d);
          }}
          onAssignProject={(id) => void assignProject(id)}
          onAccept={accept}
          onArchive={archive}
          openPopover={popover}
          onOpenPopover={setPopover}
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
