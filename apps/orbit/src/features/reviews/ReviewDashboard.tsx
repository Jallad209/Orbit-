import { formatMinute, systemClock, toLocalDate } from '@orbit/core';
import type { Clock, DailyReflection, DayCommitment, Person, WeeklyReview } from '@orbit/core';
import type { Repository } from '@orbit/storage';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { buttonVariants } from '@/components/ui/Button';
import { Card, SectionHeader, Skeleton } from '@/components/ui/Card';
import { useRepoQuery } from '@/data/useQuery';

interface DashboardData {
  commitments: DayCommitment[];
  reflections: DailyReflection[];
  people: Person[];
  weekly: WeeklyReview[];
}

async function loadDashboard(repo: Repository): Promise<DashboardData> {
  const [commitments, reflections, people, weekly] = await Promise.all([
    repo.dayCommitments.list(),
    repo.dailyReflections.list(),
    repo.people.list(),
    repo.weeklyReviews.list(),
  ]);
  return { commitments, reflections, people, weekly };
}

export function ReviewDashboard({ clock = systemClock }: { clock?: Clock }) {
  const { data } = useRepoQuery(loadDashboard, []);
  if (!data) return <Skeleton className="h-96" />;
  const today = toLocalDate(clock.now());
  const commitmentDates = new Set(data.commitments.map((item) => item.date));
  const reflectionDates = new Set(
    data.reflections.filter((item) => item.completedAt).map((item) => item.date),
  );
  const dates = [...new Set([...commitmentDates, ...reflectionDates])]
    .sort()
    .reverse()
    .slice(0, 14);
  const reflections = [...data.reflections]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);
  const followUps = data.people
    .filter((person) => person.followUpDate && person.followUpDate >= today)
    .sort((a, b) => a.followUpDate!.localeCompare(b.followUpDate!))
    .slice(0, 8);
  const weekly = data.weekly
    .filter((review) => review.status === 'completed')
    .sort((a, b) => b.reviewWeekStart.localeCompare(a.reviewWeekStart))
    .slice(0, 5);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5" data-testid="review-dashboard">
      <div className="flex flex-wrap items-end gap-3">
        {/* A minimum width so the heading and its sentence wrap above the button at 400%
            zoom instead of collapsing into a one-word column beside it. */}
        <div className="min-w-[11rem] flex-1">
          <h1 className="text-display font-semibold tracking-tight text-ink">Reviews</h1>
          <p className="mt-1 text-ink-muted">
            Your briefings, reflections, patterns, and follow-ups—calculated only on this device.
          </p>
        </div>
        <Link to="/review/weekly" className={buttonVariants({ variant: 'primary' })}>
          Open weekly review
        </Link>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionHeader title="Daily rhythm" meta="Last 14 active days" />
          {dates.length ? (
            <ul className="flex flex-col gap-1" aria-label="Daily review completion">
              {dates.map((date) => (
                <li
                  key={date}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-sm"
                >
                  <span className="tnum">{date}</span>
                  <Badge tone={commitmentDates.has(date) ? 'ok' : 'outline'}>
                    {commitmentDates.has(date) ? 'Morning done' : 'No morning'}
                  </Badge>
                  <Badge tone={reflectionDates.has(date) ? 'ok' : 'outline'}>
                    {reflectionDates.has(date) ? 'Evening done' : 'No evening'}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">No daily reviews yet.</p>
          )}
        </Card>
        <Card>
          <SectionHeader title="Upcoming follow-ups" meta={`${followUps.length} shown`} />
          {followUps.length ? (
            <ul className="flex flex-col gap-1">
              {followUps.map((person) => (
                <li key={person.id} className="flex items-center gap-2 text-sm">
                  <Link
                    to={`/people/${person.id}`}
                    className="min-w-0 flex-1 truncate hover:underline"
                  >
                    {person.name}
                  </Link>
                  <span className="tnum text-ink-faint">
                    {person.followUpDate}
                    {person.followUpTime !== null ? ` · ${formatMinute(person.followUpTime)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">No follow-ups scheduled.</p>
          )}
        </Card>
      </div>
      <Card>
        <SectionHeader
          title="Journal and structured reflections"
          meta="Journal text is never analyzed"
        />
        {reflections.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[12px] text-ink-faint">
                <tr>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Journal</th>
                  <th className="pb-2">Mood</th>
                  <th className="pb-2">Stress</th>
                  <th className="pb-2">Sleep</th>
                  <th className="pb-2">Tags</th>
                </tr>
              </thead>
              <tbody>
                {reflections.map((item) => (
                  <tr key={item.id} className="border-t border-line">
                    <td className="py-2 tnum">{item.date}</td>
                    <td>
                      {item.journalNoteId ? (
                        <Link to={`/notes/${item.journalNoteId}`} className="hover:underline">
                          Open entry
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{item.mood ?? '—'}</td>
                    <td>{item.stress ?? '—'}</td>
                    <td>{item.sleepQuality ?? '—'}</td>
                    <td>{item.tags.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">No reflections yet.</p>
        )}
      </Card>
      <Card>
        <SectionHeader title="Weekly review history" />
        {weekly.length ? (
          <ul className="flex flex-col gap-1">
            {weekly.map((review) => (
              <li key={review.id} className="flex items-center gap-2 text-sm">
                <Link to={`/review/weekly?review=${review.id}`} className="flex-1 hover:underline">
                  Week of {review.reviewWeekStart}
                </Link>
                <Badge tone="outline">{review.summary?.actionCount ?? 0} actions</Badge>
                <Badge tone={(review.summary?.items.length ?? 0) ? 'gold' : 'ok'}>
                  {review.summary?.items.length ?? 0} unresolved
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">No completed weekly reviews yet.</p>
        )}
      </Card>
    </div>
  );
}
