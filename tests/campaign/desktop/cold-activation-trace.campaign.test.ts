import { afterEach, describe, expect, it } from 'vitest';
import { launchOrbit, removeSession, waitForPath, type LaunchedOrbit } from './coldLaunch';
import { seedKnownDataset, type SeededIds } from './seedDb';

/**
 * Runs cold activation until it loses once (or a cap), then prints the full
 * ordered shell log of the losing launch, so the report can show the exact
 * event sequence that drops the activation.
 */
let live: LaunchedOrbit | null = null;
const dirs: string[] = [];
afterEach(async () => {
  await live?.close();
  live = null;
  while (dirs.length) removeSession(dirs.pop()!);
});

describe('cold activation trace-on-loss', () => {
  it(
    'captures the ordered shell log of a lost launch',
    async () => {
      const cap = Number(process.env.ORBIT_TRACE_CAP ?? 25);
      for (let run = 1; run <= cap; run++) {
        let ids: SeededIds | null = null;
        live = await launchOrbit({
          seed: async (_d, db) => {
            ids = await seedKnownDataset(db);
          },
        });
        const sessionDir = live.sessionDir;
        const start = live.page.getByRole('button', { name: 'Start planning' });
        await start.waitFor({ state: 'visible', timeout: 30_000 });
        await start.click();
        await waitForPath(live.page, (p) => p === '/today', 15_000);
        await live.close();

        live = await launchOrbit({ sessionDir, args: [`orbit://task/${ids!.taskId}`] });
        const expected = `/tasks/${ids!.taskId}`;
        let finalPath: string;
        try {
          finalPath = await waitForPath(live.page, (p) => p === expected, 8_000);
        } catch {
          const u = new URL(live.page.url());
          finalPath = u.pathname + u.search;
        }
        if (finalPath !== expected) {
          const all = live.shellLog();
          let lastStart = -1;
          all.forEach((l, i) => {
            if (l['op'] === 'start' && l['subsystem'] === 'process') lastStart = i;
          });
          console.log(`LOST on run ${run}; ordered log of the losing process:`);
          for (const l of all.slice(lastStart)) {
            console.log(
              '  ' +
                JSON.stringify({
                  ts: l['ts'],
                  subsystem: l['subsystem'],
                  op: l['op'],
                  fields: l['fields'],
                }),
            );
          }
          await live.close();
          removeSession(sessionDir);
          live = null;
          return; // captured
        }
        await live.close();
        removeSession(sessionDir);
        live = null;
      }
      console.log(`no loss in ${cap} runs`);
      expect(true).toBe(true);
    },
    25 * 40_000,
  );
});
