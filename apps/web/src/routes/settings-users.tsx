/** The route of Settings → Users. */
import type { RouteObject } from 'react-router';
import { lazyScreen } from '../app/lazy-screen.ts';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import { changeUsers, loadUsers } from '../features/users/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The users route: its loader and its action run for admins only.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function usersSettingsRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const path = '/settings/users';
  return {
    path,
    loader: guarded(loadSession, path, loadUsers(api)),
    action: guarded(loadSession, path, changeUsers(api)),
    lazy: lazyScreen(async () => (await import('../features/users/screens.ts')).UsersScreen),
  };
}
