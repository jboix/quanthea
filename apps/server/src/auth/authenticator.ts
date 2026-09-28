/** Turns a request into the principal it acts as, according to the authentication mode. */
import type { AuthMode, Principal } from '@querent/shared';

/** Identifies the principal behind a request. */
export interface Authenticator {
  /** The active authentication mode. */
  readonly mode: AuthMode;
  /**
   * Identifies who sent a request.
   *
   * @param request - The incoming request.
   * @returns The principal, or `null` when the request carries no valid session.
   */
  authenticate(request: Request): Promise<Principal | null>;
}

/** The principal of every request in `none` mode. */
export const anonymousAdmin: Principal = { id: 'anonymous', name: 'Anonymous', role: 'admin' };

/**
 * Creates the authenticator for a mode.
 *
 * @param mode - The active authentication mode.
 * @returns The authenticator.
 * @throws {Error} For `basic` and `oidc`, which are not implemented yet.
 */
export function createAuthenticator(mode: AuthMode): Authenticator {
  if (mode !== 'none') {
    throw new Error(
      `Authentication mode "${mode}" is not implemented. Start with QUERENT_AUTH_MODE=none.`,
    );
  }
  return { mode, authenticate: () => Promise.resolve(anonymousAdmin) };
}
