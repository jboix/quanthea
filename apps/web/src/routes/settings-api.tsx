/** The route of the MCP access settings. */
import type { RouteObject } from 'react-router';
import { lazyScreen } from '../app/lazy-screen.ts';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import { apiAccessAction, loadApiAccess } from '../features/api-tokens/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The MCP access route: its loader and its save action run for admins only.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function apiSettingsRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const path = '/settings/api';
  return {
    path,
    loader: guarded(loadSession, path, loadApiAccess(api)),
    action: guarded(loadSession, path, apiAccessAction(api)),
    lazy: lazyScreen(
      async () => (await import('../features/api-tokens/screens.ts')).ApiAccessScreen,
    ),
  };
}
