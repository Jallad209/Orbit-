import { CAPTURE_TYPES, addDays, systemClock, toLocalDate } from '@orbit/core';
import type { Capture, CaptureType, Clock, LocalDate, Project } from '@orbit/core';
import { Archive, CalendarDays, Check, FolderKanban, Tag } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ENTITY_LABELS, TypeBadge } from '@/components/ui/Badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { Input } from '@/components/ui/Input';
import { Kbd } from '@/components/ui/Kbd';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';

export interface TriageActionsProps {
  capture: Capture;
  projects: Project[];
  onSetType: (type: CaptureType) => void;
  onSetDate: (date: LocalDate | null) => void;
  onAssignProject: (projectId: string) => void;
  onAccept: () => void;
  onArchive: () => void;
  /** Controlled popover state so hotkeys can open them. */
  openPopover: 'date' | 'project' | null;
  onOpenPopover: (which: 'date' | 'project' | null) => void;
  clock?: Clock;
}

/** Toolbar for the selected inbox item. Every action also has a single-key hotkey. */
export function TriageActions({
  capture,
  projects,
  onSetType,
  onSetDate,
  onAssignProject,
  onAccept,
  onArchive,
  openPopover,
  onOpenPopover,
  clock = systemClock,
}: TriageActionsProps) {
  const today = toLocalDate(clock.now());
  const [projectQuery, setProjectQuery] = useState('');
  const [customDate, setCustomDate] = useState('');
  const filtered = projects.filter((p) =>
    p.title.toLowerCase().includes(projectQuery.toLowerCase()),
  );

  return (
    <div
      role="toolbar"
      aria-label="Triage"
      className="flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-surface-2/60 px-2 py-1.5"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" title="Change type (t)">
            <Tag className="size-3.5" aria-hidden="true" />
            <TypeBadge kind={capture.type} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {CAPTURE_TYPES.map((t) => (
            <DropdownMenuItem key={t} onSelect={() => onSetType(t)}>
              <span className="flex items-center gap-2">
                <TypeBadge kind={t} />
                {t === capture.type ? <Check className="size-3.5" aria-hidden="true" /> : null}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover open={openPopover === 'date'} onOpenChange={(o) => onOpenPopover(o ? 'date' : null)}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost" title="Set date (d)">
            <CalendarDays className="size-3.5" aria-hidden="true" />
            Date <Kbd>d</Kbd>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56" aria-label="Set date">
          <div className="flex flex-col gap-1">
            {[
              ['Today', today],
              ['Tomorrow', addDays(today, 1)],
              ['In a week', addDays(today, 7)],
            ].map(([label, date]) => (
              <Button
                key={label}
                size="sm"
                variant="ghost"
                className="justify-start"
                onClick={() => onSetDate(date!)}
              >
                {label}
              </Button>
            ))}
            <form
              className="mt-1 flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (customDate) onSetDate(customDate);
              }}
            >
              <Input
                type="date"
                aria-label="Custom date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="h-8"
              />
              <Button size="sm" type="submit" variant="primary">
                Set
              </Button>
            </form>
            <Button
              size="sm"
              variant="ghost"
              className="justify-start text-ink-muted"
              onClick={() => onSetDate(null)}
            >
              Clear date
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Popover
        open={openPopover === 'project'}
        onOpenChange={(o) => onOpenPopover(o ? 'project' : null)}
      >
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost" title="Assign project (p)">
            <FolderKanban className="size-3.5" aria-hidden="true" />
            Project <Kbd>p</Kbd>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64" aria-label="Assign project">
          <Input
            autoFocus
            aria-label="Search projects"
            placeholder="Search projects…"
            value={projectQuery}
            onChange={(e) => setProjectQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered[0]) {
                e.preventDefault();
                onAssignProject(filtered[0].id);
              }
            }}
            className="mb-2 h-8"
          />
          {filtered.length ? (
            <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto" aria-label="Projects">
              {filtered.map((p) => (
                <li key={p.id}>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => onAssignProject(p.id)}
                  >
                    {p.title}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-ink-faint">
              {projects.length
                ? 'No match.'
                : 'No projects yet. Create one under Projects (week 4).'}
            </p>
          )}
        </PopoverContent>
      </Popover>

      <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />

      <Button size="sm" variant="primary" onClick={onAccept} title="Accept (Enter)">
        <Check className="size-3.5" aria-hidden="true" />
        Accept as {ENTITY_LABELS[capture.type].toLowerCase()}{' '}
        <Kbd className="bg-lime-ink/10 text-lime-ink">↵</Kbd>
      </Button>
      <Button size="sm" variant="ghost" onClick={onArchive} title="Archive (e)">
        <Archive className="size-3.5" aria-hidden="true" />
        Archive <Kbd>e</Kbd>
      </Button>
    </div>
  );
}
