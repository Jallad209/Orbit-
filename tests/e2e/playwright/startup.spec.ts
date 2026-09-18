import { appendFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import { seedCount, seedWorld } from '@orbit/core';

/**
 * Startup benchmark (DEVOPS-TASKS week 6): cold start to an interactive
 * Today screen with a seeded IndexedDB. The seed goes straight into the
 * database the app created, through the raw IndexedDB API, so no app code
 * exists only for tests.
 */
const LARGE = process.env.ORBIT_STARTUP_50K === '1';
const SIZES = LARGE
  ? { tasks: 50_000, notes: 10_000, days: 120, projects: 1200, goals: 250, people: 200 }
  : { tasks: 5000, notes: 1000, days: 90, projects: 120, goals: 25, people: 20 };

test(`cold start to interactive stays inside the budget with ${LARGE ? '50k' : '5k'} tasks`, async ({
  page,
  browserName,
}, testInfo) => {
  // Playwright's Windows WebKit port hangs before/inside the bulk raw-IDB benchmark even
  // though the normal route and CSP suites pass. Chromium and Firefox exercise the same
  // IndexedDB adapter; real Safari remains a manual/not-run environment for this release.
  test.skip(browserName === 'webkit', 'Playwright WebKit-on-Windows bulk-IDB harness artifact');
  test.setTimeout(120_000);
  // The strict local number is meaningful only on the dedicated single-worker run. In the
  // full browser suite this test shares the machine with seven browser processes, so use the
  // same 3 s contention ceiling as CI and keep `pnpm e2e:startup` as the idle 1.5 s gate.
  const budgetMs = process.env.CI || testInfo.config.workers !== 1 ? 3000 : 1500;
  const world = seedWorld({ seed: 5, sizes: SIZES });
  const stores = Object.fromEntries(Object.entries(world).map(([k, rows]) => [k, rows]));

  // First visit creates the database at the current schema version.
  await page.goto('/areas');
  await expect(page.getByRole('heading', { level: 1, name: 'Areas' })).toBeVisible();

  const inserted = await page.evaluate(async (data: Record<string, unknown[]>) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('orbit');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const names = Object.keys(data).filter((n) => db.objectStoreNames.contains(n));
    let n = 0;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(names, 'readwrite');
      for (const name of names) {
        const store = tx.objectStore(name);
        for (const row of data[name]!) {
          store.put(row);
          n++;
        }
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return n;
  }, stores);
  expect(inserted).toBe(seedCount(world));

  // Record readiness in the page, not after assertion/trace round trips to Node.
  // Those can add hundreds of milliseconds after both panels are already visible.
  await page.addInitScript(() => {
    let measured = false;
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (measured || scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const ready = ['focus', 'plan-panel'].every((id) => {
          const element = document.querySelector(`[data-testid="${id}"]`);
          if (!(element instanceof HTMLElement)) return false;
          const rect = element.getBoundingClientRect();
          return (
            getComputedStyle(element).visibility === 'visible' && rect.width > 0 && rect.height > 0
          );
        });
        if (!ready) return;
        performance.mark('orbit:interactive');
        measured = true;
        observer.disconnect();
      });
    });
    observer.observe(document, { childList: true, subtree: true, attributes: true });
  });

  // Cold start: a fresh navigation, measured from navigation start.
  await page.goto('/today');
  const timing = await page.waitForFunction(
    () => performance.getEntriesByName('orbit:interactive')[0]?.startTime,
    undefined,
    { timeout: 30_000 },
  );
  await expect(page.getByTestId('focus')).toBeVisible();
  await expect(page.getByTestId('plan-panel')).toBeVisible();
  const ms = await timing.jsonValue();
  const rows = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open('orbit');
      req.onsuccess = () => resolve(req.result);
    });
    const count = await new Promise<number>((resolve) => {
      const req = db.transaction('tasks').objectStore('tasks').count();
      req.onsuccess = () => resolve(req.result);
    });
    db.close();
    return count;
  });
  expect(rows).toBe(SIZES.tasks);

  const line = `Cold start to interactive with ${inserted} records: ${Math.round(ms)} ms (budget ${budgetMs} ms)`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Startup\n\n${line}\n`);
  expect(ms).toBeLessThan(budgetMs);
});
