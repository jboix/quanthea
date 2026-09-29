/** The route of the recipes screen. */
import type { RouteObject } from 'react-router';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import {
  loadQuerySettings,
  QueriesScreen,
  querySettingsAction,
} from '../features/queries/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The recipes route: its loader and its save action run for admins only.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function querySettingsRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const path = '/settings/queries';
  return {
    path,
    loader: guarded(loadSession, path, loadQuerySettings(api)),
    action: guarded(loadSession, path, querySettingsAction(api)),
    Component: QueriesScreen,
  };
}
