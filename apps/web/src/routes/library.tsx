/** The route of the library screen: its Dashboards and Snapshots tabs. */
import type { RouteObject } from 'react-router';
import { guarded, requireRole } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import { loadLibrary, revokeSnapshot } from '../features/library/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The library route, for viewers. Its action revokes a snapshot, for editors.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function libraryRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const path = '/library';
  const editor = requireRole(loadSession, 'editor');
  const revoke = revokeSnapshot(api);
  return {
    path,
    loader: guarded(loadSession, path, loadLibrary(api)),
    action: async (args) => {
      await editor(args);
      return revoke(args);
    },
    lazy: { Component: async () => (await import('../features/library/screens.ts')).LibraryScreen },
  };
}
