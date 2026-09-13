import { formatDuration, systemClock, toLocalDate } from '@orbit/core';
import type { Clock, Commitment, Note, Person, Project, Task } from '@orbit/core';
import type { Repository } from '@orbit/storage';
import { Link } from 'react-router';
import { Badge, TypeBadge } from '@/components/ui/Badge';
import { Button, buttonVariants } from '@/components/ui/Button';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/Drawer';
import { useRepoQuery } from '@/data/useQuery';
import type { PreviewRef } from './searchActions';

interface Loaded {
  areaName: string | null;
  projectTitle: string | null;
  record:
    | { type: 'task'; task: Task }
    | { type: 'note'; note: Note }
    | { type: 'project'; project: Project }
    | { type: 'person'; person: Person; commitments: Commitment[] }
    | null;
}

async function loadPreview(repo: Repository, ref: PreviewRef): Promise<Loaded> {
  const names = async (areaId: string | null, projectId: string | null) => ({
    areaName: areaId ? ((await repo.areas.get(areaId))?.name ?? null) : null,
    projectTitle: projectId ? ((await repo.projects.get(projectId))?.title ?? null) : null,
  });
  switch (ref.type) {
    case 'task': {
      const task = await repo.tasks.get(ref.id);
      if (!task || task.deletedAt !== null)
        return { areaName: null, projectTitle: null, record: null };
      return { ...(await names(task.areaId, task.projectId)), record: { type: 'task', task } };
    }
    case 'note': {
      const note = await repo.notes.get(ref.id);
      if (!note || note.deletedAt !== null)
        return { areaName: null, projectTitle: null, record: null };
      return { ...(await names(note.areaId, note.projectId)), record: { type: 'note', note } };
    }
    case 'project': {
      const project = await repo.projects.get(ref.id);
      if (!project || project.deletedAt !== null)
        return { areaName: null, projectTitle: null, record: null };
      return { ...(await names(project.areaId, null)), record: { type: 'project', project } };
    }
    case 'person': {
      const person = await repo.people.get(ref.id);
      if (!person || person.deletedAt !== null)
        return { areaName: null, projectTitle: null, record: null };
      const commitments = (await repo.commitments.query((c) => c.personId === person.id)).filter(
        (c) => c.status === 'open',
      );
      return {
        areaName: null,
        projectTitle: null,
        record: { type: 'person', person, commitments },
      };
    }
  }
}

interface Props {
  target: PreviewRef | null;
  onClose: () => void;
  clock?: Clock;
  /** Task actions, shared with the result rows. */
  onComplete?: (task: Task) => void;
  onSchedule?: (task: Task) => void;
}

