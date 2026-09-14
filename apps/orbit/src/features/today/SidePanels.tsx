import { formatDuration } from '@orbit/core';
import { Link } from 'react-router';
import { HealthBadges } from '@/components/HealthBadge';
import { Badge } from '@/components/ui/Badge';
import { Card, ProgressBar, SectionHeader } from '@/components/ui/Card';
import type { TodayData } from './todayService';

/** Overdue tasks, tasks due soon with no block, projects close to a deadline. */
export function AtRiskPanel({ data }: { data: TodayData }) {
  const { overdue, dueSoon, projects } = data.atRisk;
  const total = overdue.length + dueSoon.length + projects.length;
  return (
    <Card data-testid="at-risk">
      <SectionHeader title="At risk" meta={total ? String(total) : undefined} />
      {total === 0 ? <p className="text-[13px] text-ink-muted">Nothing is slipping.</p> : null}
      <ul className="flex flex-col gap-1 text-sm" aria-label="At risk">
        {overdue.map((t) => (
          <li key={t.id} className="flex items-center gap-2">
            <Badge tone="danger">Overdue</Badge>
            <span className="min-w-0 flex-1 truncate">{t.title}</span>
            <span className="text-[12px] text-ink-faint tnum">{t.dueAt!.slice(0, 10)}</span>
          </li>
        ))}
        {dueSoon.map((t) => (
          <li key={t.id} className="flex items-center gap-2">
            <Badge tone="gold">Due soon</Badge>
            <span className="min-w-0 flex-1 truncate">{t.title}</span>
            <span className="text-[12px] text-ink-faint tnum">{t.dueAt!.slice(0, 10)}</span>
          </li>
        ))}
        {projects.map(({ project, health }) => (
          <li key={project.id} className="flex items-center gap-2">
            <Badge tone={health.overdue ? 'danger' : 'gold'}>
              {health.overdue
                ? `Overdue ${-health.daysToDeadline!}d`
                : `${health.daysToDeadline}d left`}
            </Badge>
            <Link
              to={`/projects/${project.id}`}
              className="min-w-0 flex-1 truncate hover:underline"
            >
              {project.title}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Minutes by area over the last seven days, as a small bar list. */
export function TimeByArea({ data }: { data: TodayData }) {
  const max = Math.max(1, ...data.timeByArea.map((x) => x.minutes));
  return (
    <Card data-testid="time-by-area">
      <SectionHeader title="Where time went" meta="7 days" />
      {data.timeByArea.length === 0 ? (
        <p className="text-[13px] text-ink-muted">No sessions recorded yet.</p>
      ) : null}
      <ul className="flex flex-col gap-2" aria-label="Time by area">
        {data.timeByArea.map(({ area, minutes }) => (
          <li key={area?.id ?? 'none'} className="flex flex-col gap-1 text-[13px]">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full"
                  style={{ background: area?.color ?? '#9a9488' }}
                />
                {area?.name ?? 'Unassigned'}
              </span>
              <span className="text-ink-faint tnum">{formatDuration(minutes)}</span>
            </div>
            <ProgressBar
              value={minutes / max}
              label={`${area?.name ?? 'Unassigned'} time`}
              tone="gold"
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ActiveProjects({ data }: { data: TodayData }) {
  const rows = data.activeProjects.slice(0, 6);
  return (
    <Card data-testid="active-projects">
      <SectionHeader
        title="Projects"
        meta={String(data.activeProjects.length)}
        actions={
          <Link to="/projects" className="text-[12px] text-ink-muted hover:underline">
            All
          </Link>
        }
      />
      {rows.length === 0 ? <p className="text-[13px] text-ink-muted">No active projects.</p> : null}
      <ul className="flex flex-col gap-1.5" aria-label="Active projects">
        {rows.map(({ project, health }) => (
          <li key={project.id} className="flex items-center gap-2 text-sm">
            <Link
              to={`/projects/${project.id}`}
              className="min-w-0 flex-1 truncate hover:underline"
            >
              {project.title}
            </Link>
            <HealthBadges health={health} />
            <span className="w-16">
              <ProgressBar value={health.progress} label={`${project.title} progress`} />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function UpcomingCommitments({ data }: { data: TodayData }) {
  return (
    <Card data-testid="commitments">
      <SectionHeader title="Commitments" meta="7 days" />
      {data.upcomingCommitments.length === 0 ? (
        <p className="text-[13px] text-ink-muted">Nothing promised this week.</p>
      ) : null}
      <ul className="flex flex-col gap-1 text-sm" aria-label="Upcoming commitments">
        {data.upcomingCommitments.map(({ commitment, person }) => (
          <li key={commitment.id} className="flex items-center gap-2">
            <Badge tone={commitment.direction === 'owed-by-me' ? 'commitment' : 'outline'}>
              {commitment.direction === 'owed-by-me' ? 'I owe' : 'Owed to me'}
            </Badge>
            <span className="min-w-0 flex-1 truncate">
              {commitment.text}
              {person ? <span className="text-ink-faint"> · {person.name}</span> : null}
            </span>
            {commitment.dueAt ? (
              <span className="text-[12px] text-ink-faint tnum">
                {commitment.dueAt.slice(0, 10)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
