import { systemClock } from '@orbit/core';
import type { Clock } from '@orbit/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { HealthBadges } from '@/components/HealthBadge';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { useRepoQuery } from '@/data/useQuery';
import { routeFor } from '@/lib/destinations';
import type { StepSession } from '../useReviewSession';
import {
  archiveProjectWithin,
  createNextActionWithin,
  editProjectWithin,
  loadProjectsStep,
  setNextActionWithin,
} from '../weeklyService';
import { DeferButton, StepFrame } from './StepFrame';

/**
 * Step 3: every active project with the shared week-11 health. Set or
 * create a next action, edit the outcome, archive, or record that it was
 * inspected. Ownership and status are revalidated when the choice is
 * saved; health is recomputed from the committed data.
 */
export function ProjectsStep({
  session,
  clock = systemClock,
}: {
  session: StepSession;
  clock?: Clock;
}) {
  const { data } = useRepoQuery((r) => loadProjectsStep(r, clock), [session.review.revision]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  if (!data) return <p className="text-sm text-ink-muted">Loading…</p>;
  const items = data.projects.map((p) => ({ type: 'project' as const, id: p.project.id }));
  return (
    <StepFrame
      session={session}
      items={items}
      fingerprint={data.fingerprint}
      intro="Every active project, with the same health signals as everywhere else. Give each one a decision: a next action, an edit, an archive, or simply “inspected” — inspected does not mean every warning is fixed."
      gate="Inspect, act on, or defer them."
    >
      {data.projects.length === 0 ? (
        <p className="text-[13px] text-ink-faint">No active projects.</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {data.projects.map(({ project, health, openTasks, area }) => {
          const ref = { type: 'project' as const, id: project.id };
          const decided = session.decided.has(`project:${project.id}`);
          const fp = data.fingerprint;
          return (
            <li
              key={project.id}
              className="flex flex-col gap-2 rounded-md border border-line px-3 py-2 text-sm"
              data-testid="review-project"
              data-decided={decided}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={routeFor({ type: 'project', id: project.id })!}
                  className="min-w-0 flex-1 truncate font-medium hover:underline"
                >
                  {project.title}
                </Link>
                {area ? <span className="text-[12px] text-ink-muted">{area.name}</span> : null}
                <HealthBadges health={health} />
                {decided ? <Badge tone="ok">decided</Badge> : null}
              </div>
              <p className="text-[12px] text-ink-faint">
                {Math.round(health.progress * 100)}% · {openTasks.length} open task
                {openTasks.length === 1 ? '' : 's'}
                {health.lastActivityAt
                  ? ` · last activity ${health.lastActivityAt.slice(0, 10)}`
                  : ' · no activity recorded'}
                {project.deadline ? ` · deadline ${project.deadline}` : ''}
              </p>
              {!decided ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      aria-label={`Next action for ${project.title}`}
                      value={
                        project.nextActionTaskId &&
                        openTasks.some((t) => t.id === project.nextActionTaskId)
                          ? project.nextActionTaskId
                          : ''
                      }
                      onChange={(e) => {
                        const taskId = e.target.value || null;
                        void session.submit('set-next-action', [ref], fp, { taskId }, (tx) =>
                          setNextActionWithin(tx, project.id, taskId),
                        );
                      }}
                      className="h-8 w-56"
                      disabled={session.busy || session.stale}
                    >
                      <option value="">
                        {openTasks.length ? 'Set next action…' : 'No open tasks'}
                      </option>
                      {openTasks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </Select>
                    <Input
                      aria-label={`New next action for ${project.title}`}
                      placeholder="Or create a next action…"
                      value={titles[project.id] ?? ''}
                      onChange={(e) => setTitles((t) => ({ ...t, [project.id]: e.target.value }))}
                      className="h-8 w-56"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!(titles[project.id] ?? '').trim() || session.busy || session.stale}
                      onClick={() =>
                        void session
                          .submit(
                            'create-next-action',
                            [ref],
                            fp,
                            { title: titles[project.id]!.trim() },
                            (tx) =>
                              createNextActionWithin(tx, project.id, titles[project.id]!, clock),
                          )
                          .then((r) => r && setTitles((t) => ({ ...t, [project.id]: '' })))
                      }
                    >
                      Create and set
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    <Textarea
                      aria-label={`Outcome for ${project.title}`}
                      rows={1}
                      value={outcomes[project.id] ?? project.outcome}
                      onChange={(e) => setOutcomes((o) => ({ ...o, [project.id]: e.target.value }))}
                      className="min-w-56 flex-1"
                      placeholder="Desired outcome"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={
                        (outcomes[project.id] ?? project.outcome) === project.outcome ||
                        session.busy ||
                        session.stale
                      }
                      onClick={() =>
                        void session.submit(
                          'edit-project',
                          [ref],
                          fp,
                          { outcome: outcomes[project.id] },
                          (tx) =>
                            editProjectWithin(tx, project, { outcome: outcomes[project.id] ?? '' }),
                        )
                      }
                    >
                      Save outcome
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={session.busy || session.stale}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Archive “${project.title}”? Its ${openTasks.length} open task${openTasks.length === 1 ? '' : 's'} will be archived too; done tasks stay.`,
                          )
                        )
                          void session.submit('archive-project', [ref], fp, {}, (tx) =>
                            archiveProjectWithin(tx, project.id),
                          );
                      }}
                    >
                      Archive
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={session.busy || session.stale}
                      onClick={() =>
                        void session.submit('acknowledge', [ref], fp, {}, async () => ({}))
                      }
                    >
                      Inspected
                    </Button>
                    <DeferButton session={session} target={ref} fingerprint={fp} />
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </StepFrame>
  );
}
