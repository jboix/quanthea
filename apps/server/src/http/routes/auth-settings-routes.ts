/** Settings → Authentication, for admins: the mode, and threads from open access. */
import {
  adoptThreadsEndpoint,
  getAuthSettingsEndpoint,
  saveAuthSettingsEndpoint,
} from '@querent/shared';
import type { Hono } from 'hono';
import type { AuthModeControl } from '../../auth/auth-mode-control.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf } from '../principal.ts';

/**
 * Mounts the authentication settings endpoints.
 *
 * @param app - The app.
 * @param authMode - The authentication mode.
 */
export function mountAuthSettingsEndpoints(app: Hono<AppEnv>, authMode: AuthModeControl): void {
  mountEndpoint(app, getAuthSettingsEndpoint, { access: 'admin', handle: () => authMode.view() });
  mountEndpoint(app, saveAuthSettingsEndpoint, {
    access: 'admin',
    handle: ({ body, principal }) => {
      authMode.switchTo(body.mode, body.adoptTo, actorOf(principal));
      return authMode.view();
    },
  });
  mountEndpoint(app, adoptThreadsEndpoint, {
    access: 'admin',
    handle: ({ body, principal }) => ({ adopted: authMode.adopt(body.userId, actorOf(principal)) }),
  });
}
