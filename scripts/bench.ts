/**
 * Engine benchmarks with budgets and regression detection.
 *
 *   pnpm run bench                 # run, compare with this machine's entry in bench/baseline.json
 *   pnpm run bench -- --update     # run and write this machine's entry
 *   pnpm run bench -- --tolerance 40
 *   pnpm run bench -- --adopt bench-results/results.json   # fold in a CI run's artifact
 *
 * Every benchmark has an absolute budget (from DEVOPS-TASKS week 6) and a
 * committed baseline mean. The run fails when a mean is over budget or more
 * than `tolerance` percent slower than the baseline. Results go to
 * bench/results.json and, in CI, to the job summary.
 *
 * The search entries (week 10) run the real MiniSearch service over a
 * 50,000-task / 5,000-note world: one query, and the one-off index build
 * whose cost is why the app warms the index after the first paint.
 *
 * The insights entry (week 11) is the real `computeInsights`: indexing, all
 * five detectors, and complete evidence construction over the same world.
 * The shared-health entry keeps the older helper workload beside it so a
 * regression in either shows on its own line.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Bench } from 'tinybench';
import {
  BlockSchema,
  DEFAULT_INSIGHT_SETTINGS,
  addDays,
  buildProjectActivity,
  createRecord,
  computeAreaAttention,
  computeGoalAttention,
  computeInsights,
  computeProjectHealth,
  expandRecurrence,
  fixedClock,
  parseCapture,
  planDay,
  seedWorld,
} from '@orbit/core';
import { createMemoryRepository } from '@orbit/storage';
import { createMiniSearchService } from '@orbit/storage/search/minisearch';
import { prepareAdapterBenchEntries } from '../bench/adapters.bench';

interface Entry {
  name: string;
  budgetMs: number;
  fn: () => unknown;
  /** Seconds-long work: a few samples rather than the usual 64. */
  heavy?: boolean;
}

const BASELINE_PATH = 'bench/baseline.json';
const RESULTS_PATH = 'bench/results.json';
const update = process.argv.includes('--update');
const tolIdx = process.argv.indexOf('--tolerance');
const tolerance = tolIdx === -1 ? 25 : Number(process.argv[tolIdx + 1]);
const adoptIdx = process.argv.indexOf('--adopt');

/**
 * Baselines are per machine: a mean recorded on the developer's laptop says nothing about
 * a CI runner, so the regression check only compares against a baseline recorded on the
 * same platform, architecture, and Node major. Budgets are absolute and always enforced.
 */
const MACHINE = `${process.platform} ${process.arch} node ${process.version.split('.')[0]}`;

interface MachineBaseline {
  at: string;
  results: Record<string, Result>;
}
interface Baseline {
  note: string;
  machines: Record<string, MachineBaseline>;
}

function readBaseline(): Baseline {
  const note =
    'Means in ms, one entry per machine. Add or refresh this machine with `pnpm run bench -- --update`; fold in a CI run with `pnpm run bench -- --adopt <bench-results/results.json>`.';
  if (!existsSync(BASELINE_PATH)) return { note, machines: {} };
  const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Partial<Baseline> & {
    machine?: string;
    at?: string;
    results?: Record<string, Result>;
  };
  if (raw.machines) return { note, machines: raw.machines };
  // The single-machine format from before week 13.
  const key = raw.machine ? raw.machine.replace(/node v(\d+)\.\d+\.\d+/, 'node v$1') : MACHINE;
  return { note, machines: { [key]: { at: raw.at ?? '', results: raw.results ?? {} } } };
}

function writeBaseline(baseline: Baseline) {
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
}

if (adoptIdx !== -1) {
  const file = process.argv[adoptIdx + 1];
  if (!file) throw new Error('--adopt needs a results.json path');
  const run = JSON.parse(readFileSync(file, 'utf8')) as {
    machine?: string;
    at: string;
    results: Record<string, Result>;
  };
  if (!run.machine)
    throw new Error(`${file} has no machine field; it predates per-machine baselines`);
  const adopted = readBaseline();
  adopted.machines[run.machine] = { at: run.at, results: run.results };
  writeBaseline(adopted);
  console.log(`baseline for ${run.machine} adopted from ${file}`);
  process.exit(0);
}

const clock = fixedClock(new Date(2026, 8, 12, 9, 0, 0));
console.log('seeding worlds…');
const planWorld = seedWorld({ seed: 7, sizes: { tasks: 3700 } }); // ≈2,050 open tasks
const bigWorld = seedWorld({ seed: 11, sizes: { tasks: 50_000, notes: 5_000, days: 120 } });
const now = clock.now();
const health = {
  milestones: bigWorld.milestones,
  tasks: bigWorld.tasks,
  sessions: bigWorld.sessions,
  now,
};
const attention = { ...bigWorld, now };
const routines = bigWorld.routines;
const activity = buildProjectActivity(bigWorld);

