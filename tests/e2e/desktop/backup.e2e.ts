import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { launchOrbit, removeSession, waitForPath, type LaunchedOrbit } from './coldLaunch';
import { seedKnownDataset } from './seedDb';

const describeWindows = process.platform === 'win32' ? describe : describe.skip;

function createdDaily(app: LaunchedOrbit) {
  return app
    .shellLog(/^created$/)
    .filter(
      (line) =>
        line['subsystem'] === 'backup' &&
        (line['fields'] as { kind?: string } | undefined)?.kind === 'daily',
    );
}

async function waitForDaily(app: LaunchedOrbit) {
  const deadline = Date.now() + 30_000;
  while (createdDaily(app).length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describeWindows('desktop scheduled backup', () => {
  let app: LaunchedOrbit | null = null;
  let sessionDir: string | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
    if (sessionDir && !process.env.ORBIT_KEEP_SESSIONS) removeSession(sessionDir);
    sessionDir = null;
  });

  it('creates one verified daily and weekly snapshot, then does not duplicate it on relaunch', async () => {
    app = await launchOrbit({
      seed: async (_dataDir, dbPath) => {
        await seedKnownDataset(dbPath);
      },
    });
    sessionDir = app.sessionDir;
    const start = app.page.getByRole('button', { name: 'Start planning' });
    await start.waitFor({ state: 'visible', timeout: 30_000 });
    await start.click();
    await waitForPath(app.page, (path) => path === '/today', 30_000);
    await waitForDaily(app);

    const today = new Date().toISOString().slice(0, 10);
    const backups = join(app.dataDir, 'backups');
    expect(createdDaily(app)).toHaveLength(1);
    expect(existsSync(join(backups, `daily-${today}.db`))).toBe(true);
    expect(readdirSync(backups).some((name) => name.startsWith('weekly-'))).toBe(true);

    await app.close();
    app = await launchOrbit({ sessionDir });
    await waitForPath(app.page, (path) => path === '/today', 30_000);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(createdDaily(app)).toHaveLength(1);
  });
});
