/**
 * Cold-launch harness for the real desktop binary. It passes `orbit://`
 * arguments to the process verbatim — what the Windows protocol handler and a
 * toast click do — which the WebDriver harness cannot: Edge WebDriver rewrites
 * `tauri:options.args` as `--<arg>`. It enables WebView2 remote debugging for
 * this process only and attaches Playwright over CDP to drive the window. Same
 * isolation as the WDIO harness: throwaway data folder, WebView2 profile, and
 * fake autostart file; single-instance and window-state are skipped by the
 * shell under ORBIT_DATA_DIR, so it never touches the real install.
 *
 * Run it from a non-elevated shell. An elevated (Administrator) host process
 * makes WebView2 drop the `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` override, so
 * Orbit starts normally but never listens for CDP and every launch times out.
 * `probe-launch.ps1` beside this file shows the resulting browser command line.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
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

/** High (`S-1-16-12288`) or System (`S-1-16-16384`) integrity: WebView2 ignores the env-var flags. */
let elevated: boolean | undefined;
function assertNotElevated() {
  if (process.platform !== 'win32') return;
  if (elevated === undefined) {
    try {
      const groups = execFileSync('whoami', ['/groups'], { encoding: 'utf8', windowsHide: true });
      elevated = /S-1-16-(12288|16384)\b/.test(groups);
    } catch {
      elevated = false; // cannot tell; let the launch speak for itself
    }
  }
  if (elevated) {
    throw new Error(
      'the desktop cold-launch harness must run from a non-elevated shell: an elevated host makes ' +
        'WebView2 ignore WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, so Orbit never opens a CDP port ' +
        '(see tests/e2e/desktop/probe-launch.ps1)',
    );
  }
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

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      resolveExit(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(child.exitCode !== null), timeoutMs);
    child.once('exit', onExit);
  });
}

function killTree(pid: number, exited: () => boolean): Promise<void> {
  return new Promise<void>((resolveKill, rejectKill) => {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    const timer = setTimeout(() => {
      killer.kill();
      rejectKill(new Error(`taskkill timed out for Orbit process ${pid}`));
    }, 15_000);
    killer.once('error', (error) => {
      clearTimeout(timer);
      rejectKill(error);
    });
    killer.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0 || exited()) resolveKill();
      else rejectKill(new Error(`taskkill exited ${code} for Orbit process ${pid}`));
    });
  });
}

/**
 * Chromium holds `lockfile` in the profile for as long as its browser process lives; a
 * relaunch into the same profile before it is released waits on the old instance (seconds)
 * and `removeSession` fails. Wait for the release rather than a fixed pause.
 */
async function waitForProfileRelease(sessionDir: string, timeoutMs = 15_000): Promise<void> {
  const lockfile = join(sessionDir, 'webview', 'EBWebView', 'lockfile');
  const deadline = Date.now() + timeoutMs;
  while (existsSync(lockfile)) {
    if (Date.now() > deadline) {
      throw new Error(
        `WebView2 profile still locked ${timeoutMs} ms after Orbit exited: ${lockfile}`,
      );
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Quit the way the tray does (`resident_quit`, forced past the draft/ack round), so the shell
 * closes the file and WebView2 shuts down and flushes what the renderer wrote — killing the
 * browser process with the host drops unflushed `localStorage` such as the first-run flag.
 */
async function quitOrbit(page: Page, child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await page
    .evaluate(() => {
      const w = window as typeof window & {
        __TAURI_INTERNALS__?: { invoke(cmd: string, args?: unknown): Promise<unknown> };
      };
      void w.__TAURI_INTERNALS__?.invoke('resident_quit', { force: true });
    })
    .catch(() => undefined);
  await waitForExit(child, 10_000);
}

async function terminateOrbit(child: ChildProcess, sessionDir: string): Promise<void> {
  if (child.exitCode === null && child.pid) {
    // Kill the tree while the host is alive: the WebView2 browser process is its child and,
    // orphaned, keeps the profile locked for ten seconds or more after the host is gone.
    await killTree(child.pid, () => child.exitCode !== null);
    if (!(await waitForExit(child, 15_000))) {
      throw new Error(`Orbit process ${child.pid} did not exit after taskkill`);
    }
  }
  await waitForProfileRelease(sessionDir);
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
  assertNotElevated();
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

  let browser: Browser | null = null;
  try {
    const deadline = Date.now() + (options.attachTimeoutMs ?? 30_000);
    while (!browser) {
      if (child.exitCode !== null)
        throw new Error(`orbit exited early (${child.exitCode}): ${stderr.join('')}`);
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 2_000 });
      } catch (error) {
        if (Date.now() > deadline) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(
            `could not attach over CDP on port ${port} within timeout; last error: ${reason}; stderr: ${stderr.join('')}`,
            { cause: error },
          );
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const spawnToCdpMs = Date.now() - t0;
    let page: Page | null = null;
    const observedPageUrls = new Set<string>();
    while (!page) {
      for (const ctx of browser.contexts()) {
        for (const p of ctx.pages()) {
          const url = p.url();
          observedPageUrls.add(url);
          if (url.startsWith('http://tauri.localhost') && !url.includes('/capture')) page = p;
        }
      }
      if (!page) {
        if (Date.now() > deadline) {
          throw new Error(
            `main page never appeared over CDP; observed: ${[...observedPageUrls].join(', ') || '(none)'}; stderr: ${stderr.join('')}`,
          );
        }
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
        await quitOrbit(page, child);
        try {
          await browser?.close();
        } catch {
          /* already gone */
        }
        await terminateOrbit(child, sessionDir);
      },
    };
  } catch (error) {
    try {
      await browser?.close();
    } catch {
      /* preserve the launch error */
    }
    await terminateOrbit(child, sessionDir).catch(() => undefined);
    throw error;
  }
}

export function removeSession(sessionDir: string) {
  const target = resolve(sessionDir);
  const tempRoot = resolve(tmpdir()) + sep;
  if (!target.startsWith(tempRoot) || !basename(target).startsWith('orbit-campaign-')) {
    throw new Error(`refusing to remove a non-campaign directory: ${target}`);
  }
  // WebView2 helper processes can hold profile files for a few seconds after the browser
  // process has exited and released the lockfile; Node backs off linearly, so 12 retries at
  // 250 ms allow up to ~20 s while an ordinary close finishes in one or two.
  rmSync(target, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
  if (existsSync(target)) throw new Error(`campaign directory is still in use: ${target}`);
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
