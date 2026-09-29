/** The dashboard endpoints: create, read and pin, and running saved panels. */
import {
  createDashboardEndpoint,
  getDashboardEndpoint,
  getDashboardVersionEndpoint,
  pinDashboardEndpoint,
  runPanelEndpoint,
  variableOptionsEndpoint,
} from '@querent/shared';
import type { Hono } from 'hono';
import type { Dashboards } from '../../dashboards/dashboards.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf, roleOf } from '../principal.ts';

/**
 * Mounts the endpoints that create, read and pin dashboards.
 *
 * @param app - The app.
 * @param dashboards - The dashboards service.
 * @param onPinnedView - Called when a pinned version is read, for the usage ledger.
 * @param threadOf - The thread that edits a dashboard, while it exists.
 */
function mountDashboardRoutes(
  app: Hono<AppEnv>,
  dashboards: Dashboards,
  onPinnedView: (dashboardId: string) => void,
  threadOf: (dashboardId: string) => string | null,
): void {
  mountEndpoint(app, createDashboardEndpoint, {
    access: 'editor',
    handle: ({ body, principal }) =>
      dashboards.create(body.spec, body.changeSummary, actorOf(principal)),
  });
  mountEndpoint(app, getDashboardEndpoint, {
    access: 'viewer',
    handle: ({ params, principal }) => ({
      ...dashboards.get(params.dashboardId, roleOf(principal)),
      threadId: threadOf(params.dashboardId),
    }),
  });
  mountEndpoint(app, getDashboardVersionEndpoint, {
    access: 'viewer',
    handle: ({ params, principal }) => {
      const version = dashboards.getVersion(
        params.dashboardId,
        Number(params.version),
        roleOf(principal),
      );
      if (version.pinnedAt !== null) onPinnedView(params.dashboardId);
      return version;
    },
  });
  mountEndpoint(app, pinDashboardEndpoint, {
    access: 'editor',
    handle: ({ params, body, principal }) =>
      dashboards.pin(params.dashboardId, body.version, actorOf(principal)),
  });
}

/**
 * Mounts the endpoints that run saved panels and list variable options. Viewers use them; the
 * request names a saved version and never carries a query.
 *
 * @param app - The app.
 * @param dashboards - The dashboards service.
 */
function mountRunRoutes(app: Hono<AppEnv>, dashboards: Dashboards): void {
  mountEndpoint(app, runPanelEndpoint, {
    access: 'viewer',
    handle: ({ body, principal, signal }) =>
      dashboards.runPanel(body, body.panelId, roleOf(principal), signal),
  });
  mountEndpoint(app, variableOptionsEndpoint, {
    access: 'viewer',
    handle: async ({ body, principal, signal }) => ({
      options: await dashboards.variableOptions(body, body.name, roleOf(principal), signal),
    }),
  });
}

/**
 * Mounts every dashboard endpoint.
 *
 * @param app - The app.
 * @param dashboards - The dashboards service.
 * @param onPinnedView - Called when a pinned version is read, for the usage ledger.
 * @param threadOf - The thread that edits a dashboard, while it exists.
 */
export function mountDashboardEndpoints(
  app: Hono<AppEnv>,
  dashboards: Dashboards,
  onPinnedView: (dashboardId: string) => void = () => undefined,
  threadOf: (dashboardId: string) => string | null = () => null,
): void {
  mountDashboardRoutes(app, dashboards, onPinnedView, threadOf);
  mountRunRoutes(app, dashboards);
}
