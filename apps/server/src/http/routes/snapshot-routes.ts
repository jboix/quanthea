/**
 * The snapshot endpoints. Editors take and revoke snapshots; anyone signed in opens one, which runs
 * no query. A snapshot of a draft is taken only by those who may see the draft. Taking one gives
 * no rights over it: any editor revokes any snapshot.
 */
import {
  getSnapshotEndpoint,
  listDashboardSnapshotsEndpoint,
  listSnapshotsEndpoint,
  revokeSnapshotEndpoint,
  takeSnapshotEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { Users } from '../../auth/users.ts';
import type { SnapshotInfo, Snapshots } from '../../dashboards/snapshots.ts';
import type { ThreadOwner } from '../../threads/bin.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { ownerNames, roleForDashboard } from '../ownership.ts';
import { actorOf, signedIn } from '../principal.ts';

/** What the snapshot endpoints need. */
export interface SnapshotRouteServices {
  /** The snapshots. */
  readonly snapshots: Snapshots;
  /** The users, for the takers' names. */
  readonly users: Pick<Users, 'nameOf'>;
  /** The thread a dashboard belongs to, in the bin or not. */
  readonly ownerOf: (dashboardId: string) => ThreadOwner | null;
  /** Called when a snapshot is opened, for the usage ledger. */
  readonly onSnapshotView?: (dashboardId: string) => void;
}

/**
 * Names the takers of snapshots, looking each up once per request.
 *
 * @param users - The users.
 * @returns A function that replaces a snapshot's taker id with their name.
 */
function namer(users: Pick<Users, 'nameOf'>) {
  const nameOf = ownerNames(users);
  return async <Info extends SnapshotInfo>({ takerId, ...info }: Info) => ({
    ...info,
    takenBy: await nameOf(takerId),
  });
}

/**
 * Mounts the endpoints that list snapshots: a dashboard's for editors, every one for admins.
 *
 * @param app - The app.
 * @param services - The snapshots and the users.
 */
function mountListEndpoints(app: Hono<AppEnv>, services: SnapshotRouteServices): void {
  const { snapshots, users } = services;
  mountEndpoint(app, listDashboardSnapshotsEndpoint, {
    access: 'editor',
    handle: async ({ params }) => ({
      snapshots: await Promise.all(snapshots.list(params.dashboardId).map(namer(users))),
    }),
  });
  mountEndpoint(app, listSnapshotsEndpoint, {
    access: 'admin',
    handle: async () => ({ snapshots: await Promise.all(snapshots.list().map(namer(users))) }),
  });
}

/**
 * Mounts every snapshot endpoint.
 *
 * @param app - The app.
 * @param services - The snapshots, the users, the owner of a dashboard and the usage callback.
 */
export function mountSnapshotEndpoints(app: Hono<AppEnv>, services: SnapshotRouteServices): void {
  const { snapshots, users } = services;
  mountEndpoint(app, takeSnapshotEndpoint, {
    access: 'editor',
    handle: async ({ body, principal, signal }) => {
      const role = roleForDashboard(signedIn(principal), services.ownerOf(body.dashboardId));
      return namer(users)(await snapshots.take(body, role, actorOf(principal), signal));
    },
  });
  mountEndpoint(app, getSnapshotEndpoint, {
    access: 'viewer',
    handle: ({ params }) => {
      const snapshot = snapshots.open(params.snapshotId);
      services.onSnapshotView?.(snapshot.dashboardId);
      return namer(users)(snapshot);
    },
  });
  mountEndpoint(app, revokeSnapshotEndpoint, {
    access: 'editor',
    handle: ({ params, principal }) => {
      snapshots.revoke(params.snapshotId, actorOf(principal));
      return { revoked: true as const };
    },
  });
  mountListEndpoints(app, services);
}
