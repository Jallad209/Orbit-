import type { Energy } from '@orbit/core';
import { cn } from '@/lib/cn';

export const ENERGIES: Energy[] = ['low', 'medium', 'high'];

interface Props {
  value: Energy;
  onChange: (energy: Energy) => void;
  size?: 'sm' | 'lg';
  /** Show the 1 / 2 / 3 hotkey hints. */
  hints?: boolean;
}

/** Three-state energy control, shared by the Today screen and the morning briefing. */
export function EnergyPicker({ value, onChange, size = 'sm', hints = false }: Props) {
  return (
    <div role="radiogroup" aria-label="Energy" className="flex rounded-md border border-line">
      {ENERGIES.map((e, i) => (
        <button
          key={e}
          type="button"
          role="radio"
          aria-checked={value === e}
          onClick={() => onChange(e)}
          className={cn(
            'capitalize',
            size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-11 px-6 text-base',
            i === 0 ? 'rounded-l-md' : i === ENERGIES.length - 1 ? 'rounded-r-md' : '',
            value === e ? 'bg-lime text-lime-ink' : 'text-ink-muted hover:bg-surface-2',
          )}
        >
          {hints ? (
            <kbd
              aria-hidden="true"
              className="mr-2 rounded border border-current/30 px-1 font-mono text-[11px]"
            >
              {i + 1}
            </kbd>
          ) : null}
          {e}
        </button>
      ))}
    </div>
  );
}
