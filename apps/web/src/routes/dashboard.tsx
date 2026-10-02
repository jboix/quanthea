/** The routes of a dashboard: its screen, and the resource routes its panels and variables load. */
import type { RouteObject, ShouldRevalidateFunctionArgs } from 'react-router';
import { ErrorPage } from '../app/error-page.tsx';
import { type GuardedPath, guarded, requireRole } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import {
  changeDashboard,
  loadDashboard,
  loadDashboardSnapshots,
  loadPanelRun,
  loadVariableOptions,
} from '../features/dashboard/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * Reloads the dashboard only when the address names another dashboard or version. Variables and
 * the time range live in the search parameters and never need the spec again.
 *
 * @param args - The navigation.
 * @returns Whether to run the loader again.
 */
function samePathKeepsSpec(args: ShouldRevalidateFunctionArgs): boolean {
  if (args.formMethod !== undefined) return args.defaultShouldRevalidate;
  return args.currentUrl.pathname !== args.nextUrl.pathname;
}

/**
 * A dashboard screen route.
 *
 * @param loadSession - Loads the current session.
 * @param path - The screen path.
 * @param api - The API client.
 * @returns The route object.
 */
function screenRoute(loadSession: SessionLoader, path: GuardedPath, api: ApiClient): RouteObject {
  const change = changeDashboard(api);
  const editor = requireRole(loadSession, 'editor');
  return {
    path,
    loader: guarded(loadSession, path, loadDashboard(api)),
    // Pinning and unpinning are for editors; the screen shows viewers neither.
    action: async (args) => {
      await editor(args);
      return change(args);
    },
    shouldRevalidate: samePathKeepsSpec,
    lazy: {
      Component: async () => (await import('../features/dashboard/screens.ts')).DashboardScreen,
    },
    ErrorBoundary: ErrorPage,
  };
}

/**
 * The dashboard routes. The resource routes load only when a panel, a variable menu or the
 * Snapshot menu asks.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route objects.
 */
export function dashboardRoutes(loadSession: SessionLoader, api: ApiClient): RouteObject[] {
  const panels = '/d/:dashboardId/v/:version/panels/:panelId';
  const options = '/d/:dashboardId/v/:version/options/:name';
  const snapshots = '/d/:dashboardId/snapshots';
  return [
    screenRoute(loadSession, '/d/:dashboardId', api),
    screenRoute(loadSession, '/d/:dashboardId/v/:version', api),
    {
      path: panels,
      loader: guarded(loadSession, panels, loadPanelRun(api)),
      shouldRevalidate: () => false,
    },
    {
      path: options,
      loader: guarded(loadSession, options, loadVariableOptions(api)),
      shouldRevalidate: () => false,
    },
    // Loads again after a snapshot is taken or revoked, so the list stays current.
    { path: snapshots, loader: guarded(loadSession, snapshots, loadDashboardSnapshots(api)) },
  ];
}
