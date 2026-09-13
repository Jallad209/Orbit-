import { RuleSchema, formatMinute, newId, nowIso, parseMinute, systemClock } from '@orbit/core';
import type {
  Area,
  Clock,
  Id,
  RolloverTarget,
  Routine,
  Rule,
  RuleType,
  Weekday,
} from '@orbit/core';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { FieldError, Input, Label, Select } from '@/components/ui/Input';
import { fieldErrors } from './zodErrors';

/**
 * One small controlled form per rule family. Each builds a draft record
 * and validates it through the shared `RuleSchema` on submit — the same
 * schema the repository enforces — mapping Zod issues to field messages.
 * Nothing here parses sentences: rules are structured objects.
 */

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  constraint: 'Time constraint',
  recurring: 'Recurring schedule',
  rollover: 'Rollover policy',
  reminder: 'Reminder',
};

export const WEEKDAY_OPTIONS: Array<{ value: Weekday; label: string }> = [
  { value: 'MO', label: 'Monday' },
  { value: 'TU', label: 'Tuesday' },
  { value: 'WE', label: 'Wednesday' },
  { value: 'TH', label: 'Thursday' },
  { value: 'FR', label: 'Friday' },
  { value: 'SA', label: 'Saturday' },
  { value: 'SU', label: 'Sunday' },
];

const TARGET_OPTIONS: Array<{ value: RolloverTarget; label: string }> = [
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'nextWeek', label: 'Next Monday' },
  { value: 'inbox', label: 'Back to inbox' },
];

export interface RuleFormProps {
  /** Editing an existing rule keeps its id and timestamps. */
  rule?: Rule | null;
  onSubmit: (rule: Rule) => Promise<void> | void;
  onCancel?: () => void;
  clock?: Clock;
}

type Errors = Record<string, string>;

/** Minute-of-day from `HH:MM`, or null (the schema then reports the field). */
function minute(text: string): number | null {
  try {
    return parseMinute(text);
  } catch {
    return null;
  }
}

/** Build the draft with base fields, then let the shared schema decide. */
function validate(
  existing: Rule | null | undefined,
  clock: Clock,
  fields: { type: RuleType; name: string; enabled: boolean; config: unknown },
): { rule: Rule; errors: null } | { rule: null; errors: Errors } {
  const at = nowIso(clock);
  const draft = {
    id: existing?.id ?? newId(),
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    deletedAt: null,
    ...fields,
  };
  const parsed = RuleSchema.safeParse(draft);
  if (parsed.success) return { rule: parsed.data, errors: null };
  return { rule: null, errors: fieldErrors(parsed.error.issues) };
}

function useSubmit(onSubmit: RuleFormProps['onSubmit'], build: () => ReturnType<typeof validate>) {
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = build();
    if (r.errors) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit(r.rule);
    } finally {
      setBusy(false);
    }
  };
  return { errors, busy, submit };
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <Label htmlFor={id} hint={hint}>
        {label}
      </Label>
      <div className="mt-1">{children}</div>
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );
}

