/**
 * Cold-launch harness for the real desktop binary. It passes `orbit://`
 * arguments to the process verbatim — what the Windows protocol handler and a
 * toast click do — which the WebDriver harness cannot: Edge WebDriver rewrites
 * `tauri:options.args` as `--<arg>`. It enables WebView2 remote debugging for
 * this process only and attaches Playwright over CDP to drive the window. Same
 * isolation as the WDIO harness: throwaway data folder, WebView2 profile, and
 * fake autostart file; single-instance and window-state are skipped by the
 * shell under ORBIT_DATA_DIR, so it never touches the real install.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';

export const ORBIT_EXE =
  process.env.ORBIT_APP ?? resolve(process.cwd(), 'apps/orbit/src-tauri/target/release/orbit.exe');

export interface LaunchedOrbit {
  child: ChildProcess;
  browser: Browser;
  /** The main window's page (URL under http://tauri.localhost, not /capture). */
  page: Page;
  sessionDir: string;
  dataDir: string;
  dbPath: string;
  /** Shell log lines (JSON objects) matching an optional op filter. */
  shellLog(ops?: RegExp): Array<Record<string, unknown>>;
  /** Milliseconds from spawn to CDP attach and to the main page being found. */
  timings: { spawnToCdpMs: number; spawnToMainPageMs: number };
  close(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
    srv.on('error', rej);
  });
}

export interface LaunchOptions {
  args?: string[];
  /** Populate the data folder before the process starts (e.g. write orbit.db). */
  seed?: (dataDir: string, dbPath: string) => Promise<void> | void;
  /** Reuse an existing session dir (second launch against the same data). */
  sessionDir?: string;
  attachTimeoutMs?: number;
  /** Extra environment for the process. */
  env?: Record<string, string>;
}

export async function launchOrbit(options: LaunchOptions = {}): Promise<LaunchedOrbit> {
  if (!existsSync(ORBIT_EXE)) throw new Error(`no desktop binary at ${ORBIT_EXE}`);
  const sessionDir = options.sessionDir ?? mkdtempSync(join(tmpdir(), 'orbit-campaign-'));
  const dataDir = join(sessionDir, 'data');
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, 'orbit.db');
  if (options.seed) await options.seed(dataDir, dbPath);
  const port = await freePort();
  const t0 = Date.now();
  const child = spawn(ORBIT_EXE, options.args ?? [], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ORBIT_DATA_DIR: dataDir,
      WEBVIEW2_USER_DATA_FOLDER: join(sessionDir, 'webview'),
      ORBIT_AUTOSTART_FAKE: join(sessionDir, 'autostart.txt'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      ...options.env,
    },
  });
  const stderr: string[] = [];
  child.stderr?.on('data', (d) => stderr.push(String(d)));

  const deadline = Date.now() + (options.attachTimeoutMs ?? 30_000);
  let browser: Browser | null = null;
  while (!browser) {
    if (child.exitCode !== null)
      throw new Error(`orbit exited early (${child.exitCode}): ${stderr.join('')}`);
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 2_000 });
    } catch {
      if (Date.now() > deadline)
        throw new Error(`could not attach over CDP within timeout; stderr: ${stderr.join('')}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const spawnToCdpMs = Date.now() - t0;
  let page: Page | null = null;
  while (!page) {
    for (const ctx of browser.contexts()) {
      for (const p of ctx.pages()) {
        const url = p.url();
        if (url.startsWith('http://tauri.localhost') && !url.includes('/capture')) page = p;
      }
    }
    if (!page) {
      if (Date.now() > deadline) throw new Error('main page never appeared over CDP');
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  const spawnToMainPageMs = Date.now() - t0;

  const shellLog = (ops?: RegExp) => {
    const logs = join(sessionDir, 'logs');
    if (!existsSync(logs)) return [];
    return readdirSync(logs)
      .filter((f) => f.endsWith('.log'))
      .sort()
      .flatMap((f) => readFileSync(join(logs, f), 'utf8').split('\n'))
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return { raw: l };
        }
      })
      .filter((o) => !ops || ops.test(String(o['op'] ?? '')));
  };

  return {
    child,
    browser,
    page,
    sessionDir,
    dataDir,
    dbPath,
    shellLog,
    timings: { spawnToCdpMs, spawnToMainPageMs },
    async close() {
      try {
        await browser?.close();
      } catch {
        /* already gone */
      }
      if (child.exitCode === null) {
        child.kill();
        await new Promise((r) => setTimeout(r, 500));
        if (child.exitCode === null) {
          try {
            spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
          } catch {
            /* ignore */
          }
        }
      }
      // With ORBIT_WAIT_FOR_EXIT set, block until this launch's orbit.exe (by PID) and any
      // WebView2 host it started are gone, so a relaunch never shares a lingering WebView2
      // host bound to the same profile folder.
      if (process.env.ORBIT_WAIT_FOR_EXIT && child.pid) {
        const deadline = Date.now() + 15_000;
        for (;;) {
          const still = spawnSync(
            'powershell',
            [
              '-NoProfile',
              '-Command',
              `@(Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue).Count`,
            ],
            { encoding: 'utf8' },
          );
          if ((still.stdout ?? '').trim() === '0' || Date.now() > deadline) break;
          await new Promise((r) => setTimeout(r, 200));
        }
        // WebView2's msedgewebview2.exe host lingers a beat after its client exits.
        await new Promise((r) => setTimeout(r, 800));
      }
      await new Promise((r) => setTimeout(r, 500));
    },
  };
}

export function removeSession(sessionDir: string) {
  // WebView2 releases its profile a moment after the process exits.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      rmSync(sessionDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      return;
    } catch {
      const until = Date.now() + 300;
      while (Date.now() < until) {
        /* spin briefly; rmSync has no async form here */
      }
    }
  }
}

/** Wait until the page URL (path + search) satisfies a predicate. */
export async function waitForPath(
  page: Page,
  predicate: (path: string) => boolean,
  timeoutMs = 30_000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const u = new URL(page.url());
    const path = u.pathname + u.search;
    if (predicate(path)) return path;
    if (Date.now() > deadline) throw new Error(`timed out waiting for path; at ${path}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
