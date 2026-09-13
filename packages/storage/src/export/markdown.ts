import { formatMinute } from '@orbit/core';
import type { Area, Goal, Milestone, Note, Project, Task } from '@orbit/core';
import type { Repository } from '../repository';

export interface MarkdownFile {
  /** Relative path inside the export folder, e.g. `projects/thesis.md`. */
  path: string;
  content: string;
}

export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'untitled';
}

function uniquePath(base: string, ext: string, used: Set<string>): string {
  let candidate = `${base}${ext}`;
  let n = 2;
  while (used.has(candidate)) candidate = `${base}-${n++}${ext}`;
  used.add(candidate);
  return candidate;
}

function checkbox(done: boolean): string {
  return done ? '[x]' : '[ ]';
}

function byTitle<T extends { title: string }>(a: T, b: T): number {
  return a.title.localeCompare(b.title);
}

/**
 * Human-readable export: one file per project and note, plus an index and
 * short lists for routines, people, and bills. Soft-deleted rows are omitted.
 */
export function markdownAnchor(path: string): string {
  return `orbit-${Array.from(path, (c) => (/[a-zA-Z0-9]/.test(c) ? c : `_${c.codePointAt(0)!.toString(16)}_`)).join('')}`;
}

export async function exportMarkdown(
  repo: Repository,
  options: { singleDocument?: boolean } = {},
): Promise<MarkdownFile[]> {
  const href = (path: string, fromSubfolder = false) =>
    options.singleDocument ? `#${markdownAnchor(path)}` : `${fromSubfolder ? '../' : ''}${path}`;
  const [areas, goals, projects, milestones, tasks, notes, routines, people, commitments, bills] =
    await Promise.all([
      repo.areas.list(),
      repo.goals.list(),
      repo.projects.list(),
      repo.milestones.list(),
      repo.tasks.list(),
      repo.notes.list(),
      repo.routines.list(),
      repo.people.list(),
      repo.commitments.list(),
      repo.bills.list(),
    ]);

  const files: MarkdownFile[] = [];
  const used = new Set<string>();
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const projectPath = new Map<string, string>();
  const sortedNotes = [...notes].sort(byTitle);
  const notePath = new Map(
    sortedNotes.map((n) => [n.id, uniquePath(`notes/${slugify(n.title)}`, '.md', used)]),
  );

  // Projects
  for (const p of [...projects].sort(byTitle)) {
    const path = uniquePath(`projects/${slugify(p.title)}`, '.md', used);
    projectPath.set(p.id, path);
    files.push({
      path,
      content: renderProject(p, areaById, goalById, milestones, tasks, notes, notePath, (path) =>
        href(path, true),
      ),
    });
  }

  // Notes
  for (const n of sortedNotes) {
    const path = notePath.get(n.id)!;
    const lines = [`# ${n.title}`, ''];
    const meta: string[] = [];
    if (n.projectId && projectPath.has(n.projectId)) {
      const p = projects.find((x) => x.id === n.projectId);
      if (p) meta.push(`Project: [${p.title}](${href(projectPath.get(n.projectId)!, true)})`);
    }
    if (n.areaId && areaById.has(n.areaId)) meta.push(`Area: ${areaById.get(n.areaId)!.name}`);
    if (meta.length) lines.push(meta.join(' · '), '');
    lines.push(n.body.trim(), '');
    files.push({ path, content: lines.join('\n') });
  }

  // Index
  {
    const lines = ['# Orbit', '', `Exported ${new Date().toISOString().slice(0, 10)}.`, ''];
    for (const area of [...areas].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`## ${area.name}`, '');
      const areaGoals = goals.filter((g) => g.areaId === area.id).sort(byTitle);
      const orphanProjects = projects
        .filter((p) => p.areaId === area.id && !p.goalId)
        .sort(byTitle);
      for (const g of areaGoals) {
        lines.push(`- **${g.title}** (${g.status}, importance ${g.importance})`);
        for (const p of projects.filter((x) => x.goalId === g.id).sort(byTitle)) {
          lines.push(`  - [${p.title}](${href(projectPath.get(p.id)!)}) — ${p.status}`);
        }
      }
      for (const p of orphanProjects)
        lines.push(`- [${p.title}](${href(projectPath.get(p.id)!)}) — ${p.status}`);
      lines.push('');
    }
    const unfiled = projects.filter((p) => !areaById.has(p.areaId));
    if (unfiled.length) {
      lines.push('## Unfiled', '');
      for (const p of unfiled.sort(byTitle))
        lines.push(`- [${p.title}](${href(projectPath.get(p.id)!)})`);
      lines.push('');
    }
    files.unshift({ path: 'README.md', content: lines.join('\n') });
  }

  // Routines
  if (routines.length) {
    const lines = ['# Routines', ''];
    for (const r of [...routines].sort(byTitle)) {
      const rec = r.recurrence;
      const when =
        rec.freq === 'weekly' && rec.byDay.length ? `weekly on ${rec.byDay.join('/')}` : rec.freq;
      const window = r.preferredWindow
        ? ` · ${formatMinute(r.preferredWindow.startMin)}–${formatMinute(r.preferredWindow.endMin)}`
        : '';
      lines.push(`- **${r.title}** — ${when}, ${r.durationMin} min, ${r.energy} energy${window}`);
    }
    lines.push('');
    files.push({ path: 'routines.md', content: lines.join('\n') });
  }

  // People
  if (people.length) {
    const lines = ['# People', ''];
    for (const person of [...people].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`## ${person.name}`, '');
      if (person.contact) lines.push(person.contact, '');
      const cs = commitments.filter((c) => c.personId === person.id);
      for (const c of cs) {
        const who = c.direction === 'owed-by-me' ? 'I owe' : 'They owe';
        const due = c.dueAt ? ` (due ${c.dueAt.slice(0, 10)})` : '';
        lines.push(`- ${checkbox(c.status === 'done')} ${who}: ${c.text}${due}`);
      }
      lines.push('');
    }
    files.push({ path: 'people.md', content: lines.join('\n') });
  }

  // Bills
  if (bills.length) {
    const lines = ['# Bills', '', '| Bill | Amount | Due | Paid |', '| --- | ---: | --- | :---: |'];
    for (const b of [...bills].sort((a, b) => a.dueAt.localeCompare(b.dueAt))) {
      lines.push(
        `| ${b.title} | ${b.amount}${b.currency ? ` ${b.currency}` : ''} | ${b.dueAt} | ${b.paid ? 'yes' : 'no'} |`,
      );
    }
    lines.push('');
    files.push({ path: 'bills.md', content: lines.join('\n') });
  }

  return files;
}

