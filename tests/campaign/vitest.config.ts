import { defineConfig } from 'vitest/config';

/**
 * Campaign-only tests: they drive the real desktop binary and real files, so
 * they are not part of the default `pnpm test` projects.
 *   pnpm exec vitest run --config tests/campaign/vitest.config.ts
 */
export default defineConfig({
  test: {
    name: 'campaign',
    environment: 'node',
    include: ['**/*.campaign.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
