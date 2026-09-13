// Desktop binary budget: fails when orbit.exe grows more than 20 % over the
// committed baseline. Usage: node scripts/check-binary-size.mjs <path-to-exe> [--update]
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const BASELINE = new URL('../bench/binary-baseline.json', import.meta.url);
const GROWTH_LIMIT = 0.2;

const [file, flag] = process.argv.slice(2);
if (!file || !existsSync(file)) {
  console.error('usage: node scripts/check-binary-size.mjs <orbit.exe> [--update]');
  process.exit(1);
}
const bytes = statSync(file).size;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
console.log(`binary: ${mb(bytes)}`);

if (flag === '--update' || !existsSync(BASELINE)) {
  writeFileSync(
    BASELINE,
    JSON.stringify({ bytes, updatedAt: new Date().toISOString() }, null, 2) + '\n',
  );
  console.log('baseline written');
  process.exit(0);
}
const base = JSON.parse(readFileSync(BASELINE, 'utf8')).bytes;
const growth = (bytes - base) / base;
console.log(`baseline: ${mb(base)}  change: ${(growth * 100).toFixed(1)}%`);
if (growth > GROWTH_LIMIT) {
  console.error(`✗ binary grew more than ${GROWTH_LIMIT * 100}% over the baseline`);
  process.exit(1);
}
console.log('✓ binary within budget');
