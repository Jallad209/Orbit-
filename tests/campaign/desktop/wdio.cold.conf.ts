/**
 * Campaign wrapper for cold activation. Same isolation as the project harness,
 * but the launch arguments come from ORBIT_CAMPAIGN_ARGS and are split on
 * whitespace (the shipped config splits on the letter "s"; see TI-002), and
 * the spec comes from ORBIT_CAMPAIGN_SPEC so the same launch can be checked by
 * the shipped spec or by the waiting variant.
 */
import { config as base } from '../../e2e/tauri/wdio.conf';

const args = (process.env.ORBIT_CAMPAIGN_ARGS ?? '').split(/\s+/).filter(Boolean);
const application = (base.capabilities as Array<Record<string, unknown>>)[0]?.['tauri:options'] as {
  application: string;
};

export const config: WebdriverIO.Config = {
  ...base,
  specs: [process.env.ORBIT_CAMPAIGN_SPEC ?? './activation-cold-waiting.spec.ts'],
  exclude: [],
  capabilities: [
    {
      maxInstances: 1,
      // @ts-expect-error tauri-driver's vendor capability
      'tauri:options': { application: application.application, args },
    },
  ],
};
