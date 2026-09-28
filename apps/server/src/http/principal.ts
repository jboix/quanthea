/** What routes read from the request's principal. */
import type { Principal, Role } from '@querent/shared';

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
 * The role a guarded route acts with.
 *
 * @param principal - The request's principal.
 * @returns Its role; `viewer` when there is none, which guarded routes never see.
 */
export function roleOf(principal: Principal | null): Role {
  return principal?.role ?? 'viewer';
}
