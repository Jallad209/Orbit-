import type { Insight } from '@orbit/core';
import { AlertTriangle, ChevronDown, Info, ShieldAlert } from 'lucide-react';
import { useId, useState, type ComponentProps } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Button, buttonVariants } from '@/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { cn } from '@/lib/cn';
import { InsightEvidence } from './InsightEvidence';
import type { SnoozeChoice } from './insightService';
import { subjectDestination, type Destination } from './insightRoutes';
import { SEVERITY_LABEL, SEVERITY_TONE, formatRangeDates, formatThreshold } from './format';

interface Props extends Omit<ComponentProps<'article'>, 'children'> {
  insight: Insight;
  onSnooze?: (insight: Insight, choice: SnoozeChoice) => void;
  onDismiss?: (insight: Insight) => void;
  onPreview: (destination: Extract<Destination, { kind: 'preview' }>) => void;
  /** Start with the evidence open (the Timeline warning link does). */
  defaultOpen?: boolean;
  /** Hide the snooze/dismiss actions (the Today strip keeps them on the Insights page). */
  compact?: boolean;
  busy?: boolean;
}

const ICONS = { risk: ShieldAlert, attention: AlertTriangle, info: Info } as const;

/**
 * One observation: severity as text and icon as well as colour, the
 * threshold and sample size visible without expanding, the evidence behind
 * a disclosure, and the snooze/dismiss actions. Keyboard: every control is
 * a named button or link.
 */
export function InsightCard({
  insight,
  onSnooze,
  onDismiss,
  onPreview,
  defaultOpen = false,
  compact = false,
  busy = false,
  className,
  ...rest
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const Icon = ICONS[insight.severity];
  const tone = SEVERITY_TONE[insight.severity];
  const subject = subjectDestination(insight.subject);
  const dates = formatRangeDates(insight);
  return (
    <article
      aria-labelledby={`${id}-title`}
      data-testid="insight-card"
      data-key={insight.key}
      data-severity={insight.severity}
      tabIndex={-1}
      className={cn(
        'rounded-lg border px-3 py-2.5 outline-none focus-visible:outline-2 focus-visible:outline-ink',
        tone === 'danger'
          ? 'border-danger/30 bg-danger-soft/40'
          : tone === 'gold'
            ? 'border-gold-2/60 bg-gold-2/20'
            : 'border-line bg-surface-2/50',
        className,
      )}
      {...rest}
    >
      <div className="flex flex-wrap items-start gap-2">
        <Badge tone={tone} className="mt-0.5">
          <Icon className="size-3" aria-hidden="true" />
          {SEVERITY_LABEL[insight.severity]}
        </Badge>
        {/* `flex-1` alone has a zero basis, so the row never wraps and the observation is
            squeezed beside the badge — a few characters per line at 400% zoom. */}
        <div className="min-w-[11rem] flex-1">
          <h3 id={`${id}-title`} className="text-[14px] font-medium leading-5 text-ink">
            {insight.title}
          </h3>
          <p className="mt-0.5 text-[13px] text-ink-muted">{insight.detail}</p>
          <p className="mt-1 text-[12px] text-ink-faint tnum" data-testid="insight-threshold">
            Threshold: {formatThreshold(insight.threshold)}
            {dates ? ` · ${dates}` : ''}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-evidence`}
          onClick={() => setOpen((o) => !o)}
          className={buttonVariants({ size: 'sm', variant: 'ghost' })}
        >
          <ChevronDown
            className={cn('size-3.5 transition-transform', open && 'rotate-180')}
            aria-hidden="true"
          />
          Evidence ({insight.evidence.length})
        </button>
        {subject.kind === 'route' ? (
          <Link to={subject.to} className={buttonVariants({ size: 'sm', variant: 'ghost' })}>
            {subject.label}
          </Link>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => onPreview(subject)}>
            {subject.label}
          </Button>
        )}
        {!compact ? (
          <span className="ml-auto flex items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  aria-label={`Snooze: ${insight.title}`}
                >
                  Snooze
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onSnooze?.(insight, 'day')}>
                  1 day
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onSnooze?.(insight, 'week')}>
                  1 week
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onSnooze?.(insight, 'change')}>
                  Until data changes
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              aria-label={`Dismiss: ${insight.title}`}
              onClick={() => onDismiss?.(insight)}
            >
              Dismiss
            </Button>
          </span>
        ) : null}
      </div>
      <div id={`${id}-evidence`} hidden={!open} className="mt-2">
        {open ? <InsightEvidence insight={insight} onPreview={onPreview} /> : null}
      </div>
    </article>
  );
}
