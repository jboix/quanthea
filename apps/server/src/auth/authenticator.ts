/** Turns a request into the principal it acts as: the user of its session cookie. */
import type { Principal } from '@quanthea/shared';
import type { Sessions } from './sessions.ts';
import type { Users } from './users.ts';

/** Identifies the principal behind a request. */
export interface Authenticator {
  /**
   * Identifies who sent a request.
   *
   * @param request - The incoming request.
   * @returns The principal, or `null` when the request carries no valid session.
   */
  authenticate(request: Request): Promise<Principal | null>;
}

/**
 * The session cookie's name. The `__Host-` prefix makes the browser refuse it unless it is Secure,
 * has `Path=/` and no `Domain`, so no other site or subdomain can set or read it.
 */
export const sessionCookieName = '__Host-querent_session';

/** What requests are signed in with. */
export interface AccountsAuthentication {
  /** The sessions. */
  readonly sessions: Sessions;
  /** The users. */
  readonly users: Pick<Users, 'principalOf'>;
}

/**
 * A cookie's value in a request.
 *
 * @param request - The request.
 * @param name - The cookie's name.
 * @returns The value, or `undefined` when the cookie is missing or appears more than once.
 */
export function cookieOf(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie') ?? '';
  const values = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  // Two cookies with the one name mean someone set a second one: trust neither.
  return values.length === 1 ? values[0] : undefined;
}

/**
 * Creates the authenticator.
 *
 * @param accounts - The sessions and users.
 * @returns The authenticator.
 */
export function createAuthenticator(accounts: AccountsAuthentication): Authenticator {
  return {
    authenticate: async (request) => {
      const cookie = cookieOf(request, sessionCookieName);
      if (cookie === undefined) return null;
      const session = await accounts.sessions.resolve(cookie);
      return session ? accounts.users.principalOf(session.userId) : null;
    },
  };
}
