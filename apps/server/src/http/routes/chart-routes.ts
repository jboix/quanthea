/** The chart endpoints: which chart recipes the agent is offered, for admins. */
import { getChartSettingsEndpoint, saveChartSettingsEndpoint } from '@querent/shared';
import type { Hono } from 'hono';
import type { ChartSettingsService } from '../../settings/chart-settings.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf } from '../principal.ts';

/**
 * Mounts the chart endpoints.
 *
 * @param app - The app.
 * @param chartSettings - The chart settings.
 */
export function mountChartEndpoints(app: Hono<AppEnv>, chartSettings: ChartSettingsService): void {
  mountEndpoint(app, getChartSettingsEndpoint, {
    access: 'admin',
    handle: () => chartSettings.get(),
  });
  mountEndpoint(app, saveChartSettingsEndpoint, {
    access: 'admin',
    handle: ({ body, principal }) => chartSettings.save(body, actorOf(principal)),
  });
}
