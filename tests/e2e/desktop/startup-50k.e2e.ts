import { expect as pw } from '@playwright/test';
import { afterEach, describe, expect, it } from 'vitest';
import { launchOrbit, removeSession, waitForPath, type LaunchedOrbit } from './coldLaunch';
import { seedLarge } from './seedDb';

const describeWindows = process.platform === 'win32' ? describe : describe.skip;
/**
 * The desktop budget is its own number, not the browser's 1,500 ms: a cold start here also
 * pays for process spawn, WebView2 start, the open-time `quick_check` of the whole file, and
 * SQLite over IPC. Measured 18 September 2026 on the development machine at 1.9–2.6 s after
 * the Week 13 fixes (docs/testing/release-1.0/performance.md); the CI figure is unmeasured.
 */
const BUDGET_MS = process.env.CI ? 6000 : 3000;

describeWindows('desktop startup with release-sized data', () => {
  let app: LaunchedOrbit | null = null;
  let sessionDir: string | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
    if (sessionDir && !process.env.ORBIT_KEEP_SESSIONS) removeSession(sessionDir);
    sessionDir = null;
  });

  it('opens an interactive Today screen under budget with 50k tasks and 10k notes', async () => {
    let seeded = 0;
    app = await launchOrbit({
      attachTimeoutMs: 120_000,
      seed: async (_dataDir, dbPath) => {
        seeded = await seedLarge(dbPath);
      },
    });
    sessionDir = app.sessionDir;

    // Complete onboarding once so the measured launch is a normal cold start,
    // with the same WebView profile and database but no setup page in the way.
    const start = app.page.getByRole('button', { name: 'Start planning' });
    await start.waitFor({ state: 'visible', timeout: 30_000 });
    await start.click();
    await waitForPath(app.page, (path) => path === '/today', 30_000);
    await app.close();

    app = await launchOrbit({ sessionDir, attachTimeoutMs: 120_000 });
    await pw(app.page.getByTestId('focus')).toBeVisible({ timeout: 30_000 });
    await pw(app.page.getByTestId('plan-panel')).toBeVisible({ timeout: 30_000 });
    const interactiveMs = await app.page.evaluate(() => performance.now());

    expect(seeded).toBeGreaterThan(60_000);
    expect(app.timings.spawnToMainPageMs).toBeLessThan(BUDGET_MS);
    expect(interactiveMs).toBeLessThan(BUDGET_MS);
  });
});