// The seeded world is healthy, so on its own the engine would return nothing and the
// benchmark would skip the evidence construction it exists to measure. Push it over every
// threshold: run 20 days later (every project stale, the last 30 days of completions in
// the estimate window), record every completed task at 1.6× its estimate (hundreds of
// sample rows per area), give every area a 40 h target (the weekly deficit), and book
// forty overlapping blocks on each of the seven days ahead (seven overloaded days).
const insightClock = fixedClock(new Date(now.getTime() + 20 * 86_400_000));
const insightToday = new Date(
  insightClock.now().getFullYear(),
  insightClock.now().getMonth(),
  insightClock.now().getDate(),
);
const insightDate = (offset: number) =>
  addDays(
    `${insightToday.getFullYear()}-${String(insightToday.getMonth() + 1).padStart(2, '0')}-${String(insightToday.getDate()).padStart(2, '0')}`,
    offset,
  );
const openTasks = bigWorld.tasks.filter((t) => t.status === 'open').slice(0, 40);
const overloadBlocks = Array.from({ length: 7 }, (_, day) =>
  openTasks.map((t, i) =>
    createRecord(BlockSchema, insightClock, {
      date: insightDate(day),
      startMin: 540 + (i % 8) * 60,
      endMin: 540 + (i % 8) * 60 + 60,
      taskId: t.id,
      source: 'manual',
    }),
  ),
).flat();
const insightWorld = {
  ...bigWorld,
  areas: bigWorld.areas.map((a) => ({ ...a, weeklyHoursTarget: 40 })),
  tasks: bigWorld.tasks.map((t) =>
    t.status === 'done' && t.completedAt && t.estimateMin > 0
      ? { ...t, actualMin: Math.round(t.estimateMin * 1.6) }
      : t,
  ),
  blocks: [...bigWorld.blocks, ...overloadBlocks],
};
const insightInput = {
  snapshot: insightWorld,
  settings: DEFAULT_INSIGHT_SETTINGS,
  planning: {
    workingWindow: { startMin: 540, endMin: 1080 },
    restBoundaries: [{ startMin: 750, endMin: 795 }],
    defaultEstimateMin: 30,
  },
  clock: insightClock,
};
{
  const probe = computeInsights(insightInput);
  const rows = probe.insights.reduce((n, i) => n + i.evidence.length, 0);
  console.log(
    `insights world: ${probe.insights.length} insights (${probe.coverage.map((c) => `${c.kind} ${c.emitted}`).join(', ')}), ${rows} evidence rows`,
  );
}

// The search index over the big world, built once; the query benchmark
// runs against it, the build benchmark rebuilds it from a fresh service.
console.log('building the search index…');
const searchRepo = createMemoryRepository({ clock });
await searchRepo.transaction(async (tx) => {
  for (const a of bigWorld.areas) await tx.areas.upsert(a, { preserveUpdatedAt: true });
  for (const p of bigWorld.projects) await tx.projects.upsert(p, { preserveUpdatedAt: true });
  for (const t of bigWorld.tasks) await tx.tasks.upsert(t, { preserveUpdatedAt: true });
  for (const n of bigWorld.notes) await tx.notes.upsert(n, { preserveUpdatedAt: true });
  for (const p of bigWorld.people) await tx.people.upsert(p, { preserveUpdatedAt: true });
});
const search = createMiniSearchService({ repo: searchRepo });
const buildStart = performance.now();
await search.ready();
const buildMs = performance.now() - buildStart;
const serialized = search.serialize();
const loadStart = performance.now();
createMiniSearchService({ repo: searchRepo, serialized });
const loadMs = performance.now() - loadStart;
console.log(
  `index: ${search.stats().documents} documents, built in ${buildMs.toFixed(0)} ms, ` +
    `loaded from ${(serialized.length / 1024 / 1024).toFixed(1)} MB of JSON in ${loadMs.toFixed(0)} ms`,
);

