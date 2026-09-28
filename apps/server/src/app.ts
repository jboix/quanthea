/** The Hono app: middleware, `/api` routes, and the SPA with its `index.html` fallback. */
import { apiPrefix } from '@querent/shared';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import type { Authenticator } from './auth/authenticator.ts';
import type { AppEnv } from './http/app-env.ts';
import { authenticate } from './http/authenticate.ts';
import { handleErrors, handleNotFound } from './http/error-handling.ts';
import { logRequests } from './http/request-log.ts';
import { mountSystemRoutes } from './http/routes/system-routes.ts';
import { securityHeaders } from './http/security-headers.ts';
import { mountSpa } from './http/spa.ts';
import type { Logger } from './lib/logger.ts';

/** Everything the app needs from the bootstrap. */
export interface AppDependencies {
  /** The server version reported by `/api/health`. */
  readonly version: string;
  /** Identifies the principal of each request. */
  readonly authenticator: Authenticator;
  /** Receives request and error logs. */
  readonly logger: Logger;
  /** The directory holding the built SPA. */
  readonly webDir: string;
}

/**
 * Builds the app. It holds no global state, so tests build one per case.
 *
 * @param dependencies - The services the routes use.
 * @returns The app, ready for `Bun.serve` or `app.request()`.
 */
export function createApp(dependencies: AppDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(securityHeaders());
  app.use(logRequests(dependencies.logger));
  app.use(`${apiPrefix}/*`, authenticate(dependencies.authenticator));

  mountSystemRoutes(app, {
    version: dependencies.version,
    authMode: dependencies.authenticator.mode,
  });
  mountSpa(app, dependencies.webDir);

  app.onError(handleErrors(dependencies.logger));
  app.notFound(handleNotFound);
  return app;
}
