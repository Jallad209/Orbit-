import type { Why } from '@orbit/core';
import { formatMinute } from '@orbit/core';
import { HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';

const COMPONENT_LABELS: Array<[keyof Why['components'], string]> = [
  ['pressure', 'Deadline pressure'],
  ['importance', 'Goal importance'],
  ['priority', 'Priority'],
  ['staleness', 'Staleness'],
  ['energyFit', 'Energy fit'],
  ['overdueBoost', 'Overdue boost'],
  ['nextAction', 'Next action'],
];

/** "Why is this in my plan?" — reasons in plain words, then the score parts. */
export function WhyPopover({ title, why }: { title: string; why: Why }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`Why ${title}`}>
          <HelpCircle className="size-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label={`Why ${title}`} className="w-72" data-testid="why-popover">
        <p className="mb-2 text-[13px] font-semibold">Why this is in the plan</p>
        <ul className="mb-3 flex flex-col gap-1 text-[13px]" aria-label="Reasons">
          {why.reasons.map((r) => (
            <li key={r} className="flex gap-2">
              <span aria-hidden="true" className="text-lime-2">
                •
              </span>
              {r}
            </li>
          ))}
        </ul>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-[12px] text-ink-muted">
          {COMPONENT_LABELS.filter(([k]) => why.components[k] !== 1).map(([k, label]) => (
            <div key={k} className="contents">
              <dt>{label}</dt>
              <dd className="tnum text-right">× {why.components[k].toFixed(2)}</dd>
            </div>
          ))}
          <div className="contents font-medium text-ink">
            <dt>Score</dt>
            <dd className="tnum text-right">{why.score.toFixed(2)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-[12px] text-ink-faint">
          Placed{' '}
          {why.placedAt
            .map((p) => `${formatMinute(p.startMin)}–${formatMinute(p.endMin)}`)
            .join(', ')}
        </p>
      </PopoverContent>
    </Popover>
  );
}
