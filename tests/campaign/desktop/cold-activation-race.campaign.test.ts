import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { launchOrbit, removeSession, waitForPath, type LaunchedOrbit } from './coldLaunch';
import { seedKnownDataset, type SeededIds } from './seedDb';

/**
 * Repeats one cold activation (a bill URI on a finished install) many times
 * and records, per launch, whether the shell queued and emitted it and where
 * the frontend ended up. Every launch is expected to open the bill; a launch
 * that ends on Today after the shell reported `queuedActivation: 1` is an
 * activation lost between the shell's emit and the window's listener.
 */
const REPEATS = Number(process.env.ORBIT_RACE_REPEATS ?? 20);
const EVIDENCE = join('docs', 'testing', 'campaign-2026-09-15', 'evidence');

interface Outcome {
  run: number;
  finalPath: string;
  shellLaunch: string | undefined;
  shellActivateQueued: boolean | undefined;
  shellReadyQueuedActivation: number | undefined;
  msReadyAfterStart: number | undefined;
  spawnToMainPageMs: number;
}

const outcomes: Outcome[] = [];
let sessionDir: string | null = null;

afterAll(() => {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(
    join(EVIDENCE, 'cold-activation-race.json'),
    JSON.stringify({ repeats: REPEATS, outcomes }, null, 2),
  );
  if (sessionDir && !process.env.ORBIT_KEEP_SESSIONS) removeSession(sessionDir);
});

function lastRunEvents(orbit: LaunchedOrbit): Array<Record<string, unknown>> {
  const all = orbit.shellLog();
  let lastStart = -1;
  all.forEach((l, i) => {
    if (l['op'] === 'start' && l['subsystem'] === 'process') lastStart = i;
  });
  return all.slice(lastStart);
}

describe('cold activation race (repeated)', () => {
  it(
    `opens the bill on every one of ${REPEATS} cold launches`,
    async () => {
      let ids: SeededIds | null = null;
      let orbit = await launchOrbit({
        seed: async (_dir, db) => {
          ids = await seedKnownDataset(db);
        },
      });
      sessionDir = orbit.sessionDir;
      const start = orbit.page.getByRole('button', { name: 'Start planning' });
      await start.waitFor({ state: 'visible', timeout: 30_000 });
      await start.click();
      await waitForPath(orbit.page, (p) => p === '/today', 15_000);
      await orbit.close();

      const expected = `/bills/${ids!.billId}`;
      for (let run = 1; run <= REPEATS; run++) {
        orbit = await launchOrbit({ sessionDir, args: [`orbit://bill/${ids!.billId}`] });
        let finalPath: string;
        try {
          finalPath = await waitForPath(orbit.page, (p) => p === expected, 8_000);
        } catch {
          const u = new URL(orbit.page.url());
          finalPath = u.pathname + u.search;
        }
        const events = lastRunEvents(orbit);
        const startTs = events.find((e) => e['op'] === 'start')?.['ts'];
        const launch = events.find((e) => e['op'] === 'launch');
        const activate = events.find((e) => e['op'] === 'activate');
        const ready = events.find((e) => e['op'] === 'ready');
        outcomes.push({
          run,
          finalPath,
          shellLaunch: (launch?.['fields'] as { launch?: string } | undefined)?.launch,
          shellActivateQueued: (activate?.['fields'] as { queued?: boolean } | undefined)?.queued,
          shellReadyQueuedActivation: (
            ready?.['fields'] as { queuedActivation?: number } | undefined
          )?.queuedActivation,
          msReadyAfterStart:
            ready && startTs
              ? new Date(String(ready['ts'])).getTime() - new Date(String(startTs)).getTime()
              : undefined,
          spawnToMainPageMs: orbit.timings.spawnToMainPageMs,
        });
        await orbit.close();
      }
      const lost = outcomes.filter((o) => o.finalPath !== expected);
      console.log(
        `cold activation: ${outcomes.length - lost.length}/${outcomes.length} opened the bill; ` +
          `${lost.length} lost (${lost.map((o) => o.run).join(', ')})`,
      );
      expect(lost).toEqual([]);
    },
    REPEATS * 20_000,
  );
});
