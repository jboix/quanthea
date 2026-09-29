/** Chart endpoints: admins switch chart recipes off, so the agent is not offered them. */
import { z } from 'zod';
import { defineEndpoint } from './contract.ts';

/** Validates the chart settings: the recipes switched off. At least one stays on. */
export const chartSettingsSchema = z.strictObject({
  disabled: z.array(z.string().max(60)).max(60).default([]),
});

/** The chart settings. */
export type ChartSettings = z.infer<typeof chartSettingsSchema>;

/** The chart settings, for admins. */
export const getChartSettingsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/settings/charts',
  output: chartSettingsSchema,
});

/** Saves the chart settings. */
export const saveChartSettingsEndpoint = defineEndpoint({
  method: 'PUT',
  path: '/settings/charts',
  body: chartSettingsSchema,
  output: chartSettingsSchema,
});
