/** Retention: how long deleted threads wait in the bin before they are deleted for good. */
import { z } from 'zod';
import { defineEndpoint } from './contract.ts';

/**
 * Validates the retention settings. `binDays` is how many days a binned thread is kept; `null`
 * keeps it until someone deletes it, and 0 purges it at the next hourly run.
 */
export const retentionSettingsSchema = z.strictObject({
  binDays: z.int().min(0).max(3650).nullable().default(30),
});

/** The retention settings. */
export type RetentionSettings = z.infer<typeof retentionSettingsSchema>;

/** The retention settings, for admins. */
export const getRetentionSettingsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/settings/retention',
  output: retentionSettingsSchema,
});

/** Saves the retention settings. */
export const saveRetentionSettingsEndpoint = defineEndpoint({
  method: 'PUT',
  path: '/settings/retention',
  body: retentionSettingsSchema,
  output: retentionSettingsSchema,
});
