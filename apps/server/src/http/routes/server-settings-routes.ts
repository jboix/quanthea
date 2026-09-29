/**
 * Settings → Server: the system settings, read-only; which settings the configuration file manages;
 * and the current configuration exported as a file.
 */
import {
  exportConfigurationEndpoint,
  getManagedSettingsEndpoint,
  getServerSettingsEndpoint,
  type ServerSettingsView,
} from '@querent/shared';
import type { Hono } from 'hono';
import { type ExportServices, exportConfiguration } from '../../provisioning/export.ts';
import type { Managed } from '../../provisioning/managed.ts';
import type { ProvisioningStatus } from '../../provisioning/status.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';

/** What the server settings endpoints need. */
export interface ServerSettingsRouteServices extends ExportServices {
  /** The system settings, as read at startup. */
  readonly serverSettings: ServerSettingsView;
  /** What the configuration file manages. */
  readonly managed: Managed;
  /** What the last application of the file left for admins to see. */
  readonly provisioningStatus: ProvisioningStatus;
}

/**
 * Mounts `GET /api/settings/server`, `/managed` and `/export`, for admins.
 *
 * @param app - The app.
 * @param services - The system settings, what the file manages, and what export reads.
 */
export function mountServerSettingsEndpoints(
  app: Hono<AppEnv>,
  services: ServerSettingsRouteServices,
): void {
  const { managed, provisioningStatus: status } = services;
  mountEndpoint(app, getServerSettingsEndpoint, {
    access: 'admin',
    handle: () => services.serverSettings,
  });
  mountEndpoint(app, getManagedSettingsEndpoint, {
    access: 'admin',
    handle: () => ({
      sections: managed.pathsOf('settings'),
      problem: status.problem(),
      restartNeeded: [...status.restartNeeded()],
    }),
  });
  mountEndpoint(app, exportConfigurationEndpoint, {
    access: 'admin',
    handle: async () => ({
      filename: 'querent.yaml',
      yaml: await exportConfiguration(services, services.serverSettings),
    }),
  });
}
