import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { launchOrbit, removeSession, waitForPath, type LaunchedOrbit } from './coldLaunch';
import { seedKnownDataset, type SeededIds } from './seedDb';

/**
 * The strongest isolation for the cold-activation race: every launch gets its
 * OWN fresh session dir (own SQLite file, own WebView2 profile, own log file),
 * seeded independently. No process, profile, or log is shared between runs, so
 * a loss here cannot be a relaunch/profile-reuse artifact — it is the shell
 * emitting `orbit:activate` to the main window before that window's listener
 * is attached.
 */
const REPEATS = Number(process.env.ORBIT_ISO_REPEATS ?? 12);
const EVIDENCE = join('docs', 'testing', 'campaign-2026-09-15', 'evidence');

interface Row {
  run: number;
  finalPath: string;
  queued: boolean | undefined;
  activateOps: number;
  readyQueuedActivation: number | undefined;
}
const rows: Row[] = [];

afterAll(() => {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(
    join(EVIDENCE, 'cold-activation-isolated.json'),
    JSON.stringify({ repeats: REPEATS, rows }, null, 2),
  );
});

describe('cold activation (fully isolated per launch)', () => {
  it(
    `opens the seeded task on every one of ${REPEATS} independent installs`,
    async () => {
      let lost = 0;
      for (let run = 1; run <= REPEATS; run++) {
        let ids: SeededIds | null = null;
        // Seed a fresh install, finish first run, then RELAUNCH the same fresh install
        // cold with the task URI (first run must be done for the task to open directly).
        let orbit: LaunchedOrbit = await launchOrbit({
          seed: async (_dir, db) => {
            ids = await seedKnownDataset(db);
          },
        });
        const sessionDir = orbit.sessionDir;
        const start = orbit.page.getByRole('button', { name: 'Start planning' });
        await start.waitFor({ state: 'visible', timeout: 30_000 });
        await start.click();
        await waitForPath(orbit.page, (p) => p === '/today', 15_000);
        await orbit.close();

        orbit = await launchOrbit({ sessionDir, args: [`orbit://task/${ids!.taskId}`] });
        const expected = `/tasks/${ids!.taskId}`;
        let finalPath: string;
        try {
          finalPath = await waitForPath(orbit.page, (p) => p === expected, 8_000);
        } catch {
          const u = new URL(orbit.page.url());
          finalPath = u.pathname + u.search;
        }
        const activate = orbit.shellLog(/^activate$/);
        const ready = orbit.shellLog(/^ready$/).at(-1);
        rows.push({
          run,
          finalPath,
          queued: (activate.at(-1)?.['fields'] as { queued?: boolean } | undefined)?.queued,
          activateOps: activate.length,
          readyQueuedActivation: (ready?.['fields'] as { queuedActivation?: number } | undefined)
            ?.queuedActivation,
        });
        if (finalPath !== expected) lost++;
        await orbit.close();
        removeSession(sessionDir);
      }
      console.log(
        `isolated cold activation: ${REPEATS - lost}/${REPEATS} opened the task; ${lost} lost`,
      );
      expect(rows.filter((r) => !r.finalPath.startsWith('/tasks/'))).toEqual([]);
    },
    REPEATS * 40_000,
  );
});
