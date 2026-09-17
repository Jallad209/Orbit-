/**
 * Campaign snapshot: records exactly what is under test so every result in
 * the report can be tied to a source revision, working-tree state, and
 * toolchain. Test-only; never imported by the app.
 *
 * Usage: pnpm exec tsx tests/campaign/snapshot.ts <out.json>
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const sh = (cmd: string) => {
  try {
    return execSync(cmd, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};

const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

const sourceGlobs = sh('git ls-files -- apps packages tests scripts bench "*.json" "*.ts" "*.toml"')
  .split('\n')
  .filter((f) => f && existsSync(join(root, f)) && statSync(join(root, f)).isFile());
const untracked = sh('git ls-files --others --exclude-standard')
  .split('\n')
  .filter((f) => f && !f.startsWith('docs/') && existsSync(join(root, f)));

const fileHashes: Record<string, string> = {};
for (const f of [...sourceGlobs, ...untracked]) fileHashes[f] = sha256(join(root, f));
const treeDigest = createHash('sha256')
  .update(
    Object.entries(fileHashes)
      .sort()
      .map(([k, v]) => `${k}:${v}`)
      .join('\n'),
  )
  .digest('hex');

const artifact = (p: string) =>
  existsSync(p)
    ? {
        path: p,
        sha256: sha256(p),
        bytes: statSync(p).size,
        mtime: statSync(p).mtime.toISOString(),
      }
    : null;

const snapshot = {
  capturedAt: new Date().toISOString(),
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  locale: Intl.DateTimeFormat().resolvedOptions().locale,
  git: {
    head: sh('git rev-parse HEAD'),
    branch: sh('git rev-parse --abbrev-ref HEAD'),
    modified: sh('git diff --name-only').split('\n').filter(Boolean),
    staged: sh('git diff --cached --name-only').split('\n').filter(Boolean),
    untracked,
    diffDigest: createHash('sha256').update(sh('git diff')).digest('hex'),
  },
  versions: {
    app: JSON.parse(readFileSync(join(root, 'apps/orbit/package.json'), 'utf8')).version,
    node: process.version,
    pnpm: sh('pnpm -v'),
    rustc: sh('rustc -V'),
    cargo: sh('cargo -V'),
    playwright: sh('pnpm exec playwright --version'),
    tauriDriver: sh('tauri-driver --version'),
    os: `${process.platform} ${sh('cmd /c ver')}`,
  },
  artifacts: {
    orbitExe: artifact(join(root, 'apps/orbit/src-tauri/target/release/orbit.exe')),
    distIndex: artifact(join(root, 'apps/orbit/dist/index.html')),
    distSw: artifact(join(root, 'apps/orbit/dist/sw.js')),
  },
  sourceTreeDigest: treeDigest,
  sourceFileCount: Object.keys(fileHashes).length,
  fileHashes,
};

const out = process.argv[2] ?? 'snapshot.json';
writeFileSync(out, JSON.stringify(snapshot, null, 2));
console.log(
  `head=${snapshot.git.head} tree=${treeDigest.slice(0, 16)} files=${snapshot.sourceFileCount} -> ${out}`,
);
