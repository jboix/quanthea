/** The route of Settings → Authentication. */
import type { RouteObject } from 'react-router';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import {
  AuthSettingsScreen,
  changeAuthSettings,
  loadAuthSettings,
} from '../features/auth-settings/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The authentication route: its loader and its action run for admins only.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function authSettingsRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const path = '/settings/auth';
  return {
    path,
    loader: guarded(loadSession, path, loadAuthSettings(api)),
    action: guarded(loadSession, path, changeAuthSettings(api)),
    Component: AuthSettingsScreen,
  };
}
