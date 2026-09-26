import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './fixtures';

type Violation = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number];

const staticRoutes = [
  '/today',
  '/inbox',
  '/timeline',
  '/areas',
  '/goals',
  '/projects',
  '/people',
  '/bills',
  '/notes',
  '/review',
  '/review/morning?date=2026-09-17',
  '/review/evening?date=2026-09-17',
  '/review/weekly?week=2026-09-14',
  '/insights',
  '/search',
  '/settings',
] as const;

function describeViolations(route: string, violations: Violation[]): string {
  return [
    `${route} has serious or critical accessibility violations:`,
    ...violations.flatMap((violation) => [
      `- ${violation.id} (${violation.impact}): ${violation.help}`,
      ...violation.nodes
        .slice(0, 5)
        .map((node) => `  ${node.target.join(' ')} — ${node.failureSummary}`),
    ]),
  ].join('\n');
}

async function scan(page: Page, route: string): Promise<Violation[]> {
  await page.goto(route);
  await page.locator('main').waitFor();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  return blocking;
}

async function firstRecordId(page: Page, storeName: string): Promise<string> {
  return page.evaluate(
    ({ storeName }) =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open('orbit');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction(storeName).objectStore(storeName).openCursor();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const cursor = request.result;
            db.close();
            if (!cursor) reject(new Error(`No record in ${storeName}`));
            else resolve(String(cursor.primaryKey));
          };
        };
      }),
    { storeName },
  );
}

test('all routes have no serious or critical axe violations', async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.setFixedTime(new Date('2026-09-17T06:00:00.000Z'));

  // Seed one real record of every entity that has a detail route. Creating them
  // through the UI also exercises the forms before their detail pages are scanned.
  await page.goto('/areas');
  await page.getByRole('textbox', { name: 'Area name' }).fill('Accessibility');
  await page.getByRole('button', { name: 'Add area' }).click();

  await page.goto('/goals');
  await page.getByRole('textbox', { name: 'Goal title' }).fill('Accessible goal');
  await page.getByRole('button', { name: 'Add goal' }).click();
  const goalRoute = await page.getByRole('link', { name: /Accessible goal/ }).getAttribute('href');

  await page.goto('/projects');
  await page.getByRole('textbox', { name: 'Project title' }).fill('Accessible project');
  await page.getByRole('button', { name: 'Add project' }).click();
  const projectRoute = await page
    .getByRole('link', { name: /Accessible project/ })
    .getAttribute('href');
  await page.goto(projectRoute!);
  await page.getByRole('textbox', { name: 'Task title' }).fill('Accessible task');
  await page.getByRole('textbox', { name: 'Task title' }).press('Enter');
  await expect(
    page
      .getByRole('list', { name: 'Project tasks' })
      .getByRole('listitem')
      .filter({ hasText: 'Accessible task' }),
  ).toBeVisible();

  await page.goto('/people');
  await page.getByRole('textbox', { name: 'Name' }).fill('Accessible person');
  await page.getByRole('button', { name: 'Add person' }).click();
  const personRoute = await page
    .getByTestId('person-row')
    .filter({ hasText: 'Accessible person' })
    .getAttribute('href');

  await page.goto('/bills');
  await page.getByRole('button', { name: 'Add bill' }).click();
  const billForm = page.getByRole('form', { name: 'New bill' });
  await billForm.getByLabel('Title').fill('Accessible bill');
  await billForm.getByLabel('Amount').fill('10');
  await billForm.getByRole('button', { name: 'Add bill' }).click();
  const billRoute = await page
    .getByTestId('bill-row')
    .filter({ hasText: 'Accessible bill' })
    .getAttribute('href');

  await page.goto('/notes');
  await page.getByLabel('New note title').fill('Accessible note');
  await page.getByRole('button', { name: 'Add note' }).click();
  const noteRoute = new URL(page.url()).pathname;
  const taskRoute = `/tasks/${await firstRecordId(page, 'tasks')}`;

  const failures: string[] = [];
  for (const route of [
    ...staticRoutes,
    goalRoute!,
    projectRoute!,
    taskRoute,
    personRoute!,
    billRoute!,
    noteRoute,
  ]) {
    const violations = await test.step(`axe ${route}`, () => scan(page, route));
    if (violations.length) failures.push(describeViolations(route, violations));

    // axe does not require a level-one heading, but a screen-reader user navigating by
    // heading needs one on every screen: the note editor shipped without any because its
    // title is an input, and nothing caught it until NVDA read the page (A11Y-AUDIT.md).
    const h1s = await page.locator('main h1').count();
    if (h1s !== 1) failures.push(`${route}: expected exactly one <h1> in main, found ${h1s}`);
  }
  expect(failures, failures.join('\n\n')).toEqual([]);
});
