/** The route tree (React Router data mode) and the browser router built from it. */
import type { ComponentType } from 'react';
import {
  createBrowserRouter,
  type LoaderFunctionArgs,
  type RouteObject,
  redirect,
} from 'react-router';
import type { ApiClient } from '../lib/api-client.ts';
import { binRoute } from '../routes/bin.tsx';
import { connectorRoutes } from '../routes/connectors.tsx';
import { dashboardRoutes } from '../routes/dashboard.tsx';
import { libraryRoute } from '../routes/library.tsx';
import { LoginRoute } from '../routes/login.tsx';
import { NotFoundRoute } from '../routes/not-found.tsx';
import { SettingsAuthRoute } from '../routes/settings-auth.tsx';
import { chartSettingsRoute } from '../routes/settings-charts.tsx';
import { SettingsLayout } from '../routes/settings-layout.tsx';
import { modelSettingsRoute } from '../routes/settings-model.tsx';
import { querySettingsRoute } from '../routes/settings-queries.tsx';
import { SettingsRetentionRoute } from '../routes/settings-retention.tsx';
import { usageSettingsRoute } from '../routes/settings-usage.tsx';
import { threadRoutes } from '../routes/thread.tsx';
import { UiKitRoute } from '../routes/ui-kit.tsx';
import { ErrorPage } from './error-page.tsx';
import { AppLayout, LoadingScreen } from './layout.tsx';
import { type GuardedPath, homePathFor, requireRole, routeAccess } from './route-access.ts';
import type { SessionLoader } from './session.ts';

/**
 * A screen route whose loader enforces the minimum role listed in {@link routeAccess}.
 *
 * @param loadSession - Loads the current session.
 * @param path - The screen path.
 * @param Component - The screen.
 * @returns The route object.
 */
function screen(
  loadSession: SessionLoader,
  path: GuardedPath,
  Component: ComponentType,
): RouteObject {
  return { path, loader: requireRole(loadSession, routeAccess[path]), Component };
}

/**
 * The login route. With a session (always the case in `none` mode) it sends the user onwards.
 *
 * @param loadSession - Loads the current session.
 * @returns The route object.
 */
function loginRoute(loadSession: SessionLoader): RouteObject {
  const loader = async ({ request }: LoaderFunctionArgs) => {
    if (!(await loadSession())) return null;
    const next = new URL(request.url).searchParams.get('next');
    return redirect(next?.startsWith('/') && !next.startsWith('//') ? next : '/');
  };
  return {
    path: '/login',
    loader,
    Component: LoginRoute,
    HydrateFallback: LoadingScreen,
    ErrorBoundary: ErrorPage,
  };
}

/** What the routes need from the app: the session and the API. */
interface RouteDependencies {
  /** Loads the current session. */
  readonly loadSession: SessionLoader;
  /** Calls the API. */
  readonly api: ApiClient;
}

/**
 * The screens inside the layout, with `/` redirecting by role and `/settings` to its first section.
 *
 * @param dependencies - The session loader and the API client.
 * @returns The child routes of the layout.
 */
function screenRoutes({ loadSession, api }: RouteDependencies): RouteObject[] {
  const home = async () => {
    const session = await loadSession();
    return redirect(session ? homePathFor(session.principal.role) : '/login');
  };
  return [
    { index: true, loader: home },
    ...threadRoutes(loadSession, api),
    libraryRoute(loadSession, api),
    ...dashboardRoutes(loadSession, api),
    binRoute(loadSession, api),
    connectorRoutes(loadSession, api),
    {
      path: '/settings',
      Component: SettingsLayout,
      children: [
        { index: true, loader: () => redirect('/settings/model') },
        modelSettingsRoute(loadSession, api),
        chartSettingsRoute(loadSession, api),
        querySettingsRoute(loadSession, api),
        usageSettingsRoute(loadSession, api),
        screen(loadSession, '/settings/auth', SettingsAuthRoute),
        screen(loadSession, '/settings/retention', SettingsRetentionRoute),
      ],
    },
    { path: '/ui', Component: UiKitRoute },
    { path: '*', Component: NotFoundRoute },
  ];
}

/**
 * The whole route tree. The root loader requires a session, so every screen below it can rely on
 * one. Screen errors render inside the layout, so the rail stays visible.
 *
 * @param dependencies - The session loader and the API client.
 * @returns The routes.
 */
export function createRoutes(dependencies: RouteDependencies): RouteObject[] {
  const { loadSession } = dependencies;
  return [
    loginRoute(loadSession),
    {
      id: 'root',
      path: '/',
      loader: requireRole(loadSession, 'viewer'),
      Component: AppLayout,
      HydrateFallback: LoadingScreen,
      ErrorBoundary: ErrorPage,
      children: [{ ErrorBoundary: ErrorPage, children: screenRoutes(dependencies) }],
    },
  ];
}

/**
 * Creates the browser router.
 *
 * @param dependencies - The session loader and the API client.
 * @returns The router to hand to `RouterProvider`.
 */
export function createAppRouter(dependencies: RouteDependencies) {
  return createBrowserRouter(createRoutes(dependencies));
}
