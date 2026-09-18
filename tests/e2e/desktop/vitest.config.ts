import { defineConfig } from 'vitest/config';

/**
 * Desktop cold-launch e2e. These drive the real release binary and real files,
 * so they are not part of the default `pnpm test` projects and run one at a
 * time. Build the binary first (`pnpm run tauri:build:bin`), then, from a
 * non-elevated shell (an Administrator shell makes WebView2 drop the
 * remote-debugging flag and every launch times out):
 *   pnpm run e2e:desktop:cold
 */
export default defineConfig({
  test: {
    name: 'desktop-e2e',
    environment: 'node',
    include: ['**/*.e2e.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
