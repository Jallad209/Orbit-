/**
 * Campaign stage runner. Runs one command, tees its output to a log file, and
 * appends {stage, command, exitCode, durationMs, log} to a results JSON so the
 * report can cite every exit status. Never retries; a retry is a new stage.
 *
 * Usage: pnpm exec tsx tests/campaign/run-stage.ts <results.json> <stage-id> -- <command...>
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [resultsPath, stage, dashes, ...cmd] = process.argv.slice(2);
if (!resultsPath || !stage || dashes !== '--' || cmd.length === 0) {
  console.error('usage: run-stage <results.json> <stage-id> -- <command...>');
  process.exit(2);
}
const logDir = join(dirname(resultsPath), 'logs');
mkdirSync(logDir, { recursive: true });
const logPath = join(logDir, `${stage}.log`);

const started = Date.now();
const startedAt = new Date(started).toISOString();
const res = spawnSync(cmd[0]!, cmd.slice(1), {
  cwd: process.cwd(),
  shell: true,
  encoding: 'utf8',
  env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  maxBuffer: 256 * 1024 * 1024,
});
const durationMs = Date.now() - started;
const output = `$ ${cmd.join(' ')}\n# started ${startedAt}\n\n${res.stdout ?? ''}\n${res.stderr ?? ''}\n# exit ${res.status ?? 'signal:' + res.signal} after ${durationMs} ms\n`;
writeFileSync(logPath, output);

const entry = {
  stage,
  command: cmd.join(' '),
  startedAt,
  durationMs,
  exitCode: res.status,
  signal: res.signal,
  log: logPath.split('\\').join('/'),
};
const results: unknown[] = existsSync(resultsPath)
  ? JSON.parse(readFileSync(resultsPath, 'utf8'))
  : [];
results.push(entry);
writeFileSync(resultsPath, JSON.stringify(results, null, 2));
process.stdout.write(`[${stage}] exit=${entry.exitCode} ${durationMs} ms -> ${logPath}\n`);
// Show the tail so the caller sees failures without opening the log.
const tail = (res.stdout + '\n' + res.stderr).split('\n').filter(Boolean).slice(-25).join('\n');
process.stdout.write(tail + '\n');
process.exit(res.status ?? 1);
