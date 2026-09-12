import { Checkbox as CheckboxPrimitive, Switch as SwitchPrimitive } from 'radix-ui';
import { Check } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CheckboxProps extends ComponentProps<typeof CheckboxPrimitive.Root> {
  label?: ReactNode;
  description?: ReactNode;
}

export function Checkbox({ className, label, description, id, ...props }: CheckboxProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const box = (
    <CheckboxPrimitive.Root
      id={inputId}
      className={cn(
        'grid size-[18px] shrink-0 place-items-center rounded-[5px] border border-ink-faint bg-white/60',
        'transition-colors duration-(--duration-fast)',
        'data-[state=checked]:border-lime-ink data-[state=checked]:bg-lime-ink data-[state=checked]:text-lime',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
  if (!label) return box;
  return (
    <div className="flex items-start gap-2.5">
      <span className="pt-0.5">{box}</span>
      <label htmlFor={inputId} className="cursor-pointer select-none">
        <span className="block text-sm text-ink">{label}</span>
        {description ? (
          <span className="block text-[13px] text-ink-muted">{description}</span>
        ) : null}
      </label>
    </div>
  );
}

export interface ToggleProps extends ComponentProps<typeof SwitchPrimitive.Root> {
  label?: ReactNode;
  description?: ReactNode;
}

export function Toggle({ className, label, description, id, ...props }: ToggleProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const control = (
    <SwitchPrimitive.Root
      id={inputId}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full bg-ink-faint/60 transition-colors duration-(--duration-base)',
        'data-[state=checked]:bg-lime-ink',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform duration-(--duration-base) ease-(--ease-out-quick)',
          'data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-lime',
        )}
      />
    </SwitchPrimitive.Root>
  );
  if (!label) return control;
  return (
    <div className="flex items-center justify-between gap-4">
      <label htmlFor={inputId} className="cursor-pointer select-none">
        <span className="block text-sm text-ink">{label}</span>
        {description ? (
          <span className="block text-[13px] text-ink-muted">{description}</span>
        ) : null}
      </label>
      {control}
    </div>
  );
}
