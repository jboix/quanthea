/** The chart endpoints: which chart recipes the agent is offered, for admins. */
import { getChartSettingsEndpoint, saveChartSettingsEndpoint } from '@quanthea/shared';
import type { Hono } from 'hono';
import type { Managed } from '../../provisioning/managed.ts';
import type { ChartSettingsService } from '../../settings/chart-settings.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf } from '../principal.ts';

/**
 * Mounts the chart endpoints.
 *
 * @param app - The app.
 * @param chartSettings - The chart settings.
 * @param managed - What the configuration file manages.
 */
export function mountChartEndpoints(
  app: Hono<AppEnv>,
  chartSettings: ChartSettingsService,
  managed: Managed,
): void {
  mountEndpoint(app, getChartSettingsEndpoint, {
    access: 'admin',
    handle: () => chartSettings.get(),
  });
  mountEndpoint(app, saveChartSettingsEndpoint, {
    access: 'admin',
    handle: ({ body, principal }) => {
      managed.refuseChange('settings', 'charts');
      return chartSettings.save(body, actorOf(principal));
    },
  });
}
