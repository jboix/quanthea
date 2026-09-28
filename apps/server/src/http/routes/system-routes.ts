/** Routes that describe the server and the caller: health and me. */
import { type AuthMode, healthEndpoint, meEndpoint } from '@querent/shared';
import type { Hono } from 'hono';
import { AppError } from '../../lib/errors.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';

/** What the system routes report. */
interface SystemInfo {
  /** The server version. */
  readonly version: string;
  /** The active authentication mode. */
  readonly authMode: AuthMode;
}

/**
 * Mounts `GET /api/health` and `GET /api/me`, both public.
 *
 * @param app - The app to mount on.
 * @param info - The version and authentication mode to report.
 */
export function mountSystemRoutes(app: Hono<AppEnv>, info: SystemInfo): void {
  mountEndpoint(app, healthEndpoint, {
    access: 'public',
    handle: () => ({ status: 'ok' as const, version: info.version }),
  });
  mountEndpoint(app, meEndpoint, {
    access: 'public',
    handle: ({ principal }) => {
      if (!principal) throw new AppError('unauthorized', 'Sign in to continue.');
      return { principal, authMode: info.authMode };
    },
  });
}
