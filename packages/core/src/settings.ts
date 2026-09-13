import type { Clock } from './clock';
import { createRecord } from './records';
import { APP_SETTINGS_ID, AppSettingsSchema, type AppSettings } from './schema';

/** The settings document a fresh install starts from. */
export function defaultAppSettings(clock: Clock): AppSettings {
  return createRecord(AppSettingsSchema, clock, { id: APP_SETTINGS_ID });
}
