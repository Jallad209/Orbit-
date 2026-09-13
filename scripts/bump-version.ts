/**
 * Bump the app version in every file that carries it, together:
 *   package.json (root and apps/orbit), tauri.conf.json, Cargo.toml.
 *
 *   pnpm run bump -- 0.1.0-alpha.1
 *   pnpm run bump -- patch | minor | major
 *
 * Prints the new version. Commit and tag afterwards:
 *   git commit -am "chore: release v0.1.0-alpha.1" && git tag v0.1.0-alpha.1
 */
import { readFileSync, writeFileSync } from 'node:fs';

const arg = process.argv[2];
if (!arg) {
  console.error('usage: pnpm run bump -- <version | patch | minor | major>');
  process.exit(1);
}

const ROOT_PKG = 'package.json';
const APP_PKG = 'apps/orbit/package.json';
const TAURI_CONF = 'apps/orbit/src-tauri/tauri.conf.json';
const CARGO = 'apps/orbit/src-tauri/Cargo.toml';

const current = (JSON.parse(readFileSync(ROOT_PKG, 'utf8')) as { version: string }).version;

function next(from: string, spec: string): string {
  if (!['patch', 'minor', 'major'].includes(spec)) {
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(spec)) {
      throw new Error(`not a semver version: ${spec}`);
    }
    return spec;
  }
  const [core] = from.split('-');
  const [major, minor, patch] = core!.split('.').map(Number) as [number, number, number];
  if (spec === 'major') return `${major + 1}.0.0`;
  if (spec === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const version = next(current, arg);

function editJson(file: string) {
  const json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  json.version = version;
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
}

editJson(ROOT_PKG);
editJson(APP_PKG);
editJson(TAURI_CONF);

// Cargo.toml: only the [package] version line, which comes first.
const cargo = readFileSync(CARGO, 'utf8');
const replaced = cargo.replace(/^version = "[^"]+"/m, `version = "${version}"`);
if (replaced === cargo) throw new Error('could not find the version line in Cargo.toml');
writeFileSync(CARGO, replaced);

console.log(`${current} → ${version}`);
console.log(`files: ${ROOT_PKG}, ${APP_PKG}, ${TAURI_CONF}, ${CARGO}`);
