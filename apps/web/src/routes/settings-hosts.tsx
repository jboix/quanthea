/** The route of the external hosts settings. */
import type { RouteObject } from 'react-router';
import { lazyScreen } from '../app/lazy-screen.ts';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import { externalHostsAction, loadExternalHosts } from '../features/external-hosts/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The external hosts route: its loader and its save action run for admins only.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function hostsSettingsRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const path = '/settings/hosts';
  return {
    path,
    loader: guarded(loadSession, path, loadExternalHosts(api)),
    action: guarded(loadSession, path, externalHostsAction(api)),
    lazy: lazyScreen(
      async () => (await import('../features/external-hosts/screens.ts')).ExternalHostsScreen,
    ),
  };
}
