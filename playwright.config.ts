import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end tests against the production build served by Vite
 * preview. Every test gets a fresh browser context, so IndexedDB starts empty.
 * Run `pnpm run e2e` (builds first) or `pnpm exec playwright test` after a build.
 */
export default defineConfig({
  testDir: 'tests/e2e/playwright',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    baseURL: 'http://localhost:4517',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter orbit exec vite preview --port 4517 --strictPort',
    url: 'http://localhost:4517',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
