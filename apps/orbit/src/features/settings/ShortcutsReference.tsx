import { Card, SectionHeader } from '@/components/ui/Card';
import { Kbd } from '@/components/ui/Kbd';
import { useHotkeyRegistry, type HotkeyInfo } from '@/lib/hotkeys';

/**
 * Bindings a screen registers only while it is mounted; listed here so the
 * reference is complete from the Settings page too. The registry's own
 * entries (the shell's navigation and capture keys) come first and win.
 */
const SCREEN_BOUND: HotkeyInfo[] = [
  { spec: '1 / 2 / 3', description: 'Pick the energy level', group: 'Morning briefing' },
  { spec: 'l', description: 'Lock or unlock the selected block', group: 'Timeline' },
  { spec: 'p', description: 'Assign the selected capture to a project', group: 'Inbox' },
];

/** Settings → Shortcuts: generated from the hotkey registry, grouped. */
export function ShortcutsReference() {
  const registry = useHotkeyRegistry();
  const seen = new Set<string>();
  const all: HotkeyInfo[] = [];
  for (const h of [...registry.list(), ...SCREEN_BOUND]) {
    const key = `${h.group}:${h.spec}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(h);
  }
  const groups = new Map<string, HotkeyInfo[]>();
  for (const h of all) groups.set(h.group, [...(groups.get(h.group) ?? []), h]);

  return (
    <Card data-testid="shortcuts">
      <SectionHeader title="Shortcuts" meta={`${all.length}`} />
      <div className="grid gap-4 sm:grid-cols-2">
        {[...groups.entries()].map(([group, items]) => (
          <div key={group}>
            <p className="mb-1 text-[12px] font-semibold tracking-wide text-ink-faint uppercase">
              {group}
            </p>
            <dl className="flex flex-col gap-1">
              {items.map((h) => (
                <div key={h.spec} className="flex items-center justify-between gap-3 text-sm">
                  <dt className="text-ink">{h.description}</dt>
                  <dd className="flex items-center gap-1">
                    {h.spec.split(' / ').map((s) => (
                      <Kbd key={s} spec={s} />
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Card>
  );
}
