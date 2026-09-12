import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/** Capture / entity types the inbox can classify into. */
export type EntityKind =
  'task' | 'event' | 'note' | 'goal' | 'routine' | 'bill' | 'person' | 'project';

export const ENTITY_LABELS: Record<EntityKind, string> = {
  task: 'Task',
  event: 'Event',
  note: 'Note',
  goal: 'Goal',
  routine: 'Routine',
  bill: 'Bill',
  person: 'Person',
  project: 'Project',
};

export const badgeVariants = cva(
  'inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-3 text-ink-muted',
        lime: 'bg-lime text-lime-ink',
        gold: 'bg-gold-2/60 text-gold-ink',
        danger: 'bg-danger-soft text-danger',
        ok: 'bg-ok/15 text-ok',
        outline: 'border border-line text-ink-muted',
        // Entity kinds
        task: 'bg-lime/40 text-lime-ink',
        event: 'bg-[#dbe7f3] text-[#1f3a5a]',
        note: 'bg-surface-3 text-ink',
        goal: 'bg-gold-2/60 text-gold-ink',
        routine: 'bg-[#dcefe3] text-[#1f4a31]',
        bill: 'bg-[#f3dede] text-[#6b1f1f]',
        person: 'bg-[#eadff3] text-[#3f2a5a]',
        project: 'bg-nav text-nav-fg',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps extends ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export interface TypeBadgeProps extends Omit<ComponentProps<'span'>, 'children'> {
  kind: EntityKind;
}

/** Colour-coded chip for an entity kind, e.g. the inbox classification. */
export function TypeBadge({ kind, className, ...props }: TypeBadgeProps) {
  return (
    <Badge tone={kind} data-kind={kind} className={className} {...props}>
      {ENTITY_LABELS[kind]}
    </Badge>
  );
}
