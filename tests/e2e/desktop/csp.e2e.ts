import { afterEach, describe, expect, it } from 'vitest';
import { launchOrbit, removeSession, type LaunchedOrbit } from './coldLaunch';

describe('desktop content security policy', () => {
  let app: LaunchedOrbit | null = null;

  afterEach(async () => {
    if (!app) return;
    const dir = app.sessionDir;
    await app.close();
    removeSession(dir);
    app = null;
  });

  it('loads cleanly and blocks an inline script probe', async () => {
    app = await launchOrbit();
    await app.page.evaluate(() => {
      const state = window as typeof window & {
        __orbitInlineProbe?: boolean;
        __orbitCspViolations?: string[];
      };
      state.__orbitCspViolations = [];
      window.addEventListener('securitypolicyviolation', (event) => {
        state.__orbitCspViolations!.push(`${event.violatedDirective}:${event.blockedURI}`);
      });
      const script = document.createElement('script');
      script.textContent = 'window.__orbitInlineProbe = true';
      document.head.append(script);
    });
    await expect
      .poll(async () =>
        app!.page.evaluate(() => {
          const state = window as typeof window & { __orbitCspViolations?: string[] };
          return state.__orbitCspViolations?.length ?? 0;
        }),
      )
      .toBeGreaterThan(0);
    const result = await app.page.evaluate(() => {
      const state = window as typeof window & {
        __orbitInlineProbe?: boolean;
        __orbitCspViolations?: string[];
      };
      return { ran: state.__orbitInlineProbe === true, violations: state.__orbitCspViolations };
    });
    expect(result.ran).toBe(false);
    expect(result.violations?.some((item) => item.startsWith('script-src'))).toBe(true);
  });
});
