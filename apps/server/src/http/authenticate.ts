/** Sets the request's principal on the context. Authorization happens per route. */
import type { MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Authenticator } from '../auth/authenticator.ts';
import type { AppEnv } from './app-env.ts';

/**
 * Creates the middleware that identifies the principal of every request.
 *
 * @param authenticator - Identifies principals for the active authentication mode.
 * @returns The middleware. It sets `principal`, `null` when the request has no valid session.
 */
export function authenticate(authenticator: Authenticator): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (context, next) => {
    context.set('principal', await authenticator.authenticate(context.req.raw));
    await next();
  });
}
