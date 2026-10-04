/** The route of Settings → Alerts. */
import type { RouteObject } from 'react-router';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import { loadAlertSettings, saveAlertSettings } from '../features/alerts/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The alert settings route: its loader and its action run for admins only.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function alertSettingsRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const path = '/settings/alerts';
  return {
    path,
    loader: guarded(loadSession, path, loadAlertSettings(api)),
    action: guarded(loadSession, path, saveAlertSettings(api)),
    lazy: {
      Component: async () => (await import('../features/alerts/screens.ts')).AlertSettingsScreen,
    },
  };
}
