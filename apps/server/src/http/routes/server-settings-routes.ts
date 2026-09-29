/** Settings → Server: the system settings, read-only. */
import { getServerSettingsEndpoint, type ServerSettingsView } from '@querent/shared';
import type { Hono } from 'hono';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';

/**
 * Mounts `GET /api/settings/server`, for admins.
 *
 * @param app - The app.
 * @param view - The system settings, as read at startup.
 */
export function mountServerSettingsEndpoint(app: Hono<AppEnv>, view: ServerSettingsView): void {
  mountEndpoint(app, getServerSettingsEndpoint, { access: 'admin', handle: () => view });
}
