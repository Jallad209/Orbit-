// Bundle budget: fails when the gzipped JS exceeds the hard cap or grows more
// than 20% over the committed baseline. Also verifies the PWA artefacts exist.
// Usage: node scripts/check-bundle.mjs [--update]
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = new URL('../apps/orbit/dist/', import.meta.url);
const BASELINE = new URL('../bench/bundle-baseline.json', import.meta.url);
const HARD_CAP_KB = 600;
const GROWTH_LIMIT = 0.2;

const dist = DIST.pathname.replace(/^\/([A-Za-z]:)/, '$1');
if (!existsSync(dist)) {
  console.error('dist/ not found. Run `pnpm --filter orbit run build` first.');
  process.exit(1);
}

const assets = join(dist, 'assets');
let jsGzip = 0;
let cssGzip = 0;
const rows = [];
for (const file of readdirSync(assets)) {
  const path = join(assets, file);
  const raw = statSync(path).size;
  if (file.endsWith('.js')) {
    const gz = gzipSync(readFileSync(path)).length;

    jsGzip += gz;
    rows.push([file, raw, gz]);
  } else if (file.endsWith('.css')) {
    cssGzip += gzipSync(readFileSync(path)).length;
  }
}
rows.sort((a, b) => b[2] - a[2]);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log('JS chunks (gzip):');
for (const [file, raw, gz] of rows.slice(0, 8))
  console.log(`  ${kb(gz).padStart(9)}  ${file}  (raw ${kb(raw)})`);
console.log(`Total JS gzip: ${kb(jsGzip)}   CSS gzip: ${kb(cssGzip)}`);

const problems = [];
for (const required of [
  'manifest.webmanifest',
  'sw.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
]) {
  if (!existsSync(join(dist, required))) problems.push(`missing PWA artefact: ${required}`);
}
if (jsGzip > HARD_CAP_KB * 1024)
  problems.push(`JS gzip ${kb(jsGzip)} exceeds the ${HARD_CAP_KB} KB cap`);

const update = process.argv.includes('--update');
let baseline = null;
if (existsSync(BASELINE)) baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
if (baseline && !update) {
  const growth = jsGzip / baseline.jsGzip - 1;
  console.log(`Baseline: ${kb(baseline.jsGzip)}  change: ${(growth * 100).toFixed(1)}%`);
  if (growth > GROWTH_LIMIT) {
    problems.push(
      `JS gzip grew ${(growth * 100).toFixed(1)}% over the baseline (limit ${GROWTH_LIMIT * 100}%). ` +
        'If intended, run `node scripts/check-bundle.mjs --update` and commit bench/bundle-baseline.json.',
    );
  }
}
if (update || !baseline) {
  writeFileSync(
    BASELINE,
    `${JSON.stringify({ jsGzip, cssGzip, updatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  console.log(`Baseline ${baseline ? 'updated' : 'created'}: bench/bundle-baseline.json`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    '### Web bundle',
    '',
    '| Metric | Size |',
    '| --- | ---: |',
    `| JS (gzip) | ${kb(jsGzip)} |`,
    `| CSS (gzip) | ${kb(cssGzip)} |`,
  ];
  if (baseline && !update) lines.push(`| Baseline | ${kb(baseline.jsGzip)} |`);
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`, { flag: 'a' });
}

if (problems.length) {
  console.error(`\n${problems.map((p) => `✗ ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('✓ bundle within budget');
