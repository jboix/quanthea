/** The route of the chart gallery. */
import type { RouteObject } from 'react-router';
import { lazyScreen } from '../app/lazy-screen.ts';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import { chartSettingsAction, loadChartSettings } from '../features/chart-gallery/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The chart gallery route: its loader and its save action run for admins only.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function chartSettingsRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const path = '/settings/charts';
  return {
    path,
    loader: guarded(loadSession, path, loadChartSettings(api)),
    action: guarded(loadSession, path, chartSettingsAction(api)),
    lazy: lazyScreen(
      async () => (await import('../features/chart-gallery/screens.ts')).ChartGalleryScreen,
    ),
  };
}
