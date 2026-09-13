import type {
  CommandChoice,
  CommandContext,
  CommandDefinition,
  CommandRegistry,
} from '@orbit/core';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { FieldError, Input, Label } from '@/components/ui/Input';
import { Kbd } from '@/components/ui/Kbd';
import { cn } from '@/lib/cn';

interface Props {
  command: CommandDefinition;
  ctx: CommandContext;
  registry: CommandRegistry;
  /** Validated arguments, ready to run. */
  onRun: (args: unknown) => Promise<void>;
  onBack: () => void;
}

/**
 * The inline step for a command that needs input: a text field or a list
 * of choices, validated against the command's schema before anything runs.
 * Errors show under the field without moving focus; a command with a
 * preview shows what will happen and waits for one more Enter.
 */
export function ArgumentPrompt({ command, ctx, registry, onRun, onBack }: Props) {
  const prompt = command.prompt!;
  const id = useId();
  const [text, setText] = useState('');
  const [choices, setChoices] = useState<CommandChoice[] | null>(
    prompt.kind === 'choice' ? null : [],
  );
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ args: unknown; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (prompt.kind !== 'choice') return;
    let cancelled = false;
    void prompt.choices(ctx).then((c) => {
      if (!cancelled) setChoices(c);
    });
    return () => {
      cancelled = true;
    };
  }, [prompt, ctx]);

  const visible = (choices ?? []).filter(
    (c) => !filter.trim() || c.label.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  const submit = async (value: string) => {
    const args = { [prompt.field]: value };
    const checked = registry.validate(command, args);
    if (!checked.ok) {
      setError(checked.errors[prompt.field] ?? checked.message);
      return;
    }
    setError(null);
    if (command.preview) {
      setBusy(true);
      try {
        const line = await command.preview(ctx, checked.args as never);
        setPreview({ args: checked.args, text: line ?? 'Ready.' });
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      await onRun(checked.args);
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onBack();
      return;
    }
    if (prompt.kind === 'choice') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => Math.min(visible.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        return;
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (prompt.kind === 'text') void submit(text);
      else {
        const choice = visible[active];
        if (choice) void submit(choice.value);
        else setError('Pick one of the options.');
      }
    }
  };

  if (preview) {
    return (
      <div className="p-4" data-testid="command-preview">
        <p className="text-[12px] font-semibold tracking-wide text-ink-faint uppercase">
          {command.title}
        </p>
        <p className="mt-2 text-sm text-ink" role="status">
          {preview.text}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
            Back
          </Button>
          <Button
            variant="primary"
            size="sm"
            autoFocus
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onRun(preview.args);
              } finally {
                setBusy(false);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setPreview(null);
              }
            }}
          >
            Run
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4" data-testid="argument-prompt">
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1 text-[12px] text-ink-faint hover:text-ink"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" /> {command.title}
      </button>
      <Label htmlFor={id}>{prompt.label}</Label>
      <Input
        id={id}
        autoFocus
        className="mt-1"
        placeholder={prompt.kind === 'text' ? prompt.placeholder : 'Filter…'}
        value={prompt.kind === 'text' ? text : filter}
        invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => {
          if (prompt.kind === 'text') setText(e.target.value);
          else {
            setFilter(e.target.value);
            setActive(0);
          }
          if (error) setError(null);
        }}
        onKeyDown={onKey}
        disabled={busy}
      />
      <FieldError id={`${id}-error`}>{error ?? undefined}</FieldError>
      {prompt.kind === 'choice' ? (
        <ul role="listbox" aria-label={prompt.label} className="mt-2 max-h-56 overflow-y-auto">
          {choices === null ? (
            <li className="px-3 py-2 text-[13px] text-ink-muted">Loading…</li>
          ) : visible.length === 0 ? (
            <li className="px-3 py-2 text-[13px] text-ink-muted">Nothing to choose from.</li>
          ) : (
            visible.map((c, i) => (
              <li
                key={c.value}
                role="option"
                aria-selected={i === active}
                className={cn(
                  'flex cursor-default items-center gap-2 rounded-md px-3 py-1.5 text-sm',
                  i === active ? 'bg-surface-2 text-ink' : 'text-ink-muted',
                )}
                onMouseMove={() => setActive(i)}
                onClick={() => void submit(c.value)}
              >
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.hint ? <span className="text-[11px] text-ink-faint">{c.hint}</span> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
      <p className="mt-3 text-[11px] text-ink-faint">
        <Kbd>Enter</Kbd> to continue · <Kbd>Esc</Kbd> back
      </p>
    </div>
  );
}
