/**
 * The external hosts endpoints: every signed-in person reads them, since the browser draws links
 * and images by them, and admins read and save them on the settings screen.
 */
import {
  getExternalHostsEndpoint,
  readExternalHostsEndpoint,
  saveExternalHostsEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { ExternalHostsService } from '../../settings/external-hosts.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf } from '../principal.ts';

/**
 * Mounts the external hosts endpoints.
 *
 * @param app - The app.
 * @param externalHosts - The external hosts.
 */
export function mountExternalHostEndpoints(
  app: Hono<AppEnv>,
  externalHosts: ExternalHostsService,
): void {
  mountEndpoint(app, readExternalHostsEndpoint, {
    access: 'viewer',
    handle: () => externalHosts.get(),
  });
  mountEndpoint(app, getExternalHostsEndpoint, {
    access: 'admin',
    handle: () => externalHosts.get(),
  });
  mountEndpoint(app, saveExternalHostsEndpoint, {
    access: 'admin',
    handle: ({ body, principal }) => externalHosts.save(body, actorOf(principal)),
  });
}
