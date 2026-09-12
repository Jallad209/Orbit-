import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn('rounded-lg border border-line bg-surface-2/60 p-4', className)}
      {...props}
    />
  );
}

export interface SectionHeaderProps extends Omit<ComponentProps<'div'>, 'title'> {
  title: ReactNode;
  /** Small count or status shown next to the title. */
  meta?: ReactNode;
  /** Right-aligned controls. */
  actions?: ReactNode;
  as?: 'h1' | 'h2' | 'h3';
}

export function SectionHeader({
  title,
  meta,
  actions,
  as: Heading = 'h2',
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <div className={cn('mb-3 flex items-baseline justify-between gap-3', className)} {...props}>
      <div className="flex items-baseline gap-2">
        <Heading className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
          {title}
        </Heading>
        {meta ? <span className="text-[12px] text-ink-faint tnum">{meta}</span> : null}
      </div>
      {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
    </div>
  );
}

export interface ProgressBarProps extends ComponentProps<'div'> {
  /** 0..1 */
  value: number;
  label?: string;
  tone?: 'lime' | 'gold' | 'danger';
  size?: 'sm' | 'md';
}

export function ProgressBar({
  value,
  label,
  tone = 'lime',
  size = 'sm',
  className,
  ...props
}: ProgressBarProps) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const fill = { lime: 'bg-lime-2', gold: 'bg-gold', danger: 'bg-danger' }[tone];
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
      className={cn(
        'w-full overflow-hidden rounded-full bg-surface-3',
        size === 'sm' ? 'h-1.5' : 'h-2.5',
        className,
      )}
      {...props}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-(--duration-base)', fill)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? <div className="mb-3 text-ink-faint [&>svg]:size-6">{icon}</div> : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-[13px] text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-surface-3', className)}
      {...props}
    />
  );
}
