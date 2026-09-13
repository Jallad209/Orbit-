/**
 * Desktop end-to-end harness: WebdriverIO → tauri-driver → Edge WebDriver →
 * the real release build of Orbit in its WebView2 window.
 *
 *   pnpm run tauri:build          # once, or after a Rust / frontend change
 *   pnpm run edge:driver          # once per WebView2 update
 *   pnpm run e2e:desktop
 *
 * Every session gets a throwaway data folder (`ORBIT_DATA_DIR`) and a
 * throwaway WebView2 profile (`WEBVIEW2_USER_DATA_FOLDER`), so the tests never
 * touch the user's real database, settings, or local storage.
 * Windows only for now: tauri-driver has no macOS backend.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser } from '@wdio/globals';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');

const application =
  process.env.ORBIT_APP ?? join(root, 'apps/orbit/src-tauri/target/release/orbit.exe');
const nativeDriver = process.env.EDGE_DRIVER ?? join(here, '.driver/msedgedriver.exe');
const tauriDriverBin =
  process.env.TAURI_DRIVER ??
  join(homedir(), '.cargo/bin', process.platform === 'win32' ? 'tauri-driver.exe' : 'tauri-driver');

let tauriDriver: ChildProcess | undefined;
let sessionDir: string | undefined;

export const config: WebdriverIO.Config = {
  runner: 'local',
  hostname: '127.0.0.1',
  port: 4444,
  specs: ['./specs/**/*.spec.ts'],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      // @ts-expect-error tauri-driver's vendor capability
      'tauri:options': { application },
    },
  ],
  logLevel: 'warn',
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 120_000 },

  onPrepare: () => {
    const missing: string[] = [];
    if (!existsSync(application)) missing.push(`app binary: ${application} (pnpm run tauri:build)`);
    if (!existsSync(nativeDriver))
      missing.push(`Edge WebDriver: ${nativeDriver} (pnpm run edge:driver)`);
    if (!existsSync(tauriDriverBin))
      missing.push(`tauri-driver: ${tauriDriverBin} (cargo install tauri-driver --locked)`);
    if (missing.length)
      throw new Error(`desktop e2e cannot start; missing\n  ${missing.join('\n  ')}`);
  },

  beforeSession: async () => {
    sessionDir = mkdtempSync(join(tmpdir(), 'orbit-desktop-e2e-'));
    tauriDriver = spawn(tauriDriverBin, ['--native-driver', nativeDriver], {
      stdio: ['ignore', process.stdout, process.stderr],
      env: {
        ...process.env,
        ORBIT_DATA_DIR: join(sessionDir, 'data'),
        WEBVIEW2_USER_DATA_FOLDER: join(sessionDir, 'webview'),
      },
    });
    // Wait for the driver to listen before WebDriverIO opens the session.
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        const res = await fetch('http://127.0.0.1:4444/status');
        if (res.ok) return;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error('tauri-driver did not start within 30 s');
      await new Promise((r) => setTimeout(r, 250));
    }
  },

  before: async () => {
    // Orbit opens its hidden quick-capture window alongside the main one, and the
    // session may start on either. Drive the main window.
    for (const handle of await browser.getWindowHandles()) {
      await browser.switchToWindow(handle);
      if (!new URL(await browser.getUrl()).pathname.startsWith('/capture')) return;
    }
    throw new Error('desktop e2e: could not find the main Orbit window');
  },

  afterSession: async () => {
    tauriDriver?.kill();
    tauriDriver = undefined;
    // The app releases its files a moment after the session closes.
    await new Promise((r) => setTimeout(r, 500));
    if (sessionDir) rmSync(sessionDir, { recursive: true, force: true, maxRetries: 5 });
    sessionDir = undefined;
  },
};
