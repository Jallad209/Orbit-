import { expect as pw } from '@playwright/test';
import { afterEach, describe, expect, it } from 'vitest';
import { launchOrbit, removeSession, waitForPath, type LaunchedOrbit } from './coldLaunch';
import { seedKnownDataset, type SeededIds } from './seedDb';

/**
 * Cold activation on the real desktop binary: the process is started with an
 * `orbit://` URI as an argument, exactly as the Windows protocol handler and a
 * notification click do when Orbit is not already running. Covers a missing
 * record on a fresh install, a populated install opening the record, and — after
 * first run — a bill, a commitment, a deleted record, and a malformed argument.
 *
 * This is the regression test for PD-001 (cold activation was silently dropped
 * on a fraction of launches): every launch below must reach the named record or
 * the safe missing page, never Today. It replaces the WDIO cold spec, which
 * could not pass a verbatim `orbit://` argv (Edge WebDriver rewrites args as
 * `--<arg>`). Windows only; skipped elsewhere.
 */
const describeWindows = process.platform === 'win32' ? describe : describe.skip;

let live: LaunchedOrbit | null = null;
const sessions: string[] = [];

afterEach(async () => {
  await live?.close();
  live = null;
  if (process.env.ORBIT_KEEP_SESSIONS) return;
  while (sessions.length) removeSession(sessions.pop()!);
});

async function pending(orbit: LaunchedOrbit): Promise<number> {
  return orbit.page.evaluate(async () => {
    const internal = (
      window as unknown as {
        __TAURI_INTERNALS__: { invoke(n: string, a?: object): Promise<number> };
      }
    ).__TAURI_INTERNALS__;
    return internal.invoke('resident_activation_pending', {});
  });
}

async function finishFirstRun(orbit: LaunchedOrbit) {
  const start = orbit.page.getByRole('button', { name: 'Start planning' });
  await start.waitFor({ state: 'visible', timeout: 30_000 });
  await start.click();
}

/** Wait for the expected path; on timeout return where the app actually is, so the failure names it. */
async function settleOn(
  orbit: LaunchedOrbit,
  expected: string,
  timeoutMs = 15_000,
): Promise<string> {
  try {
    return await waitForPath(orbit.page, (p) => p === expected, timeoutMs);
  } catch {
    const u = new URL(orbit.page.url());
    return u.pathname + u.search;
  }
}

/** Shell events of one op recorded after the most recent process start (the log folder is per session). */
function sinceLastLaunch(orbit: LaunchedOrbit, op: RegExp): Array<Record<string, unknown>> {
  const all = orbit.shellLog();
  let lastStart = -1;
  all.forEach((l, i) => {
    if (l['op'] === 'start' && l['subsystem'] === 'process') lastStart = i;
  });
  return all.slice(lastStart + 1).filter((l) => op.test(String(l['op'] ?? '')));
}

function launchField(orbit: LaunchedOrbit): string[] {
  return orbit.shellLog(/^launch$/).map((l) => (l['fields'] as { launch: string }).launch);
}

describeWindows('cold activation (direct launch)', () => {
  it('a missing record on a fresh install lands on the missing page once first run is finished', async () => {
    const id = '00000000-0000-7000-8000-0000000000e2';
    live = await launchOrbit({ args: [`orbit://task/${id}`] });
    sessions.push(live.sessionDir);
    await live.page.getByRole('heading', { name: 'Welcome to Orbit' }).waitFor({ timeout: 30_000 });
    expect(launchField(live)).toEqual(['activate']);
    await finishFirstRun(live);
    expect(await settleOn(live, `/missing?type=task&id=${id}`)).toBe(`/missing?type=task&id=${id}`);
    await pw(live.page.getByText(/no longer exists/)).toBeVisible();
    const activate = live.shellLog(/^activate$/);
    expect(activate.length).toBeGreaterThanOrEqual(1);
    expect((activate[0]!['fields'] as { kind: string }).kind).toBe('task');
    // Only the kind reaches the log, never the id.
    expect(JSON.stringify(activate)).not.toContain(id);
  });

  it('a task activation on a populated fresh install opens the task after first run', async () => {
    let ids: SeededIds | null = null;
    // Seed the install first (no args), then relaunch cold with the seeded id.
    live = await launchOrbit({
      seed: async (_dir, db) => {
        ids = await seedKnownDataset(db);
      },
    });
    const sessionDir = live.sessionDir;
    sessions.push(sessionDir);
    await live.close();
    live = await launchOrbit({ sessionDir, args: [`orbit://task/${ids!.taskId}`] });
    await live.page.getByRole('heading', { name: 'Welcome to Orbit' }).waitFor({ timeout: 30_000 });
    await finishFirstRun(live);
    expect(await settleOn(live, `/tasks/${ids!.taskId}`)).toBe(`/tasks/${ids!.taskId}`);
    await pw(live.page.getByText('Cold-launch task')).toBeVisible({ timeout: 10_000 });
  });

  it('after first run, bill / commitment / deleted / malformed activations each resolve correctly cold', async () => {
    let ids: SeededIds | null = null;
    live = await launchOrbit({
      seed: async (_dir, db) => {
        ids = await seedKnownDataset(db);
      },
    });
    const sessionDir = live.sessionDir;
    sessions.push(sessionDir);
    await finishFirstRun(live);
    await waitForPath(live.page, (p) => p === '/today', 15_000);
    await live.close();

    live = await launchOrbit({ sessionDir, args: [`orbit://bill/${ids!.billId}`] });
    expect(await settleOn(live, `/bills/${ids!.billId}`)).toBe(`/bills/${ids!.billId}`);
    await pw(live.page.getByText('Cold-launch bill')).toBeVisible({ timeout: 10_000 });
    await live.close();

    live = await launchOrbit({ sessionDir, args: [`orbit://commitment/${ids!.commitmentId}`] });
    expect(await settleOn(live, `/people/${ids!.personId}?commitment=${ids!.commitmentId}`)).toBe(
      `/people/${ids!.personId}?commitment=${ids!.commitmentId}`,
    );
    await live.close();

    live = await launchOrbit({ sessionDir, args: [`orbit://task/${ids!.deletedTaskId}`] });
    expect(await settleOn(live, `/missing?type=task&id=${ids!.deletedTaskId}`)).toBe(
      `/missing?type=task&id=${ids!.deletedTaskId}`,
    );
    await live.close();

    // A malformed argument is a manual launch: Today, no activate event, nothing pending.
    live = await launchOrbit({
      sessionDir,
      args: ['orbit://task/not-a-uuid', 'javascript:alert(1)'],
    });
    expect(await settleOn(live, '/today')).toBe('/today');
    await new Promise((r) => setTimeout(r, 1500)); // give a wrong activation time to show itself
    expect(new URL(live.page.url()).pathname).toBe('/today');
    expect(launchField(live).at(-1)).toBe('manual');
    expect(sinceLastLaunch(live, /^activate$/).length).toBe(0);
    expect(await pending(live)).toBe(0);
  });
});
