import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

interface StepperProps {
  steps: readonly string[];
  current: number;
  /** Jump back to a completed step. */
  onSelect: (index: number) => void;
}

/** Progress across a guided flow. Completed steps are clickable; the rest wait their turn. */
export function Stepper({ steps, current, onSelect }: StepperProps) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-[13px]" aria-label="Steps">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!done}
              onClick={() => onSelect(i)}
              aria-current={active ? 'step' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2 py-1',
                active
                  ? 'bg-nav text-nav-fg'
                  : done
                    ? 'text-ink hover:bg-surface-2'
                    : 'text-ink-faint',
              )}
            >
              <span
                className={cn(
                  'grid size-5 place-items-center rounded-full text-[11px] font-semibold',
                  active
                    ? 'bg-lime text-lime-ink'
                    : done
                      ? 'bg-lime-ink text-lime'
                      : 'border border-line text-ink-faint',
                )}
                aria-hidden="true"
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              {label}
            </button>
            {i < steps.length - 1 ? <span aria-hidden="true" className="h-px w-4 bg-line" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

interface FlowShellProps {
  title: string;
  subtitle: ReactNode;
  steps: readonly string[];
  current: number;
  onSelect: (index: number) => void;
  onBack: () => void;
  onNext: () => void;
  /** Label for the final step's primary action. */
  finishLabel: string;
  nextDisabled?: boolean;
  busy?: boolean;
  children: ReactNode;
  testId?: string;
}

/** Title, stepper, one step of content, and Back / Next. Keyboard-only friendly. */
export function FlowShell({
  title,
  subtitle,
  steps,
  current,
  onSelect,
  onBack,
  onNext,
  finishLabel,
  nextDisabled = false,
  busy = false,
  children,
  testId,
}: FlowShellProps) {
  const last = current === steps.length - 1;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5" data-testid={testId} data-step={current}>
      <div>
        <h1 className="text-display font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-1 text-ink-muted">{subtitle}</p>
      </div>
      <Stepper steps={steps} current={current} onSelect={onSelect} />
      <section aria-label={steps[current]} className="flex flex-col gap-4">
        <h2 className="text-h1 font-semibold tracking-tight text-ink">{steps[current]}</h2>
        {children}
      </section>
      <div className="flex items-center justify-between border-t border-line pt-4">
        <Button variant="ghost" onClick={onBack} disabled={current === 0 || busy}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back
        </Button>
        <Button variant="primary" onClick={onNext} disabled={nextDisabled} loading={busy}>
          {last ? finishLabel : 'Next'}
          {last ? null : <ArrowRight className="size-4" aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}
