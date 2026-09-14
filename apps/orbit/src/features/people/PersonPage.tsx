import { systemClock, toLocalDate } from '@orbit/core';
import type { Clock, Commitment, Person } from '@orbit/core';
import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { LinkedPanel } from '@/components/LinkedPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, SectionHeader } from '@/components/ui/Card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/Dialog';
import { InlineEdit } from '@/components/ui/InlineEdit';
import { Input, Label, Select } from '@/components/ui/Input';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { useDraftRegistration } from '@/features/drafts/DraftGuard';
import { useRepository } from '@/platform';
import { cn } from '@/lib/cn';
import {
  createCommitment,
  deleteCommitment,
  deletePerson,
  deletionImpact,
  loadPerson,
  recordContact,
  restorePerson,
  setCommitmentStatus,
  updateCommitment,
  updatePerson,
} from './peopleService';

type Direction = Commitment['direction'] | 'all';
type Status = Commitment['status'];

const DIRECTION_LABEL: Record<Commitment['direction'], string> = {
  'owed-by-me': 'I owe',
  'owed-to-me': 'Owed to me',
};

function report(title: string, e: unknown): void {
  toast({ title, description: e instanceof Error ? e.message : String(e), variant: 'danger' });
}

/** A `datetime-local` value for an instant, in the local zone. */
function localInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/**
 * One person: contact, last contact, and every commitment in both
 * directions with its own status. "Record reply/contact" moves the
 * person's last-contact time and restarts follow-ups; it never completes
 * a promise. Opened through evidence or a reminder, `?commitment=` names
 * the exact row to highlight.
 */
