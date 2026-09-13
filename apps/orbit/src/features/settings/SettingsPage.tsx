import { BellOff, BellRing, Keyboard } from 'lucide-react';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Kbd } from '@/components/ui/Kbd';
import { usePlatform } from '@/platform';
import { DataSettings } from './DataSettings';

/** Honest messaging by capability, never by user agent. */
export function CapabilityNotes() {
  const { capabilities } = usePlatform();
  return (
    <Card data-testid="capability-notes">
      <SectionHeader title="On this device" />
      <ul className="flex flex-col gap-2 text-sm">
        <li className="flex items-start gap-2">
          {capabilities.backgroundReminders ? (
            <BellRing className="mt-0.5 size-4 text-ok" aria-hidden="true" />
          ) : (
            <BellOff className="mt-0.5 size-4 text-gold-ink" aria-hidden="true" />
          )}
          <span data-testid="reminders-note">
            {capabilities.backgroundReminders
              ? 'Reminders can fire while the window is closed.'
              : 'Scheduled reminders are not available in this version of Orbit.'}
          </span>
        </li>
        <li className="flex items-start gap-2">
          <Keyboard className="mt-0.5 size-4 text-ink-muted" aria-hidden="true" />
          <span data-testid="hotkey-note">
            {capabilities.globalHotkey ? (
              <>
                <Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>Space</Kbd> opens quick capture from any app.
              </>
            ) : (
              <>
                <Kbd>c</Kbd> opens quick capture while Orbit is focused.
              </>
            )}
          </span>
        </li>
      </ul>
    </Card>
  );
}

/** Settings. Week 7 ships the data and capability sections; week 9 adds the rest. */
export function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-display font-semibold tracking-tight text-ink">Settings</h1>
        <p className="mt-1 text-ink-muted">Where your data lives and what this device can do.</p>
      </div>
      <DataSettings />
      <CapabilityNotes />
    </div>
  );
}
