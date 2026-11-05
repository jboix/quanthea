/** The route of Settings → Server. */
import type { RouteObject } from 'react-router';
import { lazyScreen } from '../app/lazy-screen.ts';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import { loadServerSettings } from '../features/server-settings/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The server route: its loader runs for admins only.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function serverSettingsRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const path = '/settings/server';
  return {
    path,
    loader: guarded(loadSession, path, loadServerSettings(api)),
    lazy: lazyScreen(
      async () => (await import('../features/server-settings/screens.ts')).ServerSettingsScreen,
    ),
  };
}
