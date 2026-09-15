import { BellOff, BellRing, Power } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Toggle } from '@/components/ui/Checkbox';
import { toast } from '@/components/ui/toastStore';
import { usePlatform } from '@/platform';
import type { AutostartStatus, DesktopPrefs, ResidentStatus } from '@/platform/types';

/**
 * Settings → Desktop: the resident shell as it actually is. Close-to-tray
 * and login launch are machine-local preferences; the login toggle shows
 * what the OS has registered, read back after every change and every time
 * the section opens, so a failed change never leaves it lying. On the web
 * the section says plainly that none of this exists.
 */
export function DesktopSettings() {
  const platform = usePlatform();
  const desktop = platform.desktop;
  const [status, setStatus] = useState<ResidentStatus | null>(null);
  const [prefs, setPrefs] = useState<DesktopPrefs | null>(null);
  const [autostart, setAutostart] = useState<AutostartStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!desktop) return;
    const [s, p, a] = await Promise.all([
      desktop.residentStatus(),
      desktop.prefs.get(),
      desktop.autostart.get(),
    ]);
    setStatus(s);
    setPrefs(p);
    setAutostart(a);
  }, [desktop]);

  useEffect(() => {
    let cancelled = false;
    const read = () =>
      void load().catch((e: unknown) => {
        if (!cancelled)
          toast({
            title: 'Could not read desktop settings',
            description: e instanceof Error ? e.message : String(e),
            variant: 'danger',
          });
      });
    const first = setTimeout(read, 0);
    // Another window (or a tray action) may have changed them: re-read on focus.
    window.addEventListener('focus', read);
    return () => {
      cancelled = true;
      clearTimeout(first);
      window.removeEventListener('focus', read);
    };
  }, [load]);

  if (!desktop) {
    return (
      <Card data-testid="desktop-settings">
        <SectionHeader title="Desktop" />
        <p className="text-sm text-ink-muted" data-testid="desktop-unsupported">
          A tray icon, close-to-tray, login launch, and reminders while the window is closed exist
          only in the desktop app. In a browser, Orbit runs while this tab is open.
        </p>
      </Card>
    );
  }

  const setCloseToTray = async (on: boolean) => {
    setBusy(true);
    try {
      setPrefs(await desktop.prefs.set({ closeToTray: on }));
      setStatus(await desktop.residentStatus());
    } catch (e) {
      toast({
        title: 'Could not save the preference',
        description: e instanceof Error ? e.message : String(e),
        variant: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  const setLoginLaunch = async (on: boolean) => {
    setBusy(true);
    try {
      const result = await desktop.autostart.set(on);
      setAutostart(result);
      setPrefs(await desktop.prefs.get());
      if (result.error) {
        toast({
          title: on ? 'Login launch was not enabled' : 'Login launch was not disabled',
          description: result.error,
          variant: 'danger',
        });
      } else {
        toast({
          title: result.enabled ? 'Orbit will start at login' : 'Orbit will not start at login',
          variant: 'success',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const phase = status?.phase ?? 'booting';
  const ready = phase === 'ready';
  return (
    <Card data-testid="desktop-settings">
      <SectionHeader title="Desktop" />
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex flex-wrap items-center gap-2" data-testid="resident-status">
          {ready ? (
            <BellRing className="size-4 text-ok" aria-hidden="true" />
          ) : (
            <BellOff className="size-4 text-gold-ink" aria-hidden="true" />
          )}
          <span>Resident reminders:</span>
          <Badge tone={ready ? 'ok' : phase === 'quitting' ? 'neutral' : 'gold'}>
            {phase === 'ready'
              ? 'ready'
              : phase === 'booting'
                ? 'starting'
                : phase === 'degraded'
                  ? 'needs attention'
                  : 'quitting'}
          </Badge>
          <Badge tone={status?.trayAvailable ? 'outline' : 'gold'} data-testid="tray-status">
            {status === null
              ? 'tray: checking…'
              : status.trayAvailable
                ? 'tray icon shown'
                : 'no tray icon'}
          </Badge>
          {status?.launch === 'background' ? <Badge tone="outline">started at login</Badge> : null}
        </div>
        {status?.trayError ? (
          <p className="text-[13px] text-gold-ink" data-testid="tray-error">
            The tray icon could not be created ({status.trayError}). Closing the window quits Orbit
            for this run.
          </p>
        ) : null}
        {status?.shutdownError ? (
          <p role="alert" className="text-[13px] text-danger">
            {status.shutdownError}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle
            label="Close to tray"
            description={
              status?.trayAvailable === false
                ? 'No tray icon this run: closing the window quits.'
                : 'Closing the window hides it; reminders keep running. Quit is below and in the tray menu.'
            }
            disabled={busy || prefs === null || status?.trayAvailable === false}
            checked={prefs?.closeToTray ?? false}
            onCheckedChange={(on) => void setCloseToTray(on)}
          />
          <Toggle
            label="Start Orbit at login"
            description={
              autostart?.error
                ? `Could not read the login setting: ${autostart.error}`
                : autostart?.enabled
                  ? 'Registered for this Windows user; Orbit starts hidden and stays in the tray.'
                  : 'Off. Only this Windows user is affected; nothing needs administrator rights.'
            }
            disabled={busy || autostart === null}
            checked={autostart?.enabled ?? false}
            onCheckedChange={(on) => void setLoginLaunch(on)}
          />
        </div>
        {autostart && autostart.enabled !== autostart.wanted && !autostart.error ? (
          <p className="text-[13px] text-gold-ink" data-testid="autostart-mismatch">
            You chose {autostart.wanted ? 'on' : 'off'} but Windows has it{' '}
            {autostart.enabled ? 'on' : 'off'}. Change the toggle to set it again.
          </p>
        ) : null}

        <p className="text-[13px] text-ink-muted">
          Reminders show as Windows notifications while Orbit is running and the computer is awake.
          Windows notification settings and Do Not Disturb (Focus) can hide them; Orbit cannot tell
          whether a toast was shown, only that Windows accepted it. Nothing is delivered while the
          computer sleeps or Orbit is not running; due reminders catch up when it can run again.
        </p>

        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || phase === 'quitting'}
            onClick={() => void desktop.quit()}
          >
            <Power className="size-3.5" aria-hidden="true" /> Quit Orbit
          </Button>
          <p className="mt-1 text-[12px] text-ink-faint">
            Stops reminders until Orbit runs again, whatever the close-to-tray setting.
          </p>
        </div>
        <div data-testid="notification-clicks">
          <p className="text-sm font-medium text-ink">Notification clicks</p>
          <p className="mt-1 text-[12px] text-ink-faint">
            Clicking a reminder opens the record it names, whether Orbit is visible, hidden, or not
            running, through the orbit:// handler the installer registers for your account. A link
            only opens a screen; it never pays, completes, or changes anything. Windows accepting a
            notification is not proof it was shown: Focus Assist and notification settings can hide
            it.
          </p>
        </div>
        <div data-testid="updates">
          <p className="text-sm font-medium text-ink">Updates</p>
          <p className="mt-1 text-[12px] text-ink-faint">
            Updates are not configured. Orbit never checks, downloads, or installs anything on its
            own. To update, download the newer installer from where you got this one and run it over
            the current installation; your data folder, backups, and preferences are kept, and an
            export beforehand (Settings → Data) is a good habit.
          </p>
        </div>
      </div>
    </Card>
  );
}
