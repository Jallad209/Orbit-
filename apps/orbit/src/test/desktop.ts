import type { AutostartStatus, DesktopApi, DesktopPrefs, ResidentStatus } from '@/platform/types';

/**
 * The week-11 resident shell surface of `DesktopApi`, with inert defaults,
 * so a test that fakes the desktop only spells out what it exercises.
 * Prefs and autostart round-trip in memory; shell events never fire unless
 * the test calls the returned `emit`.
 */
export function fakeResidentApi(
  overrides: Partial<
    Pick<
      DesktopApi,
      | 'residentStatus'
      | 'markReady'
      | 'quit'
      | 'ackQuit'
      | 'showCaptureWindow'
      | 'captureSubscribed'
      | 'activationSubscribed'
      | 'activationUnsubscribed'
      | 'showMain'
      | 'hideMain'
      | 'wakeScheduler'
      | 'backupNow'
      | 'freshIntegrity'
      | 'prefs'
      | 'autostart'
      | 'onShellEvent'
    >
  > & { prefsState?: Partial<DesktopPrefs>; autostartState?: Partial<AutostartStatus> } = {},
) {
  const prefs: DesktopPrefs = {
    closeToTray: true,
    closeExplanationSeen: false,
    autostart: false,
    legacyCloseMigrated: true,
    ...overrides.prefsState,
  };
  const autostart: AutostartStatus = {
    enabled: false,
    wanted: false,
    error: null,
    backend: 'fake',
    ...overrides.autostartState,
  };
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const status = (): ResidentStatus => ({
    phase: 'ready',
    launch: 'manual',
    trayAvailable: true,
    trayError: null,
    closeToTray: prefs.closeToTray,
    closeToTrayEffective: prefs.closeToTray,
    closeResolved: prefs.legacyCloseMigrated,
    closeExplanationSeen: prefs.closeExplanationSeen,
    readyGeneration: 1,
    generation: 1,
    shutdownError: null,
    mainVisible: true,
  });
  const api = {
    freshIntegrity: async () => ({ ok: true, messages: ['ok'], fts5: true, durationMs: 1 }),
    backupNow: async () => ({
      path: 'C:\\Orbit\\backups\\manual-test.db',
      modifiedAt: '2026-09-17T08:00:00.000Z',
      sizeBytes: 1,
      kind: 'manual' as const,
    }),
    residentStatus: async () => status(),
    markReady: async () => {},
    quit: async () => {},
    ackQuit: async () => {},
    showCaptureWindow: async () => {},
    captureSubscribed: async () => {},
    activationSubscribed: async () => 1,
    activationUnsubscribed: async (_subscriptionGeneration: number) => {},
    showMain: async () => {},
    hideMain: async () => {},
    wakeScheduler: async () => {},
    prefs: {
      get: async () => ({ ...prefs }),
      set: async (patch: Partial<DesktopPrefs>) => {
        Object.assign(prefs, patch);
        return { ...prefs };
      },
      migrateLegacy: async (value: string | null) => {
        if (!prefs.legacyCloseMigrated) {
          if (value === '0') prefs.closeToTray = false;
          if (value === '1') prefs.closeToTray = true;
          prefs.legacyCloseMigrated = true;
        }
        return { ...prefs };
      },
    },
    autostart: {
      get: async () => ({ ...autostart }),
      set: async (enabled: boolean) => {
        autostart.enabled = enabled;
        autostart.wanted = enabled;
        prefs.autostart = enabled;
        return { ...autostart };
      },
    },
    onShellEvent: async (name: string, handler: (payload: never) => void) => {
      const set = handlers.get(name) ?? new Set();
      set.add(handler as (payload: unknown) => void);
      handlers.set(name, set);
      return () => {
        set.delete(handler as (payload: unknown) => void);
      };
    },
    ...overrides,
  } satisfies Partial<DesktopApi>;
  return {
    api,
    prefs,
    autostart,
    /** Fire a shell event at the subscribed handlers. */
    emit: (name: string, payload?: unknown) => {
      for (const h of handlers.get(name) ?? []) h(payload);
    },
  };
}
