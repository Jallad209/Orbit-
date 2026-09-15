/**
 * Fetch the Microsoft Edge WebDriver that matches the installed WebView2
 * runtime, for the desktop e2e harness (tauri-driver proxies to it).
 *
 *   pnpm run edge:driver                 # detect the WebView2 version (Windows registry)
 *   pnpm run edge:driver -- 152.0.4191.66
 *
 * Downloads `edgedriver_win64.zip` from https://msedgedriver.microsoft.com
 * into tests/e2e/tauri/.driver (git-ignored) and prints the path of
 * msedgedriver.exe. Re-running with the same version is a no-op.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { download } from 'edgedriver';

const DRIVER_DIR = join('tests', 'e2e', 'tauri', '.driver');

/** The WebView2 Evergreen runtime version, from the registry key EdgeUpdate keeps current. */
function detectWebView2Version(): string | null {
  if (process.platform !== 'win32') return null;
  const keys = [
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
  ];
  for (const key of keys) {
    try {
      const out = execFileSync('reg', ['query', key, '/v', 'pv'], { encoding: 'utf8' });
      const m = /pv\s+REG_SZ\s+(\S+)/.exec(out);
      if (m) return m[1]!;
    } catch {
      /* key absent */
    }
  }
  return null;
}

const requested = process.argv[2] ?? process.env.WEBVIEW2_VERSION ?? detectWebView2Version();
if (!requested) {
  console.error(
    'Could not detect the WebView2 runtime version. Pass it explicitly: pnpm run edge:driver -- 152.0.4191.66',
  );
  process.exit(1);
}

mkdirSync(DRIVER_DIR, { recursive: true });
const cached = readdirSync(DRIVER_DIR).find((f) => f.toLowerCase() === 'msedgedriver.exe');
const versionFile = join(DRIVER_DIR, 'version.txt');
const cachedVersion = existsSync(versionFile) ? readFileSync(versionFile, 'utf8').trim() : null;
if (cached && cachedVersion === requested) {
  console.log(join(DRIVER_DIR, cached));
  process.exit(0);
}

// A cached driver of a different version must be removed first: `edgedriver.download()`
// returns early whenever the file merely exists (it does not compare versions), so after a
// WebView2 update it would otherwise keep the stale driver and the session would fail to start.
if (cached) {
  rmSync(join(DRIVER_DIR, cached), { force: true });
  rmSync(versionFile, { force: true });
}

console.error(`Fetching Edge WebDriver ${requested} from msedgedriver.microsoft.com …`);
const driverPath = await download(requested, DRIVER_DIR);
writeFileSync(versionFile, `${requested}\n`);
console.log(driverPath);
