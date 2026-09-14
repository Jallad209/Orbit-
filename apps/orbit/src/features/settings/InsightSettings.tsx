import {
  DEFAULT_INSIGHT_SETTINGS,
  INSIGHT_SETTINGS_FIELDS,
  systemClock,
  validateInsightSettings,
} from '@orbit/core';
import type { Clock, InsightSettings as Thresholds } from '@orbit/core';
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { FieldError, Input, Label } from '@/components/ui/Input';
import { toast } from '@/components/ui/toastStore';
import { useRepository } from '@/platform';
import { usePlanPrefs } from '@/features/today/planSettings';
import { restoreInsightDefaults, saveSettings } from './settingsService';

interface Props {
  clock?: Clock;
}

/**
 * Settings → Insights: the six thresholds the detectors use, validated in
 * the form and again at the storage boundary, with help text and a Restore
 * defaults action that leaves the planning preferences alone. An imported
 * or restored document re-keys the form so a stale draft never overwrites it.
 */
export function InsightSettings({ clock = systemClock }: Props) {
  const insights = usePlanPrefs((s) => s.insights);
  return <InsightSettingsForm key={JSON.stringify(insights)} clock={clock} />;
}

function InsightSettingsForm({ clock = systemClock }: Props) {
  const repo = useRepository();
  const stored = usePlanPrefs((s) => s.insights);
  const id = useId();
  const [draft, setDraft] = useState<Record<keyof Thresholds, string>>(
    () =>
      Object.fromEntries(
        INSIGHT_SETTINGS_FIELDS.map((f) => [f.key, String(stored[f.key])]),
      ) as Record<keyof Thresholds, string>,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const candidate = Object.fromEntries(
      INSIGHT_SETTINGS_FIELDS.map((f) => [
        f.key,
        draft[f.key].trim() === '' ? NaN : Number(draft[f.key]),
      ]),
    );
    const result = validateInsightSettings(candidate);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await saveSettings(repo, { insights: result.settings }, clock);
      setDirty(false);
      toast({ title: 'Insight settings saved', variant: 'success' });
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

  const restore = async () => {
    setBusy(true);
    try {
      await restoreInsightDefaults(repo, clock);
      toast({ title: 'Insight thresholds restored to defaults', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Could not restore defaults',
        description: err instanceof Error ? err.message : String(err),
        variant: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  const isDefault = INSIGHT_SETTINGS_FIELDS.every(
    (f) => stored[f.key] === DEFAULT_INSIGHT_SETTINGS[f.key],
  );

  return (
    <Card data-testid="insight-settings">
      <SectionHeader
        title="Insights"
        actions={
          <Link to="/insights" className="text-[12px] text-ink-muted underline">
            Open insights
          </Link>
        }
      />
      <form
        noValidate
        onSubmit={submit}
        aria-label="Insight settings"
        className="flex flex-col gap-4"
      >
        <p className="text-[13px] text-ink-muted">
          When an observation is worth showing. Each threshold is visible on the card it triggers.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {INSIGHT_SETTINGS_FIELDS.map((f) => (
            <div key={f.key}>
              <Label
                htmlFor={`${id}-${f.key}`}
                hint={f.unit === 'days' ? 'days' : f.unit === 'ratio' ? '× ratio' : 'count'}
              >
                {f.label}
              </Label>
              <Input
                id={`${id}-${f.key}`}
                type="number"
                inputMode="decimal"
                min={f.min}
                max={f.max}
                step={f.integer ? 1 : 0.05}
                className="mt-1"
                value={draft[f.key]}
                aria-describedby={`${id}-${f.key}-help`}
                onChange={(e) => {
                  setDirty(true);
                  setDraft((d) => ({ ...d, [f.key]: e.target.value }));
                }}
                invalid={!!errors[f.key]}
              />
              <p id={`${id}-${f.key}-help`} className="mt-0.5 text-[12px] text-ink-faint">
                {f.help} Default {DEFAULT_INSIGHT_SETTINGS[f.key]}, between {f.min} and {f.max}.
              </p>
              <FieldError id={`${id}-${f.key}-error`}>{errors[f.key]}</FieldError>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={restore} disabled={busy || isDefault}>
            Restore defaults
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!dirty}>
            Save insight settings
          </Button>
        </div>
      </form>
    </Card>
  );
}
