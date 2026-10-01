/** Whether the person may change dashboards and start threads. */
import { hasRole, type Role } from '@quanthea/shared';
import { useRouteLoaderData } from 'react-router';

/**
 * Whether the person is an editor or an admin, from the session the root route loads.
 *
 * @returns `true` for editors and admins.
 */
export function useCanEdit(): boolean {
  const session = useRouteLoaderData('root') as { principal: { role: Role } } | undefined;
  return session !== undefined && hasRole(session.principal.role, 'editor');
}
