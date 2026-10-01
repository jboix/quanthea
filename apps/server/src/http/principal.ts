/** What routes read from the request's principal. */
import type { Principal } from '@quanthea/shared';
import { AppError } from '../lib/errors.ts';

/**
 * The actor recorded in the audit log. Guarded routes only run with a principal.
 *
 * @param principal - The request's principal.
 * @returns The principal id.
 */
export function actorOf(principal: Principal | null): string {
  return principal?.id ?? 'unknown';
}

/**
 * The principal of a request that needs one. Routes with a minimum role always have one.
 *
 * @param principal - The request's principal, if any.
 * @returns The principal.
 * @throws {AppError} `unauthorized` without one.
 */
export function signedIn(principal: Principal | null): Principal {
  if (!principal) throw new AppError('unauthorized', 'Sign in to continue.');
  return principal;
}
