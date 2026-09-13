import { expect, test } from 'vitest';
import { fixedClock, planDay, seedWorld } from '../src';

/**
 * Budget from BACKEND-TASKS week 5: planDay < 50 ms with 2,000 open tasks.
 * Vitest runs benchmark files in their own mode: `pnpm run bench:planner`.
 */
const clock = fixedClock(new Date(2026, 8, 12, 9, 0, 0));
const BUDGET_MS = 50;

test('planDay stays inside its budget with 2,000 open tasks', async ({ bench }) => {
  const world = seedWorld({ seed: 7, sizes: { tasks: 3700 } });
  const open = world.tasks.filter((t) => t.status === 'open').length;
  expect(open).toBeGreaterThanOrEqual(2000);

  const results = await bench.compare(
    bench('medium-energy weekday', () => {
      planDay(world, '2026-09-14', { energy: 'medium' }, clock);
    }),
    bench('low-energy day with rest boundaries', () => {
      planDay(
        world,
        '2026-09-15',
        { energy: 'low', restBoundaries: [{ startMin: 750, endMin: 810 }] },
        clock,
      );
    }),
  );
  for (const name of ['medium-energy weekday', 'low-energy day with rest boundaries'] as const) {
    const r = results.get(name);
    console.log(`${name}: mean ${r.latency.mean.toFixed(2)} ms`);
    expect(r.latency.mean).toBeLessThan(BUDGET_MS);
  }
});
