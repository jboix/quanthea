/** The role of the person signed in, from the session the root route loads. */
import type { Role } from '@quanthea/shared';
import { useRouteLoaderData } from 'react-router';

/**
 * The person's role.
 *
 * @returns Their role; `viewer`, the weakest, before the session is known.
 */
export function useRole(): Role {
  const session = useRouteLoaderData('root') as { principal: { role: Role } } | undefined;
  return session?.principal.role ?? 'viewer';
}
