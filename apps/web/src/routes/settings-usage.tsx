/** The route of the usage screen. */
import type { RouteObject } from 'react-router';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import { loadUsage } from '../features/usage/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The usage route, for admins.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function usageSettingsRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const path = '/settings/usage';
  return {
    path,
    loader: guarded(loadSession, path, loadUsage(api)),
    lazy: { Component: async () => (await import('../features/usage/screens.ts')).UsageScreen },
  };
}
