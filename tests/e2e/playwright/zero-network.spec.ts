import { expect, test } from './fixtures';

test('the production PWA shell and lazy routes stay on the application origin', async ({
  page,
}) => {
  await page.goto('/today');
  await expect(page.getByRole('heading', { level: 1, name: /^(Today|Tomorrow)$/ })).toBeVisible();

  // Exercise the lazy chunks as well as the initial shell. The auto fixture
  // records page, worker, and service-worker requests for the whole context.
  await page.goto('/search');
  await expect(page.getByRole('heading', { level: 1, name: 'Search' })).toBeVisible();
  await page.goto('/insights');
  await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible();

  const workers = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return [];
    const registrations = await navigator.serviceWorker.getRegistrations();
    return registrations.flatMap((registration) =>
      [registration.active, registration.installing, registration.waiting]
        .map((worker) => worker?.scriptURL)
        .filter((url): url is string => Boolean(url)),
    );
  });
  // Playwright WebKit on Windows can expose the API without ever resolving
  // `navigator.serviceWorker.ready`. Inspect what it actually registered and
  // let the context-wide request boundary cover browsers with no active worker.
  expect(workers.every((url) => url.startsWith('http://localhost:4517/'))).toBe(true);
});
