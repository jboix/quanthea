/**
 * The bin endpoints: list and restore threads for editors, delete them for good and set how long
 * they are kept for admins.
 */
import {
  emptyBinEndpoint,
  getRetentionSettingsEndpoint,
  listBinEndpoint,
  purgeThreadEndpoint,
  restoreThreadEndpoint,
  saveRetentionSettingsEndpoint,
} from '@querent/shared';
import type { Hono } from 'hono';
import type { RetentionSettingsService } from '../../settings/retention-settings.ts';
import type { ThreadBin } from '../../threads/bin.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf } from '../principal.ts';

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

/**
 * Mounts the bin endpoints and the retention settings.
 *
 * @param app - The app.
 * @param bin - The bin of threads.
 * @param retention - The retention settings.
 */
export function mountBinEndpoints(
  app: Hono<AppEnv>,
  bin: ThreadBin,
  retention: RetentionSettingsService,
): void {
  mountRetentionEndpoints(app, retention);
  mountEndpoint(app, listBinEndpoint, {
    access: 'editor',
    handle: () => ({ threads: bin.list(), binDays: retention.get().binDays }),
  });
  mountEndpoint(app, restoreThreadEndpoint, {
    access: 'editor',
    handle: ({ params, principal }) => {
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
