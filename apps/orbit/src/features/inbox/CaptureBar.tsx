import { parseCapture, reclassify, systemClock } from '@orbit/core';
import type { CaptureResult, CaptureToken, Clock, TokenKind } from '@orbit/core';
import { UserPlus, X } from 'lucide-react';
import {
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { useRepoQuery } from '@/data/useQuery';
import { useRepository } from '@/platform';
import { Input } from '@/components/ui/Input';
import { Kbd } from '@/components/ui/Kbd';
import { TypeBadge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { createPerson } from '@/features/people/peopleService';
import { toast } from '@/components/ui/toastStore';
import { contextFor, loadCaptureNames, saveCapture } from './inboxService';

const TOKEN_STYLES: Record<TokenKind, string> = {
  prefix: 'bg-surface-3 text-ink-muted',
  date: 'bg-lime/40 text-lime-ink',
  time: 'bg-lime/40 text-lime-ink',
  recurrence: 'bg-[#dcefe3] text-[#1f4a31]',
  money: 'bg-[#f3dede] text-[#6b1f1f]',
  estimate: 'bg-surface-3 text-ink',
  priority: 'bg-gold-2/60 text-gold-ink',
  person: 'bg-[#eadff3] text-[#3f2a5a]',
  project: 'bg-nav text-nav-fg',
  cue: 'bg-surface-3 text-ink-muted',
};

const TOKEN_ORDER: TokenKind[] = [
  'date',
  'time',
  'recurrence',
  'money',
  'estimate',
  'priority',
  'person',
  'project',
  'prefix',
  'cue',
];

/** What a host window may do with the bar's unsaved text (the quit handshake). */
export interface CaptureBarHandle {
  /** Save the current text as a capture; false when there was nothing to save. */
  save(): Promise<boolean>;
  clear(): void;
}

export interface CaptureBarProps {
  autoFocus?: boolean;
  placeholder?: string;
  /** Called after a capture is saved. */
  onSaved?: (result: CaptureResult) => void;
  /** Called whenever the typed text changes, with the raw text. */
  onTextChange?: (text: string) => void;
  clock?: Clock;
  className?: string;
  ref?: Ref<CaptureBarHandle>;
}

/**
 * The universal capture input. Parses on every keystroke, shows the guessed
 * type and extracted fields as chips, Tab cycles the type, Enter saves.
 * Saving never waits on classification being right: a wrong guess costs one
 * keystroke here or one in the inbox.
 */
export function CaptureBar({
  autoFocus = false,
  placeholder = 'Capture anything… "Submit report next Friday", "Pay rent every month"',
  onSaved,
  onTextChange,
  clock = systemClock,
  className,
  ref,
}: CaptureBarProps) {
  const repo = useRepository();
  const { data: names } = useRepoQuery(loadCaptureNames, []);
  const [text, setTextState] = useState('');
  const [altIndex, setAltIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [creatingPerson, setCreatingPerson] = useState<string | null>(null);
  const savingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const setText = (next: string) => {
    setTextState(next);
    onTextChange?.(next);
  };

  const ctx = useMemo(() => contextFor(names, clock), [names, clock]);
  const base = useMemo(() => (text.trim() ? parseCapture(text, ctx) : null), [text, ctx]);
  const result = useMemo(() => {
    if (!base) return null;
    if (altIndex === 0) return base;
    const alt = base.alternatives[altIndex % base.alternatives.length];
    return alt ? reclassify(base, alt.type, ctx) : base;
  }, [base, altIndex, ctx]);

  const cycle = (dir: 1 | -1) => {
    if (!base) return;
    const n = base.alternatives.length;
    setAltIndex((i) => (i + dir + n) % n);
  };

  const removeToken = (t: CaptureToken) => {
    const next = `${text.slice(0, t.start)} ${text.slice(t.end)}`.replace(/\s{2,}/g, ' ').trim();
    setText(next);
    setAltIndex(0);
    inputRef.current?.focus();
  };

  const submit = async () => {
    if (!result || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await saveCapture(repo, result, clock);
      setText('');
      setAltIndex(0);
      onSaved?.(result);
    } finally {
      savingRef.current = false;
      setSaving(false);
      inputRef.current?.focus();
    }
  };

  useImperativeHandle(ref, () => ({
    save: async () => {
      if (!result) return false;
      await submit();
      return true;
    },
    clear: () => {
      setText('');
      setAltIndex(0);
    },
  }));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab' && base) {
      e.preventDefault();
      cycle(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape' && text) {
      e.preventDefault();
      setText('');
      setAltIndex(0);
    }
  };

  const tokens = result
    ? [...result.tokens].sort(
        (a, b) => TOKEN_ORDER.indexOf(a.kind) - TOKEN_ORDER.indexOf(b.kind) || a.start - b.start,
      )
    : [];
  const unknownPeople = (result?.fields.people ?? []).filter(
    (person) => !names?.people.some((known) => known.toLowerCase() === person.toLowerCase()),
  );

  return (
    <div className={cn('flex flex-col gap-2', className)} data-testid="capture-bar">
      <Input
        ref={inputRef}
        aria-label="Capture"
        autoFocus={autoFocus}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setAltIndex(0);
        }}
        onKeyDown={onKeyDown}
        readOnly={saving}
        aria-busy={saving || undefined}
        className="h-11 text-base"
        autoComplete="off"
        spellCheck={false}
      />
      <div className="flex min-h-6 flex-wrap items-center gap-1.5 text-[12px] text-ink-faint">
        {result ? (
          <>
            <button
              type="button"
              onClick={() => cycle(1)}
              title="Change type (Tab)"
              className="rounded-full focus-visible:outline-2 focus-visible:outline-ink"
              data-testid="capture-type"
              data-confidence={result.confidence}
            >
              <TypeBadge kind={result.type} />
            </button>
            {!result.explicit && result.confidence < 0.6 ? (
              <span className="text-ink-faint">guess</span>
            ) : null}
            {tokens.map((t) => (
              <span
                key={`${t.kind}-${t.start}`}
                data-testid={`token-${t.kind}`}
                className={cn(
                  'inline-flex h-5 items-center gap-1 rounded-full pr-1 pl-2 text-[11px] font-medium',
                  TOKEN_STYLES[t.kind],
                )}
              >
                {t.label}
                <button
                  type="button"
                  aria-label={`Remove ${t.label}`}
                  onClick={() => removeToken(t)}
                  className="grid size-3.5 place-items-center rounded-full opacity-60 hover:opacity-100"
                >
                  <X className="size-2.5" aria-hidden="true" />
                </button>
              </span>
            ))}
            {unknownPeople.map((person) => (
              <button
                key={person}
                type="button"
                disabled={creatingPerson === person}
                onClick={() => {
                  setCreatingPerson(person);
                  void createPerson(repo, { name: person }, clock)
                    .then(() => toast.success('Person added', person))
                    .catch((error: unknown) =>
                      toast.warning(
                        'Could not add person',
                        error instanceof Error ? error.message : String(error),
                      ),
                    )
                    .finally(() => setCreatingPerson(null));
                }}
                className="inline-flex h-6 items-center gap-1 rounded-full border border-line px-2 text-[11px] font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
              >
                <UserPlus className="size-3" aria-hidden="true" />
                Create {person}?
              </button>
            ))}
            <span className="ml-auto flex items-center gap-1">
              <Kbd>Tab</Kbd> type <Kbd>Enter</Kbd> capture
            </span>
          </>
        ) : (
          <span>
            Type anything. <Kbd>t:</Kbd> task · <Kbd>n:</Kbd> note · <Kbd>e:</Kbd> event ·{' '}
            <Kbd>g:</Kbd> goal · <Kbd>r:</Kbd> routine · <Kbd>b:</Kbd> bill · <Kbd>c:</Kbd>{' '}
            commitment · <Kbd>@person</Kbd> · <Kbd>#project</Kbd>
          </span>
        )}
      </div>
    </div>
  );
}
