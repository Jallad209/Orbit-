/**
 * Generate a large, realistic Orbit export for benchmarks and manual testing.
 *
 *   pnpm run seed -- --tasks 50000 --notes 10000 --days 365 [--out bench/data/seed.json]
 *
 * The file is an ordinary Orbit export (import it from Settings, week 9) and
 * carries sessions, blocks, and day commitments for `--days` of history.
 * Output lives under bench/data/, which git ignores.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fixedClock, seedCount, seedWorld } from '@orbit/core';
import type { BaseRecord } from '@orbit/core';
import { STORE_ORDER, createMemoryRepository, exportJson, serializeExport } from '@orbit/storage';
import type { EntityStore } from '@orbit/storage';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}
function argStr(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : String(process.argv[i + 1]);
}

const tasks = arg('tasks', 50_000);
const notes = arg('notes', 10_000);
const days = arg('days', 365);
const seed = arg('seed', 2026);
const out = argStr('out', `bench/data/seed-${tasks}.json`);

const t0 = performance.now();
const clock = fixedClock('2026-09-12T09:00:00.000Z');
const world = seedWorld({
  seed,
  sizes: {
    tasks,
    notes,
    days,
    projects: Math.max(12, Math.round(tasks / 40)),
    goals: Math.max(8, Math.round(tasks / 200)),
    areas: 6,
    people: Math.max(10, Math.round(tasks / 500)),
    events: Math.max(20, Math.round(days * 1.5)),
  },
});
const generated = performance.now();

const repo = createMemoryRepository({ clock });
await repo.transaction(async (tx) => {
  for (const name of STORE_ORDER) {
    const store = tx[name] as unknown as EntityStore<BaseRecord>;
    for (const rec of world[name]) await store.upsert(rec, { preserveUpdatedAt: true });
  }
});
const envelope = await exportJson(repo, clock);
const text = serializeExport(envelope);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, text);

console.log(
  `wrote ${out}: ${seedCount(world)} records, ${(text.length / 1024 / 1024).toFixed(1)} MB, ` +
    `op-log seq ${envelope.opLogSeq}, generated in ${Math.round(generated - t0)} ms, ` +
    `loaded in ${Math.round(performance.now() - generated)} ms`,
);
