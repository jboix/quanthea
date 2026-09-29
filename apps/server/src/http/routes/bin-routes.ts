/**
 * The bin endpoints: list and restore threads for editors, delete them for good and set how long
 * they are kept for admins.
 */
import {
  emptyBinEndpoint,
  getRetentionSettingsEndpoint,
  listBinEndpoint,
  type Principal,
  purgeThreadEndpoint,
  restoreThreadEndpoint,
  saveRetentionSettingsEndpoint,
} from '@querent/shared';
import type { Hono } from 'hono';
import type { Users } from '../../auth/users.ts';
import { AppError } from '../../lib/errors.ts';
import type { RetentionSettingsService } from '../../settings/retention-settings.ts';
import type { ThreadBin } from '../../threads/bin.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { canRead, ownerNames } from '../ownership.ts';
import { actorOf, signedIn } from '../principal.ts';

/**
 * Mounts the retention settings endpoints.
 *
 * @param app - The app.
 * @param retention - The retention settings.
 */
function mountRetentionEndpoints(app: Hono<AppEnv>, retention: RetentionSettingsService): void {
  mountEndpoint(app, getRetentionSettingsEndpoint, {
    access: 'admin',
    handle: () => retention.get(),
  });
  mountEndpoint(app, saveRetentionSettingsEndpoint, {
    access: 'admin',
    handle: ({ body, principal }) => retention.save(body, actorOf(principal)),
  });
}

/** What the bin endpoints need. */
export interface BinRouteServices {
  /** The bin of threads. */
  readonly bin: ThreadBin;
  /** The retention settings. */
  readonly retention: RetentionSettingsService;
  /** The users, for owners' names. */
  readonly users: Pick<Users, 'nameOf'>;
}

/**
 * The binned threads someone sees: their own, or everyone's for an admin, each named by its owner
 * when it is someone else's.
 *
 * @param services - The bin route services.
 * @param principal - Who asks.
 * @returns The threads.
 */
function binnedFor(services: BinRouteServices, principal: Principal) {
  const nameOf = ownerNames(services.users);
  const shown = services.bin.list().filter((thread) => canRead(principal, thread.ownerId));
  return Promise.all(
    shown.map(async ({ ownerId, ...thread }) => ({
      ...thread,
      ownerName: ownerId === principal.id ? null : await nameOf(ownerId),
    })),
  );
}

/**
 * Mounts the bin endpoints and the retention settings. Editors see and restore their own binned
 * threads; admins see, restore and delete everyone's.
 *
 * @param app - The app.
 * @param services - The bin, the retention settings and the users.
 */
export function mountBinEndpoints(app: Hono<AppEnv>, services: BinRouteServices): void {
  const { bin, retention } = services;
  mountRetentionEndpoints(app, retention);
  mountEndpoint(app, listBinEndpoint, {
    access: 'editor',
    handle: async ({ principal }) => ({
      threads: await binnedFor(services, signedIn(principal)),
      binDays: retention.get().binDays,
    }),
  });
  mountEndpoint(app, restoreThreadEndpoint, {
    access: 'editor',
    handle: ({ params, principal }) => {
      const binned = bin.list().find((thread) => thread.id === params.threadId);
      if (!binned || !canRead(signedIn(principal), binned.ownerId))
        throw new AppError('not_found', `No thread ${params.threadId} in the bin.`);
      bin.restore(params.threadId, actorOf(principal));
      return { restored: true as const };
    },
  });
  mountEndpoint(app, purgeThreadEndpoint, {
    access: 'admin',
    handle: ({ params, principal }) => {
      bin.purge(params.threadId, actorOf(principal));
      return { purged: true as const };
    },
  });
  mountEndpoint(app, emptyBinEndpoint, {
    access: 'admin',
    handle: ({ principal }) => ({ purged: bin.purgeAll(actorOf(principal)) }),
  });
}
