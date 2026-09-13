/**
 * Engine benchmarks with budgets and regression detection.
 *
 *   pnpm run bench                 # run, compare with bench/baseline.json
 *   pnpm run bench -- --update     # run and rewrite the baseline
 *   pnpm run bench -- --tolerance 40
 *
 * Every benchmark has an absolute budget (from DEVOPS-TASKS week 6) and a
 * committed baseline mean. The run fails when a mean is over budget or more
 * than `tolerance` percent slower than the baseline. Results go to
 * bench/results.json and, in CI, to the job summary.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Bench } from 'tinybench';
import {
  computeAreaAttention,
  computeGoalAttention,
  computeProjectHealth,
  expandRecurrence,
  fixedClock,
  parseCapture,
  planDay,
  seedWorld,
} from '@orbit/core';

interface Entry {
  name: string;
  budgetMs: number;
  fn: () => void;
}

const BASELINE_PATH = 'bench/baseline.json';
const RESULTS_PATH = 'bench/results.json';
const update = process.argv.includes('--update');
const tolIdx = process.argv.indexOf('--tolerance');
const tolerance = tolIdx === -1 ? 25 : Number(process.argv[tolIdx + 1]);

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

const entries: Entry[] = [
  {
    name: 'planner: planDay, 2k open tasks',
    budgetMs: 50,
    fn: () => planDay(planWorld, '2026-09-14', { energy: 'medium' }, clock),
  },
  {
    name: 'search: title scan, 50k tasks',
    budgetMs: 30,
    fn: () => {
      const q = 'review the';
      let n = 0;
      for (const t of bigWorld.tasks) if (t.title.toLowerCase().includes(q)) n++;
      return n;
    },
  },
  {
    name: 'insights: health + attention, 50k world',
    budgetMs: 200,
    fn: () => {
      for (const p of bigWorld.projects) computeProjectHealth(p, health);
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

const bench = new Bench({ time: 800, warmupTime: 200 });
for (const e of entries) bench.add(e.name, e.fn);
await bench.run();

interface Result {
  meanMs: number;
  p99Ms: number;
  samples: number;
}
const results: Record<string, Result> = {};
for (const task of bench.tasks) {
  const r = task.result;
  if (!r || r.state !== 'completed') throw new Error(`benchmark failed: ${task.name}`);
  results[task.name] = {
    meanMs: r.latency.mean,
    p99Ms: r.latency.p99,
    samples: r.latency.samples?.length ?? 0,
  };
}

const baseline: Record<string, Result> = existsSync(BASELINE_PATH)
  ? (JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as { results: Record<string, Result> }).results
  : {};

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
const table = [
  '| Benchmark | mean ms | p99 ms | budget ms | baseline ms | Δ | status |',
  '|---|---:|---:|---:|---:|---:|---|',
  ...rows,
].join('\n');
console.log('\n' + table + '\n');

writeFileSync(
  RESULTS_PATH,
  JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + '\n',
);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Engine benchmarks\n\n${table}\n`);
}

if (update) {
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify(
      {
        note: 'Means in ms. Regenerate with `pnpm run bench -- --update` on the reference machine.',
        machine: `${process.platform} ${process.arch} node ${process.version}`,
        at: new Date().toISOString(),
        results,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`baseline written to ${BASELINE_PATH}`);
} else if (failed) {
  console.error(`benchmark check failed (tolerance ${tolerance}%)`);
  process.exit(1);
}
