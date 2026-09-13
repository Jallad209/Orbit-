import { BellOff, BellRing, Keyboard } from 'lucide-react';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Kbd } from '@/components/ui/Kbd';
import { cn } from '@/lib/cn';
import { usePlatform } from '@/platform';
import { RulesSection } from '@/features/rules/RulesSection';
import { AppearanceSettings } from './AppearanceSettings';
import { DataSettings } from './DataSettings';
import { PlanningSettings } from './PlanningSettings';
import { ShortcutsReference } from './ShortcutsReference';

/** Honest messaging by capability, never by user agent. */
export function CapabilityNotes() {
  const { capabilities } = usePlatform();
  const reminders = capabilities.backgroundReminders
    ? 'Reminders fire as system notifications, even while the window is closed.'
    : capabilities.nativeReminders
      ? 'Reminders fire as system notifications while Orbit is running; background delivery arrives with the tray.'
      : 'Reminders show inside Orbit while this tab is open. Install the desktop app for system notifications.';
  return (
    <Card data-testid="capability-notes">
      <SectionHeader title="On this device" />
      <ul className="flex flex-col gap-2 text-sm">
        <li className="flex items-start gap-2">
          {capabilities.nativeReminders ? (
            <BellRing className="mt-0.5 size-4 text-ok" aria-hidden="true" />
          ) : (
            <BellOff className="mt-0.5 size-4 text-gold-ink" aria-hidden="true" />
          )}
          <span data-testid="reminders-note">{reminders}</span>
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

const SECTIONS = [
  { id: 'planning', label: 'Planning' },
  { id: 'rules', label: 'Rules' },
  { id: 'data', label: 'Data' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'shortcuts', label: 'Shortcuts' },
] as const;

/** Settings: planning, rules, data, appearance, shortcuts, with an in-page nav. */
export function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div>
        <h1 className="text-display font-semibold tracking-tight text-ink">Settings</h1>
        <p className="mt-1 text-ink-muted">
          How Orbit plans, the rules it follows, where your data lives, and what this device can do.
        </p>
      </div>
      <div className="grid gap-5 md:grid-cols-[10rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="md:sticky md:top-2 md:self-start">
          <ul className="flex flex-wrap gap-1 md:flex-col">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className={cn(
                    'block rounded-md px-2.5 py-1.5 text-[13px] text-ink-muted hover:bg-surface-2 hover:text-ink',
                  )}
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-col gap-5">
          <section id="planning" aria-label="Planning" className="scroll-mt-4">
            <PlanningSettings />
          </section>
          <section id="rules" aria-label="Rules" className="scroll-mt-4">
            <RulesSection />
          </section>
          <section id="data" aria-label="Data" className="scroll-mt-4 flex flex-col gap-5">
            <DataSettings />
            <CapabilityNotes />
          </section>
          <section id="appearance" aria-label="Appearance" className="scroll-mt-4">
            <AppearanceSettings />
          </section>
          <section id="shortcuts" aria-label="Shortcuts" className="scroll-mt-4">
            <ShortcutsReference />
          </section>
        </div>
      </div>
    </div>
  );
}
