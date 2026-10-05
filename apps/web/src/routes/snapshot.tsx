/** The route of a snapshot's page. */
import type { RouteObject } from 'react-router';
import { ErrorPage } from '../app/error-page.tsx';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import { loadSnapshot } from '../features/snapshot/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * A snapshot's page, for anyone signed in. It never loads again on its own: nothing in it changes.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function snapshotRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const path = '/s/:snapshotId';
  return {
    path,
    loader: guarded(loadSession, path, loadSnapshot(api)),
    shouldRevalidate: ({ currentUrl, nextUrl }) => currentUrl.pathname !== nextUrl.pathname,
    lazy: {
      Component: async () => (await import('../features/snapshot/screens.ts')).SnapshotScreen,
    },
    ErrorBoundary: ErrorPage,
  };
}
