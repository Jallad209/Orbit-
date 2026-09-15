import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';
import { dismissFirstRun } from './helpers';
import { SESSION_DIR_FILE } from '../session';

/**
 * The resident shell on the real desktop app (week 11), in an isolated
 * run: preferences live beside the throwaway data folder, login launch is
 * a fake file, and no single-instance registration exists, so nothing here
 * can reach the user's Orbit.
 *
 * Readiness is a handshake from the main window for the open generation;
 * the first close shows the explanation and hides only once acknowledged;
 * later closes hide straight away; the tray's Open brings the window back;
 * login launch is opt-in and read back from the (fake) OS.
 */

interface ResidentStatus {
  phase: string;
  launch: string;
  trayAvailable: boolean;
  trayError: string | null;
  closeToTray: boolean;
  closeToTrayEffective: boolean;
  closeResolved: boolean;
  closeExplanationSeen: boolean;
  readyGeneration: number | null;
  generation: number;
  shutdownError: string | null;
  mainVisible: boolean;
}

interface Prefs {
  closeToTray: boolean;
  closeExplanationSeen: boolean;
  autostart: boolean;
  legacyCloseMigrated: boolean;
}

interface AutostartStatus {
  enabled: boolean;
  wanted: boolean;
  error: string | null;
  backend: string;
}

async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await browser.execute(
    async (cmd, params) => {
      const internal = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke<R>(name: string, args: Record<string, unknown>): Promise<R>;
          };
        }
      ).__TAURI_INTERNALS__;
      try {
        return { value: await internal.invoke<T>(cmd, params) };
      } catch (error) {
        return { failure: String(error) };
      }
    },
    command,
    args,
  );
  if ('failure' in result) throw new Error(result.failure);
  return result.value;
}

/** Ask the shell to close the main window the way the title-bar X does. */
async function closeMain() {
  await invoke<void>('plugin:window|close', { label: 'main' });
}

describe('resident shell on desktop', () => {
  it('reaches readiness for the open generation with a tray and resolved preferences', async () => {
    await dismissFirstRun();
    await expect($('h1')).toHaveText(/^(Today|Tomorrow)$/);

    let status!: ResidentStatus;
    await browser.waitUntil(
      async () => {
        status = await invoke<ResidentStatus>('resident_status');
        return status.phase === 'ready' && status.readyGeneration === status.generation;
      },
      { timeout: 20_000, timeoutMsg: 'the main window never acknowledged readiness' },
    );
    expect(status.launch).toBe('manual');
    expect(status.trayAvailable).toBe(true);
    expect(status.trayError).toBeNull();
    expect(status.closeResolved).toBe(true);
    expect(status.closeToTrayEffective).toBe(true);
    expect(status.mainVisible).toBe(true);

    const prefs = await invoke<Prefs>('prefs_get');
    expect(prefs).toEqual({
      closeToTray: true,
      closeExplanationSeen: false,
      autostart: false,
      legacyCloseMigrated: true,
    });
    const dir = readFileSync(SESSION_DIR_FILE, 'utf8').trim();
    expect(existsSync(join(dir, 'desktop-preferences.json'))).toBe(true);
    // Readiness for a generation that is not open is refused.
    await expect(invoke<void>('resident_ready', { generation: 999 })).rejects.toThrow(/ignored/);
  });

  it('login launch is opt-in, read back from the registration, and never the real Run key here', async () => {
    const dir = readFileSync(SESSION_DIR_FILE, 'utf8').trim();
    const fake = join(dir, 'autostart.txt');
    const before = await invoke<AutostartStatus>('autostart_get');
    expect(before).toEqual({ enabled: false, wanted: false, error: null, backend: 'fake' });
    expect(existsSync(fake)).toBe(false);

    const on = await invoke<AutostartStatus>('autostart_set', { enabled: true });
    expect(on).toEqual({ enabled: true, wanted: true, error: null, backend: 'fake' });
    expect(readFileSync(fake, 'utf8')).toContain('--background');
    expect((await invoke<Prefs>('prefs_get')).autostart).toBe(true);

    // Settings shows the read-back, not a wish.
    await browser.url(`${new URL(await browser.getUrl()).origin}/settings`);
    const label = await $('label*=Start Orbit at login');
    const toggle = await $(`#${await label.getAttribute('for')}`);
    await browser.waitUntil(async () => (await toggle.getAttribute('aria-checked')) === 'true', {
      timeout: 10_000,
      timeoutMsg: 'the login toggle did not reflect the registration',
    });
    await expect($('[data-testid="tray-status"]')).toHaveText('tray icon shown');

    const off = await invoke<AutostartStatus>('autostart_set', { enabled: false });
    expect(off.enabled).toBe(false);
    expect(existsSync(fake)).toBe(false);
  });

  it('the first close explains and hides only when acknowledged; later closes hide at once; Open restores', async () => {
    await browser.url(`${new URL(await browser.getUrl()).origin}/today`);
    await expect($('h1')).toHaveText(/^(Today|Tomorrow)$/);
    await closeMain();
    const dialog = await $('[data-testid="close-explanation"]');
    await expect(dialog).toBeDisplayed();
    expect((await invoke<ResidentStatus>('resident_status')).mainVisible).toBe(true);
    await dialog.$('button=Hide to tray').click();
    await browser.waitUntil(
      async () => !(await invoke<ResidentStatus>('resident_status')).mainVisible,
      { timeout: 10_000, timeoutMsg: 'the main window did not hide' },
    );
    expect((await invoke<Prefs>('prefs_get')).closeExplanationSeen).toBe(true);
    // Hidden is not torn down: the same webview answers, and the shell is still ready.
    expect((await invoke<ResidentStatus>('resident_status')).phase).toBe('ready');

    await invoke<void>('resident_show_main');
    await browser.waitUntil(
      async () => (await invoke<ResidentStatus>('resident_status')).mainVisible,
      { timeout: 10_000, timeoutMsg: 'the main window did not come back' },
    );
    await closeMain();
    await browser.waitUntil(
      async () => !(await invoke<ResidentStatus>('resident_status')).mainVisible,
      { timeout: 10_000, timeoutMsg: 'the second close did not hide' },
    );
    await expect($('[data-testid="close-explanation"]')).not.toBeExisting();
    await invoke<void>('resident_show_main');
    await browser.waitUntil(
      async () => (await invoke<ResidentStatus>('resident_status')).mainVisible,
      { timeout: 10_000 },
    );
  });
});
