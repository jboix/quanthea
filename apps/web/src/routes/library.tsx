/** The route of the library screen. */
import type { RouteObject } from 'react-router';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import { loadLibrary } from '../features/library/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The library route, for viewers.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function libraryRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const path = '/library';
  return {
    path,
    loader: guarded(loadSession, path, loadLibrary(api)),
    lazy: { Component: async () => (await import('../features/library/screens.ts')).LibraryScreen },
  };
}
