/**
 * The layout endpoints of dashboards and of reports: the history of a version's layout, saving a
 * revision, and restoring one. Only those who may pin a dashboard or activate a report arrange
 * it: its thread's owner and admins, and any editor when it has no thread. Anyone who may see the
 * version reads the layout it is shown with, through the endpoint that reads the version.
 */
import type { LayoutEndpoints, LayoutRevision } from '@quanthea/shared';
import type { Hono } from 'hono';
import type { Users } from '../../auth/users.ts';
import type { LayoutEntry, Layouts } from '../../dashboards/layouts.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { checkOwnerChange, ownerNames } from '../ownership.ts';
import { actorOf, signedIn } from '../principal.ts';

/** What the layout endpoints of one kind need. */
export interface LayoutRouteServices {
  /** The layouts. */
  readonly layouts: Layouts;
  /** The users, for the names of who saved each revision. */
  readonly users: Pick<Users, 'nameOf'>;
  /** The owner of the thread a dashboard or a report belongs to, or `null` without a thread. */
  readonly ownerOf: (subjectId: string) => { readonly ownerId: string | null } | null;
}

/** The path parameters of one version. */
interface VersionParams {
  /** The dashboard or the report. */
  readonly id: string;
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
 * The version a request names, after checking the person may arrange what it belongs to.
 *
 * @param services - The owner of a dashboard or a report.
 * @param params - The path parameters.
 * @param principal - Who asks.
 * @returns The dashboard or the report, and the version.
 * @throws {AppError} `forbidden` for anyone but its thread's owner and admins.
 */
function arrangeable(
  services: LayoutRouteServices,
  params: VersionParams,
  principal: Parameters<typeof signedIn>[0],
) {
  checkOwnerChange(signedIn(principal), services.ownerOf(params.id));
  return { subjectId: params.id, version: Number(params.version) };
}

/**
 * Mounts the layout endpoints of dashboards, or of reports.
 *
 * @param app - The app.
 * @param endpoints - The three endpoints of the kind.
 * @param services - Its layouts, the users and the owner of one.
 */
export function mountLayoutEndpoints(
  app: Hono<AppEnv>,
  endpoints: LayoutEndpoints,
  services: LayoutRouteServices,
): void {
  const { layouts } = services;
  mountEndpoint(app, endpoints.list, {
    access: 'editor',
    handle: async ({ params, principal }) => {
      const target = arrangeable(services, params, principal);
      const named = revisionNamer(services.users);
      const entries = layouts.history(target.subjectId, target.version);
      return { revisions: await Promise.all(entries.map(named)) };
    },
  });
  mountEndpoint(app, endpoints.save, {
    access: 'editor',
    handle: ({ params, body, principal }) => {
      const target = arrangeable(services, params, principal);
      const saved = layouts.save(target, body.layout, body.basedOn, actorOf(principal));
      return revisionNamer(services.users)(saved);
    },
  });
  mountEndpoint(app, endpoints.restore, {
    access: 'editor',
    handle: ({ params, body, principal }) => {
      const target = arrangeable(services, params, principal);
      const revision = Number(params.revision);
      const restored = layouts.restore(target, revision, body.basedOn, actorOf(principal));
      return revisionNamer(services.users)(restored);
    },
  });
}
