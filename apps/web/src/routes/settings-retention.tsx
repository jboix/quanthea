/** The route of Settings → Retention. */
import type { RouteObject } from 'react-router';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import { loadRetention, RetentionScreen, retentionAction } from '../features/retention/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The retention route: its loader and its save action run for admins only.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function retentionSettingsRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const path = '/settings/retention';
  return {
    path,
    loader: guarded(loadSession, path, loadRetention(api)),
    action: guarded(loadSession, path, retentionAction(api)),
    Component: RetentionScreen,
  };
}
