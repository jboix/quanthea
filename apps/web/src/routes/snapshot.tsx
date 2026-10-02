/** The routes of snapshots: a snapshot's page, and Settings → Snapshots for admins. */
import type { RouteObject } from 'react-router';
import { ErrorPage } from '../app/error-page.tsx';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import { loadSnapshot, loadSnapshots, revokeSnapshot } from '../features/snapshot/index.ts';
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

/**
 * Settings → Snapshots: every live snapshot, with Revoke. Its loader and action run for admins
 * only.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function snapshotsSettingsRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const path = '/settings/snapshots';
  return {
    path,
    loader: guarded(loadSession, path, loadSnapshots(api)),
    action: guarded(loadSession, path, revokeSnapshot(api)),
    lazy: {
      Component: async () => (await import('../features/snapshot/screens.ts')).SnapshotsScreen,
    },
  };
}