function Footer({
  busy,
  onCancel,
  editing,
  rootError,
}: {
  busy: boolean;
  onCancel?: () => void;
  editing: boolean;
  rootError?: string;
}) {
  return (
    <div className="mt-4 flex items-center justify-end gap-2">
      {rootError ? (
        <p role="alert" className="mr-auto text-[13px] text-danger">
          {rootError}
        </p>
      ) : null}
      {onCancel ? (
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      ) : null}
      <Button type="submit" variant="primary" loading={busy}>
        {editing ? 'Save rule' : 'Add rule'}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Constraint: no high energy after / reserve a window
// ---------------------------------------------------------------------------

export function ConstraintForm({
  rule,
  areas,
  onSubmit,
  onCancel,
  clock = systemClock,
}: RuleFormProps & { areas: readonly Area[] }) {
  const id = useId();
  const existing = rule?.type === 'constraint' ? rule : null;
  const initial = existing?.config;
  const [kind, setKind] = useState<'noHighEnergyAfter' | 'reserve'>(
    initial?.kind ?? 'noHighEnergyAfter',
  );
  const [name, setName] = useState(existing?.name ?? '');
  const [after, setAfter] = useState(
    initial?.kind === 'noHighEnergyAfter' ? formatMinute(initial.afterMin) : '19:00',
  );
  const [day, setDay] = useState<Weekday>(initial?.kind === 'reserve' ? initial.dayOfWeek : 'FR');
  const [start, setStart] = useState(
    initial?.kind === 'reserve' ? formatMinute(initial.startMin) : '18:00',
  );
  const [end, setEnd] = useState(
    initial?.kind === 'reserve' ? formatMinute(initial.endMin) : '22:00',
  );
  const [areaId, setAreaId] = useState<Id | ''>(
    initial?.kind === 'reserve' ? (initial.areaId ?? '') : '',
  );
  const [label, setLabel] = useState(initial?.kind === 'reserve' ? initial.label : '');

  const { errors, busy, submit } = useSubmit(onSubmit, () =>
    validate(existing, clock, {
      type: 'constraint',
      name,
      enabled: existing?.enabled ?? true,
      config:
        kind === 'noHighEnergyAfter'
          ? { kind, afterMin: minute(after) }
          : {
              kind,
              dayOfWeek: day,
              startMin: minute(start),
              endMin: minute(end),
              areaId: areaId || null,
              label,
            },
    }),
  );

  return (
    <form noValidate onSubmit={submit} aria-label="Time constraint" data-testid="constraint-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-kind`} label="Kind">
          <Select
            id={`${id}-kind`}
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="noHighEnergyAfter">No demanding work after a time</option>
            <option value="reserve">Reserve a window</option>
          </Select>
        </Field>
        <Field id={`${id}-name`} label="Name" hint="optional">
          <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {kind === 'noHighEnergyAfter' ? (
          <Field id={`${id}-after`} label="After" hint="HH:MM" error={errors['config.afterMin']}>
            <Input
              id={`${id}-after`}
              value={after}
              onChange={(e) => setAfter(e.target.value)}
              invalid={!!errors['config.afterMin']}
              aria-describedby={errors['config.afterMin'] ? `${id}-after-error` : undefined}
            />
          </Field>
        ) : (
          <>
            <Field id={`${id}-day`} label="Weekday">
              <Select
                id={`${id}-day`}
                value={day}
                onChange={(e) => setDay(e.target.value as Weekday)}
              >
                {WEEKDAY_OPTIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id={`${id}-start`} label="From" hint="HH:MM" error={errors['config.startMin']}>
              <Input
                id={`${id}-start`}
                value={start}
                onChange={(e) => setStart(e.target.value)}
                invalid={!!errors['config.startMin']}
              />
            </Field>
            <Field id={`${id}-end`} label="To" hint="HH:MM" error={errors['config.endMin']}>
              <Input
                id={`${id}-end`}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                invalid={!!errors['config.endMin']}
              />
            </Field>
            <Field id={`${id}-area`} label="For" hint="an area, or block the time">
              <Select id={`${id}-area`} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
                <option value="">Nothing — keep the time free</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id={`${id}-label`} label="Label" hint="shown on the timeline">
              <Input id={`${id}-label`} value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
          </>
        )}
      </div>
      <Footer busy={busy} onCancel={onCancel} editing={!!existing} rootError={errors['_']} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Recurring: a routine n times per week
// ---------------------------------------------------------------------------

export function RecurringForm({
  rule,
  routines,
  onSubmit,
  onCancel,
  clock = systemClock,
}: RuleFormProps & { routines: readonly Routine[] }) {
  const id = useId();
  const existing = rule?.type === 'recurring' ? rule : null;
  const [name, setName] = useState(existing?.name ?? '');
  const [routineId, setRoutineId] = useState<Id | ''>(
    existing?.config.routineId ?? routines[0]?.id ?? '',
  );
  const [times, setTimes] = useState(String(existing?.config.timesPerWeek ?? 3));

  const { errors, busy, submit } = useSubmit(onSubmit, () =>
    validate(existing, clock, {
      type: 'recurring',
      name,
      enabled: existing?.enabled ?? true,
      config: { routineId, timesPerWeek: Number(times) },
    }),
  );

  return (
    <form noValidate onSubmit={submit} aria-label="Recurring schedule" data-testid="recurring-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-routine`} label="Routine" error={errors['config.routineId']}>
          <Select
            id={`${id}-routine`}
            value={routineId}
            onChange={(e) => setRoutineId(e.target.value)}
            invalid={!!errors['config.routineId']}
          >
            {routines.length === 0 ? <option value="">No routines yet</option> : null}
            {routines.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id={`${id}-times`}
          label="Times per week"
          hint="1–7"
          error={errors['config.timesPerWeek']}
        >
          <Input
            id={`${id}-times`}
            type="number"
            min={1}
            max={7}
            value={times}
            onChange={(e) => setTimes(e.target.value)}
            invalid={!!errors['config.timesPerWeek']}
          />
        </Field>
        <Field id={`${id}-name`} label="Name" hint="optional">
          <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <Footer busy={busy} onCancel={onCancel} editing={!!existing} rootError={errors['_']} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Rollover: priority → target
// ---------------------------------------------------------------------------

export function RolloverForm({ rule, onSubmit, onCancel, clock = systemClock }: RuleFormProps) {
  const id = useId();
  const existing = rule?.type === 'rollover' ? rule : null;
  const [name, setName] = useState(existing?.name ?? 'Rollover');
  const [p1, setP1] = useState<RolloverTarget>(existing?.config.p1 ?? 'tomorrow');
  const [p2, setP2] = useState<RolloverTarget>(existing?.config.p2 ?? 'tomorrow');
  const [p3, setP3] = useState<RolloverTarget>(existing?.config.p3 ?? 'nextWeek');

  const { errors, busy, submit } = useSubmit(onSubmit, () =>
    validate(existing, clock, {
      type: 'rollover',
      name,
      enabled: existing?.enabled ?? true,
      config: { p1, p2, p3 },
    }),
  );

  const priority = (
    label: string,
    value: RolloverTarget,
    set: (v: RolloverTarget) => void,
    key: string,
  ) => (
    <Field id={`${id}-${key}`} label={label} error={errors[`config.${key}`]}>
      <Select
        id={`${id}-${key}`}
        value={value}
        onChange={(e) => set(e.target.value as RolloverTarget)}
      >
        {TARGET_OPTIONS.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <form noValidate onSubmit={submit} aria-label="Rollover policy" data-testid="rollover-form">
      <p className="mb-3 text-[13px] text-ink-muted">
        Where unfinished committed work goes at the evening shutdown, by priority.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {priority('Priority 1', p1, setP1, 'p1')}
        {priority('Priority 2', p2, setP2, 'p2')}
        {priority('Priority 3', p3, setP3, 'p3')}
        <Field id={`${id}-name`} label="Name" hint="optional">
          <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <Footer busy={busy} onCancel={onCancel} editing={!!existing} rootError={errors['_']} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Reminder: bill within N days / follow-up after N days
// ---------------------------------------------------------------------------

export function ReminderForm({ rule, onSubmit, onCancel, clock = systemClock }: RuleFormProps) {
  const id = useId();
  const existing = rule?.type === 'reminder' ? rule : null;
  const [kind, setKind] = useState<'billDueWithin' | 'followUpAfter'>(
    existing?.config.kind ?? 'billDueWithin',
  );
  const [name, setName] = useState(existing?.name ?? '');
  const [days, setDays] = useState(String(existing?.config.days ?? 3));

  const { errors, busy, submit } = useSubmit(onSubmit, () =>
    validate(existing, clock, {
      type: 'reminder',
      name,
      enabled: existing?.enabled ?? true,
      config: { kind, days: days.trim() === '' ? Number.NaN : Number(days) },
    }),
  );

  return (
    <form noValidate onSubmit={submit} aria-label="Reminder" data-testid="reminder-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-kind`} label="Remind me">
          <Select
            id={`${id}-kind`}
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="billDueWithin">when a bill is due within</option>
            <option value="followUpAfter">to follow up when nobody replied for</option>
          </Select>
        </Field>
        <Field
          id={`${id}-days`}
          label="Days"
          hint={kind === 'billDueWithin' ? '0–60' : '1–365'}
          error={errors['config.days']}
        >
          <Input
            id={`${id}-days`}
            type="number"
            min={kind === 'billDueWithin' ? 0 : 1}
            max={kind === 'billDueWithin' ? 60 : 365}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            invalid={!!errors['config.days']}
          />
        </Field>
        <Field id={`${id}-name`} label="Name" hint="optional">
          <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <Footer busy={busy} onCancel={onCancel} editing={!!existing} rootError={errors['_']} />
    </form>
  );
}

/** The right form for a family, so the section can stay dumb. */
export function RuleForm({
  type,
  areas,
  routines,
  ...props
}: RuleFormProps & { type: RuleType; areas: readonly Area[]; routines: readonly Routine[] }) {
  switch (type) {
    case 'constraint':
      return <ConstraintForm areas={areas} {...props} />;
    case 'recurring':
      return <RecurringForm routines={routines} {...props} />;
    case 'rollover':
      return <RolloverForm {...props} />;
    case 'reminder':
      return <ReminderForm {...props} />;
  }
}
