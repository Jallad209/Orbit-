/** Campaign wrapper: the project's desktop harness config with a single diagnostic spec. */
import { config as base } from '../../e2e/tauri/wdio.conf';

export const config: WebdriverIO.Config = {
  ...base,
  specs: ['./readiness-probe.spec.ts'],
  exclude: [],
};
