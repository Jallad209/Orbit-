import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import { formatHotkey } from '@/lib/hotkeys';

export interface KbdProps extends ComponentProps<'kbd'> {
  /** A hotkey spec such as "mod+k" or "g t"; rendered through `formatHotkey`. */
  spec?: string;
}

export function Kbd({ className, spec, children, ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1 font-mono text-[11px] text-ink-muted',
        className,
      )}
      {...props}
    >
      {spec ? formatHotkey(spec) : children}
    </kbd>
  );
}
