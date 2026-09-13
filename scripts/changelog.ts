/**
 * Changelog from Conventional Commits (DEVOPS-TASKS week 9), via git-cliff.
 *
 *   pnpm run changelog                       # print what is unreleased (review before tagging)
 *   pnpm run changelog:release -- v0.1.0-beta.1
 *       # insert the section for that tag at the top of CHANGELOG.md, keeping
 *       # every hand-edited section below it; then edit the new section by hand
 *
 * The Release workflow renders the same section into the GitHub release body
 * (`git-cliff --current --strip all`), so the notes on the release and in the
 * file start from the same skeleton.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = 'CHANGELOG.md';
const INTRO = `# Changelog

All notable changes to Orbit. Generated from Conventional Commits with git-cliff,
then edited by hand before each release.
`;

function cliff(args: string[]): string {
  // The npm package's JS entry point, run with node: no shell, no platform shim.
  const cli = fileURLToPath(import.meta.resolve('git-cliff/cli'));
  return execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

const [mode, tagArg] = process.argv.slice(2).filter((a) => a !== '--');

if (mode === 'release') {
  const tag = tagArg;
  if (!tag || !/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag)) {
    console.error('usage: pnpm run changelog:release -- v<version>');
    process.exit(1);
  }
  const section = cliff(['--unreleased', '--tag', tag, '--strip', 'all']).trim();
  if (!section) {
    console.error('nothing unreleased: no conventional commits since the last tag');
    process.exit(1);
  }
  const existing = existsSync(FILE) ? readFileSync(FILE, 'utf8') : INTRO;
  const at = existing.indexOf('\n## [');
  const head = at >= 0 ? existing.slice(0, at + 1) : `${existing.trimEnd()}\n`;
  const tail = at >= 0 ? existing.slice(at + 1) : '';
  if (tail.includes(`## [${tag.replace(/^v/, '')}]`)) {
    console.error(`${FILE} already has a section for ${tag}`);
    process.exit(1);
  }
  writeFileSync(FILE, `${head}\n${section}\n\n${tail}`.replace(/\n{3,}/g, '\n\n'));
  console.log(`inserted the ${tag} section into ${FILE}; edit it by hand before publishing`);
} else {
  const out = cliff(['--unreleased', '--strip', 'all']).trim();
  console.log(out || '(nothing unreleased)');
}