function renderProject(
  p: Project,
  areaById: Map<string, Area>,
  goalById: Map<string, Goal>,
  milestones: Milestone[],
  tasks: Task[],
  notes: Note[],
  notePath: Map<string, string>,
  href: (path: string) => string,
): string {
  const lines = [`# ${p.title}`, ''];
  const meta: string[] = [`Status: ${p.status}`];
  const area = areaById.get(p.areaId);
  if (area) meta.push(`Area: ${area.name}`);
  const goal = p.goalId ? goalById.get(p.goalId) : undefined;
  if (goal) meta.push(`Goal: ${goal.title}`);
  if (p.deadline) meta.push(`Deadline: ${p.deadline}`);
  lines.push(meta.join(' · '), '');

  if (p.outcome.trim()) lines.push('## Outcome', '', p.outcome.trim(), '');

  const ms = milestones.filter((m) => m.projectId === p.id).sort((a, b) => a.order - b.order);
  if (ms.length) {
    const done = ms.filter((m) => m.done).length;
    lines.push(`## Milestones (${done}/${ms.length})`, '');
    for (const m of ms) lines.push(`- ${checkbox(m.done)} ${m.title}`);
    lines.push('');
  }

  const ts = tasks.filter((t) => t.projectId === p.id && t.status !== 'archived');
  if (ts.length) {
    lines.push('## Tasks', '');
    for (const t of ts.sort((a, b) => a.priority - b.priority || byTitle(a, b))) {
      const next = p.nextActionTaskId === t.id ? ' **← next action**' : '';
      const due = t.dueAt ? ` (due ${t.dueAt.slice(0, 10)})` : '';
      lines.push(
        `- ${checkbox(t.status === 'done')} ${t.title}${due} · P${t.priority} · ${t.estimateMin} min${next}`,
      );
    }
    lines.push('');
  }

  const ns = notes.filter((n) => n.projectId === p.id).sort(byTitle);
  if (ns.length) {
    lines.push('## Notes', '');
    for (const n of ns) lines.push(`- [${n.title}](${href(notePath.get(n.id)!)})`);
    lines.push('');
  }

  return lines.join('\n');
}
