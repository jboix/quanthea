/** The minimum role of each screen (architecture, web routes), and the loaders that enforce it. */
import { hasRole, type Role } from '@querent/shared';
import { data, redirect } from 'react-router';
import type { Session, SessionLoader } from './session.ts';

/** Every guarded screen path and the weakest role that may open it. */
export const routeAccess = {
  '/threads/new': 'editor',
  '/threads/:threadId': 'editor',
  '/library': 'viewer',
  '/d/:dashboardId': 'viewer',
  '/d/:dashboardId/v/:version': 'viewer',
  '/d/:dashboardId/v/:version/panels/:panelId': 'viewer',
  '/d/:dashboardId/v/:version/options/:name': 'viewer',
  '/bin': 'editor',
  '/connectors': 'admin',
  '/connectors/new': 'admin',
  '/connectors/:connectorId': 'admin',
  '/connectors/:connectorId/edit': 'admin',
  '/connectors/:connectorId/health': 'admin',
  '/settings/model': 'admin',
  '/settings/auth': 'admin',
  '/settings/retention': 'admin',
} as const satisfies Record<string, Role>;

/** A guarded screen path. */
export type GuardedPath = keyof typeof routeAccess;

/**
 * Where `/` sends a user: editors start a thread, viewers browse the library.
 *
 * @param role - The user's role.
 * @returns The path to redirect to.
 */
export function homePathFor(role: Role): string {
  return hasRole(role, 'editor') ? '/threads/new' : '/library';
}

/**
 * Sends a user without a session to the login page, remembering where they were going.
 *
 * @param request - The navigation request.
 * @returns The redirect response to throw.
 */
function toLogin(request: Request): Response {
  const { pathname, search } = new URL(request.url);
  return redirect(`/login?next=${encodeURIComponent(pathname + search)}`);
}

/**
 * Loads the session for a route that needs at least `minimum`. Without a session it redirects to
 * the login page. With a weaker role it throws a 403 the error page shows as "your role can't
 * do this".
 *
 * @param loadSession - Loads the current session.
 * @param minimum - The weakest role allowed.
 * @returns The route loader. It resolves to the session.
 */
export function requireRole(
  loadSession: SessionLoader,
  minimum: Role,
): (args: { readonly request: Request }) => Promise<Session> {
  return async ({ request }) => {
    const session = await loadSession();
    if (!session) throw toLogin(request);
    if (!hasRole(session.principal.role, minimum)) {
      throw data({ minimum }, { status: 403, statusText: 'Forbidden' });
    }
    return session;
  };
}

/**
 * Wraps a loader or an action so it runs only for a role allowed on `path`. The API checks the
 * role again; this keeps the screen from calling it for nothing.
 *
 * @param loadSession - Loads the current session.
 * @param path - The guarded path whose minimum role applies.
 * @param handler - The loader or action.
 * @returns The guarded handler.
 */
export function guarded<Args extends { readonly request: Request }, Result>(
  loadSession: SessionLoader,
  path: GuardedPath,
  handler: (args: Args) => Promise<Result>,
): (args: Args) => Promise<Result> {
  const check = requireRole(loadSession, routeAccess[path]);
  return async (args) => {
    await check(args);
    return handler(args);
  };
}
