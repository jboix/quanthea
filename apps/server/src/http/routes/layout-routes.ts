/**
 * The layout endpoints: the history of a version's layout, saving a revision, and restoring one.
 * Only those who may pin a dashboard arrange it: its thread's owner and admins. Anyone who may see
 * the version reads the layout it is shown with, through the version endpoint.
 */
import {
  type LayoutRevision,
  listDashboardLayoutsEndpoint,
  restoreDashboardLayoutEndpoint,
  saveDashboardLayoutEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { Users } from '../../auth/users.ts';
import type { DashboardLayouts, LayoutEntry } from '../../dashboards/layouts.ts';
import type { ThreadOwner } from '../../threads/bin.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { checkOwnerChange, ownerNames } from '../ownership.ts';
import { actorOf, signedIn } from '../principal.ts';

/** What the layout endpoints need. */
export interface LayoutRouteServices {
  /** The layouts. */
  readonly layouts: DashboardLayouts;
  /** The users, for the names of who saved each revision. */
  readonly users: Pick<Users, 'nameOf'>;
  /** The thread a dashboard belongs to, in the bin or not. */
  readonly ownerOf: (dashboardId: string) => ThreadOwner | null;
}

/** The path parameters of one version. */
interface VersionParams {
  /** The dashboard. */
  readonly dashboardId: string;
  /** The version, as the path gives it. */
  readonly version: string;
}

/**
 * Names who saved revisions, looking each person up once per request.
 *
 * @param users - The users.
 * @returns A function that turns a revision into what the endpoints return.
 */
function revisionNamer(users: Pick<Users, 'nameOf'>) {
  const nameOf = ownerNames(users);
  return async (entry: LayoutEntry): Promise<LayoutRevision> => ({
    revision: entry.revision,
    layout: entry.layout,
    restoredFrom: entry.restoredFrom,
    savedBy: await nameOf(entry.actor),
    createdAt: entry.createdAt,
  });
}

/**
 * The version a request names, after checking the person may arrange its dashboard.
 *
 * @param services - The owner of a dashboard.
 * @param params - The path parameters.
 * @param principal - Who asks.
 * @returns The dashboard and version.
 * @throws {AppError} `forbidden` for anyone but its thread's owner and admins.
 */
function arrangeable(
  services: LayoutRouteServices,
  params: VersionParams,
  principal: Parameters<typeof signedIn>[0],
) {
  checkOwnerChange(signedIn(principal), services.ownerOf(params.dashboardId));
  return { dashboardId: params.dashboardId, version: Number(params.version) };
}

/**
 * Mounts the layout endpoints.
 *
 * @param app - The app.
 * @param services - The layouts, the users and the owner of a dashboard.
 */
export function mountLayoutEndpoints(app: Hono<AppEnv>, services: LayoutRouteServices): void {
  const { layouts } = services;
  mountEndpoint(app, listDashboardLayoutsEndpoint, {
    access: 'editor',
    handle: async ({ params, principal }) => {
      const target = arrangeable(services, params, principal);
      const named = revisionNamer(services.users);
      const entries = layouts.history(target.dashboardId, target.version);
      return { revisions: await Promise.all(entries.map(named)) };
    },
  });
  mountEndpoint(app, saveDashboardLayoutEndpoint, {
    access: 'editor',
    handle: ({ params, body, principal }) => {
      const target = arrangeable(services, params, principal);
      const saved = layouts.save(target, body.layout, body.basedOn, actorOf(principal));
      return revisionNamer(services.users)(saved);
    },
  });
  mountEndpoint(app, restoreDashboardLayoutEndpoint, {
    access: 'editor',
    handle: ({ params, body, principal }) => {
      const target = arrangeable(services, params, principal);
      const revision = Number(params.revision);
      const restored = layouts.restore(target, revision, body.basedOn, actorOf(principal));
      return revisionNamer(services.users)(restored);
    },
  });
}
