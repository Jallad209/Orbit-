import { AppSettingsSchema, formatMinute, parseMinute, systemClock } from '@orbit/core';
import type { Clock, TimeWindow } from '@orbit/core';
import { Plus, X } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { FieldError, Input, Label } from '@/components/ui/Input';
import { toast } from '@/components/ui/toastStore';
import { useRepository } from '@/platform';
import { usePlanPrefs } from '@/features/today/planSettings';
import { fieldErrors } from '@/features/rules/zodErrors';
import { saveSettings } from './settingsService';

interface Props {
  clock?: Clock;
}

type Errors = Record<string, string>;

function minute(text: string): number | null {
  try {
    return parseMinute(text);
  } catch {
    return null;
  }
}

function windowError(start: string, end: string): string | null {
  const s = minute(start);
  const e = minute(end);
  if (s === null || e === null) return 'Use HH:MM, for example 09:00.';
  return e > s ? null : 'The day has to end after it starts.';
}

/**
 * Settings → Planning: the working window, rest boundaries, the gap between
 * blocks, the default estimate, and the evening hour. Validated through the
 * shared `AppSettingsSchema` and stored in the settings document.
 */
export function PlanningSettings({ clock = systemClock }: Props) {
  const repo = useRepository();
  const prefs = usePlanPrefs();
  const id = useId();
  const [start, setStart] = useState(formatMinute(prefs.workingWindow.startMin));
  const [end, setEnd] = useState(formatMinute(prefs.workingWindow.endMin));
  const [rest, setRest] = useState(
    prefs.restBoundaries.map((r) => ({
      start: formatMinute(r.startMin),
      end: formatMinute(r.endMin),
    })),
  );
  const [buffer, setBuffer] = useState(String(prefs.bufferMin));
  const [estimate, setEstimate] = useState(String(prefs.defaultEstimateMin));
  const [evening, setEvening] = useState(formatMinute(prefs.eveningStartMin));
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const liveWindowError = windowError(start, end);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Errors = {};
    if (liveWindowError) errs['workingWindow'] = liveWindowError;
    const restBoundaries: TimeWindow[] = [];
    rest.forEach((r, i) => {
      const err = windowError(r.start, r.end);
      if (err) errs[`restBoundaries.${i}`] = err;
      else restBoundaries.push({ startMin: minute(r.start)!, endMin: minute(r.end)! });
    });
    const eveningMin = minute(evening);
    if (eveningMin === null) errs['eveningStartMin'] = 'Use HH:MM, for example 17:00.';
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    const patch = {
      workingWindow: { startMin: minute(start)!, endMin: minute(end)! },
      restBoundaries,
      bufferMin: Number(buffer),
      defaultEstimateMin: Number(estimate),
      eveningStartMin: eveningMin!,
    };
    const parsed = AppSettingsSchema.partial().safeParse(patch);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await saveSettings(repo, patch, clock);
      setDirty(false);
      toast({ title: 'Planning settings saved', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Could not save settings',
        description: err instanceof Error ? err.message : String(err),
        variant: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  const touch =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      setDirty(true);
      set(v);
    };

  return (
    <Card data-testid="planning-settings">
      <SectionHeader title="Planning" />
      <form
        noValidate
        onSubmit={submit}
        aria-label="Planning settings"
        className="flex flex-col gap-4"
      >
        <div>
          <p className="text-[13px] font-medium text-ink">Working window</p>
          <p className="text-[12px] text-ink-faint">The hours the planner may fill.</p>
          <div className="mt-1 flex items-center gap-2">
            <Input
              aria-label="Working window start"
              className="w-24"
              value={start}
              onChange={(e) => touch(setStart)(e.target.value)}
              invalid={!!errors['workingWindow']}
            />
            <span className="text-ink-faint">to</span>
            <Input
              aria-label="Working window end"
              className="w-24"
              value={end}
              onChange={(e) => touch(setEnd)(e.target.value)}
              invalid={!!errors['workingWindow']}
            />
          </div>
          <FieldError id={`${id}-window-error`}>{errors['workingWindow']}</FieldError>
        </div>

        <div>
          <p className="text-[13px] font-medium text-ink">Rest boundaries</p>
          <p className="text-[12px] text-ink-faint">Never planned into: lunch, the school run…</p>
          <ul className="mt-1 flex flex-col gap-2" aria-label="Rest boundaries">
            {rest.map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                <Input
                  aria-label={`Rest ${i + 1} start`}
                  className="w-24"
                  value={r.start}
                  onChange={(e) =>
                    touch(setRest)(
                      rest.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)),
                    )
                  }
                  invalid={!!errors[`restBoundaries.${i}`]}
                />
                <span className="text-ink-faint">to</span>
                <Input
                  aria-label={`Rest ${i + 1} end`}
                  className="w-24"
                  value={r.end}
                  onChange={(e) =>
                    touch(setRest)(
                      rest.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)),
                    )
                  }
                  invalid={!!errors[`restBoundaries.${i}`]}
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove rest ${i + 1}`}
                  onClick={() => touch(setRest)(rest.filter((_, j) => j !== i))}
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
                {errors[`restBoundaries.${i}`] ? (
                  <span role="alert" className="text-[12px] text-danger">
                    {errors[`restBoundaries.${i}`]}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="ghost"
            className="mt-1"
            onClick={() => touch(setRest)([...rest, { start: '12:30', end: '13:15' }])}
          >
            <Plus className="size-3.5" aria-hidden="true" /> Add a rest boundary
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor={`${id}-buffer`} hint="minutes">
              Gap between blocks
            </Label>
            <Input
              id={`${id}-buffer`}
              type="number"
              min={0}
              max={120}
              className="mt-1"
              value={buffer}
              onChange={(e) => touch(setBuffer)(e.target.value)}
              invalid={!!errors['bufferMin']}
            />
            <FieldError>{errors['bufferMin']}</FieldError>
          </div>
          <div>
            <Label htmlFor={`${id}-estimate`} hint="minutes">
              Default estimate
            </Label>
            <Input
              id={`${id}-estimate`}
              type="number"
              min={5}
              max={480}
              className="mt-1"
              value={estimate}
              onChange={(e) => touch(setEstimate)(e.target.value)}
              invalid={!!errors['defaultEstimateMin']}
            />
            <FieldError>{errors['defaultEstimateMin']}</FieldError>
          </div>
          <div>
            <Label htmlFor={`${id}-evening`} hint="HH:MM">
              Evening shutdown from
            </Label>
            <Input
              id={`${id}-evening`}
              className="mt-1"
              value={evening}
              onChange={(e) => touch(setEvening)(e.target.value)}
              invalid={!!errors['eveningStartMin']}
            />
            <FieldError>{errors['eveningStartMin']}</FieldError>
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={busy} disabled={!dirty}>
            Save planning settings
          </Button>
        </div>
      </form>
    </Card>
  );
}
