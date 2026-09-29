/**
 * Signing in and out, and setting or changing a password. They set or clear the session cookie,
 * so they are raw routes, each declaring its access and parsing its body with the shared schema.
 */
import {
  type AuthMode,
  apiPrefix,
  changePasswordEndpoint,
  setPasswordEndpoint,
  signInEndpoint,
  signOutEndpoint,
  signOutEverywhereEndpoint,
} from '@querent/shared';
import type { Context, Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { z } from 'zod';
import { cookieOf, sessionCookieName } from '../../auth/authenticator.ts';
import type { PasswordAccounts, SignedIn } from '../../auth/password-accounts.ts';
import { absoluteLimitMs, type Sessions } from '../../auth/sessions.ts';
import type { Users } from '../../auth/users.ts';
import { AppError } from '../../lib/errors.ts';
import { accessMiddleware } from '../access.ts';
import type { AppEnv } from '../app-env.ts';
import { clientAddress } from '../client-address.ts';
import { actorOf } from '../principal.ts';

/** The session cookie's name without its `__Host-` prefix, which Hono adds. */
const cookieBaseName = sessionCookieName.replace('__Host-', '');

/** What the authentication routes need. */
export interface AuthRouteServices {
  /** Gives the authentication mode in force. */
  readonly modeOf: () => AuthMode;
  /** The sessions, when the session key is set. */
  readonly sessions: Sessions | undefined;
  /** Password accounts, when the session key and the pepper are set. */
  readonly passwords: PasswordAccounts | undefined;
  /** The users. */
  readonly users: Pick<Users, 'principalOf'>;
  /** How many proxies in front of querent append to `X-Forwarded-For`. */
  readonly trustedProxyHops: number;
}

/**
 * Parses a request body with a schema.
 *
 * @param context - The request context.
 * @param schema - The schema.
 * @returns The body.
 * @throws {AppError} `bad_request` when it does not match.
 */
async function bodyOf<Schema extends z.ZodType>(
  context: Context<AppEnv>,
  schema: Schema,
): Promise<z.output<Schema>> {
  const parsed = schema.safeParse(await context.req.json().catch(() => undefined));
  if (!parsed.success) throw new AppError('bad_request', 'The request is invalid.');
  return parsed.data;
}

/**
 * The password accounts, or why passwords are off.
 *
 * @param services - The route services.
 * @returns The password accounts.
 * @throws {AppError} `bad_request` when the keys they need are not set.
 */
function passwordsOf(services: AuthRouteServices): PasswordAccounts {
  if (!services.passwords)
    throw new AppError(
      'bad_request',
      'Passwords need QUERENT_SESSION_KEY and QUERENT_PASSWORD_PEPPER on the server.',
    );
  return services.passwords;
}

/**
 * Sets the session cookie and answers with the principal.
 *
 * @param context - The request context.
 * @param services - The route services.
 * @param signedIn - The session.
 * @returns The response.
 */
async function signedInResponse(
  context: Context<AppEnv>,
  services: AuthRouteServices,
  signedIn: SignedIn,
): Promise<Response> {
  setCookie(context, cookieBaseName, signedIn.cookie, {
    prefix: 'host',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: absoluteLimitMs / 1000,
  });
  const principal = await services.users.principalOf(signedIn.userId);
  return context.json(signInEndpoint.output.parse({ principal }));
}

/**
 * Mounts sign-in and sign-out.
 *
 * @param app - The app.
 * @param services - The route services.
 */
function mountSignInRoutes(app: Hono<AppEnv>, services: AuthRouteServices): void {
  app.post(`${apiPrefix}${signInEndpoint.path}`, accessMiddleware('public'), async (context) => {
    if (services.modeOf() === 'none')
      throw new AppError('bad_request', 'Sign-in is off: everyone is an admin on this server.');
    const body = await bodyOf(context, signInEndpoint.body);
    const address = clientAddress(context, services.trustedProxyHops);
    const signedIn = await passwordsOf(services).signIn({ ...body, address });
    return signedInResponse(context, services, signedIn);
  });
  app.post(`${apiPrefix}${signOutEndpoint.path}`, accessMiddleware('public'), async (context) => {
    const cookie = cookieOf(context.req.raw, sessionCookieName);
    if (cookie !== undefined && services.sessions) await services.sessions.end(cookie);
    deleteCookie(context, cookieBaseName, { prefix: 'host', path: '/', secure: true });
    return context.json(signOutEndpoint.output.parse({ signedOut: true }));
  });
  const everywhere = `${apiPrefix}${signOutEverywhereEndpoint.path}`;
  app.post(everywhere, accessMiddleware('viewer'), (context) => {
    const ended = services.sessions?.endAllOf(actorOf(context.get('principal'))) ?? 0;
    deleteCookie(context, cookieBaseName, { prefix: 'host', path: '/', secure: true });
    return context.json(signOutEverywhereEndpoint.output.parse({ ended }));
  });
}

/**
 * Mounts setting a password through a link, and changing one.
 *
 * @param app - The app.
 * @param services - The route services.
 */
function mountPasswordRoutes(app: Hono<AppEnv>, services: AuthRouteServices): void {
  app.post(
    `${apiPrefix}${setPasswordEndpoint.path}`,
    accessMiddleware('public'),
    async (context) => {
      const body = await bodyOf(context, setPasswordEndpoint.body);
      const address = clientAddress(context, services.trustedProxyHops);
      const signedIn = await passwordsOf(services).setWithLink({ ...body, address });
      return signedInResponse(context, services, signedIn);
    },
  );
  const change = `${apiPrefix}${changePasswordEndpoint.path}`;
  app.post(change, accessMiddleware('viewer'), async (context) => {
    if (services.modeOf() === 'none')
      throw new AppError('bad_request', 'There are no passwords while everyone is an admin.');
    const body = await bodyOf(context, changePasswordEndpoint.body);
    const userId = actorOf(context.get('principal'));
    const signedIn = await passwordsOf(services).change({ userId, ...body });
    await signedInResponse(context, services, signedIn);
    return context.json(changePasswordEndpoint.output.parse({ changed: true }));
  });
}

/**
 * Mounts the authentication routes.
 *
 * @param app - The app.
 * @param services - The mode, sessions, password accounts, users and proxy hops.
 */
export function mountAuthRoutes(app: Hono<AppEnv>, services: AuthRouteServices): void {
  mountSignInRoutes(app, services);
  mountPasswordRoutes(app, services);
}
