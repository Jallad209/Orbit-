import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';

export interface InlineEditProps {
  value: string;
  onCommit: (next: string) => void;
  /** Called when the user cancels with Escape. */
  onCancel?: () => void;
  placeholder?: string;
  /** Start in edit mode. */
  autoEdit?: boolean;
  /** Reject empty strings (default true). */
  required?: boolean;
  className?: string;
  inputClassName?: string;
  'aria-label': string;
}

/**
 * Click-to-edit text. Enter commits, Escape cancels, blur commits.
 * Empty values are rejected when `required`, restoring the previous value.
 */
export function InlineEdit({
  value,
  onCommit,
  onCancel,
  placeholder = 'Untitled',
  autoEdit = false,
  required = true,
  className,
  inputClassName,
  'aria-label': ariaLabel,
}: InlineEditProps) {
  const [editing, setEditing] = useState(autoEdit);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  // The draft is seeded from `value` each time editing starts, so an external
  // change to `value` while idle is picked up without an effect.
  const startEditing = () => {
    setDraft(value);
    setEditing(true);
  };

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (required && next === '') {
      setDraft(value);
      return;
    }
    if (next !== value) onCommit(next);
  };

  const cancel = () => {
    cancelled.current = true;
    setDraft(value);
    setEditing(false);
    onCancel?.();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-label={ariaLabel}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (cancelled.current) {
            cancelled.current = false;
            return;
          }
          commit();
        }}
        className={cn(
          'w-full rounded-sm bg-white/70 px-1 -mx-1 text-inherit outline-none ring-2 ring-lime/50',
          inputClassName,
        )}
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={`${ariaLabel}: ${value || placeholder}. Press Enter to edit.`}
      onClick={startEditing}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          startEditing();
        }
      }}
      className={cn(
        'block w-full truncate rounded-sm px-1 -mx-1 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ink',
        !value && 'text-ink-faint',
        className,
      )}
    >
      {value || placeholder}
    </button>
  );
}
