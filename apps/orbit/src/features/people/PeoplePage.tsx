import { formatMinute, systemClock } from '@orbit/core';
import type { Clock } from '@orbit/core';
import { Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, Skeleton } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/toastStore';
import { useRepoQuery } from '@/data/useQuery';
import { useInsights } from '@/features/insights/useInsights';
import { useRepository } from '@/platform';
import { routeFor } from '@/lib/destinations';
import { createPerson, loadPeople, restorePerson } from './peopleService';

/**
 * Everyone Orbit knows, with what is outstanding in each direction. The
 * "many open commitments" badge is the week-11 insight for that person,
 * so the list and the Insights page can never disagree on the count.
 */
export function PeoplePage({ clock = systemClock }: { clock?: Clock }) {
  const repo = useRepository();
  const { data, loading, error } = useRepoQuery(loadPeople, []);
  const insights = useInsights();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [filter, setFilter] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [busy, setBusy] = useState(false);

  const flagged = new Set(
    (insights.view?.active ?? [])
      .filter((i) => i.kind === 'person-commitments' && i.subject.type === 'person')
      .map((i) => (i.subject.type === 'person' ? i.subject.id : '')),
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createPerson(repo, { name, contact }, clock);
      setName('');
      setContact('');
    } catch (err) {
      toast({
        title: 'Could not add the person',
        description: err instanceof Error ? err.message : String(err),
        variant: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  const q = filter.trim().toLowerCase();
  const rows = (data?.people ?? []).filter((r) => !q || r.person.name.toLowerCase().includes(q));
  const deleted = data?.deleted ?? [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-display font-semibold tracking-tight text-ink">People</h1>
        <p className="mt-1 text-ink-muted">
          Who you owe and who owes you. A reply records contact; finishing a promise is a separate
          step.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-wrap gap-2" aria-label="New person">
        <Input
          aria-label="Name"
          placeholder="New person, e.g. Omar"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-48 flex-1"
        />
        <Input
          aria-label="Contact"
          placeholder="Email, phone, or handle (optional)"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          className="min-w-48 flex-1"
        />
        <Button type="submit" variant="primary" disabled={!name.trim() || busy}>
          Add person
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Filter people"
          placeholder="Filter by name"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8 max-w-xs"
        />
        {deleted.length ? (
          <Button size="sm" variant="ghost" onClick={() => setShowDeleted((v) => !v)}>
            {showDeleted ? 'Hide deleted' : `Deleted (${deleted.length})`}
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          People could not be loaded: {error.message}
        </p>
      ) : loading && !data ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={q ? 'Nobody matches' : 'No people yet'}
          description={
            q ? 'Try another name.' : 'Add someone you exchange promises with to track them here.'
          }
        />
      ) : (
        <ul className="flex flex-col gap-1" aria-label="People">
          {rows.map(({ person, counts }) => (
            <li key={person.id}>
              <Link
                to={routeFor({ type: 'person', id: person.id })!}
                className="flex items-center gap-3 rounded-md border border-line bg-surface-2/40 px-3 py-2 hover:bg-surface-2"
                data-testid="person-row"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{person.name}</span>
                  {person.contact ? (
                    <span className="block truncate text-[12px] text-ink-faint">
                      {person.contact}
                    </span>
                  ) : null}
                </span>
                {flagged.has(person.id) ? (
                  <Badge tone="gold" title="Listed by Insights: many open commitments">
                    {counts.open} open
                  </Badge>
                ) : null}
                {person.followUpDate ? (
                  <Badge tone="lime">
                    Follow up {person.followUpDate}
                    {person.followUpTime === null ? '' : ` · ${formatMinute(person.followUpTime)}`}
                  </Badge>
                ) : null}
                <Badge tone="outline" aria-label={`You owe ${counts.owedByMe}`}>
                  I owe {counts.owedByMe}
                </Badge>
                <Badge tone="outline" aria-label={`Owed to you ${counts.owedToMe}`}>
                  Owed to me {counts.owedToMe}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {showDeleted && deleted.length ? (
        <section aria-label="Deleted people" className="flex flex-col gap-2">
          <h2 className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
            Deleted
          </h2>
          <ul className="flex flex-col gap-1">
            {deleted.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-md border border-dashed border-line px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">{p.name}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void restorePerson(repo, p.id, clock).catch((err: unknown) =>
                      toast({
                        title: 'Could not restore',
                        description: err instanceof Error ? err.message : String(err),
                        variant: 'danger',
                      }),
                    )
                  }
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
