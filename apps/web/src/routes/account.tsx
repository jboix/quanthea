/** The route of one's own account. */
import type { RouteObject } from 'react-router';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import { AccountScreen, accountAction, loadAccount } from '../features/account/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The account route, for anyone signed in.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function accountRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const path = '/account';
  return {
    path,
    loader: guarded(loadSession, path, loadAccount(api, loadSession)),
    action: guarded(loadSession, path, accountAction(api)),
    Component: AccountScreen,
  };
}
