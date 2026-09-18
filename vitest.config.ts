import { defineConfig } from 'vitest/config';

// Tests run in UTC on every machine. Fixture timestamps are UTC instants while test clocks
// are built from local wall time, so a day count near midnight differs between a UTC+3
// developer machine and a UTC runner (the planner golden). Set here, before the workers
// are spawned, so they inherit it; `env` covers the projects that run in-process.
process.env.TZ = 'UTC';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**', 'apps/*/src/**'],
      exclude: [
        '**/*.d.ts',
        '**/index.ts',
        '**/*.test.{ts,tsx}',
        'apps/*/src/test/**',
        'apps/*/src/pages/dev/**',
        'apps/*/src/main.tsx',
        'apps/*/src/pwa/**',
      ],
      thresholds: {
        'packages/core/src/**': { lines: 90, functions: 90, statements: 90 },
        'packages/storage/src/**': { lines: 85, functions: 85, statements: 85 },
        'apps/orbit/src/**': { lines: 70, functions: 65, statements: 70 },
      },
    },
  },
});
