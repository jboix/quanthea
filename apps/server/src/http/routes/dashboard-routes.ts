/** The dashboard endpoints: create, read, pin and search, and running saved panels. */
import {
  createDashboardEndpoint,
  type DashboardSpec,
  getDashboardEndpoint,
  getDashboardVersionEndpoint,
  pinDashboardEndpoint,
  runPanelEndpoint,
  searchLibraryEndpoint,
  unpinDashboardEndpoint,
  variableOptionsEndpoint,
} from '@querent/shared';
import type { Hono } from 'hono';
import type { Dashboards, DescribeForPin } from '../../dashboards/dashboards.ts';
import { AppError } from '../../lib/errors.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf, roleOf } from '../principal.ts';

/** The thread a dashboard belongs to, in the bin or not. */
type OwnerOf = (
  dashboardId: string,
) => { readonly threadId: string; readonly binned: boolean } | null;

/** What the dashboard endpoints need besides the dashboards service. */
export interface DashboardRouteOptions {
  /** Called when a pinned version is read, for the usage ledger. */
  readonly onPinnedView?: (dashboardId: string) => void;
  /** The thread a dashboard belongs to, in the bin or not. */
  readonly ownerOf?: OwnerOf;
  /** Writes a dashboard's description and tags when it is pinned. */
  readonly describe?: (spec: DashboardSpec, dashboardId: string) => ReturnType<DescribeForPin>;
}

/**
 * Mounts the endpoints that create and read dashboards.
 *
 * @param app - The app.
 * @param dashboards - The dashboards service.
 * @param onPinnedView - Called when a pinned version is read, for the usage ledger.
 * @param ownerOf - The thread a dashboard belongs to, in the bin or not.
 */
function mountDashboardRoutes(
  app: Hono<AppEnv>,
  dashboards: Dashboards,
  onPinnedView: (dashboardId: string) => void,
  ownerOf: OwnerOf,
): void {
  mountEndpoint(app, createDashboardEndpoint, {
    access: 'editor',
    handle: ({ body, principal }) =>
      dashboards.create(body.spec, body.changeSummary, actorOf(principal)),
  });
  mountEndpoint(app, getDashboardEndpoint, {
    access: 'viewer',
    handle: ({ params, principal }) => {
      const dashboard = dashboards.get(params.dashboardId, roleOf(principal));
      const owner = ownerOf(params.dashboardId);
      const threadBinned = owner?.binned === true;
      return {
        ...dashboard,
        threadId: threadBinned ? null : (owner?.threadId ?? null),
        threadBinned,
      };
    },
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
}

/**
 * Mounts the endpoints that choose the version a dashboard shows, or none. A dashboard whose
 * thread is in the bin can't be pinned: purging would delete it.
 *
 * @param app - The app.
 * @param dashboards - The dashboards service.
 * @param options - The owner of a dashboard, and the metadata writer.
 */
function mountPinRoutes(
  app: Hono<AppEnv>,
  dashboards: Dashboards,
  options: DashboardRouteOptions & { readonly ownerOf: OwnerOf },
): void {
  mountEndpoint(app, pinDashboardEndpoint, {
    access: 'editor',
    handle: ({ params, body, principal }) => {
      const { dashboardId } = params;
      if (options.ownerOf(dashboardId)?.binned)
        throw new AppError('bad_request', 'Its thread is in the bin. Restore it before pinning.');
      const { describe } = options;
      const describeThis = describe && ((spec: DashboardSpec) => describe(spec, dashboardId));
      return dashboards.pin(dashboardId, body.version, actorOf(principal), describeThis);
    },
  });
  mountEndpoint(app, unpinDashboardEndpoint, {
    access: 'editor',
    handle: ({ params, principal }) => dashboards.unpin(params.dashboardId, actorOf(principal)),
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
 * @param options - The usage callback, the owner of a dashboard, and the metadata writer.
 */
export function mountDashboardEndpoints(
  app: Hono<AppEnv>,
  dashboards: Dashboards,
  options: DashboardRouteOptions = {},
): void {
  const onPinnedView = options.onPinnedView ?? (() => undefined);
  const ownerOf = options.ownerOf ?? (() => null);
  mountDashboardRoutes(app, dashboards, onPinnedView, ownerOf);
  mountPinRoutes(app, dashboards, { ...options, ownerOf });
  mountRunRoutes(app, dashboards);
  mountEndpoint(app, searchLibraryEndpoint, {
    access: 'viewer',
    handle: ({ query }) => dashboards.searchLibrary(query),
  });
}
