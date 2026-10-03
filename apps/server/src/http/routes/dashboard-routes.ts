/**
 * The dashboard endpoints: create, read, pin and search, and running saved panels. A dashboard's
 * drafts follow its thread: only its owner and admins see them, and others read it as a viewer
 * does (`../ownership.ts`). Only the owner and admins pin and unpin it.
 */
import {
  createDashboardEndpoint,
  type DashboardSpec,
  getDashboardEndpoint,
  getDashboardVersionEndpoint,
  hasRole,
  type Principal,
  pinDashboardEndpoint,
  runPanelEndpoint,
  searchLibraryEndpoint,
  unpinDashboardEndpoint,
  variableOptionsEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { Dashboards, DescribeForPin } from '../../dashboards/dashboards.ts';
import { AppError } from '../../lib/errors.ts';
import type { ThreadOwner } from '../../threads/bin.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { canChangeDashboard, canRead, roleForDashboard } from '../ownership.ts';
import { actorOf, signedIn } from '../principal.ts';

/** The thread a dashboard belongs to, in the bin or not. */
type OwnerOf = (dashboardId: string) => ThreadOwner | null;

/** What the dashboard endpoints need besides the dashboards service. */
export interface DashboardRouteOptions {
  /** Called when a pinned version is read, for the usage ledger. */
  readonly onPinnedView?: (dashboardId: string) => void;
  /** The thread a dashboard belongs to, in the bin or not. */
  readonly ownerOf?: OwnerOf;
  /** Writes a dashboard's description and tags when it is pinned. */
  readonly describe?: (spec: DashboardSpec, dashboardId: string) => ReturnType<DescribeForPin>;
}

/** The options with their defaults. */
type Resolved = Required<Pick<DashboardRouteOptions, 'onPinnedView' | 'ownerOf'>> &
  DashboardRouteOptions;

/**
 * What the dashboard screen needs to know about its thread, for this person.
 *
 * @param principal - Who asks.
 * @param owner - The dashboard's thread, if any.
 * @returns The thread they may open, whether it is in the bin or someone else's, and whether they
 *   may change the dashboard.
 */
function threadFacts(principal: Principal, owner: ThreadOwner | null) {
  const readable = owner !== null && canRead(principal, owner.ownerId);
  return {
    threadId: readable && !owner.binned ? owner.threadId : null,
    threadBinned: readable && owner.binned,
    threadOfOther: owner !== null && !readable,
    canChange: hasRole(principal.role, 'editor') && canChangeDashboard(principal, owner),
  };
}

/**
 * Mounts the endpoints that create and read dashboards.
 *
 * @param app - The app.
 * @param dashboards - The dashboards service.
 * @param options - The usage callback and the owner of a dashboard.
 */
function mountDashboardRoutes(app: Hono<AppEnv>, dashboards: Dashboards, options: Resolved): void {
  mountEndpoint(app, createDashboardEndpoint, {
    access: 'editor',
    handle: ({ body, principal }) =>
      dashboards.create(body.spec, body.changeSummary, actorOf(principal)),
  });
  mountEndpoint(app, getDashboardEndpoint, {
    access: 'viewer',
    handle: ({ params, principal }) => {
      const reader = signedIn(principal);
      const owner = options.ownerOf(params.dashboardId);
      const dashboard = dashboards.get(params.dashboardId, roleForDashboard(reader, owner));
      return { ...dashboard, ...threadFacts(reader, owner) };
    },
  });
  mountEndpoint(app, getDashboardVersionEndpoint, {
    access: 'viewer',
    handle: ({ params, principal }) => {
      const role = roleForDashboard(signedIn(principal), options.ownerOf(params.dashboardId));
      const version = dashboards.getVersion(params.dashboardId, Number(params.version), role);
      if (version.pinnedAt !== null) options.onPinnedView(params.dashboardId);
      return version;
    },
  });
}

/**
 * Refuses a change of the version shown unless the person may change the dashboard.
 *
 * @param principal - Who asks.
 * @param owner - The dashboard's thread, if any.
 * @throws {AppError} `forbidden`, or `bad_request` while its thread is in the bin.
 */
function checkChange(principal: Principal, owner: ThreadOwner | null): void {
  if (!canChangeDashboard(principal, owner))
    throw new AppError('forbidden', 'Only the owner of its thread, or an admin, can change this.');
  if (owner?.binned)
    throw new AppError('bad_request', 'Its thread is in the bin. Restore it before pinning.');
}

/**
 * Mounts the endpoints that choose the version a dashboard shows, or none. A dashboard whose
 * thread is in the bin can't be pinned: purging would delete it.
 *
 * @param app - The app.
 * @param dashboards - The dashboards service.
 * @param options - The owner of a dashboard, and the metadata writer.
 */
function mountPinRoutes(app: Hono<AppEnv>, dashboards: Dashboards, options: Resolved): void {
  mountEndpoint(app, pinDashboardEndpoint, {
    access: 'editor',
    handle: ({ params, body, principal }) => {
      const { dashboardId } = params;
      checkChange(signedIn(principal), options.ownerOf(dashboardId));
      const { describe } = options;
      const describeThis = describe && ((spec: DashboardSpec) => describe(spec, dashboardId));
      return dashboards.pin(dashboardId, body.version, actorOf(principal), describeThis);
    },
  });
  mountEndpoint(app, unpinDashboardEndpoint, {
    access: 'editor',
    handle: ({ params, principal }) => {
      checkChange(signedIn(principal), options.ownerOf(params.dashboardId));
      return dashboards.unpin(params.dashboardId, actorOf(principal));
    },
  });
}

/**
 * Mounts the endpoints that run saved panels and list variable options. The request names a saved
 * version and never carries a query; drafts run only for those who may see them.
 *
 * @param app - The app.
 * @param dashboards - The dashboards service.
 * @param options - The owner of a dashboard.
 */
function mountRunRoutes(app: Hono<AppEnv>, dashboards: Dashboards, options: Resolved): void {
  const roleFor = (principal: Principal | null, dashboardId: string) =>
    roleForDashboard(signedIn(principal), options.ownerOf(dashboardId));
  mountEndpoint(app, runPanelEndpoint, {
    access: 'viewer',
    handle: ({ body, principal, signal }) =>
      dashboards.runPanel(body, body.panelId, roleFor(principal, body.dashboardId), signal),
  });
  mountEndpoint(app, variableOptionsEndpoint, {
    access: 'viewer',
    handle: async ({ body, principal, signal }) => ({
      options: await dashboards.variableOptions(
        body,
        body.name,
        roleFor(principal, body.dashboardId),
        signal,
      ),
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
  const resolved: Resolved = {
    ...options,
    onPinnedView: options.onPinnedView ?? (() => undefined),
    ownerOf: options.ownerOf ?? (() => null),
  };
  mountDashboardRoutes(app, dashboards, resolved);
  mountPinRoutes(app, dashboards, resolved);
  mountRunRoutes(app, dashboards, resolved);
  mountEndpoint(app, searchLibraryEndpoint, {
    access: 'viewer',
    handle: ({ query }) => dashboards.searchLibrary(query),
  });
}