const entries: Entry[] = [
  {
    name: 'planner: planDay, 2k open tasks',
    budgetMs: 50,
    fn: () => planDay(planWorld, '2026-09-14', { energy: 'medium' }, clock),
  },
  {
    name: 'search: minisearch query, 50k tasks + 5k notes',
    budgetMs: 30,
    fn: () => search.search('review the', undefined, 20),
  },
  {
    name: 'search: rebuild index, 55k documents',
    budgetMs: 5000,
    heavy: true,
    fn: () => {
      const fresh = createMiniSearchService({ repo: searchRepo });
      return fresh.ready();
    },
  },
  {
    name: 'insights: computeInsights, five detectors + evidence, 50k world',
    budgetMs: 200,
    fn: () => {
      const report = computeInsights(insightInput);
      // Evidence is built in full for every emitted insight; keep the result alive.
      return report.insights.reduce((n, i) => n + i.evidence.length, 0);
    },
  },
  {
    name: 'insights: shared health + attention, 50k world',
    budgetMs: 200,
    fn: () => {
      for (const p of bigWorld.projects) computeProjectHealth(p, { ...health, activity });
      for (const g of bigWorld.goals) computeGoalAttention(g, attention);
      for (const a of bigWorld.areas) computeAreaAttention(a, attention);
    },
  },
  {
    name: 'recurrence: one year of routines',
    budgetMs: 20,
    fn: () => {
      for (const r of routines)
        expandRecurrence(r.recurrence, '2026-01-01', { from: '2026-01-01', to: '2026-12-31' });
      for (let i = 0; i < 50; i++)
        expandRecurrence(
          {
            freq: 'weekly',
            interval: 1,
            byDay: ['MO', 'WE', 'FR'],
            byMonthDay: null,
            count: null,
            until: null,
          },
          '2026-01-01',
          { from: '2026-01-01', to: '2026-12-31' },
        );
    },
  },
  {
    name: 'capture: parse 100 phrases',
    budgetMs: 30,
    fn: () => {
      const ctx = { now, people: ['Omar', 'Sara'], projects: ['Thesis'] };
      for (let i = 0; i < 100; i++)
        parseCapture('Pay electricity bill $120 every month starting next Friday at 5pm', ctx);
    },
  },
];

console.log('seeding SQLite and IndexedDB adapter worlds…');
entries.push(...(await prepareAdapterBenchEntries()));

const bench = new Bench({ time: 800, warmupTime: 200 });
const heavy = new Bench({ time: 0, iterations: 3, warmupTime: 0, warmupIterations: 1 });
for (const e of entries) (e.heavy ? heavy : bench).add(e.name, e.fn);
await bench.run();
await heavy.run();

interface Result {
  meanMs: number;
  p99Ms: number;
  samples: number;
}
const results: Record<string, Result> = {};
for (const task of [...bench.tasks, ...heavy.tasks]) {
  const r = task.result;
  if (!r || r.state !== 'completed') throw new Error(`benchmark failed: ${task.name}`);
  results[task.name] = {
    meanMs: r.latency.mean,
    p99Ms: r.latency.p99,
    samples: r.latency.samples?.length ?? 0,
  };
}

const stored = readBaseline();
const baseline: Record<string, Result> = stored.machines[MACHINE]?.results ?? {};
const comparing = MACHINE in stored.machines;

const rows: string[] = [];
let failed = false;
for (const e of entries) {
  const r = results[e.name]!;
  const base = baseline[e.name];
  const delta = base ? ((r.meanMs - base.meanMs) / base.meanMs) * 100 : null;
  const overBudget = r.meanMs > e.budgetMs;
  const regressed = delta !== null && delta > tolerance;
  if (overBudget || regressed) failed = true;
  const status = overBudget ? '❌ over budget' : regressed ? '❌ regression' : '✅';
  rows.push(
    `| ${e.name} | ${r.meanMs.toFixed(2)} | ${r.p99Ms.toFixed(2)} | ${e.budgetMs} | ${
      base ? base.meanMs.toFixed(2) : '—'
    } | ${delta === null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}%`} | ${status} |`,
  );
}
const heading = comparing
  ? `Machine \`${MACHINE}\`; regression tolerance ${tolerance} % against its baseline.`
  : `No baseline for \`${MACHINE}\`: budgets enforced, regression check skipped. Add one with \`pnpm run bench -- --update\` on this machine, or \`--adopt\` the CI artifact.`;
const table = [
  heading,
  '',
  '| Benchmark | mean ms | p99 ms | budget ms | baseline ms | Δ | status |',
  '|---|---:|---:|---:|---:|---:|---|',
  ...rows,
].join('\n');
console.log('\n' + table + '\n');

writeFileSync(
  RESULTS_PATH,
  JSON.stringify({ machine: MACHINE, at: new Date().toISOString(), results }, null, 2) + '\n',
);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Engine benchmarks\n\n${table}\n`);
}

if (update) {
  stored.machines[MACHINE] = { at: new Date().toISOString(), results };
  writeBaseline(stored);
  console.log(`baseline for ${MACHINE} written to ${BASELINE_PATH}`);
} else if (failed) {
  console.error(`benchmark check failed (tolerance ${tolerance}%)`);
  process.exit(1);
}
