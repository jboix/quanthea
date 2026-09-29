/** Route access: every `/api` route is either public or declares its minimum role. */
import { apiPrefix, hasRole, type Role } from '@querent/shared';
import type { Hono, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { AppError } from '../lib/errors.ts';
import type { AppEnv } from './app-env.ts';

/** Who may call a route: anyone, or principals with at least a role. */
export type Access = 'public' | Role;

/** The access each access-checking middleware enforces, so the route table can be audited. */
const accessByMiddleware = new WeakMap<MiddlewareHandler<AppEnv>, Access>();

/**
 * Creates a middleware that lets through only principals with at least `minimum`.
 *
 * @param minimum - The weakest role allowed.
 * @returns The middleware. It answers 401 without a principal and 403 with a weaker role.
 */
export function requireRole(minimum: Role): MiddlewareHandler<AppEnv> {
  const middleware = createMiddleware<AppEnv>(async (context, next) => {
    const principal = context.get('principal');
    if (!principal) throw new AppError('unauthorized', 'Sign in to continue.');
    // The default admin chooses their own email and password before anything else.
    if (principal.setupRequired)
      throw new AppError('forbidden', 'Choose your own email and password first.');
    if (!hasRole(principal.role, minimum)) {
      throw new AppError('forbidden', `This needs the ${minimum} role or higher.`);
    }
    await next();
  });
  accessByMiddleware.set(middleware, minimum);
  return middleware;
}

/**
 * Creates a middleware that marks a route as public. It lets every request through.
 *
 * @returns The middleware.
 */
function allowAnyone(): MiddlewareHandler<AppEnv> {
  const middleware = createMiddleware<AppEnv>((_context, next) => next());
  accessByMiddleware.set(middleware, 'public');
  return middleware;
}

/**
 * Creates the middleware that enforces an access declaration.
 *
 * @param access - `public`, or the minimum role.
 * @returns The middleware to put in front of the route handler.
 */
export function accessMiddleware(access: Access): MiddlewareHandler<AppEnv> {
  return access === 'public' ? allowAnyone() : requireRole(access);
}

/** One `/api` route and the access it declares. */
export interface RouteAccess {
  /** The HTTP method. */
  readonly method: string;
  /** The Hono path pattern. */
  readonly path: string;
  /** The declared access, or `undefined` when the route declares none. */
  readonly access: Access | undefined;
}

/**
 * Lists every `/api` route of an app with the access it declares. Wildcard middleware
 * mounts (`/api/*`) are not routes and are left out.
 *
 * @param app - The app to audit.
 * @returns One entry per method and path.
 */
export function listApiRouteAccess(app: Hono<AppEnv>): RouteAccess[] {
  const routes = new Map<string, RouteAccess>();
  const apiRoutes = app.routes.filter(
    (route) => route.path.startsWith(`${apiPrefix}/`) && !route.path.endsWith('*'),
  );
  for (const route of apiRoutes) {
    const key = `${route.method} ${route.path}`;
    const declared = accessByMiddleware.get(route.handler as MiddlewareHandler<AppEnv>);
    const access = routes.get(key)?.access ?? declared;
    routes.set(key, { method: route.method, path: route.path, access });
  }
  return [...routes.values()];
}
