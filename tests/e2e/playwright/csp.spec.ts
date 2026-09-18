import { expect, test } from './fixtures';

const WEB_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";

test('the production web policy loads Orbit without violations', async ({ page }) => {
  const violations: string[] = [];
  const errors: string[] = [];
  page.on('console', (message) => {
    if (/content security policy/i.test(message.text())) violations.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.addEventListener('securitypolicyviolation', (event) => {
      (window as typeof window & { __orbitCsp?: string[] }).__orbitCsp ??= [];
      (window as typeof window & { __orbitCsp: string[] }).__orbitCsp.push(
        `${event.violatedDirective}:${event.blockedURI}`,
      );
    });
  });

  await page.goto('/today');
  await page.waitForTimeout(500);
  expect(errors, 'page errors during startup').toEqual([]);
  await expect(page.getByRole('heading', { level: 1, name: /^(Today|Tomorrow)$/ })).toBeVisible();
  const meta = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  const eventViolations = await page.evaluate(
    () => (window as typeof window & { __orbitCsp?: string[] }).__orbitCsp ?? [],
  );

  expect(meta).toBe(WEB_CSP);
  expect([...violations, ...eventViolations]).toEqual([]);
  expect(errors).toEqual([]);
});
