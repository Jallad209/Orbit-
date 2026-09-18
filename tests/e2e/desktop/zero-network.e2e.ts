import { afterEach, describe, expect, it } from 'vitest';
import { launchOrbit, removeSession, waitForPath, type LaunchedOrbit } from './coldLaunch';

/**
 * Everything the WebView may talk to is served in-process by Tauri: the bundle
 * on `tauri.localhost` and the command bridge on `ipc.localhost`. Neither is a
 * network socket; anything else is a request leaving the app.
 */
const APP_ORIGINS = new Set(['http://tauri.localhost', 'http://ipc.localhost']);

describe('desktop offline boundary', () => {
  let app: LaunchedOrbit | null = null;

  afterEach(async () => {
    if (!app) return;
    const dir = app.sessionDir;
    await app.close();
    removeSession(dir);
    app = null;
  });

  it('makes no WebView request outside the application origins', async () => {
    app = await launchOrbit();
    const requests: string[] = [];
    // Attach before first run so its navigation, the fonts, and every lazy chunk are recorded.
    for (const context of app.browser.contexts()) {
      context.on('request', (request) => requests.push(request.url()));
    }
    const start = app.page.getByRole('button', { name: 'Start planning' });
    await start.waitFor({ state: 'visible', timeout: 30_000 });
    await start.click();
    await waitForPath(app.page, (path) => path === '/today', 30_000);
    await app.page.getByRole('heading', { level: 1, name: /^(Today|Tomorrow)$/ }).waitFor();

    // Navigate the way the app does, client-side. A full document reload while a
    // write is in flight orphans the shared SQLite transaction until the shell
    // expires it 30 s later, which is not a network property of the app.
    for (const label of ['Insights', 'Notes', 'Settings']) {
      await app.page.getByRole('link', { name: new RegExp(`^${label}\\b`) }).click();
      await app.page.getByRole('heading', { level: 1, name: label }).waitFor();
    }

    expect(requests.length).toBeGreaterThan(0);
    const external = requests.filter((url) => {
      if (/^(?:data|blob|about):/.test(url)) return false;
      return !APP_ORIGINS.has(new URL(url).origin);
    });
    expect(external).toEqual([]);
  });
});
