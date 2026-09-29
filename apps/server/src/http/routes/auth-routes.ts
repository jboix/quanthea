/** The sign-in and sign-out routes. They set and clear the session cookie, so they are raw routes. */
import { apiPrefix, signOutEndpoint } from '@querent/shared';
import type { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { cookieOf, sessionCookieName } from '../../auth/authenticator.ts';
import type { Sessions } from '../../auth/sessions.ts';
import { accessMiddleware } from '../access.ts';
import type { AppEnv } from '../app-env.ts';

/** The session cookie's name without its `__Host-` prefix, which Hono adds. */
const cookieBaseName = sessionCookieName.replace('__Host-', '');

/**
 * Mounts the authentication routes.
 *
 * @param app - The app.
 * @param sessions - The sessions, when the session key is set.
 */
export function mountAuthRoutes(app: Hono<AppEnv>, sessions: Sessions | undefined): void {
  app.post(`${apiPrefix}${signOutEndpoint.path}`, accessMiddleware('public'), async (context) => {
    const cookie = cookieOf(context.req.raw, sessionCookieName);
    if (cookie !== undefined && sessions) await sessions.end(cookie);
    deleteCookie(context, cookieBaseName, { prefix: 'host', path: '/', secure: true });
    return context.json(signOutEndpoint.output.parse({ signedOut: true }));
  });
}
