import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
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
