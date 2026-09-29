/** Settings → Server: the system settings, read-only; and which settings the file manages. */
import {
  getManagedSettingsEndpoint,
  getServerSettingsEndpoint,
  type ServerSettingsView,
} from '@querent/shared';
import type { Hono } from 'hono';
import type { Managed } from '../../provisioning/managed.ts';
import type { ProvisioningStatus } from '../../provisioning/status.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';

/**
 * Mounts `GET /api/settings/server` and `GET /api/settings/managed`, for admins.
 *
 * @param app - The app.
 * @param view - The system settings, as read at startup.
 * @param managed - What the configuration file manages.
 * @param status - What the last application of the file left for admins to see.
 */
export function mountServerSettingsEndpoint(
  app: Hono<AppEnv>,
  view: ServerSettingsView,
  managed: Managed,
  status: ProvisioningStatus,
): void {
  mountEndpoint(app, getServerSettingsEndpoint, { access: 'admin', handle: () => view });
  mountEndpoint(app, getManagedSettingsEndpoint, {
    access: 'admin',
    handle: () => ({
      sections: managed.pathsOf('settings'),
      problem: status.problem(),
      restartNeeded: [...status.restartNeeded()],
    }),
  });
}