export function PersonPage({ clock = systemClock }: { clock?: Clock }) {
  const { id } = useParams();
  const repo = useRepository();
  const [params] = useSearchParams();
  const highlight = params.get('commitment');
  const { data, loading, error } = useRepoQuery(
    (r) => (id ? loadPerson(r, id) : Promise.resolve(null)),
    [id],
  );
  const [direction, setDirection] = useState<Direction>('all');
  const [status, setStatus] = useState<Status>('open');
  const [contactOpen, setContactOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState<number | null>(null);

  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        This person could not be loaded: {error.message}
      </p>
    );
  }
  if (!data) {
    if (loading) return <p className="text-sm text-ink-muted">Loading…</p>;
    return (
      <EmptyState
        title="That person no longer exists"
        description="The link may be old, or the person was removed."
        action={
          <Link to="/people" className="text-sm underline">
            Back to people
          </Link>
        }
      />
    );
  }
  const { person } = data;
  if (person.deletedAt !== null) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Link to="/people" className="text-[13px] text-ink-muted hover:underline">
          ← People
        </Link>
        <EmptyState
          title={`${person.name} was deleted`}
          description={`${data.open.length} open commitment${data.open.length === 1 ? '' : 's'} are kept with the record and come back when it is restored. No follow-ups are sent while it is deleted.`}
          action={
            <Button
              variant="secondary"
              onClick={() =>
                void restorePerson(repo, person.id, clock).catch((e) =>
                  report('Could not restore', e),
                )
              }
            >
              Restore person
            </Button>
          }
        />
      </div>
    );
  }

  const rows = (
    status === 'open' ? data.open : status === 'done' ? data.done : data.dropped
  ).filter((c) => direction === 'all' || c.direction === direction);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link to="/people" className="text-[13px] text-ink-muted hover:underline">
          ← People
        </Link>
        <h1 className="mt-1 text-display font-semibold tracking-tight text-ink">
          <InlineEdit
            value={person.name}
            onCommit={(v) =>
              void updatePerson(repo, person, { name: v }).catch((e) =>
                report('Could not rename', e),
              )
            }
            aria-label="Person name"
          />
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-muted">
          <InlineEdit
            value={person.contact}
            required={false}
            placeholder="Add contact details"
            onCommit={(v) =>
              void updatePerson(repo, person, { contact: v }).catch((e) =>
                report('Could not save contact', e),
              )
            }
            aria-label="Contact details"
          />
          <span data-testid="last-contact">
            Last contact:{' '}
            {person.lastContactAt ? localInput(person.lastContactAt).replace('T', ' ') : 'never'}
          </span>
          <Badge tone="outline">I owe {data.counts.owedByMe}</Badge>
          <Badge tone="outline">Owed to me {data.counts.owedToMe}</Badge>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setContactOpen(true)}>
          Record reply/contact
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            void deletionImpact(repo, person.id).then(setDeleteOpen, (e) =>
              report('Could not check', e),
            )
          }
        >
          <Trash2 className="size-4" aria-hidden="true" /> Delete person
        </Button>
      </div>

      <NewCommitment personId={person.id} personName={person.name} clock={clock} />

      <section aria-label="Commitments">
        <SectionHeader
          title="Commitments"
          meta={`${data.counts.open} open`}
          actions={
            <>
              <Select
                aria-label="Filter by direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value as Direction)}
                className="h-8 w-36"
              >
                <option value="all">Both directions</option>
                <option value="owed-by-me">I owe</option>
                <option value="owed-to-me">Owed to me</option>
              </Select>
              <Select
                aria-label="Filter by status"
                value={status}
                onChange={(e) => setStatus(e.target.value as Status)}
                className="h-8 w-28"
              >
                <option value="open">Open</option>
                <option value="done">Done</option>
                <option value="dropped">Dropped</option>
              </Select>
            </>
          }
        />
        {rows.length === 0 ? (
          <p className="text-[13px] text-ink-faint">Nothing {status} in this direction.</p>
        ) : (
          <ul className="flex flex-col gap-1" aria-label={`${status} commitments`}>
            {rows.map((c) => (
              <CommitmentRow
                key={c.id}
                commitment={c}
                followUp={data.followUps.get(c.id) ?? null}
                highlighted={highlight === c.id}
                clock={clock}
              />
            ))}
          </ul>
        )}
      </section>

      <LinkedPanel entity={{ type: 'person', id: person.id }} clock={clock} />

      <ContactDialog
        open={contactOpen}
        person={person}
        clock={clock}
        onClose={() => setContactOpen(false)}
      />
      <Dialog open={deleteOpen !== null} onOpenChange={(o) => (!o ? setDeleteOpen(null) : null)}>
        <DialogContent size="sm">
          <DialogTitle>Delete {person.name}?</DialogTitle>
          <DialogDescription>
            {deleteOpen ?? 0} commitment{deleteOpen === 1 ? '' : 's'} will be hidden with the person
            and kept for recovery. Nothing is marked done or moved to anyone else, and no follow-up
            is sent while the person is deleted. You can restore from the People list.
          </DialogDescription>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDeleteOpen(null);
                void deletePerson(repo, person.id, clock).catch((e) =>
                  report('Could not delete', e),
                );
              }}
            >
              Delete person
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewCommitment({
  personId,
  personName,
  clock,
}: {
  personId: string;
  personName: string;
  clock: Clock;
}) {
  const repo = useRepository();
  const [text, setText] = useState('');
  const [dir, setDir] = useState<Commitment['direction']>('owed-by-me');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (): Promise<boolean> => {
    if (!text.trim()) return false;
    setBusy(true);
    setProblem(null);
    try {
      await createCommitment(
        repo,
        personId,
        { text, direction: dir, dueAt: fromLocalInput(due ? `${due}T23:59` : '') },
        clock,
      );
      setText('');
      setDue('');
      return true;
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  useDraftRegistration({
    key: `person:${personId}:new-commitment`,
    label: `New commitment with ${personName}`,
    dirty: text.trim().length > 0,
    status: problem ? 'failed' : text ? 'editing' : 'saved',
    error: problem,
    flush: async () =>
      (await submit()) ? { ok: true } : { ok: false, reason: problem ?? 'Not saved.' },
    discard: () => {
      setText('');
      setDue('');
      setProblem(null);
    },
  });

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-wrap items-end gap-2"
      aria-label="New commitment"
    >
      <div className="min-w-56 flex-1">
        <Label htmlFor="commitment-text">Commitment</Label>
        <Input
          id="commitment-text"
          placeholder="What was promised?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="commitment-direction">Direction</Label>
        <Select
          id="commitment-direction"
          value={dir}
          onChange={(e) => setDir(e.target.value as Commitment['direction'])}
          className="mt-1 w-36"
        >
          <option value="owed-by-me">I owe</option>
          <option value="owed-to-me">Owed to me</option>
        </Select>
      </div>
      <div>
        <Label htmlFor="commitment-due">Due (optional)</Label>
        <Input
          id="commitment-due"
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="mt-1"
        />
      </div>
      <Button type="submit" variant="primary" disabled={!text.trim() || busy}>
        Add
      </Button>
      {problem ? (
        <p role="alert" className="basis-full text-[13px] text-danger">
          {problem}
        </p>
      ) : null}
    </form>
  );
}

function CommitmentRow({
  commitment: c,
  followUp,
  highlighted,
  clock,
}: {
  commitment: Commitment;
  followUp: { since: string; fireAt: string | null } | null;
  highlighted: boolean;
  clock: Clock;
}) {
  const repo = useRepository();
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView?.({ block: 'center' });
  }, [highlighted]);
  const today = toLocalDate(clock.now());
  const dueDate = c.dueAt ? c.dueAt.slice(0, 10) : null;
  const overdue = c.status === 'open' && dueDate !== null && dueDate < today;
  const set = (status: Status) =>
    void setCommitmentStatus(repo, c, status, clock).catch((e) => report('Could not update', e));
  return (
    <li
      ref={ref}
      data-testid="commitment-row"
      data-commitment-id={c.id}
      aria-current={highlighted ? 'true' : undefined}
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-md border px-3 py-2',
        highlighted ? 'border-lime-2 bg-lime/20' : 'border-line bg-surface-2/40',
      )}
    >
      <Badge tone={c.direction === 'owed-to-me' ? 'gold' : 'neutral'}>
        {DIRECTION_LABEL[c.direction]}
      </Badge>
      <span className={cn('min-w-0 flex-1 text-sm', c.status !== 'open' && 'text-ink-faint')}>
        <InlineEdit
          value={c.text}
          onCommit={(v) =>
            void updateCommitment(repo, c, { text: v }, clock).catch((e) =>
              report('Could not edit', e),
            )
          }
          aria-label={`Commitment ${c.text}`}
        />
      </span>
      <label className="flex items-center gap-1 text-[12px] text-ink-faint">
        <span className="sr-only">Due date for {c.text}</span>
        <Input
          type="date"
          aria-label={`Due date for ${c.text}`}
          value={dueDate ?? ''}
          onChange={(e) =>
            void updateCommitment(
              repo,
              c,
              { dueAt: fromLocalInput(e.target.value ? `${e.target.value}T23:59` : '') },
              clock,
            ).catch((err) => report('Could not change the date', err))
          }
          className={cn('h-7 w-36 text-[12px]', overdue && 'text-danger')}
        />
        {dueDate === null ? <span>no due date</span> : overdue ? <span>overdue</span> : null}
      </label>
      {followUp && c.status === 'open' ? (
        <span className="basis-full text-[12px] text-ink-faint" data-testid="follow-up">
          Follow-up counts from {toLocalDate(new Date(followUp.since))}
          {followUp.fireAt
            ? `; reminder on ${toLocalDate(new Date(followUp.fireAt))}`
            : '; no follow-up rule is enabled'}
        </span>
      ) : null}
      <span className="flex items-center gap-1">
        {c.status === 'open' ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => set('done')}>
              Mark done
            </Button>
            <Button size="sm" variant="ghost" onClick={() => set('dropped')}>
              Drop
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => set('open')}>
            Reopen
          </Button>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Delete ${c.text}`}
          onClick={() =>
            void deleteCommitment(repo, c.id, clock).catch((e) => report('Could not delete', e))
          }
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </Button>
      </span>
    </li>
  );
}

function ContactDialog({
  open,
  person,
  clock,
  onClose,
}: {
  open: boolean;
  person: Person;
  clock: Clock;
  onClose: () => void;
}) {
  const repo = useRepository();
  const [at, setAt] = useState(() => localInput(clock.now().toISOString()));
  const [older, setOlder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = async (correct: boolean) => {
    const instant = fromLocalInput(at);
    if (!instant) {
      report('Could not record contact', new Error('Enter a real date and time.'));
      return;
    }
    setBusy(true);
    try {
      const outcome = await recordContact(repo, person, instant, { correct, clock });
      if (outcome.kind === 'older') {
        setOlder(outcome.current);
        return;
      }
      toast({
        title: outcome.kind === 'recorded' ? 'Contact recorded' : 'Already recorded',
        description:
          outcome.kind === 'recorded'
            ? 'Follow-up timing restarted for open commitments owed to you. No commitment was completed.'
            : 'That time is already the last contact; nothing changed.',
        variant: 'success',
      });
      setOlder(null);
      onClose();
    } catch (e) {
      report('Could not record contact', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setOlder(null);
          onClose();
        }
      }}
    >
      <DialogContent size="sm" data-testid="contact-dialog">
        <DialogTitle>Record reply/contact</DialogTitle>
        <DialogDescription>
          Updates last contact for this person and restarts follow-up timing for all open
          commitments owed to you. It does not complete any commitment.
        </DialogDescription>
        <div className="mt-3">
          <Label htmlFor="contact-at">When</Label>
          <Input
            id="contact-at"
            type="datetime-local"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            className="mt-1"
          />
        </div>
        {older ? (
          <p role="alert" className="mt-3 text-[13px] text-gold-ink">
            The last recorded contact is newer ({localInput(older).replace('T', ' ')}). Moving it
            back is a correction, not a new contact.
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {older ? (
            <Button variant="secondary" onClick={() => void apply(true)} loading={busy}>
              Correct to the earlier time
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void apply(false)} loading={busy}>
              Record contact
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
