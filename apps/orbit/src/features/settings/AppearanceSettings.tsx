import { Card, SectionHeader } from '@/components/ui/Card';
import { Toggle } from '@/components/ui/Checkbox';
import { useAppStore } from '@/app/store';

/** Settings → Appearance. Orbit follows the system theme; motion can be turned down here. */
export function AppearanceSettings() {
  const reduceMotion = useAppStore((s) => s.reduceMotion);
  const setReduceMotion = useAppStore((s) => s.setReduceMotion);
  return (
    <Card data-testid="appearance-settings">
      <SectionHeader title="Appearance" />
      <div className="flex flex-col gap-3 text-sm">
        <div className="w-full max-w-md">
          <Toggle
            label="Reduce motion"
            description="Shorten every animation, whatever the system preference says."
            checked={reduceMotion}
            onCheckedChange={setReduceMotion}
          />
        </div>
        <p className="text-[13px] text-ink-muted">
          Colours follow the Orbit palette: charcoal navigation, a warm workspace, lime for action.
          A dark workspace arrives with the visual polish in week 13.
        </p>
      </div>
    </Card>
  );
}
