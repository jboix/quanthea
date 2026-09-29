/** The users endpoints, for admins: list, invite, change, reset link, end sessions. */
import {
  endUserSessionsEndpoint,
  inviteUserEndpoint,
  listUsersEndpoint,
  resetLinkEndpoint,
  updateUserEndpoint,
} from '@querent/shared';
import type { Hono } from 'hono';
import type { PasswordAccounts } from '../../auth/password-accounts.ts';
import type { Sessions } from '../../auth/sessions.ts';
import { changeUser, type UserAdminDependencies } from '../../auth/user-admin.ts';
import type { Users } from '../../auth/users.ts';
import { AppError } from '../../lib/errors.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf } from '../principal.ts';

/** What the users endpoints need. */
export interface UserRouteServices {
  /** The users. */
  readonly users: Users;
  /** Password accounts, when the keys are set. */
  readonly passwords: PasswordAccounts | undefined;
  /** The sessions, when the session key is set. */
  readonly sessions: Sessions | undefined;
  /** What changing a user needs. */
  readonly userAdmin: UserAdminDependencies;
  /** querent's origin, when configured; links are relative without it. */
  readonly publicUrl: string | undefined;
}

/**
 * A link that sets a password: the token goes after the `#`, so it never reaches a server log or
 * a `Referer` header.
 *
 * @param services - The route services.
 * @param issued - The token and when it stops working.
 * @param issued.token - The token.
 * @param issued.expiresAt - When it stops working.
 * @returns The link and when it stops working.
 */
function linkOf(services: UserRouteServices, issued: { token: string; expiresAt: number }) {
  return {
    link: `${services.publicUrl ?? ''}/set-password#${issued.token}`,
    expiresAt: issued.expiresAt,
  };
}

/**
 * The password accounts, or why links cannot be made.
 *
 * @param services - The route services.
 * @returns The password accounts.
 * @throws {AppError} `bad_request` when the keys they need are not set.
 */
function passwordsOf(services: UserRouteServices): PasswordAccounts {
  if (!services.passwords)
    throw new AppError(
      'bad_request',
      'Password links need the session key and the password pepper. Settings → Server shows where they come from.',
    );
  return services.passwords;
}

/**
 * Mounts the users endpoints.
 *
 * @param app - The app.
 * @param services - The users, password accounts, sessions, admin dependencies and public URL.
 */
export function mountUserEndpoints(app: Hono<AppEnv>, services: UserRouteServices): void {
  const { users } = services;
  mountEndpoint(app, listUsersEndpoint, {
    access: 'admin',
    handle: async () => ({ users: await users.list() }),
  });
  mountEndpoint(app, inviteUserEndpoint, {
    access: 'admin',
    handle: async ({ body, principal }) => {
      const passwords = passwordsOf(services);
      const user = await users.create(body, actorOf(principal));
      const issued = await passwords.issueLink(user.id, 'invite', actorOf(principal));
      return { user, invite: linkOf(services, issued) };
    },
  });
  mountEndpoint(app, updateUserEndpoint, {
    access: 'admin',
    handle: async ({ params, body, principal }) => {
      changeUser(services.userAdmin, params.userId, body, actorOf(principal));
      return users.get(params.userId);
    },
  });
  mountAccessEndpoints(app, services);
}

/**
 * Mounts the endpoints that let a user back in or throw them out: a reset link, and ending their
 * sessions.
 *
 * @param app - The app.
 * @param services - The route services.
 */
function mountAccessEndpoints(app: Hono<AppEnv>, services: UserRouteServices): void {
  const { users } = services;
  mountEndpoint(app, resetLinkEndpoint, {
    access: 'admin',
    handle: async ({ params, principal }) => {
      const user = await users.get(params.userId);
      if (user.disabled)
        throw new AppError('bad_request', 'Enable the user before resetting their password.');
      return linkOf(
        services,
        await passwordsOf(services).issueLink(user.id, 'reset', actorOf(principal)),
      );
    },
  });
  mountEndpoint(app, endUserSessionsEndpoint, {
    access: 'admin',
    handle: ({ params }) => ({ ended: services.sessions?.endAllOf(params.userId) ?? 0 }),
  });
}