function Meta({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}

/**
 * Read-only preview of a search result. People and notes have no screen
 * of their own until week 12; this drawer shows what they hold so a
 * search never dead-ends on a placeholder.
 */
export function SearchPreview({
  target,
  onClose,
  clock = systemClock,
  onComplete,
  onSchedule,
}: Props) {
  const { data, loading } = useRepoQuery(
    async (repo) => (target ? loadPreview(repo, target) : null),
    [target?.type, target?.id],
  );
  const today = toLocalDate(clock.now());
  const record = data?.record ?? null;

  return (
    <Drawer open={target !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DrawerContent aria-describedby={undefined} data-testid="search-preview">
        <DrawerHeader>
          <div className="mb-1">{target ? <TypeBadge kind={target.type} /> : null}</div>
          <DrawerTitle className="text-h2">
            {record?.type === 'task'
              ? record.task.title
              : record?.type === 'note'
                ? record.note.title
                : record?.type === 'project'
                  ? record.project.title
                  : record?.type === 'person'
                    ? record.person.name
                    : loading
                      ? 'Loading…'
                      : 'Not found'}
          </DrawerTitle>
        </DrawerHeader>
        <DrawerBody>
          {!record && !loading ? (
            <p className="text-sm text-ink-muted">This record no longer exists.</p>
          ) : null}
          {record?.type === 'task' ? (
            <div className="flex flex-col gap-4">
              <dl className="flex flex-col gap-1.5">
                <Meta label="Status" value={record.task.status} />
                <Meta label="Project" value={data?.projectTitle} />
                <Meta label="Area" value={data?.areaName} />
                <Meta
                  label="Due"
                  value={record.task.dueAt ? record.task.dueAt.slice(0, 10) : null}
                />
                <Meta label="Estimate" value={formatDuration(record.task.estimateMin)} />
                <Meta label="Priority" value={`P${record.task.priority}`} />
                <Meta label="Energy" value={record.task.energy} />
              </dl>
              {record.task.notes ? (
                <p className="text-sm whitespace-pre-wrap text-ink">{record.task.notes}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {record.task.status === 'open' || record.task.status === 'inbox' ? (
                  <>
                    <Button size="sm" variant="primary" onClick={() => onComplete?.(record.task)}>
                      Complete
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => onSchedule?.(record.task)}>
                      Schedule today
                    </Button>
                  </>
                ) : (
                  <Badge tone="ok">{record.task.status}</Badge>
                )}
                {record.task.projectId ? (
                  <Link
                    to={`/projects/${record.task.projectId}`}
                    className={buttonVariants({ size: 'sm', variant: 'ghost' })}
                  >
                    Open project
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
          {record?.type === 'note' ? (
            <div className="flex flex-col gap-4">
              <dl className="flex flex-col gap-1.5">
                <Meta label="Project" value={data?.projectTitle} />
                <Meta label="Area" value={data?.areaName} />
                <Meta label="Edited" value={record.note.updatedAt.slice(0, 10)} />
              </dl>
              {record.note.body ? (
                <p
                  className="text-sm leading-6 whitespace-pre-wrap text-ink"
                  data-testid="note-body"
                >
                  {record.note.body}
                </p>
              ) : (
                <p className="text-sm text-ink-muted">This note has no body yet.</p>
              )}
              {record.note.projectId ? (
                <Link to={`/projects/${record.note.projectId}`} className="text-[13px] underline">
                  Open project
                </Link>
              ) : null}
              <p className="text-[12px] text-ink-faint">Editing notes arrives in week 12.</p>
            </div>
          ) : null}
          {record?.type === 'project' ? (
            <div className="flex flex-col gap-4">
              <dl className="flex flex-col gap-1.5">
                <Meta label="Status" value={record.project.status} />
                <Meta label="Area" value={data?.areaName} />
                <Meta label="Deadline" value={record.project.deadline} />
              </dl>
              {record.project.outcome ? (
                <p className="text-sm text-ink">{record.project.outcome}</p>
              ) : null}
              <Link to={`/projects/${record.project.id}`} className="text-[13px] underline">
                Open project
              </Link>
            </div>
          ) : null}
          {record?.type === 'person' ? (
            <div className="flex flex-col gap-4">
              <dl className="flex flex-col gap-1.5">
                <Meta label="Contact" value={record.person.contact || null} />
                <Meta
                  label="Last contact"
                  value={
                    record.person.lastContactAt ? record.person.lastContactAt.slice(0, 10) : 'never'
                  }
                />
              </dl>
              <div>
                <p className="mb-1 text-[12px] font-semibold tracking-wide text-ink-faint uppercase">
                  Open commitments
                </p>
                {record.commitments.length === 0 ? (
                  <p className="text-sm text-ink-muted">None open.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {record.commitments.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 text-sm">
                        <Badge tone={c.direction === 'owed-to-me' ? 'gold' : 'neutral'}>
                          {c.direction === 'owed-to-me' ? 'they owe' : 'I owe'}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate text-ink">{c.text}</span>
                        {c.dueAt ? (
                          <span
                            className={
                              c.dueAt.slice(0, 10) < today
                                ? 'text-[12px] text-danger'
                                : 'text-[12px] text-ink-faint'
                            }
                          >
                            {c.dueAt.slice(0, 10)}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="text-[12px] text-ink-faint">The people screen arrives in week 12.</p>
            </div>
          ) : null}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
