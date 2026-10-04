/** The route of Settings → Notifications. */
import type { RouteObject } from 'react-router';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import { changeNotifications, loadNotifications } from '../features/notifications/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The notifications route: its loader and its action run for admins only.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function notificationsSettingsRoute(
  loadSession: SessionLoader,
  api: ApiClient,
): RouteObject {
  const path = '/settings/notifications';
  return {
    path,
    loader: guarded(loadSession, path, loadNotifications(api)),
    action: guarded(loadSession, path, changeNotifications(api)),
    lazy: {
      Component: async () =>
        (await import('../features/notifications/screens.ts')).NotificationsScreen,
    },
  };
}
