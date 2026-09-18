import { expect, test as base, type Request } from '@playwright/test';

type OfflineFixtures = {
  offlineBoundary: void;
};

/**
 * Orbit is offline-only. This auto fixture turns every browser e2e into a
 * network-boundary assertion, including requests made by workers and service
 * workers in the browser context. Same-origin Vite assets are the only allowed
 * HTTP traffic.
 */
export const test = base.extend<OfflineFixtures>({
  offlineBoundary: [
    async ({ baseURL, context }, use) => {
      const origin = new URL(baseURL!).origin;
      const external: string[] = [];
      const inspect = (request: Request) => {
        const url = request.url();
        if (/^(?:data|blob|about):/.test(url)) return;
        if (new URL(url).origin !== origin) external.push(`${request.method()} ${url}`);
      };
      context.on('request', inspect);
      await use();
      context.off('request', inspect);
      expect(external, `Orbit made requests outside ${origin}`).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
export type { Page } from '@playwright/test';
