/** The bin endpoints: list and restore threads for editors, delete them for good for admins. */
import {
  emptyBinEndpoint,
  listBinEndpoint,
  purgeThreadEndpoint,
  restoreThreadEndpoint,
} from '@querent/shared';
import type { Hono } from 'hono';
import type { ThreadBin } from '../../threads/bin.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf } from '../principal.ts';

/**
 * Mounts the bin endpoints.
 *
 * @param app - The app.
 * @param bin - The bin of threads.
 */
export function mountBinEndpoints(app: Hono<AppEnv>, bin: ThreadBin): void {
  mountEndpoint(app, listBinEndpoint, {
    access: 'editor',
    handle: () => ({ threads: bin.list() }),
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
