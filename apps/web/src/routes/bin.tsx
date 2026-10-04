/** The route of the bin screen. */
import type { RouteObject } from 'react-router';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import { changeBin, loadBin } from '../features/bin/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The bin route, for analysts and above: analysts see their conversations, editors their threads
 * too. Deleting for good is for admins; the API checks it again.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function binRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const path = '/bin';
  const roleOf = async () => (await loadSession())?.principal.role ?? null;
  return {
    path,
    loader: guarded(loadSession, path, loadBin(api, roleOf)),
    action: guarded(loadSession, path, changeBin(api)),
    lazy: { Component: async () => (await import('../features/bin/screens.ts')).BinScreen },
  };
}
